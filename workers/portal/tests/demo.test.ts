/**
 * The public demo patient: a real account the front page opens to anyone.
 *
 * Three properties are worth proving. The door only exists where a
 * deployment names one — an unset or mistaken `DEMO_EMAIL` must leave the
 * worker exactly as it was, and both routes must say so the same way. The
 * session it mints is a real one, so everything writes through. And the one
 * line drawn across it holds: a demo session cannot delete a report or the
 * account, while the same account's own login still can — which is the test
 * that would fail if the guard were hung on the account rather than on the
 * cookie that opened it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken } from "../src/session";

const SECRET = "test-portal-secret";
const DEMO_EMAIL = "andres@example.com";

interface Tables {
  users: Array<{ id: string; email: string; created_at: string; settings: string | null; session_epoch: number }>;
  reports: Array<{ id: string; user_id: string; payload: string }>;
  pages: Array<{ report_id: string; page_num: number; kv_key: string }>;
  shares: Array<{ token_hash: string; user_id: string }>;
  failures: Array<{ email: string; at: number }>;
}

/** Dispatches on the exact SQL constants, like the other portal fakes. */
function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.userByEmail:
        return { results: t.users.filter((u) => u.email === a[0]), changes: 0 };
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.settingsForUser:
        return { results: t.users.filter((u) => u.id === a[0]).map((u) => ({ settings: u.settings })), changes: 0 };
      case SQL.saveSettings: {
        const u = t.users.find((u) => u.id === a[0]);
        if (!u) return { results: [], changes: 0 };
        u.settings = a[1] as string;
        return { results: [], changes: 1 };
      }
      case SQL.reportsForUser:
        return { results: t.reports.filter((r) => r.user_id === a[0]).map((r) => ({ id: r.id, payload: r.payload })), changes: 0 };
      case SQL.reportOwner:
        return { results: t.reports.filter((r) => r.id === a[0]).map((r) => ({ id: r.id, user_id: r.user_id })), changes: 0 };
      case SQL.pagesForReport:
        return { results: t.pages.filter((p) => p.report_id === a[0]), changes: 0 };
      case SQL.deletePages: {
        const before = t.pages.length;
        t.pages = t.pages.filter((p) => p.report_id !== a[0]);
        return { results: [], changes: before - t.pages.length };
      }
      case SQL.deleteReport: {
        const before = t.reports.length;
        t.reports = t.reports.filter((r) => !(r.id === a[0] && r.user_id === a[1]));
        return { results: [], changes: before - t.reports.length };
      }
      case SQL.pageKeysForUser: {
        const ids = new Set(t.reports.filter((r) => r.user_id === a[0]).map((r) => r.id));
        return { results: t.pages.filter((p) => ids.has(p.report_id)).map((p) => ({ kv_key: p.kv_key })), changes: 0 };
      }
      case SQL.deletePagesForUser: {
        const ids = new Set(t.reports.filter((r) => r.user_id === a[0]).map((r) => r.id));
        const before = t.pages.length;
        t.pages = t.pages.filter((p) => !ids.has(p.report_id));
        return { results: [], changes: before - t.pages.length };
      }
      case SQL.deleteReportsForUser: {
        const before = t.reports.length;
        t.reports = t.reports.filter((r) => r.user_id !== a[0]);
        return { results: [], changes: before - t.reports.length };
      }
      case SQL.deleteSharesForUser: {
        const before = t.shares.length;
        t.shares = t.shares.filter((s) => s.user_id !== a[0]);
        return { results: [], changes: before - t.shares.length };
      }
      case SQL.clearLoginFailures: {
        const before = t.failures.length;
        t.failures = t.failures.filter((f) => f.email !== a[0]);
        return { results: [], changes: before - t.failures.length };
      }
      case SQL.unlinkInvites:
      case SQL.unlinkSynonyms:
        return { results: [], changes: 0 };
      case SQL.deleteUser: {
        const before = t.users.length;
        t.users = t.users.filter((u) => u.id !== a[0]);
        return { results: [], changes: before - t.users.length };
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
      return { success: true, meta: { changes: run(sql, args).changes } };
    },
  });
  return { prepare: (sql: string) => make(sql, []) } as unknown as D1Database;
}

