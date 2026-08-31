/**
 * Moje krev's API worker: accounts and, from Phase 3, stored reports.
 *
 * Auth is deliberately small: signup spends an invite code, login mails a
 * single-use link, the session is a signed cookie. No passwords exist to
 * leak, and no route ever confirms whether an e-mail is registered — the
 * login answer is the same sentence either way.
 */
import { SQL, type LoginTokenRow, type UserRow } from "./db";
import { sendLoginLink, type MailEnv } from "./email";
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
  SESSION_SECRET: string;
  SESSION_TTL_DAYS?: string;
  LOGIN_TOKEN_TTL_MINUTES?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const sessionTtlSeconds = (env: Env) => (parseInt(env.SESSION_TTL_DAYS ?? "90", 10) || 90) * 86400;
const tokenTtlSeconds = (env: Env) => (parseInt(env.LOGIN_TOKEN_TTL_MINUTES ?? "15", 10) || 15) * 60;

/** Enough to catch typos; the delivered link is the real verification. */
const looksLikeEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

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
      case "GET /api/me": {
        const user = await requireUser(request, env);
        if (!user) return json({ error: "unauthorized", message: "Přihlaste se prosím." }, 401);
        return json({ email: user.email, createdAt: user.created_at });
      }
      default:
        return json({ error: "not_found" }, 404);
    }
  },
} satisfies ExportedHandler<Env>;
