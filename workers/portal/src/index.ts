/**
 * Moje krev's API worker: accounts, and the reports they own.
 *
 * Auth is deliberately small: e-mail and password, the session a signed
 * cookie. Sign-up is a link the operator sends — a code that lives a week
 * and spends once — and so is a forgotten password: the same kind of code,
 * bound to the account it resets. No route ever confirms whether an e-mail
 * is registered: a wrong password and an unknown address get one sentence,
 * and a spent, expired or foreign code gets another, whichever it was.
 *
 * Storage is deliberately dumb: the client builds a LabReport with lab-core
 * and this worker keeps it, whole, keyed to the account. Trends, review and
 * derived values are computed in the client from those payloads — the
 * parsing layer exists twice already, and a third copy in SQL would drift.
 * The one thing this worker does read out of a payload is the identity
 * fields, to make sure they are empty: identity is redacted in the browser,
 * and a client that forgot is corrected here rather than trusted.
 *
 * One page is public: /ai/<token>, the text a person's own AI assistant
 * fetches when they paste their share link. It sits above the login gate,
 * answers by the token's hash alone, and says the same 404 for a token that
 * is expired, revoked, unknown or malformed — the page must not be a way to
 * learn which tokens ever existed. It is HTML, always: ChatGPT's browser
 * opens HTML and refuses "a Markdown file", and it refused one again when
 * the page negotiated on Accept — so nothing about the address or the
 * response may say markdown. The old `.md` address redirects to the bare one.
 */
import { mintSession } from "@bw/gate";
import { SQL, type AiShareRow, type InviteRow, type PageRow, type ReportRow, type UserRow } from "./db";
import { monthOf, recordUserSpendUsd, userBudget } from "./ledger";
import { DUMMY_RECORD, hashPassword, verifyPassword } from "./password";
import {
  clearCookieHeader,
  mintCookieToken,
  newLoginToken,
  readCookie,
  setCookieHeader,
  sha256Hex,
  verifyCookieToken,
} from "./session";

export interface Env {
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
  PORTAL_USD_LIMIT?: string;
  MAX_PAGES_PER_REPORT?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const sessionTtlSeconds = (env: Env) => (parseInt(env.SESSION_TTL_DAYS ?? "90", 10) || 90) * 86400;
const usdLimit = (env: Env) => parseFloat(env.PORTAL_USD_LIMIT ?? "5") || 5;

/**
 * What this person may spend in a month.
 *
 * `budget_usd` on the account wins over the deployment-wide
 * `PORTAL_USD_LIMIT`, so one person can be raised — or paused — without
 * moving anyone else. `??` and not `||` on purpose: a stored 0 is a
 * deliberate freeze and must not fall through to the default the way an
 * empty env var does.
 */
const limitFor = (user: UserRow, env: Env) => user.budget_usd ?? usdLimit(env);
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

/** Length is the only password rule; it is a demo and length is the rule
 *  that helps. The ceiling bounds the hash's CPU, nothing else. */
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 256;
/** Ten wrong tries on one e-mail in fifteen minutes, and that e-mail waits
 *  fifteen minutes — whether or not it has an account. */
const LOCKOUT_FAILURES = 10;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;

/** Enough to catch typos; the delivered link is the real verification. */
const looksLikeEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

const passwordOk = (s: unknown): s is string =>
  typeof s === "string" && s.length >= MIN_PASSWORD && s.length <= MAX_PASSWORD;

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const now = () => Math.floor(Date.now() / 1000);
const nowIso = () => new Date().toISOString();

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

/* ------------------------------------------------------------------- auth */

/** Every way a code can be no good gets this one answer. */
const inviteDead = (status = 403) =>
  json({ error: "invite_invalid", message: "Odkaz už neplatí. Napište mi a pošlu nový." }, status);

/** Wrong password and unknown e-mail: one sentence, one status. */
const badLogin = () => json({ error: "invalid_login", message: "E-mail nebo heslo nesouhlasí." }, 401);

/** A 200 with the session cookie set — the end of register, login and reset. */
async function loggedIn(env: Env, uid: string): Promise<Response> {
  const ttl = sessionTtlSeconds(env);
  const cookie = await mintCookieToken(env.SESSION_SECRET, uid, ttl);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "set-cookie": setCookieHeader(cookie, ttl) },
  });
}

