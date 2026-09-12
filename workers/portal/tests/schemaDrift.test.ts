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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schemaDrift, tablesFromSchema } from "../../../tools/scripts/check-schema.mjs";

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
});
