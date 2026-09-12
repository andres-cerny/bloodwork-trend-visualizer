/**
 * The taught spellings: what one account files under a shipped analyte is
 * read by every account, and only the teacher can take it back.
 *
 * Same harness as reports.test.ts — everything real except D1.
 */
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken } from "../src/session";

const SECRET = "test-portal-secret";

interface Tables {
  users: Array<{ id: string; email: string; created_at: string; settings: string | null; budget_usd?: number | null }>;
  synonyms: Array<{ raw_name: string; canonical_id: string; taught_by: string | null; created_at: string }>;
}

function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.allSynonyms:
        return { results: t.synonyms.map((s) => ({ raw_name: s.raw_name, canonical_id: s.canonical_id, taught_by: s.taught_by })), changes: 0 };
      case SQL.upsertSynonym: {
        const [raw, cid, by, at] = a as [string, string, string, string];
        const existing = t.synonyms.find((s) => s.raw_name === raw);
        if (existing) Object.assign(existing, { canonical_id: cid, taught_by: by, created_at: at });
        else t.synonyms.push({ raw_name: raw, canonical_id: cid, taught_by: by, created_at: at });
        return { results: [], changes: 1 };
      }
      case SQL.deleteSynonym: {
        const before = t.synonyms.length;
        t.synonyms = t.synonyms.filter((s) => !(s.raw_name === a[0] && s.taught_by === a[1]));
        return { results: [], changes: before - t.synonyms.length };
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
      const r = run(sql, args);
      return { success: true, meta: { changes: r.changes } };
    },
  });
  return { prepare: (sql: string) => make(sql, []) } as unknown as D1Database;
}

function env(t: Tables): Env {
  return {
    DB: fakeD1(t),
    PAGES: {} as KVNamespace,
    BUDGET: {} as KVNamespace,
    EXTRACT: {} as Fetcher,
    SESSION_SECRET: SECRET,
    EXTRACT_SESSION_SECRET: "x",
    SESSION_TTL_DAYS: "90",
    PORTAL_USD_LIMIT: "5",
    MAX_PAGES_PER_REPORT: "30",
  } as unknown as Env;
}

async function as(uid: string, method: string, path: string, body?: unknown): Promise<Response> {
  const cookie = `mojekrev_session=${await mintCookieToken(SECRET, uid, 90 * 86400)}`;
  return worker.fetch(
    new Request(`https://portal${path}`, {
      method,
      headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env(current),
  );
}

let current: Tables;
const fresh = (): Tables => ({
  users: [
    { id: "u-a", email: "a@x.cz", created_at: "2026-01-01", settings: null },
    { id: "u-b", email: "b@x.cz", created_at: "2026-01-01", settings: null },
  ],
  synonyms: [],
});

describe("taught spellings", () => {
  it("what one account teaches, the other reads — marked as not theirs", async () => {
    current = fresh();
    expect((await as("u-a", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "sodik" })).status).toBe(200);
    const seenByB = (await (await as("u-b", "GET", "/api/synonyms")).json()) as Array<{ rawName: string; canonicalId: string; mine: boolean }>;
    expect(seenByB).toEqual([{ rawName: "S_Na", canonicalId: "sodik", mine: false }]);
    const seenByA = (await (await as("u-a", "GET", "/api/synonyms")).json()) as Array<{ mine: boolean }>;
    expect(seenByA[0].mine).toBe(true);
  });

  it("only the teacher can withdraw it", async () => {
    current = fresh();
    await as("u-a", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "sodik" });
    const byB = (await (await as("u-b", "DELETE", "/api/synonyms", { rawName: "S_Na" })).json()) as { removed: boolean };
    expect(byB.removed).toBe(false);
    expect(current.synonyms).toHaveLength(1);
    const byA = (await (await as("u-a", "DELETE", "/api/synonyms", { rawName: "S_Na" })).json()) as { removed: boolean };
    expect(byA.removed).toBe(true);
    expect(current.synonyms).toHaveLength(0);
  });

  it("refuses a name that is not a printed name or an id that is not a catalog key", async () => {
    current = fresh();
    expect((await as("u-a", "PUT", "/api/synonyms", { rawName: "", canonicalId: "sodik" })).status).toBe(400);
    expect((await as("u-a", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "Sodík; DROP" })).status).toBe(400);
    expect((await as("u-a", "PUT", "/api/synonyms", { rawName: "x".repeat(201), canonicalId: "sodik" })).status).toBe(400);
    expect(current.synonyms).toHaveLength(0);
  });

  it("is the account's own data — no session, no answer", async () => {
    current = fresh();
    const res = await worker.fetch(new Request("https://portal/api/synonyms"), env(current));
    expect(res.status).toBe(401);
  });
});