/** The invite row if it exists, is unspent and has not run out; else null. */
async function liveInvite(env: Env, code: unknown): Promise<InviteRow | null> {
  if (typeof code !== "string" || !code.trim()) return null;
  const row = await env.DB.prepare(SQL.inviteByCode).bind(code.trim()).first<InviteRow>();
  if (!row || row.used_at !== null) return null;
  if (row.expires_at !== null && row.expires_at <= nowIso()) return null;
  return row;
}

/** Spend the code for this account. False means someone else got there first. */
async function burnInvite(env: Env, code: string, uid: string): Promise<boolean> {
  const burned = await env.DB.prepare(SQL.burnInvite).bind(code, uid, nowIso()).run();
  return !!burned.meta && burned.meta.changes === 1;
}

/** What kind of link this is, so the page can show the right form or the refusal. */
async function inviteKind(env: Env, rawCode: string): Promise<Response> {
  let code: string;
  try {
    code = decodeURIComponent(rawCode);
  } catch {
    // A malformed percent-escape is not a code; it is not a crash either.
    return inviteDead(404);
  }
  const invite = await liveInvite(env, code);
  if (!invite) return inviteDead(404);
  return json({ kind: invite.user_id ? "password" : "signup" });
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const { code, email, password } = (await request.json().catch(() => ({}))) as {
    code?: string;
    email?: string;
    password?: string;
  };
  if (!looksLikeEmail(email) || !passwordOk(password)) {
    return json({ error: "bad_request", message: `Vyplňte platný e-mail a heslo o nejméně ${MIN_PASSWORD} znacích.` }, 400);
  }
  const invite = await liveInvite(env, code);
  // A bound code is a set-password link; it opens no new account.
  if (!invite || invite.user_id !== null) return inviteDead();

  const normEmail = email.trim().toLowerCase();
  // The same refusal as a dead code: a person holding a link must not learn
  // from it which addresses already have an account.
  if (await env.DB.prepare(SQL.userByEmail).bind(normEmail).first<UserRow>()) return inviteDead();

  const record = await hashPassword(password);
  const uid = crypto.randomUUID();
  await env.DB.prepare(SQL.insertUser).bind(uid, normEmail, nowIso(), record.hash, record.salt, record.iters).run();

  // The conditional UPDATE is the single-use guarantee. Losing the race means
  // another registration spent this code between our check and now — undo the
  // user row rather than leaving an account no invite paid for.
  if (!(await burnInvite(env, invite.code, uid))) {
    await env.DB.prepare(SQL.deleteUser).bind(uid).run();
    return inviteDead();
  }
  return loggedIn(env, uid);
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const { email, password } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!looksLikeEmail(email) || typeof password !== "string" || password.length > MAX_PASSWORD) {
    return json({ error: "bad_request", message: "Zadejte e-mail a heslo." }, 400);
  }
  const normEmail = email.trim().toLowerCase();

  const since = now() - LOCKOUT_WINDOW_SECONDS;
  const recent = await env.DB.prepare(SQL.countLoginFailures).bind(normEmail, since).first<{ n: number }>();
  if ((recent?.n ?? 0) >= LOCKOUT_FAILURES) {
    return json({ error: "locked", message: "Příliš mnoho pokusů. Zkuste to znovu za 15 minut." }, 429);
  }

  const user = await env.DB.prepare(SQL.userByEmail).bind(normEmail).first<UserRow>();
  // An account without a password (made before passwords existed) is
  // verified against the dummy like an unknown address: same time, same no.
  const record =
    user && user.password_hash && user.password_salt && user.password_iters
      ? { hash: user.password_hash, salt: user.password_salt, iters: user.password_iters }
      : DUMMY_RECORD;
  const ok = (await verifyPassword(password, record)) && record !== DUMMY_RECORD;
  if (!ok || !user) {
    await env.DB.prepare(SQL.insertLoginFailure).bind(normEmail, now()).run();
    await env.DB.prepare(SQL.pruneLoginFailures).bind(since).run();
    return badLogin();
  }
  await env.DB.prepare(SQL.clearLoginFailures).bind(normEmail).run();
  return loggedIn(env, user.id);
}

