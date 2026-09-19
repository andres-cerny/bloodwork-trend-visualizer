/**
 * The open door: an address asks for a link, the link opens the set-password
 * screen, and the account is born when the password is set.
 *
 * Everything here is behind OPEN_SIGNUP="true". Off — the default, and every
 * deployment until Ondřej flips it — the two routes answer 404, the login
 * form asks for no Turnstile, and the worker is exactly the invite-only one
 * it was. On:
 *
 *   POST /api/auth/register {email, consent, turnstile}
 *   POST /api/auth/forgot   {email, turnstile}
 *
 * both mint a code the way `moje-krev-invites.mjs --email` does and mail it.
 * The address with an account gets a set-password link bound to it; the
 * address without one gets a code carrying the address and the consent, and
 * using it (POST /api/auth/password) creates the row — so nothing exists for
 * an address that never opened its mail, and an unverified address can
 * spend nothing. Register on a taken address and forgot on a free one are
 * both answered {ok:true} after one lookup and one mail; register inserts a
 * code either way, forgot on a free address inserts nothing (there is no
 * account to bind a code to, and a row for an address that asked for
 * nothing would be a row to prune). The mail — one HTTP call to Resend —
 * is what the timing is made of, and the response body is identical, so
 * the missing insert is not a tell. The only difference is which mail, and
 * only the mailbox learns it.
 *
 * Turnstile guards the three public forms — register, login, forgot — and
 * nothing behind the login; a logged-in person is the gate there. A token
 * is checked through @bw/gate for all three of Cloudflare's proofs (solved,
 * on this hostname, for this action). The one way past it is
 * OPEN_SIGNUP_DEV_BYPASS="true", which accepts a request that brings *no*
 * token: the local app without a site key. tests/guards pins that no
 * wrangler.jsonc sets it.
 */
import { verifyTurnstile } from "@bw/gate";
import { PORTAL_TURNSTILE_ACTIONS, type PortalTurnstileAction } from "@bw/gate/turnstile";
import { SQL, type InviteRow, type UserRow } from "./db";
import { MailError, sendMail, type MailEnv } from "./mail";
import { hashPassword } from "./password";
import { ipHash, overLimit, recordAttempt, tooMany, type RateLimitEnv } from "./ratelimit";
import { newLoginToken } from "./session";

export interface SignupEnv extends MailEnv, RateLimitEnv {
  /** "true" opens registration and forgotten-password mail, and turns Turnstile on. */
  OPEN_SIGNUP?: string;
  /** "true" lets a request without a Turnstile token through. Local only. */
  OPEN_SIGNUP_DEV_BYPASS?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** Comma-separated hostnames this deployment serves. Never localhost in production. */
  TURNSTILE_HOSTNAMES?: string;
}

/** The mailed link lives a day — long enough to read the mail in the evening,
 *  short enough that a forwarded one is dead by the weekend. */
export const LINK_TTL_HOURS = 24;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/** Enough to catch typos; the delivered link is the real verification. */
export const looksLikeEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export const signupOpen = (env: SignupEnv) => env.OPEN_SIGNUP === "true";

/** What the door asks before drawing „Registrovat" and „Zapomenuté heslo". */
export const signupStatus = (env: SignupEnv) => json({ open: signupOpen(env) });

/* -------------------------------------------------------------- turnstile */

const notHuman = () => json({ error: "turnstile_failed", message: "Ověření se nezdařilo. Zkuste to znovu." }, 403);

/**
 * The bot gate on a public form. Null when the request may go on; otherwise
 * the refusal to return. With OPEN_SIGNUP off there is no gate — the door
 * is invite-only and a code is the proof — so the login route is unchanged.
 */
