/**
 * The schema check's two pure halves.
 *
 * The outage this exists to prevent (2026-09-12) was invisible to every test
 * in the repo, because the fake D1 these tests run against dispatches on the
 * exact SQL strings in db.ts — a statement naming a column that exists in no
 * database at all passes them. So what is asserted here is not the queries
 * but the checker: that it reads schema.sql correctly, and that it reports the
 * one shape of drift that caused the outage.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnsFromResultSets, schemaDrift, tablesFromSchema } from "../../../tools/scripts/check-schema.mjs";

const SCHEMA = readFileSync(join(import.meta.dirname, "../schema.sql"), "utf-8");

describe("reading schema.sql", () => {
  const tables = tablesFromSchema(SCHEMA);

  it("finds every table the worker uses", () => {
    expect([...tables.keys()].sort()).toEqual([
      "ai_shares",
      "invites",
      "login_failures",
      "report_pages",
      "reports",
      "signup_attempts",
      "synonyms",
      "users",
    ]);
  });

  it("reads the columns, comments and all", () => {
    // budget_usd is the column whose absence took login down.
    expect(tables.get("users")).toEqual([
      "id",
      "email",
      "created_at",
      "settings",
      "password_hash",
      "password_salt",
      "password_iters",
      "budget_usd",
      "session_epoch",
      "consent_at",
      "email_verified_at",
    ]);
  });

  it("does not mistake a table constraint for a column", () => {
    // report_pages ends with PRIMARY KEY (report_id, page_num), which sits
    // where a column sits and is not one.
    expect(tables.get("report_pages")).toEqual(["report_id", "page_num", "kv_key", "width", "height"]);
    expect(tables.get("report_pages")).not.toContain("PRIMARY");
  });

  it("keeps a column that merely begins with a constraint word", () => {
    const t = tablesFromSchema(
      "CREATE TABLE t (\n  id TEXT PRIMARY KEY,\n  uniqueness TEXT,\n  PRIMARY KEY (id)\n);",
    );
    expect(t.get("t")).toEqual(["id", "uniqueness"]);
  });
});

/**
 * The live database is moved by migrations/ and a fresh one by schema.sql, and
 * the checker compares the live one to schema.sql alone — so a column added
 * to a migration and forgotten in schema.sql would pass check:schema and be
 * missing from every fresh database, and the reverse would pass here and
 * take login down live. Every ALTER and every CREATE in every migration
 * must therefore name something schema.sql declares.
 */
describe("the migrations and schema.sql agree", () => {
  const declared = tablesFromSchema(SCHEMA);
  const dir = join(import.meta.dirname, "../migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  it("has the open-signup migration", () => {
    expect(files).toContain("2026-09-19-open-signup.sql");
  });

  for (const file of files) {
    it(`${file} adds only columns and tables schema.sql declares`, () => {
      const sql = readFileSync(join(dir, file), "utf-8").replace(/--[^\n]*/g, "");
      for (const [, table, column] of sql.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi)) {
        expect(declared.get(table), `${file}: table ${table}`).toBeDefined();
        expect(declared.get(table), `${file}: ${table}.${column}`).toContain(column);
      }
      for (const [table, cols] of tablesFromSchema(sql)) {
        expect(declared.get(table), `${file}: table ${table}`).toEqual(cols);
      }
    });
  }
});

describe("reporting drift", () => {
  const declared = tablesFromSchema(SCHEMA);

  it("is silent when the database matches", () => {
    const live = new Map([...declared].map(([t, c]) => [t, [...c]]));
    expect(schemaDrift(declared, live)).toEqual({ missingTables: [], missingColumns: [] });
  });

  it("names the column an unapplied migration would have added", () => {
    // Exactly the 2026-09-12 state: every table present, budget_usd absent.
    const live = new Map([...declared].map(([t, c]) => [t, c.filter((x) => x !== "budget_usd")]));
    expect(schemaDrift(declared, live)).toEqual({
      missingTables: [],
      missingColumns: ["users.budget_usd"],
    });
  });

  it("names a whole table the database has never had", () => {
    const live = new Map([...declared].filter(([t]) => t !== "login_failures"));
    const { missingTables, missingColumns } = schemaDrift(declared, live);
    expect(missingTables).toEqual(["login_failures"]);
    // The table is reported once, not once per column it would have held.
    expect(missingColumns).toEqual([]);
  });

  it("ignores a table the database has and schema.sql does not", () => {
    // login_tokens was dropped by the password migration; a database still
    // carrying it is untidy, not broken, and must not fail a deploy.
    const live = new Map([...declared, ["login_tokens", ["token_hash"]]]);
    expect(schemaDrift(declared, live)).toEqual({ missingTables: [], missingColumns: [] });
  });

  it("ignores Cloudflare's own _cf_KV, which every D1 database carries", () => {
    // D1 refuses pragma_table_info on it (SQLITE_AUTH), so the checker must
    // never ask about it — and if it somehow appears in the live map, it is
    // noise, not drift.
    const live = new Map([...declared, ["_cf_KV", ["key", "value"]]]);
    expect(schemaDrift(declared, live)).toEqual({ missingTables: [], missingColumns: [] });
  });
});

describe("reading wrangler's reply", () => {
  const declared = tablesFromSchema(SCHEMA);
  const tables = [...declared.keys()];
  const sets = tables.map((t) => ({ results: declared.get(t)!.map((name) => ({ name })) }));

  it("asks only about the tables schema.sql declares", () => {
    // The 2026-09-12 checker queried sqlite_master and got _cf_KV back with
    // the rest, which D1 would not describe; the whole statement failed and
    // the check could never pass. Nothing here names a table we did not
    // declare, so _cf_KV is never in the question.
    expect(tables).not.toContain("_cf_KV");
    expect(tables.every((t) => /^[A-Za-z_]\w*$/.test(t))).toBe(true);
  });

  it("maps one result set per statement back onto its table", () => {
    expect(columnsFromResultSets(tables, sets)).toEqual(declared);
  });

  it("reads an empty result set as a table the database has not got", () => {
    const i = tables.indexOf("login_failures");
    const short = sets.map((s, k) => (k === i ? { results: [] } : s));
    const live = columnsFromResultSets(tables, short);
    expect(live.has("login_failures")).toBe(false);
    expect(schemaDrift(declared, live).missingTables).toEqual(["login_failures"]);
  });

  it("refuses a reply it cannot match to its questions", () => {
    // Fewer sets than statements, or no array at all, is a schema that was
    // not read — never a pass.
    expect(() => columnsFromResultSets(tables, sets.slice(1))).toThrow(/expected 8 result sets, got 7/);
    expect(() => columnsFromResultSets(tables, { error: "SQLITE_AUTH" })).toThrow(/got object/);
  });
});
