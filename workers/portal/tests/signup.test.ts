/**
 * The open door, everything real except D1, Resend and Turnstile.
 *
 * Resend and Cloudflare's siteverify are both reached through the global
 * fetch, so one stub answers for both and records what was sent — the mail
 * is read back out of it, and the link out of the mail, the way a person
 * would. What is proved: an address gets a link and nothing else exists for
 * it until the link is used; the link opens the account with the consent
 * that was given and logs in; a taken address is answered word for word
 * like a free one; the bot gate and the per-IP ceiling refuse before any
 * work; and with OPEN_SIGNUP off none of this exists and auth.test.ts's
 * invite-only worker is what runs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { hashPassword } from "../src/password";
import { DAY_LIMIT, HOUR_LIMIT } from "../src/ratelimit";
import { LINK_TTL_HOURS, mailFor } from "../src/signup";

const SECRET = "test-portal-secret";
const ORIGIN = "https://moje-krev.example";

interface UserT {
  id: string;
  email: string;
  created_at: string;
  password_hash: string | null;
  password_salt: string | null;
  password_iters: number | null;
  session_epoch: number;
  consent_at: string | null;
  email_verified_at: string | null;
}
interface InviteT {
  code: string;
  note: string | null;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  user_id: string | null;
  email: string | null;
  consent_at: string | null;
}
interface Tables {
  users: UserT[];
  invites: InviteT[];
  failures: Array<{ email: string; at: number }>;
  attempts: Array<{ ip_hash: string; at: number }>;
}

/** Dispatches on the exact SQL constants; a query without a branch throws. */
function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.inviteByCode:
        return { results: t.invites.filter((i) => i.code === a[0]), changes: 0 };
      case SQL.burnInvite: {
        const at = a[2] as string;
        const inv = t.invites.find((i) => i.code === a[0] && i.used_at === null && (i.expires_at === null || i.expires_at > at));
        if (!inv) return { results: [], changes: 0 };
        inv.used_by = a[1] as string;
        inv.used_at = at;
        return { results: [], changes: 1 };
      }
      case SQL.insertBoundInvite:
        t.invites.push({ code: a[0] as string, note: a[1] as string, used_by: null, used_at: null, expires_at: a[3] as string, user_id: a[4] as string, email: null, consent_at: null });
        return { results: [], changes: 1 };
      case SQL.insertPendingInvite:
        t.invites.push({ code: a[0] as string, note: a[1] as string, used_by: null, used_at: null, expires_at: a[3] as string, user_id: null, email: a[4] as string, consent_at: a[5] as string });
        return { results: [], changes: 1 };
      case SQL.userByEmail:
        return { results: t.users.filter((u) => u.email === a[0]), changes: 0 };
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.insertVerifiedUser: {
        // UNIQUE(email), the way D1 would say it.
        if (t.users.some((u) => u.email === a[1])) throw new Error("D1_ERROR: UNIQUE constraint failed: users.email");
        t.users.push({
          id: a[0] as string,
          email: a[1] as string,
          created_at: a[2] as string,
          password_hash: a[3] as string,
          password_salt: a[4] as string,
          password_iters: a[5] as number,
          session_epoch: 0,
          consent_at: a[6] as string,
          email_verified_at: a[7] as string,
        });
        return { results: [], changes: 1 };
      }
      case SQL.setPassword: {
        const u = t.users.find((u) => u.id === a[0]);
        if (!u) return { results: [], changes: 0 };
        u.password_hash = a[1] as string;
        u.password_salt = a[2] as string;
        u.password_iters = a[3] as number;
        return { results: [], changes: 1 };
      }
      case SQL.bumpSessionEpoch: {
        const u = t.users.find((u) => u.id === a[0]);
        if (!u) return { results: [], changes: 0 };
        u.session_epoch += 1;
        return { results: [{ session_epoch: u.session_epoch }], changes: 1 };
      }
      case SQL.deleteUser: {
        const before = t.users.length;
        t.users = t.users.filter((u) => u.id !== a[0]);
        return { results: [], changes: before - t.users.length };
      }
      case SQL.countLoginFailures:
        return { results: [{ n: t.failures.filter((f) => f.email === a[0] && f.at > (a[1] as number)).length }], changes: 0 };
      case SQL.insertLoginFailure:
        t.failures.push({ email: a[0] as string, at: a[1] as number });
        return { results: [], changes: 1 };
      case SQL.pruneLoginFailures:
      case SQL.clearLoginFailures:
        return { results: [], changes: 0 };
      case SQL.countSignupAttempts:
        return { results: [{ n: t.attempts.filter((x) => x.ip_hash === a[0] && x.at > (a[1] as number)).length }], changes: 0 };
      case SQL.insertSignupAttempt:
        t.attempts.push({ ip_hash: a[0] as string, at: a[1] as number });
        return { results: [], changes: 1 };
      case SQL.pruneSignupAttempts: {
        const before = t.attempts.length;
        t.attempts = t.attempts.filter((x) => x.at >= (a[0] as number));
        return { results: [], changes: before - t.attempts.length };
      }
      default:
        throw new Error(`fakeD1: no branch for: ${sql}`);
    }
  };
  const make = (sql: string, args: unknown[]): unknown => ({
    bind: (...values: unknown[]) => make(sql, values),
    async first() {
      return run(sql, args).results[0] ?? null;
    },
    async all() {
      return { results: run(sql, args).results };
    },
    async run() {
      return { meta: { changes: run(sql, args).changes } };
    },
  });
  return { prepare: (sql: string) => make(sql, []) } as unknown as D1Database;
}