/** A set-password link: the code names the account, the password replaces
 *  whatever it had — including nothing. Reports are not touched. */
async function handleSetPassword(request: Request, env: Env): Promise<Response> {
  const { code, password } = (await request.json().catch(() => ({}))) as { code?: string; password?: string };
  if (!passwordOk(password)) {
    return json({ error: "bad_request", message: `Heslo musí mít nejméně ${MIN_PASSWORD} znaků.` }, 400);
  }
  const invite = await liveInvite(env, code);
  if (!invite || invite.user_id === null) return inviteDead();
  const user = await env.DB.prepare(SQL.userById).bind(invite.user_id).first<UserRow>();
  if (!user) return inviteDead();

  // Spend before writing: a link that lost this race changes nothing.
  if (!(await burnInvite(env, invite.code, user.id))) return inviteDead();
  const record = await hashPassword(password);
  await env.DB.prepare(SQL.setPassword).bind(user.id, record.hash, record.salt, record.iters).run();
  await env.DB.prepare(SQL.clearLoginFailures).bind(user.email).run();
  return loggedIn(env, user.id);
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
  const limit = limitFor(user, env);
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
  // Streamed answer: rows as they are written, then a final "done" line
  // that is the buffered answer. Lines pass through untouched except the
  // last, which is where the cost is booked and the person's budget added —
  // the same two things the buffered path does to its one object.
  const type = res.headers.get("content-type") ?? "";
  if (res.ok && type.includes("x-ndjson") && res.body) {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    let tail = "";
    const rewrite = async (text: string): Promise<string> => {
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(text);
      } catch {
        return text;
      }
      if (ev.type !== "done" && ev.type !== "error") return text;
      const { type: _t, ...data } = ev;
      const shaped = await settle(env, user, ev.type === "done" ? 200 : 502, data as ExtractAnswer);
      return JSON.stringify({ type: ev.type, ...shaped });
    };
    const through = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, ctrl) {
        tail += dec.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = tail.indexOf("\n")) >= 0) {
          const one = tail.slice(0, nl);
          tail = tail.slice(nl + 1);
          ctrl.enqueue(enc.encode((await rewrite(one)) + "\n"));
        }
      },
      async flush(ctrl) {
        if (tail.trim()) ctrl.enqueue(enc.encode((await rewrite(tail)) + "\n"));
      },
    });
    return new Response(res.body.pipeThrough(through), {
      status: 200,
      headers: { "content-type": type, "cache-control": "no-store" },
    });
  }

  const data = (await res.json().catch(() => ({}))) as ExtractAnswer;
  return json(await settle(env, user, res.status, data), res.status);
}

interface ExtractAnswer {
  costUsd?: number;
  error?: string;
  message?: string;
  budget?: unknown;
}

