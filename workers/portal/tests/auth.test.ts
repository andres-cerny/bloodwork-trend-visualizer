/**
 * Route-level tests for the auth flow, everything real except D1.
 *
 * The properties worth proving are the single-use ones — a code burns once,
 * whatever it opens — and the fail-closed ones: a wrong password and an
 * unknown e-mail are one answer, a dead code is one answer whichever way it
 * died, ten misses lock the e-mail, a tampered cookie is an absent one, and
 * an account that never set a password cannot be entered by guessing.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { PBKDF2_ITERATIONS, hashPassword } from "../src/password";
import { mintCookieToken } from "../src/session";
import { TTL_HOURS, mintInvites } from "../../../tools/scripts/moje-krev-invites.mjs";

const SECRET = "test-portal-secret";

interface UserT {
  id: string;
  email: string;
  created_at: string;
  password_hash: string | null;
  password_salt: string | null;
  password_iters: number | null;
}
interface InviteT {
  code: string;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
  user_id: string | null;
}
interface Tables {
  users: UserT[];
  invites: InviteT[];
  failures: Array<{ email: string; at: number }>;
  reports: Array<{ id: string; user_id: string; payload: string }>;
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
        const at = a[2] as string;
        const inv = t.invites.find(
          (i) => i.code === a[0] && i.used_at === null && (i.expires_at === null || i.expires_at > at),
        );
        if (!inv) return { results: [], changes: 0 };
        inv.used_by = a[1] as string;
        inv.used_at = at;
        return { results: [], changes: 1 };
      }
      case SQL.userByEmail:
        return { results: t.users.filter((u) => u.email === a[0]), changes: 0 };
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.insertUser:
        t.users.push({
          id: a[0] as string,
          email: a[1] as string,
          created_at: a[2] as string,
          password_hash: a[3] as string,
          password_salt: a[4] as string,
          password_iters: a[5] as number,
        });
        return { results: [], changes: 1 };
      case SQL.setPassword: {
        const u = t.users.find((u) => u.id === a[0]);
        if (!u) return { results: [], changes: 0 };
        u.password_hash = a[1] as string;
        u.password_salt = a[2] as string;
        u.password_iters = a[3] as number;
        return { results: [], changes: 1 };
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
      case SQL.pruneLoginFailures: {
        const before = t.failures.length;
        t.failures = t.failures.filter((f) => f.at >= (a[0] as number));
        return { results: [], changes: before - t.failures.length };
      }
      case SQL.clearLoginFailures: {
        const before = t.failures.length;
        t.failures = t.failures.filter((f) => f.email !== a[0]);
        return { results: [], changes: before - t.failures.length };
      }
      case SQL.reportsForUser:
        return { results: t.reports.filter((r) => r.user_id === a[0]).map((r) => ({ id: r.id, payload: r.payload })), changes: 0 };
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

const ORIGIN = "https://moje-krev.example";

const STUB = { PAGES: {} as KVNamespace, BUDGET: {} as KVNamespace, EXTRACT: {} as Fetcher, EXTRACT_SESSION_SECRET: "x" };
function makeEnv(t: Tables): Env {
  return { ...STUB, DB: fakeD1(t), SESSION_SECRET: SECRET };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const get = (path: string, headers: Record<string, string> = {}) => new Request(ORIGIN + path, { headers });

const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const invite = (code: string, extra: Partial<InviteT> = {}): InviteT => ({
  code,
  used_by: null,
  used_at: null,
  expires_at: inHours(24),
  user_id: null,
  ...extra,
});

let tables: Tables;
let env: Env;

beforeEach(() => {
  tables = { users: [], invites: [invite("RODINA-1")], failures: [], reports: [] };
  env = makeEnv(tables);
});

const PASSWORD = "dlouhé heslo 1";

/** Runs a registration and returns the session cookie value. */
async function signup(email = "andres@example.com", code = "RODINA-1", password = PASSWORD): Promise<string> {
  const reg = await worker.fetch(post("/api/auth/register", { code, email, password }), env);
  expect(reg.status).toBe(200);
  const cookie = reg.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly");
  return cookie.split(";")[0];
}

