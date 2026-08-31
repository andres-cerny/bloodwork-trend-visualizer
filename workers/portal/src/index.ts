/**
 * Moje krev's API worker: accounts, and the reports they own.
 *
 * Auth is deliberately small: signup spends an invite code, login mails a
 * single-use link, the session is a signed cookie. No passwords exist to
 * leak, and no route ever confirms whether an e-mail is registered — the
 * login answer is the same sentence either way.
 *
 * Storage is deliberately dumb: the client builds a LabReport with lab-core
 * and this worker keeps it, whole, keyed to the account. Trends, review and
 * derived values are computed in the client from those payloads — the
 * parsing layer exists twice already, and a third copy in SQL would drift.
 * The one thing this worker does read out of a payload is the identity
 * fields, to make sure they are empty: identity is redacted in the browser,
 * and a client that forgot is corrected here rather than trusted.
 */
import { mintSession } from "@bw/gate";
import { SQL, type LoginTokenRow, type PageRow, type ReportRow, type UserRow } from "./db";
import { sendLoginLink, type MailEnv } from "./email";
import { monthOf, recordUserSpendUsd, userBudget } from "./ledger";
import {
  clearCookieHeader,
  mintCookieToken,
  newLoginToken,
  readCookie,
  setCookieHeader,
  sha256Hex,
  verifyCookieToken,
} from "./session";

export interface Env extends MailEnv {
  DB: D1Database;
  /** Redacted page images, keyed `${uid}/${reportId}/page_${n}`. */
  PAGES: KVNamespace;
  /** The per-person monthly ledger (src/ledger.ts). */
  BUDGET: KVNamespace;
  /** moje-krev-extract, reached only through this binding. */
  EXTRACT: Fetcher;
  SESSION_SECRET: string;
  /** Paired with moje-krev-extract's SESSION_SECRET; mints its page sessions. */
  EXTRACT_SESSION_SECRET: string;
  SESSION_TTL_DAYS?: string;
  LOGIN_TOKEN_TTL_MINUTES?: string;
  PORTAL_USD_LIMIT?: string;
  MAX_PAGES_PER_REPORT?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const sessionTtlSeconds = (env: Env) => (parseInt(env.SESSION_TTL_DAYS ?? "90", 10) || 90) * 86400;
const tokenTtlSeconds = (env: Env) => (parseInt(env.LOGIN_TOKEN_TTL_MINUTES ?? "15", 10) || 15) * 60;
const usdLimit = (env: Env) => parseFloat(env.PORTAL_USD_LIMIT ?? "5") || 5;
const maxPages = (env: Env) => parseInt(env.MAX_PAGES_PER_REPORT ?? "30", 10) || 30;

/** One extract call covers one page and lives five minutes — long enough for
 *  the slowest model round-trip, short enough that a leaked token is worth
 *  nothing by the time anyone reads it. */
const EXTRACT_SESSION_TTL = 300;

/** A page image for storage: a JPEG of an A4 page at display resolution is
 *  ~200 KB, so this is generous, and KV's own cap is 25 MB. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
/** A LabReport JSON: a thirty-page report with bboxes is well under 1 MB. */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_EXTRACT_BYTES = 6 * 1024 * 1024;

/** Enough to catch typos; the delivered link is the real verification. */
const looksLikeEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const now = () => Math.floor(Date.now() / 1000);

/**
 * The uid is re-read from the database on every authed request, not trusted
 * from the cookie alone: it is what makes account deletion effective — a
 * signed cookie for a deleted row is a 401, not a ghost login.
 */
async function requireUser(request: Request, env: Env): Promise<UserRow | null> {
  const claims = await verifyCookieToken(env.SESSION_SECRET, readCookie(request));
  if (!claims) return null;
  return await env.DB.prepare(SQL.userById).bind(claims.uid).first<UserRow>();
}

const unauthorized = () => json({ error: "unauthorized", message: "Přihlaste se prosím." }, 401);

/** Create a login token for the user and mail (or, in dev, return) the link. */
async function issueLoginLink(env: Env, origin: string, user: UserRow): Promise<Response> {
  // At most 5 links per user per hour. Not a security boundary — the token is
  // unguessable — but a cap on how much mail a stuck retry loop can send.
  const since = now() - 3600;
  const recent = await env.DB.prepare(SQL.countRecentLoginTokens)
    .bind(user.id, since)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) {
    return json({ error: "too_many_requests", message: "Příliš mnoho žádostí. Zkuste to za hodinu." }, 429);
  }

  const token = newLoginToken();
  await env.DB.prepare(SQL.insertLoginToken)
    .bind(await sha256Hex(token), user.id, now(), now() + tokenTtlSeconds(env))
    .run();

