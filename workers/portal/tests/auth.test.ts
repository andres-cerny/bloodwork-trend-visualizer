/**
 * Route-level tests for the auth flow, everything real except D1 and Resend.
 *
 * The properties worth proving are the single-use ones — an invite burns
 * once, a login link spends once — and the fail-closed ones: unknown e-mail
 * answers like a known one, a tampered cookie is an absent one, a deleted
 * user's valid cookie is a 401.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken } from "../src/session";

const SECRET = "test-portal-secret";

interface Tables {
  users: Array<{ id: string; email: string; created_at: string }>;
  invites: Array<{ code: string; used_by: string | null; used_at: string | null }>;
  tokens: Array<{ token_hash: string; user_id: string; created_at: number; expires_at: number; used_at: number | null }>;
}

/**
 * Dispatches on the exact SQL constants, like the agent worker's fake — a
 * query without a branch here throws rather than returning nothing.
 */
function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.inviteByCode:
        return { results: t.invites.filter((i) => i.code === a[0]), changes: 0 };
      case SQL.burnInvite: {
        const inv = t.invites.find((i) => i.code === a[0] && i.used_by === null);
        if (!inv) return { results: [], changes: 0 };
        inv.used_by = a[1] as string;
        inv.used_at = a[2] as string;
        return { results: [], changes: 1 };
      }
      case SQL.userByEmail:
        return { results: t.users.filter((u) => u.email === a[0]), changes: 0 };
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.insertUser:
        t.users.push({ id: a[0] as string, email: a[1] as string, created_at: a[2] as string });
        return { results: [], changes: 1 };
      case SQL.deleteUser: {
        const before = t.users.length;
        t.users = t.users.filter((u) => u.id !== a[0]);
        return { results: [], changes: before - t.users.length };
      }
      case SQL.insertLoginToken:
        t.tokens.push({
          token_hash: a[0] as string,
          user_id: a[1] as string,
          created_at: a[2] as number,
          expires_at: a[3] as number,
          used_at: null,
        });
        return { results: [], changes: 1 };
      case SQL.loginTokenByHash:
        return { results: t.tokens.filter((k) => k.token_hash === a[0]), changes: 0 };
      case SQL.spendLoginToken: {
        const tok = t.tokens.find((k) => k.token_hash === a[0] && k.used_at === null);
        if (!tok) return { results: [], changes: 0 };
        tok.used_at = a[1] as number;
        return { results: [], changes: 1 };
      }
      case SQL.countRecentLoginTokens:
        return {
          results: [{ n: t.tokens.filter((k) => k.user_id === a[0] && k.created_at > (a[1] as number)).length }],
          changes: 0,
        };
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

const ORIGIN = "https://kapka.example";

function makeEnv(t: Tables): Env {
  return { DB: fakeD1(t), SESSION_SECRET: SECRET, DEV_MAGIC_LINK: "1" };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + path, { headers });

let tables: Tables;
let env: Env;

beforeEach(() => {
  tables = {
    users: [],
    invites: [{ code: "RODINA-1", used_by: null, used_at: null }],
    tokens: [],
  };
  env = makeEnv(tables);
});

/** Runs register → confirm and returns the session cookie value. */
async function registerAndConfirm(email = "andres@example.com"): Promise<string> {
  const reg = await worker.fetch(post("/api/auth/register", { invite: "RODINA-1", email }), env);
  expect(reg.status).toBe(200);
  const { devLink } = (await reg.json()) as { devLink: string };
  const confirm = await worker.fetch(get(devLink.replace(ORIGIN, "")), env);
  expect(confirm.status).toBe(302);
  expect(confirm.headers.get("location")).toBe("/");
  const cookie = confirm.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  return cookie.split(";")[0];
}

describe("register", () => {
  it("burns the invite, creates the user, hands back a working link", async () => {
    const cookie = await registerAndConfirm();
    expect(tables.invites[0].used_by).toBe(tables.users[0].id);

    const me = await worker.fetch(get("/api/me", { cookie }), env);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "andres@example.com" });
  });

  it("refuses an unknown or already-used invite the same way", async () => {
    await registerAndConfirm();
    for (const invite of ["RODINA-1", "NEEXISTUJE"]) {
      const res = await worker.fetch(post("/api/auth/register", { invite, email: "b@example.com" }), env);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("invite_invalid");
    }
    expect(tables.users).toHaveLength(1);
  });

  it("refuses a second account on the same e-mail without spending the invite", async () => {
    await registerAndConfirm();
    tables.invites.push({ code: "RODINA-2", used_by: null, used_at: null });
    const res = await worker.fetch(
      post("/api/auth/register", { invite: "RODINA-2", email: "andres@example.com" }),
      env,
    );
    expect(res.status).toBe(409);
    expect(tables.invites[1].used_by).toBeNull();
  });
});