export async function requireHuman(
  request: Request,
  env: SignupEnv,
  action: PortalTurnstileAction,
  token: unknown,
): Promise<Response | null> {
  if (!signupOpen(env)) return null;
  if (token === undefined || token === null || token === "") {
    if (env.OPEN_SIGNUP_DEV_BYPASS === "true") return null;
    return json(
      { error: "turnstile_missing", message: "Chybí ověření, že nejste robot. Obnovte stránku a zkuste to znovu." },
      400,
    );
  }
  // No secret is a misconfiguration, and fails closed like an empty allowlist.
  if (typeof token !== "string" || !env.TURNSTILE_SECRET_KEY) return notHuman();
  const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, request.headers.get("cf-connecting-ip"), {
    hostnames: (env.TURNSTILE_HOSTNAMES ?? "").split(","),
    action,
  });
  return ok ? null : notHuman();
}

/* ------------------------------------------------------------------- mail */

export type MailKind = "register" | "forgot";

/** The three mails, word for word. Plain text; the link is the only URL. */
export function mailFor(kind: "signup" | "password" | "no-account", email: string, link: string): { subject: string; text: string } {
  switch (kind) {
    case "signup":
      return {
        subject: "Moje krev – odkaz k založení účtu",
        text:
          `Dobrý den,\n\n` +
          `tímto odkazem si zvolíte heslo a založíte účet v Moje krev pro adresu ${email}:\n\n` +
          `${link}\n\n` +
          `Odkaz platí ${LINK_TTL_HOURS} hodin a lze ho použít jednou. ` +
          `Pokud jste o něj nežádali, tento e-mail ignorujte – žádný účet nevznikne.\n\n` +
          `Moje krev\n`,
      };
    case "password":
      return {
        subject: "Moje krev – odkaz k nastavení hesla",
        text:
          `Dobrý den,\n\n` +
          `tímto odkazem si nastavíte nové heslo ke svému účtu v Moje krev:\n\n` +
          `${link}\n\n` +
          `Odkaz platí ${LINK_TTL_HOURS} hodin a lze ho použít jednou. ` +
          `Pokud jste o něj nežádali, tento e-mail ignorujte – vaše heslo se nemění.\n\n` +
          `Moje krev\n`,
      };
    case "no-account":
      return {
        subject: "Moje krev – k této adrese není účet",
        text:
          `Dobrý den,\n\n` +
          `někdo požádal o nové heslo pro adresu ${email}, ale žádný účet v Moje krev k ní nepatří. ` +
          `Účet si můžete založit zde:\n\n` +
          `${link}\n\n` +
          `Pokud jste o nic nežádali, tento e-mail ignorujte.\n\n` +
          `Moje krev\n`,
      };
  }
}

const nowIso = () => new Date().toISOString();
const now = () => Math.floor(Date.now() / 1000);

/**
 * Register and forgot, one handler: mint, mail, say ok.
 *
 * The order is the cheap refusals first — the door closed, a malformed
 * address, no consent, no human, too many from this IP — and only then the
 * work whose timing must not depend on whether the address has an account.
 */
