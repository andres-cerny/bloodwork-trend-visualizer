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
  users: Array<{ id: string; email: string; created_at: string; settings: string | null; budget_usd?: number | null; session_epoch: number }>;
  synonyms: Array<{ raw_name: string; canonical_id: string; taught_by: string | null; created_at: string }>;
  auto?: Array<{ code: string; name_cs: string; unit: string; mat?: string; raw_name: string; model: string | null; created_by: string | null; created_at: string }>;
  aliases?: Array<{ lab: string; raw_name: string; unit: string; canonical_id: string | null; source: string; model: string | null; code?: string | null; taught_by: string | null; created_at: string }>;
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
        if (existing && existing.taught_by !== by && existing.taught_by !== null && existing.taught_by !== a[4]) return { results: [], changes: 0 };
        if (existing) Object.assign(existing, { canonical_id: cid, taught_by: by, created_at: at });
        else t.synonyms.push({ raw_name: raw, canonical_id: cid, taught_by: by, created_at: at });
        return { results: [], changes: 1 };
      }
      case SQL.deleteSynonym: {
        const before = t.synonyms.length;
        t.synonyms = t.synonyms.filter((s) => !(s.raw_name === a[0] && s.taught_by === a[1]));
        return { results: [], changes: before - t.synonyms.length };
      }
      case SQL.allAliases:
        return { results: (t.aliases ??= []).map(({ created_at: _c, ...r }) => r), changes: 0 };
      case SQL.upsertAlias: {
        // Mirrors the SQL's WHERE: owner (unless a model would replace a
        // person), nobody's, the demo's, or a person replacing a model.
        const [lab, raw, unit, cid, source, model, by, at, demo, code] = a as [string, string, string, string | null, string, string | null, string, string, string | null, string | null];
        const rows = (t.aliases ??= []);
        const ex = rows.find((r) => r.lab === lab && r.raw_name === raw && r.unit === unit);
        if (ex) {
          const may =
            (ex.taught_by === by && !(ex.source === "person" && source === "model")) ||
            ex.taught_by === null || ex.taught_by === demo || (ex.source === "model" && source === "person");
          if (!may) return { results: [], changes: 0 };
          Object.assign(ex, { canonical_id: cid, source, model, code, taught_by: by, created_at: at });
        } else rows.push({ lab, raw_name: raw, unit, canonical_id: cid, source, model, code, taught_by: by, created_at: at });
        return { results: [], changes: 1 };
      }
      case SQL.deleteAlias: {
        const rows = (t.aliases ??= []);
        const before = rows.length;
        t.aliases = rows.filter((r) => !(r.lab === a[0] && r.raw_name === a[1] && r.unit === a[2] && r.taught_by === a[3]));
        return { results: [], changes: before - t.aliases.length };
      }
      case SQL.allAutoEntries:
        return { results: [...(t.auto ??= [])], changes: 0 };
      case SQL.insertAutoEntry: {
        const rows = (t.auto ??= []);
        if (rows.some((r) => r.code === a[0])) return { results: [], changes: 0 };
        rows.push({ code: a[0] as string, name_cs: a[1] as string, unit: a[2] as string, raw_name: a[3] as string, model: a[4] as string | null, created_by: a[5] as string, created_at: a[6] as string, mat: a[7] as string });
        return { results: [], changes: 1 };
      }
      case SQL.deleteAutoEntry: {
        const rows = (t.auto ??= []);
        const before = rows.length;
        t.auto = rows.filter((r) => !(r.code === a[0] && r.created_by === a[1]));
        return { results: [], changes: before - t.auto.length };
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

async function as(uid: string, method: string, path: string, body?: unknown, demo = false): Promise<Response> {
  const cookie = `mojekrev_session=${await mintCookieToken(SECRET, uid, 90 * 86400, demo)}`;
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
    { id: "u-a", email: "a@x.cz", created_at: "2026-01-01", settings: null, session_epoch: 0 },
    { id: "u-b", email: "b@x.cz", created_at: "2026-01-01", settings: null, session_epoch: 0 },
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

  it("belongs to its first teacher: another account cannot relabel it, the teacher can", async () => {
    current = fresh();
    await as("u-a", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "sodik" });
    const byB = (await (await as("u-b", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "draslik" })).json()) as { taught: boolean };
    expect(byB.taught).toBe(false);
    expect(current.synonyms).toEqual([expect.objectContaining({ raw_name: "S_Na", canonical_id: "sodik", taught_by: "u-a" })]);
    await as("u-a", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "chloridy" });
    expect(current.synonyms[0]).toMatchObject({ canonical_id: "chloridy", taught_by: "u-a" });
  });

  it("can be put right when its teacher is gone", async () => {
    current = fresh();
    current.synonyms.push({ raw_name: "S_Na", canonical_id: "draslik", taught_by: null as unknown as string, created_at: "2026-01-01" });
    const res = (await (await as("u-b", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "sodik" })).json()) as { taught: boolean };
    expect(res.taught).toBe(true);
    expect(current.synonyms[0]).toMatchObject({ canonical_id: "sodik", taught_by: "u-b" });
  });

  it("is not taught from the demo", async () => {
    current = fresh();
    const res = await as("u-a", "PUT", "/api/synonyms", { rawName: "S_Na", canonicalId: "sodik" }, true);
    expect(res.status).toBe(403);
    expect(current.synonyms).toHaveLength(0);
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

describe("scoped aliases (lab, printed name, unit)", () => {
  it("one account's decision is read by every account, with its scope and source", async () => {
    current = fresh();
    const body = { lab: "Stod", rawName: "P_Protrombinový test", unit: "s", canonicalId: "pt_cas", source: "model", model: "claude-haiku-5-5", code: "02213" };
    expect((await as("u-a", "PUT", "/api/aliases", body)).status).toBe(200);
    const seen = (await (await as("u-b", "GET", "/api/aliases")).json()) as any[];
    expect(seen).toEqual([{ lab: "Stod", rawName: "P_Protrombinový test", unit: "s", canonicalId: "pt_cas", source: "model", model: "claude-haiku-5-5", code: "02213", mine: false }]);
    // A malformed code is dropped, not stored.
    await as("u-a", "PUT", "/api/aliases", { ...body, code: "DROP TABLE" });
    expect(current.aliases![0].code).toBeNull();
  });

  it("a person's decision replaces a model's; a model's never replaces a person's", async () => {
    current = fresh();
    const scope = { lab: "Stod", rawName: "Glukóza", unit: "arb.j." };
    await as("u-a", "PUT", "/api/aliases", { ...scope, canonicalId: null, source: "model", model: "claude-haiku-5-5" });
    await as("u-b", "PUT", "/api/aliases", { ...scope, canonicalId: "glukoza", source: "person" });
    expect(current.aliases![0]).toMatchObject({ canonical_id: "glukoza", source: "person", taught_by: "u-b" });
    const r = (await (await as("u-b", "PUT", "/api/aliases", { ...scope, canonicalId: null, source: "model", model: "claude-haiku-5-5" })).json()) as { taught: boolean };
    expect(r.taught).toBe(false);
    expect(current.aliases![0]).toMatchObject({ canonical_id: "glukoza", source: "person" });
  });

  it("only the account that saved a decision can withdraw it", async () => {
    current = fresh();
    const scope = { lab: "Stod", rawName: "B-HbA1c", unit: "%" };
    await as("u-a", "PUT", "/api/aliases", { ...scope, canonicalId: null, source: "model", model: "claude-haiku-5-5" });
    expect(((await (await as("u-b", "DELETE", "/api/aliases", scope)).json()) as any).removed).toBe(false);
    expect(((await (await as("u-a", "DELETE", "/api/aliases", scope)).json()) as any).removed).toBe(true);
    expect(current.aliases).toEqual([]);
  });

  it("refuses a malformed decision: no name, a bad id, a model answer without its model", async () => {
    current = fresh();
    for (const body of [
      { lab: "L", rawName: "", unit: "", canonicalId: "sodik" },
      { lab: "L", rawName: "S_Na", unit: "", canonicalId: "Sodík!" },
      { lab: "L", rawName: "S_Na", unit: "", canonicalId: "sodik", source: "model" },
      { lab: "L", rawName: "S_Na", unit: "", source: "person" },
    ]) {
      expect((await as("u-a", "PUT", "/api/aliases", body)).status).toBe(400);
    }
  });
});

describe("auto-added catalog entries (NČLP)", () => {
  const entry = { code: "01721", nameCs: "Estron (S; látková konc. [pmol/l])", unit: "pmol/l", material: "s", rawName: "S_Estron", model: "claude-haiku-5-5" };

  it("one account adds, every account sees it — the first writer of a code keeps it", async () => {
    current = fresh();
    expect(((await (await as("u-a", "PUT", "/api/auto-entries", entry)).json()) as any).added).toBe(true);
    expect(((await (await as("u-b", "PUT", "/api/auto-entries", { ...entry, nameCs: "jiný" })).json()) as any).added).toBe(false);
    const seen = (await (await as("u-b", "GET", "/api/auto-entries")).json()) as any[];
    expect(seen).toEqual([expect.objectContaining({ code: "01721", nameCs: entry.nameCs, material: "s", rawName: "S_Estron", mine: false })]);
  });

  it("only the creator withdraws it through the API", async () => {
    current = fresh();
    await as("u-a", "PUT", "/api/auto-entries", entry);
    expect(((await (await as("u-b", "DELETE", "/api/auto-entries", { code: "01721" })).json()) as any).removed).toBe(false);
    expect(((await (await as("u-a", "DELETE", "/api/auto-entries", { code: "01721" })).json()) as any).removed).toBe(true);
  });

  it("refuses a malformed entry", async () => {
    current = fresh();
    // A urine (or unknown) specimen is never an auto entry in Moje krev.
    for (const body of [{ ...entry, code: "1721" }, { ...entry, nameCs: "" }, { ...entry, rawName: "" }, { ...entry, material: "u" }, { ...entry, material: undefined }]) {
      expect((await as("u-a", "PUT", "/api/auto-entries", body)).status).toBe(400);
    }
  });
});