  const link = `${origin}/api/auth/confirm?token=${token}`;
  const result = await sendLoginLink(env, user.email, link);
  if (!result.sent && "error" in result) {
    return json({ error: "mail_failed", message: "Odkaz se nepodařilo odeslat. Zkuste to prosím znovu." }, 502);
  }
  return json({
    ok: true,
    message: "Pokud e-mail známe, poslali jsme na něj přihlašovací odkaz.",
    ...("devLink" in result ? { devLink: result.devLink } : {}),
  });
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const { invite, email } = (await request.json().catch(() => ({}))) as {
    invite?: string;
    email?: string;
  };
  if (typeof invite !== "string" || !invite.trim() || !looksLikeEmail(email)) {
    return json({ error: "bad_request", message: "Vyplňte pozvánkový kód a platný e-mail." }, 400);
  }
  const normEmail = email.trim().toLowerCase();
  const code = invite.trim();

  const inviteRow = await env.DB.prepare(SQL.inviteByCode)
    .bind(code)
    .first<{ code: string; used_by: string | null }>();
  if (!inviteRow || inviteRow.used_by) {
    return json({ error: "invite_invalid", message: "Pozvánkový kód není platný." }, 403);
  }
  if (await env.DB.prepare(SQL.userByEmail).bind(normEmail).first<UserRow>()) {
    return json(
      { error: "email_taken", message: "Tento e-mail už účet má. Přihlaste se odkazem." },
      409,
    );
  }

  const user: UserRow = { id: crypto.randomUUID(), email: normEmail, created_at: new Date().toISOString() };
  await env.DB.prepare(SQL.insertUser).bind(user.id, user.email, user.created_at).run();

  // The conditional UPDATE is the single-use guarantee. Losing the race means
  // another registration spent this code between our check and now — undo the
  // user row rather than leaving an account no invite paid for.
  const burned = await env.DB.prepare(SQL.burnInvite).bind(code, user.id, user.created_at).run();
  if (!burned.meta || burned.meta.changes !== 1) {
    await env.DB.prepare(SQL.deleteUser).bind(user.id).run();
    return json({ error: "invite_invalid", message: "Pozvánkový kód není platný." }, 403);
  }

  return issueLoginLink(env, new URL(request.url).origin, user);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email } = (await request.json().catch(() => ({}))) as { email?: string };
  if (!looksLikeEmail(email)) {
    return json({ error: "bad_request", message: "Zadejte platný e-mail." }, 400);
  }
  const user = await env.DB.prepare(SQL.userByEmail).bind(email.trim().toLowerCase()).first<UserRow>();
  // The same sentence whether the account exists or not, so the login form
  // cannot be used to enumerate who has one.
  if (!user) return json({ ok: true, message: "Pokud e-mail známe, poslali jsme na něj přihlašovací odkaz." });
  return issueLoginLink(env, new URL(request.url).origin, user);
}

async function handleConfirm(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const fail = () =>
    new Response(null, { status: 302, headers: { location: "/?prihlaseni=neplatne" } });
  if (!token) return fail();

  const row = await env.DB.prepare(SQL.loginTokenByHash)
    .bind(await sha256Hex(token))
    .first<LoginTokenRow>();
  if (!row || row.used_at !== null || row.expires_at < now()) return fail();

  // Spend before minting: a link that lost this race logs nobody in twice.
  const spent = await env.DB.prepare(SQL.spendLoginToken).bind(row.token_hash, now()).run();
  if (!spent.meta || spent.meta.changes !== 1) return fail();

  const ttl = sessionTtlSeconds(env);
  const cookie = await mintCookieToken(env.SESSION_SECRET, row.user_id, ttl);
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": setCookieHeader(cookie, ttl) },
  });
}

/* ---------------------------------------------------------------- extract */

/**
 * One page to the extractor, on the account's own ledger.
 *
 * The extractor's contract is the demo's: a session header and a page. This
 * worker holds that contract on the user's behalf — one single-page session
 * per call, minted with the secret it shares with moje-krev-extract — so the
 * browser never sees an extract token and the demo's Turnstile door stays
 * shut. Spend the extractor reports is booked against the person, and a
 * frozen person is refused here before anything is sent.
 */