const login = (email: string, password: string) => worker.fetch(post("/api/auth/login", { email, password }), env);

const body = async (res: Response) => (await res.json()) as { error: string; message: string };

describe("register", () => {
  it("spends the code, opens the account with a hashed password, logs in", async () => {
    const cookie = await signup();
    expect(tables.invites[0].used_by).toBe(tables.users[0].id);
    expect(tables.invites[0].used_at).not.toBeNull();
    const u = tables.users[0];
    expect(u.password_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(u.password_iters).toBe(PBKDF2_ITERATIONS);
    expect(u.password_hash).not.toContain(PASSWORD);

    const me = await worker.fetch(get("/api/me", { cookie }), env);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "andres@example.com" });
  });

  it("refuses an expired, a spent, a bound and an unknown code with one body", async () => {
    tables.invites = [
      invite("PROSLY", { expires_at: inHours(-1) }),
      invite("UTRACENY", { used_by: "u-x", used_at: "2026-09-01T00:00:00Z" }),
      invite("VAZANY", { user_id: "u-x" }),
    ];
    const bodies = new Set<string>();
    for (const code of ["PROSLY", "UTRACENY", "VAZANY", "NEEXISTUJE"]) {
      const res = await worker.fetch(post("/api/auth/register", { code, email: "b@example.com", password: PASSWORD }), env);
      expect(res.status, code).toBe(403);
      expect(res.headers.get("set-cookie")).toBeNull();
      bodies.add(await res.text());
    }
    expect(bodies.size).toBe(1);
    expect([...bodies][0]).toContain("Odkaz už neplatí");
    expect(tables.users).toHaveLength(0);
    expect(tables.invites.find((i) => i.code === "VAZANY")!.used_at).toBeNull();
  });

  it("refuses a short password before touching the code", async () => {
    const res = await worker.fetch(post("/api/auth/register", { code: "RODINA-1", email: "b@example.com", password: "sedm777" }), env);
    expect(res.status).toBe(400);
    expect(tables.invites[0].used_at).toBeNull();
    expect(tables.users).toHaveLength(0);
  });

  it("refuses a taken e-mail with the dead-code body, without spending the code", async () => {
    await signup();
    tables.invites.push(invite("RODINA-2"));
    const res = await worker.fetch(post("/api/auth/register", { code: "RODINA-2", email: "Andres@Example.com", password: PASSWORD }), env);
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("invite_invalid");
    expect(tables.invites[1].used_at).toBeNull();
    expect(tables.users).toHaveLength(1);
  });
});