function fakeKv(seed: string[]) {
  const store = new Map<string, string>(seed.map((k) => [k, "img"]));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

const ORIGIN = "https://moje-krev.example";
const payload = (id: string) =>
  JSON.stringify({
    id,
    sourceFile: `${id}.pdf`,
    reportDate: "2026-03-04",
    labName: "Lab",
    patientName: null,
    patientId: null,
    pages: [{ pageNum: 1, imageWidth: 800, imageHeight: 1100 }],
    measurements: [{ rawAnalyteName: "S_Glukóza", canonicalId: "glukoza", valueRaw: "5,32", unitRaw: "mmol/l", refRangeRaw: "(4,11-5,60)", flag: "normal" }],
  });

let tables: Tables;
let env: Env;
let pages: ReturnType<typeof fakeKv>;

beforeEach(() => {
  tables = {
    users: [{ id: "u-andres", email: DEMO_EMAIL, created_at: "2026-01-01T00:00:00Z", settings: null, session_epoch: 0 }],
    reports: [{ id: "r-1", user_id: "u-andres", payload: payload("r-1") }],
    pages: [{ report_id: "r-1", page_num: 1, kv_key: "u-andres/r-1/page_1" }],
    shares: [{ token_hash: "h", user_id: "u-andres" }],
    failures: [],
  };
  pages = fakeKv(["u-andres/r-1/page_1"]);
  env = {
    DB: fakeD1(tables),
    PAGES: pages,
    BUDGET: fakeKv([]),
    EXTRACT: {} as Fetcher,
    SESSION_SECRET: SECRET,
    EXTRACT_SESSION_SECRET: "x",
    DEMO_EMAIL,
  };
});

const ask = () => worker.fetch(new Request(`${ORIGIN}/api/auth/demo`), env);
const knock = (headers: Record<string, string> = { "content-type": "application/json" }) =>
  worker.fetch(new Request(`${ORIGIN}/api/auth/demo`, { method: "POST", headers, body: "{}" }), env);

/** The cookie a click on "Zobrazit demo pacienta" leaves behind. */
async function enterDemo(): Promise<string> {
  const res = await knock();
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** The same account, entered the ordinary way: e-mail, password, 90 days. */
async function ownLogin(): Promise<string> {
  return `mojekrev_session=${await mintCookieToken(SECRET, "u-andres", 3600)}`;
}

const call = (cookie: string, method: string, path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(ORIGIN + path, { method, ...init, headers: { cookie, ...(init.headers as Record<string, string>) } }), env);

describe("the door only exists where a demo is named", () => {
  it("answers 404 to both routes when DEMO_EMAIL is unset, and sets no cookie", async () => {
    delete env.DEMO_EMAIL;
    for (const res of [await ask(), await knock()]) {
      expect(res.status).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("answers 404 when DEMO_EMAIL names an address with no account", async () => {
    env.DEMO_EMAIL = "nikdo@example.com";
    expect((await ask()).status).toBe(404);
    const res = await knock();
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("says yes, and case-folds the configured address like every other login", async () => {
    env.DEMO_EMAIL = "  Andres@Example.com  ";
    expect(await (await ask()).json()).toEqual({ available: true });
    expect((await knock()).status).toBe(200);
  });

  it("refuses a POST that is not JSON — a cross-site form must not swap a session", async () => {
    for (const type of ["application/x-www-form-urlencoded", "text/plain", "multipart/form-data"]) {
      const res = await knock({ "content-type": type });
      expect(res.status, type).toBe(404);
      expect(res.headers.get("set-cookie"), type).toBeNull();
    }
  });
});

describe("the session it mints", () => {
  it("needs no password and logs no failure, and lasts a day rather than ninety", async () => {
    const res = await knock();
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Max-Age=86400");
    expect(tables.failures).toHaveLength(0);
  });

  it("reads the account's reports, and says it is the demo without naming whose", async () => {
    const cookie = await enterDemo();
    const me = await (await call(cookie, "GET", "/api/me")).json();
    expect(me).toEqual({ email: null, createdAt: "2026-01-01T00:00:00Z", demo: true });

    const reports = (await (await call(cookie, "GET", "/api/reports")).json()) as Array<{ id: string }>;
    expect(reports.map((r) => r.id)).toEqual(["r-1"]);
  });

  it("still writes: a stranger may correct and map, that is what makes it a demo", async () => {
    const cookie = await enterDemo();
    const res = await call(cookie, "PUT", "/api/settings", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ learned: { glukoza: ["S_Glukóza"] } }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(tables.users[0].settings!)).toEqual({ learned: { glukoza: ["S_Glukóza"] } });
  });

  it("keeps the address out of the export too — the other way it could walk out", async () => {
    const body = (await (await call(await enterDemo(), "GET", "/api/export")).json()) as { email: string | null; reports: unknown[] };
    expect(body.email).toBeNull();
    expect(body.reports).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(DEMO_EMAIL);
  });

  it("says who it is on its own login: the e-mail comes back, demo does not", async () => {
    const cookie = await ownLogin();
    const me = await (await call(cookie, "GET", "/api/me")).json();
    expect(me).toEqual({ email: DEMO_EMAIL, createdAt: "2026-01-01T00:00:00Z", demo: false });
    expect(((await (await call(cookie, "GET", "/api/export")).json()) as { email: string }).email).toBe(DEMO_EMAIL);
  });
});

describe("the line it may not cross", () => {
  it("cannot delete a report, and nothing moves", async () => {
    const res = await call(await enterDemo(), "DELETE", "/api/reports/r-1");
    expect(res.status).toBe(403);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "demo_readonly" });
    expect(tables.reports.map((r) => r.id)).toEqual(["r-1"]);
    expect([...pages._store.keys()]).toEqual(["u-andres/r-1/page_1"]);
  });

  it("cannot delete the account, and nothing moves", async () => {
    const res = await call(await enterDemo(), "DELETE", "/api/account");
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(tables.users.map((u) => u.id)).toEqual(["u-andres"]);
    expect(tables.reports).toHaveLength(1);
    expect(tables.shares).toHaveLength(1);
  });

  it("is the cookie's limit and not the account's — the owner's own login still deletes", async () => {
    const mine = await ownLogin();
    expect((await call(mine, "DELETE", "/api/reports/r-1")).status).toBe(200);
    expect(tables.reports).toHaveLength(0);
    expect((await call(mine, "DELETE", "/api/account")).status).toBe(200);
    expect(tables.users).toHaveLength(0);
  });

  it("does not outlive the demo it was minted for: the cookie dies with the row", async () => {
    const cookie = await enterDemo();
    tables.users = [];
    expect((await call(cookie, "GET", "/api/me")).status).toBe(401);
  });

  it("leaving the demo logs nobody out but the visitor: the owner's session stays", async () => {
    // A logout moves the account's session_epoch — for the person's own
    // login. A stranger clicking „Odhlásit se" in the demo must not end the
    // owner's sessions on their own account; the fake has no branch for
    // the bump, so reaching it here would throw.
    const visitor = await enterDemo();
    const owner = await ownLogin();
    const out = await call(visitor, "POST", "/api/auth/logout");
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call(owner, "GET", "/api/me")).status).toBe(200);
    expect(tables.users[0].session_epoch).toBe(0);
  });
});