async function handleExtract(request: Request, env: Env, user: UserRow): Promise<Response> {
  const limit = usdLimit(env);
  const before = await userBudget(env.BUDGET, user.id, limit);
  if (before.frozen) {
    return json(
      {
        error: "budget_exhausted",
        message: `Měsíční limit zpracování (${limit} USD) je vyčerpán. Obnoví se začátkem příštího měsíce.`,
        budget: before,
      },
      402,
    );
  }

  const body = await request.text();
  if (body.length > MAX_EXTRACT_BYTES) return json({ error: "too_large", message: "Stránka je příliš velká." }, 413);

  const session = await mintSession(env.EXTRACT_SESSION_SECRET, EXTRACT_SESSION_TTL, 1);
  const res = await env.EXTRACT.fetch(
    new Request("https://extract/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", "x-demo-session": session },
      body,
    }),
  );
  const data = (await res.json().catch(() => ({}))) as {
    costUsd?: number;
    error?: string;
    message?: string;
    budget?: unknown;
  };

  if (res.ok && typeof data.costUsd === "number") {
    await recordUserSpendUsd(env.BUDGET, user.id, monthOf(), data.costUsd);
  } else if (!res.ok) {
    // The extractor's reason, in the log as well as in the answer: a page that
    // fails for every member of the family is a deployment problem, and the
    // log is where the operator looks first.
    console.error(`extract refused: ${res.status} ${data.error ?? ""} ${data.message ?? ""}`.trim());
  }
  // The extractor's own ceiling is the family's shared fuse; its message is
  // written for the demo, so it is replaced. Its `budget` is the capability
  // ledger, which is nobody's business here — the person's is returned.
  const message =
    data.error === "budget_exhausted"
      ? "Zpracování je dočasně pozastaveno — společný limit je vyčerpán."
      : data.message;
  return json(
    { ...data, ...(message !== undefined ? { message } : {}), budget: await userBudget(env.BUDGET, user.id, limit) },
    res.status,
  );
}

/* ---------------------------------------------------------------- reports */

const pageKey = (uid: string, reportId: string, n: number) => `${uid}/${reportId}/page_${n}`;
const pageRoute = (reportId: string, n: number) => `/api/pages/${reportId}/${n}`;

interface StoredPage {
  pageNum: number;
  imageWidth: number;
  imageHeight: number;
}

/**
 * The stored shape of a report: the client's LabReport with two corrections.
 * Identity is emptied whatever the client sent, and page images are named by
 * route rather than carried inline — a data: URL in a payload would be the
 * image stored twice.
 */
function sanitizeReport(id: string, body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  if (r.id !== id || !Array.isArray(r.measurements) || !Array.isArray(r.pages)) return null;
  const pages: StoredPage[] = [];
  for (const p of r.pages as Array<Record<string, unknown>>) {
    if (!p || typeof p.pageNum !== "number") return null;
    pages.push({
      pageNum: p.pageNum,
      imageWidth: typeof p.imageWidth === "number" ? p.imageWidth : 0,
      imageHeight: typeof p.imageHeight === "number" ? p.imageHeight : 0,
    });
  }
  return {
    ...r,
    patientName: null,
    patientId: null,
    pages,
    reportDate: typeof r.reportDate === "string" ? r.reportDate : null,
    labName: typeof r.labName === "string" ? r.labName : null,
    sourceFile: typeof r.sourceFile === "string" ? r.sourceFile : "",
  };
}

/** A stored payload as the client reads it: page images by route. */
function presentReport(row: ReportRow): unknown {
  const r = JSON.parse(row.payload) as { pages?: StoredPage[] };
  return {
    ...r,
    pages: (r.pages ?? []).map((p) => ({ ...p, imageUrl: pageRoute(row.id, p.pageNum) })),
  };
}

async function listReports(env: Env, user: UserRow): Promise<Response> {
  const { results } = await env.DB.prepare(SQL.reportsForUser).bind(user.id).all<ReportRow>();
  return json(results.map(presentReport));
}

async function putReport(request: Request, env: Env, user: UserRow, id: string): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_PAYLOAD_BYTES) return json({ error: "too_large", message: "Report je příliš velký." }, 413);
  const report = sanitizeReport(id, JSON.parse(text.length ? text : "null"));
  if (!report) return json({ error: "bad_request", message: "Neplatný report." }, 400);

  const saved = await env.DB.prepare(SQL.upsertReport)
    .bind(id, user.id, report.reportDate, report.labName, JSON.stringify(report), new Date().toISOString())
    .run();
  // Zero changes on an upsert means the id exists and belongs to someone
  // else: the conflict branch's WHERE refused it.
  if (!saved.meta || saved.meta.changes !== 1) return json({ error: "forbidden", message: "Report nepatří k tomuto účtu." }, 403);
  return json({ ok: true });
}

/** The report row, if it is this user's. */
async function ownedReport(env: Env, user: UserRow, id: string): Promise<boolean> {
  const row = await env.DB.prepare(SQL.reportOwner).bind(id).first<{ id: string; user_id: string }>();
  return !!row && row.user_id === user.id;
}