/** Book the extractor's cost to the person and answer with their ledger. */
async function settle(env: Env, user: UserRow, status: number, data: ExtractAnswer): Promise<Record<string, unknown>> {
  const limit = limitFor(user, env);
  if (status === 200 && typeof data.costUsd === "number") {
    await recordUserSpendUsd(env.BUDGET, user.id, monthOf(), data.costUsd);
  } else if (status !== 200) {
    // The extractor's reason, in the log as well as in the answer: a page that
    // fails for every member of the family is a deployment problem, and the
    // log is where the operator looks first. Its `message` is deliberately not
    // logged — a Gemini body that will not parse produces one V8 built out of
    // the model's own output, which came off the page
    // (docs/security-review-gemini.md, finding 6). The status and the code are
    // ours and say the same thing to an operator.
    console.error(`extract refused: ${status} ${data.error ?? ""}`.trim());
  }
  // The extractor's own ceiling is the family's shared fuse; its message is
  // written for the demo, so it is replaced. Its `budget` is the capability
  // ledger, which is nobody's business here — the person's is returned.
  const message =
    data.error === "budget_exhausted"
      ? "Zpracování je dočasně pozastaveno — společný limit je vyčerpán."
      : data.message;
  return { ...data, ...(message !== undefined ? { message } : {}), budget: await userBudget(env.BUDGET, user.id, limit) };
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
  const reportDate = typeof r.reportDate === "string" ? r.reportDate : null;
  return {
    ...r,
    patientName: null,
    patientId: null,
    pages,
    reportDate,
    labName: typeof r.labName === "string" ? r.labName : null,
    // Derived, never the client's string: a lab PDF's own filename routinely
    // carries the patient's name, and the server cannot inspect it for
    // identity — so it is replaced with a date, not trusted.
    sourceFile: reportDate ? `report-${reportDate}.pdf` : "report.pdf",
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

/* ---------------------------------------------------------------- account */

/**
 * Everything the account holds, as one file the person can keep. JSON is the
 * stored payloads exactly, plus the AI context if they wrote one; CSV is one
 * printed row per line for a spreadsheet.
 * Their data is theirs — and a reader of the export can also see for
 * themselves that no name and no number is in it.
 */
async function exportAccount(env: Env, user: UserRow, format: string): Promise<Response> {
  const { results } = await env.DB.prepare(SQL.reportsForUser).bind(user.id).all<ReportRow>();
  const reports = results.map((r) => JSON.parse(r.payload) as Record<string, any>);
  // The AI context is the person's own words about themselves; what they
  // wrote, they can take with them.
  const settingsRow = await env.DB.prepare(SQL.settingsForUser).bind(user.id).first<{ settings: string | null }>();
  const aiContext = settingsRow?.settings ? ((JSON.parse(settingsRow.settings) as { aiContext?: unknown }).aiContext ?? null) : null;
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = ["datum;laborator;parametr;nazev;hodnota;jednotka;rozmezi;stav;overeno;report"];
    for (const r of reports) {
      for (const m of r.measurements ?? []) {
        lines.push(
          [r.reportDate, r.labName, m.rawAnalyteName, m.canonicalId, m.valueRaw, m.unitRaw, m.refRangeRaw, m.flag, m.corrected ? "opraveno" : m.confirmed ? "potvrzeno" : "", r.id].map(cell).join(";"),
        );
      }
    }
    // A BOM, so a Czech Excel opens the diacritics as diacritics.
    return new Response(`\ufeff${lines.join("\r\n")}\r\n`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="moje-krev-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), email: user.email, aiContext, reports }, null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="moje-krev-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}

/**
 * Delete the account: every page image, every report, every AI share, the
 * failure counter on its e-mail, the user row. The invite that opened the
 * account stays spent — a code must not come back to life because the
 * account it paid for is gone — and a set-password link bound to it is
 * unbound, so it opens nothing. Immediate and complete; the cookie the
 * request came with is a 401 from the next request on, because requireUser
 * re-reads the row.
 */
async function deleteAccount(env: Env, user: UserRow): Promise<Response> {
  const { results } = await env.DB.prepare(SQL.pageKeysForUser).bind(user.id).all<{ kv_key: string }>();
  await Promise.all(results.map((p) => env.PAGES.delete(p.kv_key)));
  await env.DB.prepare(SQL.deletePagesForUser).bind(user.id).run();
  await env.DB.prepare(SQL.deleteReportsForUser).bind(user.id).run();
  await env.DB.prepare(SQL.deleteSharesForUser).bind(user.id).run();
  await env.DB.prepare(SQL.clearLoginFailures).bind(user.email).run();
  await env.DB.prepare(SQL.unlinkInvites).bind(user.id).run();
  await env.DB.prepare(SQL.deleteUser).bind(user.id).run();
  return new Response(JSON.stringify({ ok: true, pagesDeleted: results.length }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "set-cookie": clearCookieHeader() },
  });
}

/**
 * Which reader pair the extractor is actually running, or null if it will not
 * say. `null` is the honest answer and the privacy page treats it as the
 * broader claim: over-disclosure ages safely, the other direction does not.
 */
async function extractPhotoReaders(env: Env): Promise<string | null> {
  const res = await env.EXTRACT.fetch(new Request("https://extract/api/status")).catch(() => null);
  if (!res || !res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { photoReaders?: string };
  return data.photoReaders ?? null;
}

/* --------------------------------------------------------------- AI share */

/** 24 hours: the link is a bearer key to health numbers. */
const SHARE_TTL_SECONDS = 24 * 3600;
/** A thirty-report account is well under 100 KB; the cap is against abuse. */
const MAX_SHARE_BYTES = 512 * 1024;
/**
 * newLoginToken is 32 random bytes as base64url: 43 characters, exactly.
 * The `.md` suffix is the shape links had until 2026-09-06; a link minted
 * before that deploy lives at most 24 hours, and is redirected to the bare
 * address so the fetcher never sees a file-looking URL. The suffix can go
 * from this pattern once that day has passed.
 */
const SHARE_PAGE = /^\/ai\/([A-Za-z0-9_-]{43})(\.md)?$/;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The page around the text: a heading for a human who opens the link, the
 * snapshot in one <pre>, escaped — lab text carries values like "<0,5",
 * which would otherwise swallow the rest of the line as a tag. No script,
 * no stylesheet, nothing fetched.
 */
const sharePageHtml = (snapshot: string) =>
  `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Moje krev — výsledky pro AI</title>
</head>
<body>
<h1>Moje krev — výsledky pro AI</h1>
<pre style="white-space:pre-wrap">${escapeHtml(snapshot)}</pre>
</body>
</html>
`;

const sharePageNotFound = () =>
  new Response("Not found\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });

/**
 * The public page. Anything under /ai/ that is not exactly a live token's
 * page is the same 404 — one body, one status, one set of headers — so an
 * attacker probing tokens learns nothing from the shape of the refusal.
 */
async function serveSharePage(env: Env, request: Request, pathname: string): Promise<Response> {
  const m = SHARE_PAGE.exec(pathname);
  if (!m) return sharePageNotFound();
  // Who fetches, and what they ask for — no token, no body. This is how a
  // "my browser cannot open it" from an assistant gets diagnosed.
  console.log(JSON.stringify({ sharePage: m[2] ? "md" : "bare", ua: request.headers.get("user-agent"), accept: request.headers.get("accept") }));
  if (m[2]) {
    return new Response(null, {
      status: 301,
      headers: { location: `/ai/${m[1]}`, "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }
  const row = await env.DB.prepare(SQL.shareByHash).bind(await sha256Hex(m[1])).first<AiShareRow>();
  if (!row || row.revoked_at !== null || row.expires_at <= now()) return sharePageNotFound();
  return new Response(sharePageHtml(row.snapshot), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

/**
 * Mint: revoke whatever this person had, store the hash and the text they
 * sent, hand back the URL once. The text is theirs, built by their browser
 * from their own payloads; this worker stores it and never reads it.
 */
async function createShare(request: Request, env: Env, user: UserRow): Promise<Response> {
  const text = await shareText(request);
  if (text instanceof Response) return text;

  const t = now();
  await env.DB.prepare(SQL.revokeSharesForUser).bind(user.id, t).run();
  const token = newLoginToken();
  const expiresAt = t + SHARE_TTL_SECONDS;
  await env.DB.prepare(SQL.insertShare).bind(await sha256Hex(token), user.id, text, t, expiresAt).run();
  return json({ url: `${new URL(request.url).origin}/ai/${token}`, expiresAt: new Date(expiresAt * 1000).toISOString() });
}

/** The text a share request carries, or the refusal to send back. */
async function shareText(request: Request): Promise<string | Response> {
  const raw = await request.text();
  if (raw.length > MAX_SHARE_BYTES) return json({ error: "too_large", message: "Text je příliš dlouhý." }, 413);
  let text: unknown;
  try {
    text = (JSON.parse(raw) as { text?: unknown }).text;
  } catch {
    return json({ error: "bad_request", message: "Neplatný požadavek." }, 400);
  }
  if (typeof text !== "string" || !text.trim()) return json({ error: "bad_request", message: "Není co sdílet." }, 400);
  return text;
}

/**
 * Replace the live link's text without minting: the person saved something
 * that belongs on the page — their AI context — and the URL they may have
 * pasted already should serve the newer text. No live link: 404, and the
 * client mints instead if it wants to.
 */
async function updateShare(request: Request, env: Env, user: UserRow): Promise<Response> {
  const text = await shareText(request);
  if (text instanceof Response) return text;
  const { meta } = await env.DB.prepare(SQL.updateLiveShare).bind(user.id, text, now()).run();
  if (!meta.changes) return json({ error: "not_found", message: "Žádný platný odkaz." }, 404);
  return json({ ok: true });
}

async function getShare(env: Env, user: UserRow): Promise<Response> {
  const row = await env.DB.prepare(SQL.liveShareForUser).bind(user.id, now()).first<{ expires_at: number }>();
  return json(row ? { expiresAt: new Date(row.expires_at * 1000).toISOString() } : null);
}

async function revokeShare(env: Env, user: UserRow): Promise<Response> {
  await env.DB.prepare(SQL.revokeSharesForUser).bind(user.id, now()).run();
  return json({ ok: true });
}

/* ----------------------------------------------------------------- router */

const REPORT = /^\/api\/reports\/([^/]+)$/;
const INVITE = /^\/api\/auth\/invite\/([^/]+)$/;
const PAGE = /^\/api\/(?:reports|pages)\/([^/]+)\/(\d{1,3})$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    // The one public page, above the gate: a share link works without a
    // login, which is the whole point of it.
    if (url.pathname.startsWith("/ai/")) {
      return request.method === "GET" || request.method === "HEAD" ? serveSharePage(env, request, url.pathname) : sharePageNotFound();
    }

    switch (route) {
      case "POST /api/auth/register":
        return handleRegister(request, env);
      case "POST /api/auth/login":
        return handleLogin(request, env);
      case "POST /api/auth/password":
        return handleSetPassword(request, env);
      case "POST /api/auth/logout":
        return new Response(null, { status: 204, headers: { "set-cookie": clearCookieHeader() } });
      // Public because the page that needs it is: /soukromi is reachable
      // logged out, and its processor sentence has to come from the
      // deployment rather than from whoever last edited the copy
      // (docs/security-review-gemini.md, finding 1). It discloses the pair
      // name only — exactly what the demo's own /api/status already tells
      // anyone who asks.
      case "GET /api/processors":
        return json({ photoReaders: await extractPhotoReaders(env) });
    }
    const invite = INVITE.exec(url.pathname);
    if (invite && request.method === "GET") return inviteKind(env, invite[1]);

    // Everything below is the account's own data.
    const user = await requireUser(request, env);
    if (!user) return unauthorized();

    switch (route) {
      case "GET /api/me":
        return json({ email: user.email, createdAt: user.created_at });
      case "GET /api/status":
        return json({ budget: await userBudget(env.BUDGET, user.id, limitFor(user, env)), maxPages: maxPages(env) });
      case "POST /api/extract":
        return handleExtract(request, env, user);
      case "GET /api/reports":
        return listReports(env, user);
      case "GET /api/settings":
        return getSettings(env, user);
      case "PUT /api/settings":
        return putSettings(request, env, user);
      case "GET /api/export":
        return exportAccount(env, user, url.searchParams.get("format") ?? "json");
      case "DELETE /api/account":
        return deleteAccount(env, user);
      case "POST /api/ai-share":
        return createShare(request, env, user);
      case "GET /api/ai-share":
        return getShare(env, user);
      case "PUT /api/ai-share":
        return updateShare(request, env, user);
      case "DELETE /api/ai-share":
        return revokeShare(env, user);
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
