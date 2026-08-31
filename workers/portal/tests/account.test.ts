/**
 * Leaving: the export the person takes with them, and the deletion that
 * leaves nothing behind. The deletion test walks the fake KV as well as the
 * tables — "zero rows and zero objects" is the gate in docs/plans/portal.md.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken } from "../src/session";

const SECRET = "test-portal-secret";

interface Tables {
  users: Array<{ id: string; email: string; created_at: string; settings: string | null }>;
  invites: Array<{ code: string; used_by: string | null; used_at: string | null }>;
  tokens: Array<{ token_hash: string; user_id: string }>;
  reports: Array<{ id: string; user_id: string; report_date: string | null; lab_name: string | null; payload: string }>;
  pages: Array<{ report_id: string; page_num: number; kv_key: string }>;
}

function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.reportsForUser:
        return { results: t.reports.filter((r) => r.user_id === a[0]).map((r) => ({ id: r.id, payload: r.payload })), changes: 0 };
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
      case SQL.deleteTokensForUser: {
        const before = t.tokens.length;
        t.tokens = t.tokens.filter((k) => k.user_id !== a[0]);
        return { results: [], changes: before - t.tokens.length };
      }
      case SQL.unlinkInvites: {
        let n = 0;
        for (const i of t.invites) if (i.used_by === a[0]) (i.used_by = null), n++;
        return { results: [], changes: n };
      }
      case SQL.deleteUser: {
        const before = t.users.length;
        t.users = t.users.filter((u) => u.id !== a[0]);
        return { results: [], changes: before - t.users.length };
      }
      case SQL.inviteByCode:
        return { results: t.invites.filter((i) => i.code === a[0]), changes: 0 };
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

const A = { id: "u-a", email: "a@example.com", created_at: "2026-01-01T00:00:00Z", settings: null };
const B = { id: "u-b", email: "b@example.com", created_at: "2026-01-01T00:00:00Z", settings: null };
const payload = (id: string, date: string) =>
  JSON.stringify({
    id,
    sourceFile: `${id}.pdf`,
    reportDate: date,
    labName: "Lab",
    patientName: null,
    patientId: null,
    pages: [{ pageNum: 1, imageWidth: 800, imageHeight: 1100 }],
    measurements: [{ rawAnalyteName: "S_Glukóza", canonicalId: "glukoza", valueRaw: "5,32", unitRaw: "mmol/l", refRangeRaw: "(4,11-5,60)", flag: "normal" }],
  });

let tables: Tables;
let env: Env;
let pages: ReturnType<typeof fakeKv>;

async function as(user: { id: string }) {
  return { cookie: `mojekrev_session=${await mintCookieToken(SECRET, user.id, 3600)}` };
}
const call = async (user: { id: string }, method: string, path: string) =>
  worker.fetch(new Request(`https://portal${path}`, { method, headers: await as(user) }), env);

beforeEach(() => {
  tables = {
    users: [{ ...A }, { ...B }],
    invites: [
      { code: "code-a", used_by: "u-a", used_at: "2026-01-01" },
      { code: "code-b", used_by: "u-b", used_at: "2026-01-01" },
    ],
    tokens: [{ token_hash: "ta", user_id: "u-a" }, { token_hash: "tb", user_id: "u-b" }],
    reports: [
      { id: "r-1", user_id: "u-a", report_date: "2026-03-04", lab_name: "Lab", payload: payload("r-1", "2026-03-04") },
      { id: "r-2", user_id: "u-a", report_date: "2026-05-04", lab_name: "Lab", payload: payload("r-2", "2026-05-04") },
      { id: "r-9", user_id: "u-b", report_date: "2026-05-04", lab_name: "Lab", payload: payload("r-9", "2026-05-04") },
    ],
    pages: [
      { report_id: "r-1", page_num: 1, kv_key: "u-a/r-1/page_1" },
      { report_id: "r-2", page_num: 1, kv_key: "u-a/r-2/page_1" },
      { report_id: "r-9", page_num: 1, kv_key: "u-b/r-9/page_1" },
    ],
  };
  pages = fakeKv(["u-a/r-1/page_1", "u-a/r-2/page_1", "u-b/r-9/page_1"]);
  env = {
    DB: fakeD1(tables),
    PAGES: pages,
    BUDGET: fakeKv([]),
    EXTRACT: {} as Fetcher,
    SESSION_SECRET: SECRET,
    EXTRACT_SESSION_SECRET: "x",
  };
});

describe("export", () => {
  it("hands back the stored payloads as a JSON file", async () => {
    const res = await call(A, "GET", "/api/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="moje-krev-\d{4}-\d{2}-\d{2}\.json"/);
    const body = (await res.json()) as { email: string; reports: Array<{ id: string; patientName: unknown }> };
    expect(body.email).toBe("a@example.com");
    expect(body.reports.map((r) => r.id)).toEqual(["r-1", "r-2"]);
    expect(body.reports.every((r) => r.patientName === null)).toBe(true);
  });

  it("flattens to one printed row per CSV line, with a BOM for Excel", async () => {
    const res = await call(A, "GET", "/api/export?format=csv");
    expect(res.headers.get("content-type")).toContain("text/csv");
    // text() strips a leading BOM per the fetch spec, so the proof that
    // Excel gets one has to read bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes).trim().split("\r\n");
    expect(lines[0]).toBe("datum;laborator;parametr;nazev;hodnota;jednotka;rozmezi;stav;report");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('"2026-03-04";"Lab";"S_Glukóza";"glukoza";"5,32";"mmol/l";"(4,11-5,60)";"normal";"r-1"');
  });

  it("is each account's own", async () => {
    const body = (await (await call(B, "GET", "/api/export")).json()) as { reports: Array<{ id: string }> };
    expect(body.reports.map((r) => r.id)).toEqual(["r-9"]);
  });
});

describe("delete account", () => {
  it("leaves zero rows and zero objects for the account, and touches nobody else's", async () => {
    const res = await call(A, "DELETE", "/api/account");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");

    expect(tables.users.map((u) => u.id)).toEqual(["u-b"]);
    expect(tables.reports.map((r) => r.id)).toEqual(["r-9"]);
    expect(tables.pages.map((p) => p.kv_key)).toEqual(["u-b/r-9/page_1"]);
    expect(tables.tokens.map((t) => t.user_id)).toEqual(["u-b"]);
    expect([...pages._store.keys()]).toEqual(["u-b/r-9/page_1"]);
  });

  it("makes the account's cookie a 401 from the next request on", async () => {
    const headers = await as(A);
    await worker.fetch(new Request("https://portal/api/account", { method: "DELETE", headers }), env);
    const after = await worker.fetch(new Request("https://portal/api/reports", { headers }), env);
    expect(after.status).toBe(401);
  });

  it("keeps the invite that opened the account spent", async () => {
    await call(A, "DELETE", "/api/account");
    const inv = tables.invites.find((i) => i.code === "code-a")!;
    expect(inv.used_by).toBeNull();
    expect(inv.used_at).not.toBeNull();
    const res = await worker.fetch(
      new Request("https://portal/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite: "code-a", email: "new@example.com" }),
      }),
      env,
    );
    expect(res.status).toBe(403);
  });
});