/* ------------------------------------------------ the two services, faked */

interface Sent {
  to: string[];
  from: string;
  subject: string;
  text: string;
  html?: unknown;
}
interface Outside {
  mails: Sent[];
  /** What siteverify was asked, in order. */
  verifies: Array<{ secret: string; response: string; remoteip: string | null }>;
  /** What siteverify answers next; the default is a solved challenge on our host. */
  verdict: (token: string) => Record<string, unknown>;
  /** Resend's next status; 200 unless a test breaks it. */
  resendStatus: number;
}

function stubOutside(): Outside {
  const o: Outside = {
    mails: [],
    verifies: [],
    verdict: (token) => ({ success: true, hostname: "moje-krev.example", action: token.replace(/^ok:/, "") }),
    resendStatus: 200,
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://challenges.cloudflare.com/")) {
      const p = new URLSearchParams(init?.body as string);
      o.verifies.push({ secret: p.get("secret")!, response: p.get("response")!, remoteip: p.get("remoteip") });
      return new Response(JSON.stringify(o.verdict(p.get("response")!)), { status: 200 });
    }
    if (url === "https://api.resend.com/emails") {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer re_test_key");
      o.mails.push(JSON.parse(init?.body as string) as Sent);
      return new Response(o.resendStatus === 200 ? '{"id":"m-1"}' : '{"message":"domain not verified"}', { status: o.resendStatus });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return o;
}

/* ------------------------------------------------------------ the fixture */

const STUB = { PAGES: {} as KVNamespace, BUDGET: {} as KVNamespace, EXTRACT: {} as Fetcher, EXTRACT_SESSION_SECRET: "x" };
const OPEN: Partial<Env> = {
  OPEN_SIGNUP: "true",
  TURNSTILE_SECRET_KEY: "ts-secret",
  TURNSTILE_HOSTNAMES: "moje-krev.example",
  RESEND_API_KEY: "re_test_key",
  MAIL_FROM: "Moje krev <noreply@moje-krev.example>",
};

let tables: Tables;
let env: Env;
let outside: Outside;

beforeEach(() => {
  tables = { users: [], invites: [], failures: [], attempts: [] };
  env = { ...STUB, DB: fakeD1(tables), SESSION_SECRET: SECRET, ...OPEN };
  outside = stubOutside();
});
afterEach(() => vi.unstubAllGlobals());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + path, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  });
const get = (path: string, headers: Record<string, string> = {}) => new Request(ORIGIN + path, { headers });
const body = async (res: Response) => (await res.json()) as { ok?: true; error?: string; message?: string; open?: boolean };