export async function handleSignupMail(request: Request, env: SignupEnv, kind: MailKind, parsed?: unknown): Promise<Response> {
  if (!signupOpen(env)) return json({ error: "not_found" }, 404);
  // An open door with no way to send mail is a deployment nobody can enter,
  // and the local fallback — the link in the log — would put a credential
  // into production observability. Only the dev bypass, which no deployed
  // wrangler.jsonc may set, turns that fallback on.
  if (!env.RESEND_API_KEY && env.OPEN_SIGNUP_DEV_BYPASS !== "true") {
    return json({ error: "mail_unconfigured", message: "Odesílání e-mailů zatím není nastavené." }, 503);
  }
  // handleRegister has read the body already to see there was no code in it.
  const body = (parsed ?? (await request.json().catch(() => ({})))) as { email?: unknown; consent?: unknown; turnstile?: unknown };
  if (!looksLikeEmail(body.email)) return json({ error: "bad_request", message: "Zadejte platný e-mail." }, 400);
  if (kind === "register" && body.consent !== true) {
    return json(
      { error: "consent_required", message: "Bez souhlasu se zpracováním zdravotních údajů a s podmínkami užití účet nevznikne." },
      400,
    );
  }
  const human = await requireHuman(request, env, PORTAL_TURNSTILE_ACTIONS[kind], body.turnstile);
  if (human) return human;

  const t = now();
  const hash = await ipHash(env, request);
  const over = await overLimit(env, hash, t);
  if (over) return json({ error: "too_many", message: tooMany(over) }, 429);
  await recordAttempt(env, hash, t);

  const email = body.email.trim().toLowerCase();
  const origin = new URL(request.url).origin;
  const user = await env.DB.prepare(SQL.userByEmail).bind(email).first<UserRow>();
  const stamp = nowIso();
  const expires = new Date(Date.now() + LINK_TTL_HOURS * 3600_000).toISOString();

  let mail: { subject: string; text: string };
  if (user) {
    // An account: a set-password link bound to it, whichever form asked.
    const code = newLoginToken();
    await env.DB.prepare(SQL.insertBoundInvite).bind(code, `mailed: ${kind}`, stamp, expires, user.id).run();
    mail = mailFor("password", email, `${origin}/heslo?kod=${encodeURIComponent(code)}`);
  } else if (kind === "register") {
    // No account: a code carrying the address and the consent. The row is
    // born when the code is used, not now.
    const code = newLoginToken();
    await env.DB.prepare(SQL.insertPendingInvite).bind(code, "mailed: register", stamp, expires, email, stamp).run();
    mail = mailFor("signup", email, `${origin}/heslo?kod=${encodeURIComponent(code)}`);
  } else {
    // Forgot, no account: nothing to mint. The mailbox is told; the asker
    // is not.
    mail = mailFor("no-account", email, `${origin}/registrace`);
  }

  try {
    await sendMail(env, email, mail.subject, mail.text);
  } catch (e) {
    if (!(e instanceof MailError)) throw e;
    console.error(`signup mail failed: ${e.message}`);
    return json({ error: "mail_failed", message: "Odeslání e-mailu se nezdařilo. Zkuste to prosím později." }, 502);
  }
  return json({ ok: true });
}

/* ------------------------------------------------------ opening the account */

/**
 * A mailed sign-up code, used: the account for its address, with this
 * password. Returns who to log in, or null when the code was spent under us.
 *
 * The conditional UPDATE that burns the code is the single-use guarantee,
 * as everywhere in this worker. Should the address have gained an account
 * between the mail and the click (a second link, an operator's code), the
 * link still proves the address — exactly what a set-password link proves —
 * so the password is set on that account instead, and every session the old
 * one opened ends. Otherwise the row is written first and the code burned
 * after, the way handleRegister does it: used_by references users(id), and
 * losing the race undoes the row rather than leaving an account no link
 * paid for.
 */
export async function openMailedAccount(
  env: { DB: D1Database },
  invite: InviteRow,
  password: string,
): Promise<{ uid: string; epoch: number } | null> {
  if (!invite.email) return null;
  const at = nowIso();
  const record = await hashPassword(password);
  const burn = async (uid: string) => {
    const r = await env.DB.prepare(SQL.burnInvite).bind(invite.code, uid, at).run();
    return !!r.meta && r.meta.changes === 1;
  };

  const existing = await env.DB.prepare(SQL.userByEmail).bind(invite.email).first<UserRow>();
  if (existing) {
    if (!(await burn(existing.id))) return null;
    await env.DB.prepare(SQL.setPassword).bind(existing.id, record.hash, record.salt, record.iters).run();
    await env.DB.prepare(SQL.clearLoginFailures).bind(existing.email).run();
    const row = await env.DB.prepare(SQL.bumpSessionEpoch).bind(existing.id).first<{ session_epoch: number }>();
    return row ? { uid: existing.id, epoch: row.session_epoch } : null;
  }

  const uid = crypto.randomUUID();
  try {
    await env.DB.prepare(SQL.insertVerifiedUser)
      .bind(uid, invite.email, at, record.hash, record.salt, record.iters, invite.consent_at ?? at, at)
      .run();
  } catch {
    // UNIQUE on email: someone registered this address between the read
    // above and now. Their link won; this one opens nothing.
    return null;
  }
  if (!(await burn(uid))) {
    await env.DB.prepare(SQL.deleteUser).bind(uid).run();
    return null;
  }
  return { uid, epoch: 0 };
}