describe("login", () => {
  it("answers a wrong password and an unknown e-mail identically", async () => {
    await signup();
    const wrong = await login("andres@example.com", "špatné heslo");
    const unknown = await login("nikdo@example.com", PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.text()).toBe(await unknown.text());
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(unknown.headers.get("set-cookie")).toBeNull();
  });

  it("the right password logs in, case-folds the e-mail, and clears the misses", async () => {
    await signup();
    await login("andres@example.com", "špatné heslo");
    expect(tables.failures).toHaveLength(1);
    const res = await login("Andres@Example.com", PASSWORD);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
    expect(tables.failures).toHaveLength(0);
  });

  it("an account without a password cannot be entered, and says the same thing", async () => {
    tables.users.push({
      id: "u-old",
      email: "old@example.com",
      created_at: "2026-08-31T00:00:00Z",
      password_hash: null,
      password_salt: null,
      password_iters: null,
    });
    const res = await login("old@example.com", "");
    const unknown = await login("nikdo@example.com", "");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe(await unknown.text());
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("locks the e-mail after the tenth miss — the right password included", async () => {
    await signup();
    for (let i = 0; i < 10; i++) expect((await login("andres@example.com", "ne")).status).toBe(401);
    const locked = await login("andres@example.com", PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers.get("set-cookie")).toBeNull();
    // Only that e-mail: a lockout is not a lockdown.
    tables.invites.push(invite("RODINA-2"));
    await signup("b@example.com", "RODINA-2");
    expect((await login("b@example.com", PASSWORD)).status).toBe(200);
  });

  it("counts misses on unknown e-mails too, so the lockout names no account", async () => {
    for (let i = 0; i < 10; i++) await login("nikdo@example.com", "ne");
    expect((await login("nikdo@example.com", "ne")).status).toBe(429);
  });

  it("forgets misses older than the window", async () => {
    await signup();
    for (let i = 0; i < 10; i++) await login("andres@example.com", "ne");
    for (const f of tables.failures) f.at -= 16 * 60;
    expect((await login("andres@example.com", PASSWORD)).status).toBe(200);
  });
});

describe("set-password link", () => {
  const oldPassword = "původní heslo";
  beforeEach(async () => {
    const rec = await hashPassword(oldPassword);
    tables.users.push({
      id: "u-a",
      email: "a@example.com",
      created_at: "2026-08-31T00:00:00Z",
      password_hash: rec.hash,
      password_salt: rec.salt,
      password_iters: rec.iters,
    });
    tables.reports.push(
      { id: "r-1", user_id: "u-a", payload: '{"id":"r-1","measurements":[1]}' },
      { id: "r-2", user_id: "u-a", payload: '{"id":"r-2","measurements":[2]}' },
    );
    tables.invites.push(invite("HESLO-A", { user_id: "u-a" }));
  });

  it("names the kind of link, and 404s a dead one with the dead-code body", async () => {
    expect(await (await worker.fetch(get("/api/auth/invite/RODINA-1"), env)).json()).toEqual({ kind: "signup" });
    expect(await (await worker.fetch(get("/api/auth/invite/HESLO-A"), env)).json()).toEqual({ kind: "password" });
    tables.invites.push(invite("PROSLY", { expires_at: inHours(-1) }), invite("UTRACENY", { used_at: "2026-09-01T00:00:00Z" }));
    // "%E0" is a malformed escape: decodeURIComponent throws on it, and a
    // throw here would be a 500 for a link someone mangled in a chat app.
    for (const code of ["PROSLY", "UTRACENY", "NEEXISTUJE", "%E0", "%20"]) {
      const res = await worker.fetch(get(`/api/auth/invite/${code}`), env);
      expect(res.status, code).toBe(404);
      expect((await body(res)).message).toBe("Odkaz už neplatí. Napište mi a pošlu nový.");
    }
  });

  it("replaces the hash, spends the code, logs in, and leaves the reports alone", async () => {
    const before = JSON.stringify(tables.reports);
    const res = await worker.fetch(post("/api/auth/password", { code: "HESLO-A", password: "nové heslo 2" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");

    const inv = tables.invites.find((i) => i.code === "HESLO-A")!;
    expect(inv.used_at).not.toBeNull();
    expect(inv.used_by).toBe("u-a");
    expect(JSON.stringify(tables.reports)).toBe(before);

    expect((await login("a@example.com", oldPassword)).status).toBe(401);
    expect((await login("a@example.com", "nové heslo 2")).status).toBe(200);
    // Spent: a second use of the same link changes nothing.
    const again = await worker.fetch(post("/api/auth/password", { code: "HESLO-A", password: "třetí heslo 3" }), env);
    expect(again.status).toBe(403);
    expect((await login("a@example.com", "nové heslo 2")).status).toBe(200);
  });

  it("refuses an unbound code, a code bound to a gone account, and a short password", async () => {
    tables.invites.push(invite("HESLO-PRYC", { user_id: "u-gone" }));
    const unbound = await worker.fetch(post("/api/auth/password", { code: "RODINA-1", password: "nové heslo 2" }), env);
    const gone = await worker.fetch(post("/api/auth/password", { code: "HESLO-PRYC", password: "nové heslo 2" }), env);
    expect(unbound.status).toBe(403);
    expect(gone.status).toBe(403);
    expect(await unbound.text()).toBe(await gone.text());
    expect(tables.invites.find((i) => i.code === "RODINA-1")!.used_at).toBeNull();

    const short = await worker.fetch(post("/api/auth/password", { code: "HESLO-A", password: "krátké" }), env);
    expect(short.status).toBe(400);
    expect(tables.invites.find((i) => i.code === "HESLO-A")!.used_at).toBeNull();
    expect((await login("a@example.com", oldPassword)).status).toBe(200);
  });
});

describe("sessions", () => {
  it("refuses a tampered cookie and a wrong-secret cookie", async () => {
    const cookie = await signup();
    const forged = await mintCookieToken("some-other-secret", tables.users[0].id, 3600);
    for (const c of [cookie.slice(0, -2) + "xx", `mojekrev_session=${forged}`, "mojekrev_session=nonsense"]) {
      const res = await worker.fetch(get("/api/me", { cookie: c }), env);
      expect(res.status).toBe(401);
    }
  });

  it("a deleted account's still-valid cookie is a 401, not a ghost login", async () => {
    const cookie = await signup();
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

describe("the invite script", () => {
  /** Reads the script's INSERT back into the fake, the way D1 would. */
  function applySql(sql: string) {
    const strings = [...sql.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
    if (/ SELECT /.test(sql)) {
      const [code, , , expires_at, email] = strings;
      const user = tables.users.find((u) => u.email === email);
      if (user) tables.invites.push(invite(code, { expires_at, user_id: user.id }));
      return;
    }
    for (let i = 0; i < strings.length; i += 4) {
      tables.invites.push(invite(strings[i], { expires_at: strings[i + 3] }));
    }
  }
  const codeOf = (link: string, path: string) => {
    const url = new URL(link);
    expect(url.pathname).toBe(path);
    return url.searchParams.get("kod")!;
  };

  it("prints sign-up links whose codes the worker accepts, for a week", async () => {
    const out = mintInvites({ n: 2, note: "máma, táta", origin: ORIGIN });
    applySql(out.sql);
    expect(out.links).toHaveLength(2);
    for (const link of out.links) {
      const code = codeOf(link, "/registrace");
      expect(await (await worker.fetch(get(`/api/auth/invite/${code}`), env)).json()).toEqual({ kind: "signup" });
    }
    const ttl = (new Date(out.expires).getTime() - Date.now()) / 3600_000;
    expect(ttl).toBeGreaterThan(TTL_HOURS - 0.05);
    expect(ttl).toBeLessThanOrEqual(TTL_HOURS);
  });

  it("with --email prints one set-password link bound to that account", async () => {
    await signup("andres@example.com");
    const out = mintInvites({ n: 5, email: "Andres@Example.com", origin: ORIGIN });
    applySql(out.sql);
    expect(out.links).toHaveLength(1);
    const code = codeOf(out.links[0], "/heslo");
    expect(await (await worker.fetch(get(`/api/auth/invite/${code}`), env)).json()).toEqual({ kind: "password" });
    // ...and the link is a set-password link, so it opens no new account.
    const reg = await worker.fetch(post("/api/auth/register", { code, email: "b@example.com", password: PASSWORD }), env);
    expect(reg.status).toBe(403);
  });

  it("a bound link for an e-mail nobody has mints nothing", async () => {
    const out = mintInvites({ email: "nikdo@example.com", origin: ORIGIN });
    applySql(out.sql);
    const res = await worker.fetch(get(`/api/auth/invite/${codeOf(out.links[0], "/heslo")}`), env);
    expect(res.status).toBe(404);
  });

  it("quotes an apostrophe the SQL way", () => {
    const out = mintInvites({ note: "O'Brien", origin: ORIGIN });
    expect(out.sql).toContain("'O''Brien'");
    applySql(out.sql);
    expect(tables.invites.at(-1)!.code).toBe(out.codes[0]);
  });
});