/** A token siteverify will call solved for this action — see `verdict`. */
const solved = (action: "portal-register" | "portal-login" | "portal-forgot") => `ok:${action}`;

const askRegister = (email: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) =>
  worker.fetch(post("/api/auth/register", { email, consent: true, turnstile: solved("portal-register"), ...extra }, headers), env);
const askForgot = (email: string, extra: Record<string, unknown> = {}) =>
  worker.fetch(post("/api/auth/forgot", { email, turnstile: solved("portal-forgot"), ...extra }), env);

/** The one link in a mail, and its code. */
function linkIn(mail: Sent): { url: URL; code: string } {
  const m = mail.text.match(/https?:\/\/\S+/);
  expect(m, "the mail carries a link").not.toBeNull();
  const url = new URL(m![0]);
  return { url, code: url.searchParams.get("kod") ?? "" };
}

const PASSWORD = "dlouhé heslo 1";
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0];
const me = (cookie: string) => worker.fetch(get("/api/me", { cookie }), env);

async function seedUser(email: string, password = PASSWORD): Promise<UserT> {
  const rec = await hashPassword(password);
  const u: UserT = {
    id: `u-${email}`,
    email,
    created_at: "2026-08-31T00:00:00Z",
    password_hash: rec.hash,
    password_salt: rec.salt,
    password_iters: rec.iters,
    session_epoch: 0,
    consent_at: null,
    email_verified_at: null,
  };
  tables.users.push(u);
  return u;
}

/* ------------------------------------------------------------------ tests */