describe("login", () => {
  it("answers identically for known and unknown e-mail", async () => {
    await registerAndConfirm();
    const known = await worker.fetch(post("/api/auth/login", { email: "andres@example.com" }), env);
    const unknown = await worker.fetch(post("/api/auth/login", { email: "nikdo@example.com" }), env);
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const k = (await known.json()) as { message: string; devLink?: string };
    const u = (await unknown.json()) as { message: string; devLink?: string };
    expect(u.message).toBe(k.message);
    // ...but only the real account got a token.
    expect(k.devLink).toBeDefined();
    expect(u.devLink).toBeUndefined();
    expect(tables.tokens.filter((t) => t.used_at === null)).toHaveLength(1);
  });

  it("caps link requests per user per hour", async () => {
    await registerAndConfirm(); // spends token 1 of the hour's 5
    for (let i = 0; i < 4; i++) {
      const res = await worker.fetch(post("/api/auth/login", { email: "andres@example.com" }), env);
      expect(res.status).toBe(200);
    }
    const sixth = await worker.fetch(post("/api/auth/login", { email: "andres@example.com" }), env);
    expect(sixth.status).toBe(429);
  });
});

describe("confirm", () => {
  it("spends a link exactly once", async () => {
    await registerAndConfirm();
    const login = await worker.fetch(post("/api/auth/login", { email: "andres@example.com" }), env);
    const { devLink } = (await login.json()) as { devLink: string };

    const first = await worker.fetch(get(devLink.replace(ORIGIN, "")), env);
    expect(first.headers.get("location")).toBe("/");

    const second = await worker.fetch(get(devLink.replace(ORIGIN, "")), env);
    expect(second.headers.get("location")).toBe("/?prihlaseni=neplatne");
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an expired link", async () => {
    await registerAndConfirm();
    const login = await worker.fetch(post("/api/auth/login", { email: "andres@example.com" }), env);
    const { devLink } = (await login.json()) as { devLink: string };
    for (const t of tables.tokens) t.expires_at = Math.floor(Date.now() / 1000) - 1;

    const res = await worker.fetch(get(devLink.replace(ORIGIN, "")), env);
    expect(res.headers.get("location")).toBe("/?prihlaseni=neplatne");
  });
});

describe("sessions", () => {
  it("refuses a tampered cookie and a wrong-secret cookie", async () => {
    const cookie = await registerAndConfirm();
    const forged = await mintCookieToken("some-other-secret", tables.users[0].id, 3600);
    for (const c of [cookie.slice(0, -2) + "xx", `kapka_session=${forged}`, "kapka_session=nonsense"]) {
      const res = await worker.fetch(get("/api/me", { cookie: c }), env);
      expect(res.status).toBe(401);
    }
  });

  it("a deleted account's still-valid cookie is a 401, not a ghost login", async () => {
    const cookie = await registerAndConfirm();
    tables.users = [];
    const res = await worker.fetch(get("/api/me", { cookie }), env);
    expect(res.status).toBe(401);
  });

  it("logout clears the cookie", async () => {
    const res = await worker.fetch(post("/api/auth/logout", {}), env);
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("mail configuration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never echoes a login link when a real mail key is present", async () => {
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      sent.push(String(url));
      return new Response("{}", { status: 200 });
    });
    // DEV_MAGIC_LINK deliberately ALSO set: the key must win.
    env = { ...makeEnv(tables), RESEND_API_KEY: "re_test", DEV_MAGIC_LINK: "1" };
    const reg = await worker.fetch(post("/api/auth/register", { invite: "RODINA-1", email: "a@b.cz" }), env);
    expect(reg.status).toBe(200);
    const body = (await reg.json()) as Record<string, unknown>;
    expect(body.devLink).toBeUndefined();
    expect(sent).toEqual(["https://api.resend.com/emails"]);
  });

  it("with neither key nor dev flag, login fails loudly rather than pretending", async () => {
    await registerAndConfirm();
    env = { DB: env.DB, SESSION_SECRET: SECRET };
    const res = await worker.fetch(post("/api/auth/login", { email: "andres@example.com" }), env);
    expect(res.status).toBe(502);
  });
});