async function putPage(request: Request, env: Env, user: UserRow, id: string, n: number): Promise<Response> {
  if (!(await ownedReport(env, user, id))) return json({ error: "not_found" }, 404);
  const type = request.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ error: "bad_request", message: "Očekáván obrázek stránky." }, 400);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PAGE_BYTES) {
    return json({ error: "too_large", message: "Obrázek stránky je příliš velký." }, 413);
  }
  const width = parseInt(request.headers.get("x-image-width") ?? "0", 10) || null;
  const height = parseInt(request.headers.get("x-image-height") ?? "0", 10) || null;
  const key = pageKey(user.id, id, n);
  await env.PAGES.put(key, bytes, { metadata: { type } });
  await env.DB.prepare(SQL.upsertPage).bind(id, n, key, width, height).run();
  return json({ ok: true, imageUrl: pageRoute(id, n) });
}

async function getPage(env: Env, user: UserRow, id: string, n: number): Promise<Response> {
  // The key carries the uid, so a page of someone else's report is not a
  // forbidden read — it is a key that does not exist.
  const { value, metadata } = await env.PAGES.getWithMetadata<{ type?: string }>(pageKey(user.id, id, n), "arrayBuffer");
  if (!value) return json({ error: "not_found" }, 404);
  return new Response(value, {
    headers: {
      "content-type": metadata?.type ?? "image/jpeg",
      "cache-control": "private, max-age=86400",
    },
  });
}

/** Row and images together — a report is never half-deleted. */
async function deleteReport(env: Env, user: UserRow, id: string): Promise<Response> {
  if (!(await ownedReport(env, user, id))) return json({ error: "not_found" }, 404);
  const { results } = await env.DB.prepare(SQL.pagesForReport).bind(id).all<PageRow>();
  await Promise.all(results.map((p) => env.PAGES.delete(p.kv_key)));
  await env.DB.prepare(SQL.deletePages).bind(id).run();
  await env.DB.prepare(SQL.deleteReport).bind(id, user.id).run();
  return json({ ok: true, pagesDeleted: results.length });
}

/* --------------------------------------------------------------- settings */

const MAX_SETTINGS_BYTES = 64 * 1024;

async function getSettings(env: Env, user: UserRow): Promise<Response> {
  const row = await env.DB.prepare(SQL.settingsForUser).bind(user.id).first<{ settings: string | null }>();
  return json(row?.settings ? JSON.parse(row.settings) : {});
}

async function putSettings(request: Request, env: Env, user: UserRow): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_SETTINGS_BYTES) return json({ error: "too_large" }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "bad_request" }, 400);
  await env.DB.prepare(SQL.saveSettings).bind(user.id, JSON.stringify(parsed)).run();
  return json({ ok: true });
}

/* ----------------------------------------------------------------- router */

const REPORT = /^\/api\/reports\/([^/]+)$/;
const PAGE = /^\/api\/(?:reports|pages)\/([^/]+)\/(\d{1,3})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    switch (route) {
      case "POST /api/auth/register":
        return handleRegister(request, env);
      case "POST /api/auth/login":
        return handleLogin(request, env);
      case "GET /api/auth/confirm":
        return handleConfirm(request, env);
      case "POST /api/auth/logout":
        return new Response(null, { status: 204, headers: { "set-cookie": clearCookieHeader() } });
    }

    // Everything below is the account's own data.
    const user = await requireUser(request, env);
    if (!user) return unauthorized();

    switch (route) {
      case "GET /api/me":
        return json({ email: user.email, createdAt: user.created_at });
      case "GET /api/status":
        return json({ budget: await userBudget(env.BUDGET, user.id, usdLimit(env)), maxPages: maxPages(env) });
      case "POST /api/extract":
        return handleExtract(request, env, user);
      case "GET /api/reports":
        return listReports(env, user);
      case "GET /api/settings":
        return getSettings(env, user);
      case "PUT /api/settings":
        return putSettings(request, env, user);
    }

    const page = PAGE.exec(url.pathname);
    if (page) {
      const [, id, n] = page;
      const pageNum = parseInt(n, 10);
      if (!REPORT_ID.test(id) || pageNum < 1 || pageNum > maxPages(env)) return json({ error: "not_found" }, 404);
      if (request.method === "PUT" && url.pathname.startsWith("/api/reports/")) return putPage(request, env, user, id, pageNum);
      if (request.method === "GET" && url.pathname.startsWith("/api/pages/")) return getPage(env, user, id, pageNum);
    }
    const report = REPORT.exec(url.pathname);
    if (report && REPORT_ID.test(report[1])) {
      if (request.method === "PUT") return putReport(request, env, user, report[1]);
      if (request.method === "DELETE") return deleteReport(env, user, report[1]);
    }
    return json({ error: "not_found" }, 404);
  },
} satisfies ExportedHandler<Env>;