describe("register mails a link", () => {
  it("sends one plain-text mail with a /heslo link, and creates no user row", async () => {
    const res = await askRegister("Nova@Example.com");
    expect(res.status).toBe(200);
    const answer = await res.text();
    expect(JSON.parse(answer)).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toBeNull();

    expect(outside.mails).toHaveLength(1);
    const mail = outside.mails[0];
    expect(mail.to).toEqual(["nova@example.com"]);
    expect(mail.from).toBe(OPEN.MAIL_FROM);
    expect(mail.html).toBeUndefined();
    expect(mail.subject).toBe("Moje krev – odkaz k založení účtu");
    expect(mail.text).toContain("Pokud jste o něj nežádali, tento e-mail ignorujte");
    expect(mail.text).toContain(`${LINK_TTL_HOURS} hodin`);

    const { url, code } = linkIn(mail);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe("/heslo");
    expect(code.length).toBeGreaterThanOrEqual(40);

    // The code carries the address and the consent; the account does not exist.
    expect(tables.users).toHaveLength(0);
    const inv = tables.invites.find((i) => i.code === code)!;
    expect(inv.email).toBe("nova@example.com");
    expect(inv.user_id).toBeNull();
    expect(inv.consent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ttl = (new Date(inv.expires_at!).getTime() - Date.now()) / 3600_000;
    expect(ttl).toBeGreaterThan(LINK_TTL_HOURS - 0.05);
    expect(ttl).toBeLessThanOrEqual(LINK_TTL_HOURS);
    // The link never appears in the response.
    expect(answer).not.toContain(code);
  });

  it("the link names its address, sets the password, opens the account with the consent, logs in — once", async () => {
    await askRegister("nova@example.com");
    const { code } = linkIn(outside.mails[0]);

    const kind = await worker.fetch(get(`/api/auth/invite/${encodeURIComponent(code)}`), env);
    expect(await kind.json()).toEqual({ kind: "signup", email: "nova@example.com" });

    const set = await worker.fetch(post("/api/auth/password", { code, password: PASSWORD }), env);
    expect(set.status).toBe(200);
    expect(set.headers.get("set-cookie")).toContain("HttpOnly");
    const who = await me(cookieOf(set));
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({ email: "nova@example.com", demo: false });

    expect(tables.users).toHaveLength(1);
    const u = tables.users[0];
    expect(u.password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(u.consent_at).toBe(tables.invites[0].consent_at);
    expect(u.email_verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tables.invites[0].used_by).toBe(u.id);
    expect(tables.invites[0].used_at).not.toBeNull();

    // Spent: the same link opens nothing and makes nothing.
    const again = await worker.fetch(post("/api/auth/password", { code, password: "jiné heslo 22" }), env);
    expect(again.status).toBe(403);
    expect(tables.users).toHaveLength(1);
    // And the password is the one that was set.
    const login = await worker.fetch(post("/api/auth/login", { email: "nova@example.com", password: PASSWORD, turnstile: solved("portal-login") }), env);
    expect(login.status).toBe(200);
  });

  it("a mailed code is not an operator's code: typed into the sign-up form it opens nothing", async () => {
    await askRegister("nova@example.com");
    const { code } = linkIn(outside.mails[0]);
    const res = await worker.fetch(post("/api/auth/register", { code, email: "jiny@example.com", password: PASSWORD }), env);
    expect(res.status).toBe(403);
    expect(tables.users).toHaveLength(0);
    expect(tables.invites[0].used_at).toBeNull();
  });

  it("refuses a short password before spending the code", async () => {
    await askRegister("nova@example.com");
    const { code } = linkIn(outside.mails[0]);
    const res = await worker.fetch(post("/api/auth/password", { code, password: "krátké" }), env);
    expect(res.status).toBe(400);
    expect(tables.invites[0].used_at).toBeNull();
    expect(tables.users).toHaveLength(0);
  });

  it("without both consents, no mail and no code", async () => {
    for (const consent of [undefined, false, "true", 1]) {
      const res = await askRegister("nova@example.com", { consent });
      expect(res.status, String(consent)).toBe(400);
      expect((await body(res)).error).toBe("consent_required");
    }
    expect(outside.mails).toHaveLength(0);
    expect(tables.invites).toHaveLength(0);
    expect(outside.verifies).toHaveLength(0);
  });

  it("refuses an address that is not one", async () => {
    for (const email of ["", "nic", "a@b", 42, null]) {
      const res = await askRegister(email as string);
      expect(res.status, String(email)).toBe(400);
    }
    expect(outside.mails).toHaveLength(0);
  });
});

describe("a taken address is answered like a free one", () => {
  it("same status, same body, and the mail is a set-password link bound to the account", async () => {
    await seedUser("stara@example.com");
    const free = await askRegister("nova@example.com");
    const taken = await askRegister("stara@example.com");
    expect(taken.status).toBe(free.status);
    expect(await taken.text()).toBe(await free.text());
    expect(taken.headers.get("set-cookie")).toBeNull();

    expect(outside.mails).toHaveLength(2);
    const mail = outside.mails[1];
    expect(mail.to).toEqual(["stara@example.com"]);
    expect(mail.subject).toBe("Moje krev – odkaz k nastavení hesla");
    expect(mail.text).toContain("vaše heslo se nemění");
    const { url, code } = linkIn(mail);
    expect(url.pathname).toBe("/heslo");
    const inv = tables.invites.find((i) => i.code === code)!;
    expect(inv.user_id).toBe("u-stara@example.com");
    expect(inv.email).toBeNull();
    // No second account for the address, now or after the link.
    expect(tables.users).toHaveLength(1);
    expect(await (await worker.fetch(get(`/api/auth/invite/${encodeURIComponent(code)}`), env)).json()).toEqual({ kind: "password" });
    const set = await worker.fetch(post("/api/auth/password", { code, password: "nové heslo 2" }), env);
    expect(set.status).toBe(200);
    expect(tables.users).toHaveLength(1);
    expect(tables.users[0].session_epoch).toBe(1);
  });

  it("a sign-up code whose address got an account meanwhile sets that account's password instead", async () => {
    await askRegister("nova@example.com");
    const { code } = linkIn(outside.mails[0]);
    // Registered through another door before the mail was opened.
    const u = await seedUser("nova@example.com", "první heslo 1");
    const set = await worker.fetch(post("/api/auth/password", { code, password: "druhé heslo 2" }), env);
    expect(set.status).toBe(200);
    expect(tables.users).toHaveLength(1);
    expect(tables.users[0].id).toBe(u.id);
    expect(tables.invites[0].used_by).toBe(u.id);
    const login = (pw: string) => worker.fetch(post("/api/auth/login", { email: "nova@example.com", password: pw, turnstile: solved("portal-login") }), env);
    expect((await login("první heslo 1")).status).toBe(401);
    expect((await login("druhé heslo 2")).status).toBe(200);
  });

  it("the UNIQUE race: two links for one free address open one account", async () => {
    await askRegister("nova@example.com");
    await askRegister("nova@example.com");
    const [a, b] = outside.mails.map((m) => linkIn(m).code);
    expect((await worker.fetch(post("/api/auth/password", { code: a, password: PASSWORD }), env)).status).toBe(200);
    // The second link finds the account and sets its password — the address
    // is proven either way — but makes no second row.
    expect((await worker.fetch(post("/api/auth/password", { code: b, password: "jiné heslo 22" }), env)).status).toBe(200);
    expect(tables.users).toHaveLength(1);
  });
});

describe("forgot", () => {
  it("an account gets the set-password mail; an unknown address gets the no-account mail; one answer", async () => {
    await seedUser("stara@example.com");
    const known = await askForgot("stara@example.com");
    const unknown = await askForgot("nikdo@example.com");
    expect(known.status).toBe(200);
    expect(await known.text()).toBe(await unknown.text());

    expect(outside.mails[0].subject).toBe("Moje krev – odkaz k nastavení hesla");
    expect(tables.invites).toHaveLength(1);
    expect(tables.invites[0].user_id).toBe("u-stara@example.com");

    expect(outside.mails[1].to).toEqual(["nikdo@example.com"]);
    expect(outside.mails[1].subject).toBe("Moje krev – k této adrese není účet");
    expect(linkIn(outside.mails[1]).url.pathname).toBe("/registrace");
    // Nothing minted for an address with no account, and no account either.
    expect(tables.invites).toHaveLength(1);
    expect(tables.users).toHaveLength(1);
  });

  it("the three mails are plain text with one link and the two sentences", () => {
    for (const kind of ["signup", "password", "no-account"] as const) {
      const { subject, text } = mailFor(kind, "kdo@example.com", "https://x/heslo?kod=abc");
      expect(subject.startsWith("Moje krev – ")).toBe(true);
      expect(text).not.toMatch(/<[a-z]+>/);
      expect(text.match(/https?:\/\//g)).toHaveLength(1);
      expect(text).toMatch(/ignorujte/);
    }
  });
});

describe("the bot gate", () => {
  it("no token is a 400 that does no work", async () => {
    const res = await askRegister("nova@example.com", { turnstile: undefined });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("turnstile_missing");
    expect(outside.mails).toHaveLength(0);
    expect(tables.invites).toHaveLength(0);
    expect(tables.attempts).toHaveLength(0);
  });

  it("a token siteverify refuses is a 403; the check carries the secret, the IP and asks the register action", async () => {
    outside.verdict = () => ({ success: false, "error-codes": ["invalid-input-response"] });
    const res = await askRegister("nova@example.com", { turnstile: "bad" });
    expect(res.status).toBe(403);
    expect((await body(res)).message).toBe("Ověření se nezdařilo. Zkuste to znovu.");
    expect(outside.verifies).toEqual([{ secret: "ts-secret", response: "bad", remoteip: "203.0.113.7" }]);
    expect(outside.mails).toHaveLength(0);
  });

  it("a token solved for another form, or on another host, is refused", async () => {
    // The login form's token, replayed at registration.
    expect((await askRegister("nova@example.com", { turnstile: solved("portal-login") })).status).toBe(403);
    outside.verdict = () => ({ success: true, hostname: "localhost", action: "portal-register" });
    expect((await askRegister("nova@example.com")).status).toBe(403);
    expect(outside.mails).toHaveLength(0);
  });

  it("no TURNSTILE_SECRET_KEY fails closed, never open", async () => {
    env.TURNSTILE_SECRET_KEY = undefined;
    expect((await askRegister("nova@example.com")).status).toBe(403);
    expect(outside.verifies).toHaveLength(0);
  });

  it("login asks for a token on an open deployment, and not before the body is sane", async () => {
    await seedUser("stara@example.com");
    const bare = await worker.fetch(post("/api/auth/login", { email: "stara@example.com", password: PASSWORD }), env);
    expect(bare.status).toBe(400);
    expect((await body(bare)).error).toBe("turnstile_missing");
    expect(tables.failures).toHaveLength(0);
    const ok = await worker.fetch(post("/api/auth/login", { email: "stara@example.com", password: PASSWORD, turnstile: solved("portal-login") }), env);
    expect(ok.status).toBe(200);
    expect(outside.verifies.at(-1)!.response).toBe("ok:portal-login");
  });

  it("OPEN_SIGNUP_DEV_BYPASS lets a request with no token through, and only that", async () => {
    env.OPEN_SIGNUP_DEV_BYPASS = "true";
    expect((await askRegister("nova@example.com", { turnstile: undefined })).status).toBe(200);
    expect(outside.verifies).toHaveLength(0);
    // A token that is there is still checked.
    outside.verdict = () => ({ success: false });
    expect((await askRegister("nova@example.com", { turnstile: "bad" })).status).toBe(403);
  });

  it("the bypass is in no wrangler.jsonc", () => {
    // OPEN_SIGNUP itself may be "true" there — that is how the handoff tells
    // the operator to open the door. The bypass never may: it is the local
    // app's way past Turnstile, and a deployed worker with it lets bots in.
    const cfg = readFileSync(join(import.meta.dirname, "../wrangler.jsonc"), "utf-8").replace(/\/\/[^\n]*/g, "");
    expect(cfg).not.toMatch(/OPEN_SIGNUP_DEV_BYPASS/);
  });
});

describe("the per-IP ceiling", () => {
  it(`the ${HOUR_LIMIT + 1}th mail in an hour from one IP is a 429 in Czech; another IP is not counted`, async () => {
    for (let i = 0; i < HOUR_LIMIT; i++) expect((await askRegister(`n${i}@example.com`)).status).toBe(200);
    const over = await askRegister("dalsi@example.com");
    expect(over.status).toBe(429);
    expect((await body(over)).message).toBe("Příliš mnoho žádostí o odkaz z této adresy. Zkuste to znovu za hodinu.");
    expect(outside.mails).toHaveLength(HOUR_LIMIT);
    expect(tables.invites).toHaveLength(HOUR_LIMIT);
    // Forgot shares the ceiling — it is the same mail.
    expect((await askForgot("dalsi@example.com")).status).toBe(429);
    expect((await askRegister("jina-ip@example.com", {}, { "cf-connecting-ip": "198.51.100.9" })).status).toBe(200);
  });

  it(`${DAY_LIMIT} in a day is the day's ceiling, whatever the hour`, async () => {
    const hash = tables.attempts; // filled by the first ask below
    expect((await askRegister("n0@example.com")).status).toBe(200);
    const ip = hash[0].ip_hash;
    const now = Math.floor(Date.now() / 1000);
    for (let i = 1; i < DAY_LIMIT; i++) tables.attempts.push({ ip_hash: ip, at: now - 2 * 3600 - i });
    const over = await askRegister("n1@example.com");
    expect(over.status).toBe(429);
    expect((await body(over)).message).toBe("Příliš mnoho žádostí o odkaz z této adresy. Zkuste to znovu zítra.");
  });

  it("stores a salted hash, not the address, and forgets rows older than a day", async () => {
    await askRegister("n0@example.com");
    expect(tables.attempts[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(tables.attempts)).not.toContain("203.0.113.7");
    tables.attempts.push({ ip_hash: "stale", at: Math.floor(Date.now() / 1000) - 25 * 3600 });
    await askRegister("n1@example.com");
    expect(tables.attempts.some((x) => x.ip_hash === "stale")).toBe(false);
  });
});

describe("mail delivery", () => {
  it("without RESEND_API_KEY, locally (the dev bypass), the link is logged and the answer is the same", async () => {
    env.RESEND_API_KEY = undefined;
    env.OPEN_SIGNUP_DEV_BYPASS = "true";
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await askRegister("nova@example.com");
    expect(res.status).toBe(200);
    expect(outside.mails).toHaveLength(0);
    const logged = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("RESEND_API_KEY unset");
    expect(logged).toContain(`${ORIGIN}/heslo?kod=`);
    expect(logged).toContain(tables.invites[0].code);
    log.mockRestore();
  });

  it("without RESEND_API_KEY in production the door answers 503 mail_unconfigured, mints nothing and logs no link", async () => {
    // The door is open, the bypass is not set: this is a deployment. A link
    // printed into the worker's log there is a credential in observability,
    // for an address that will never receive it.
    env.RESEND_API_KEY = undefined;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const ask of [askRegister, askForgot]) {
      const res = await ask("nova@example.com");
      expect(res.status).toBe(503);
      expect(await body(res)).toEqual({ error: "mail_unconfigured", message: "Odesílání e-mailů zatím není nastavené." });
    }
    expect(outside.mails).toHaveLength(0);
    expect(tables.invites).toHaveLength(0);
    expect(log.mock.calls.map((c) => c.join(" ")).join("\n")).not.toContain("/heslo?kod=");
    log.mockRestore();
  });

  it("Resend refusing is a 502 in Czech, not a silent ok", async () => {
    outside.resendStatus = 403;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await askRegister("nova@example.com");
    expect(res.status).toBe(502);
    expect((await body(res)).message).toBe("Odeslání e-mailu se nezdařilo. Zkuste to prosím později.");
    expect(err.mock.calls.join(" ")).toContain("domain not verified");
    err.mockRestore();
  });
});

describe("with OPEN_SIGNUP off", () => {
  beforeEach(() => {
    env.OPEN_SIGNUP = undefined;
  });

  it("the door says closed and the two forms do not exist", async () => {
    expect(await body(await worker.fetch(get("/api/auth/signup"), env))).toEqual({ open: false });
    expect((await askRegister("nova@example.com")).status).toBe(404);
    expect((await askForgot("nova@example.com")).status).toBe(404);
    expect(outside.mails).toHaveLength(0);
    expect(tables.invites).toHaveLength(0);
  });

  it("login takes no token and asks siteverify nothing", async () => {
    await seedUser("stara@example.com");
    const res = await worker.fetch(post("/api/auth/login", { email: "stara@example.com", password: PASSWORD }), env);
    expect(res.status).toBe(200);
    expect(outside.verifies).toHaveLength(0);
  });

  it("and open, the door says so", async () => {
    env.OPEN_SIGNUP = "true";
    expect(await body(await worker.fetch(get("/api/auth/signup"), env))).toEqual({ open: true });
  });
});
