#!/usr/bin/env node
/**
 * Refuse to deploy a worker whose SQL names a column the live database has not
 * got.
 *
 * On 2026-09-12 a deploy took Moje krev's login down for everyone. The cause
 * was not a bug in any sense the tests could reach: `db.ts` had grown
 * `budget_usd` in the two statements that read an account, the migration that
 * adds that column had never been applied to the remote database, and the
 * commit carrying the query went out while the schema stayed behind. Every
 * login then threw `no such column` before the password was even compared,
 * which reaches the browser as a bare 500.
 *
 * Nothing offline could see it. The worker's own tests fake D1 by dispatching
 * on the exact SQL strings in `db.ts`, so a statement naming a column that
 * exists nowhere passes all of them; `npm run test:all` was green throughout.
 * The gap is between the repo and one live database, so the only thing that
 * can close it is a question asked of that database.
 *
 * `schema.sql` is the authority, by its own terms — "the schema for a fresh
 * database ... a column added here must also be added there". So this reads
 * the live shape and reports anything `schema.sql` declares that the database
 * is missing.
 *
 *   npm run check:schema
 *
 * It needs D1 read access on the Cloudflare token, so it is not part of
 * `npm test` — it belongs to the deploy pre-flight, beside check:bundle.
 *
 * A check that cannot see is never a check that passed: if the live schema
 * cannot be read at all, this exits non-zero and says so. The outage it
 * exists to prevent was an invisible gap, and "I could not look" must not
 * read like "nothing is wrong".
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const SCHEMA = new URL("workers/portal/schema.sql", ROOT);
const WORKER_DIR = fileURLToPath(new URL("workers/portal", ROOT));
const DB = "moje-krev";

/** Table-level constraints share the column position and are not columns. */
const CONSTRAINT = new Set(["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"]);

/** Split a CREATE TABLE body on its top-level commas: `PRIMARY KEY (a, b)`
 *  must survive as one piece. */
function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(at, i));
      at = i + 1;
    }
  }
  parts.push(body.slice(at));
  return parts;
}

/** table name → column names, as `schema.sql` declares them. */
export function tablesFromSchema(sql) {
  const clean = sql.replace(/--[^\n]*/g, "");
  const out = new Map();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_]\w*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  for (const [, table, body] of clean.matchAll(re)) {
    const cols = topLevelParts(body)
      .map((p) => p.trim().split(/\s+/)[0])
      .filter((c) => c && !CONSTRAINT.has(c.toUpperCase()));
    out.set(table, cols);
  }
  return out;
}

/** What `schema.sql` declares and the live database does not have. */
export function schemaDrift(declared, live) {
  const missingTables = [];
  const missingColumns = [];
  for (const [table, cols] of declared) {
    const actual = live.get(table);
    if (!actual) {
      missingTables.push(table);
      continue;
    }
    for (const c of cols) if (!actual.includes(c)) missingColumns.push(`${table}.${c}`);
  }
  return { missingTables, missingColumns };
}

/**
 * The live shape of the declared tables, in one round trip.
 *
 * D1's SQL authorizer refuses `pragma_table_info()` as a table-valued
 * function — `JOIN pragma_table_info(m.name)` comes back `SQLITE_AUTH`
 * (code 7500), which reads at first like a token problem and is not one.
 * The statement form `PRAGMA table_info(t)` is allowed, so this sends one
 * per declared table in a single command; wrangler returns one result set
 * per statement, in order, and a table the database has not got returns an
 * empty one.
 *
 * Table names are interpolated, but only after `tablesFromSchema` has
 * matched them as identifiers (`[A-Za-z_]\w*`) out of our own schema.sql.
 */
function liveTables(tables) {
  const sql = tables.map((t) => `PRAGMA table_info(${t});`).join(" ");
  const raw = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, "--remote", "--json", `--command=${sql}`],
    { cwd: WORKER_DIR, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  // wrangler prints its banner before the JSON on some versions.
  const at = raw.indexOf("[");
  if (at < 0) throw new Error(`no JSON in wrangler output:\n${raw}`);
  const sets = JSON.parse(raw.slice(at));
  if (!Array.isArray(sets) || sets.length !== tables.length) {
    throw new Error(`expected ${tables.length} result sets, got ${Array.isArray(sets) ? sets.length : typeof sets}:\n${raw}`);
  }
  const out = new Map();
  tables.forEach((t, i) => {
    const cols = (sets[i]?.results ?? []).map((r) => r.name);
    if (cols.length > 0) out.set(t, cols);
  });
  return out;
}

function main() {
  const declared = tablesFromSchema(readFileSync(SCHEMA, "utf-8"));
  if (declared.size === 0) {
    console.error("✘ parsed no tables out of workers/portal/schema.sql — the parser or the file changed shape.");
    process.exit(1);
  }

  let live;
  try {
    live = liveTables([...declared.keys()]);
  } catch (e) {
    console.error(
      "✘ could not read the live schema of the D1 database " + DB + ".\n" +
        "  This is NOT a pass. Do not deploy until the schema has been checked.\n" +
        "  A Cloudflare API token with Account · D1 · Read is what this needs;\n" +
        "  code 7403 below means the token has none.\n\n" +
        // Both streams: wrangler reports an authorization failure on stdout
        // under --json and a network one on stderr, and the operator needs
        // whichever it was.
        [e.stdout, e.stderr, e.message]
          .map((s) => String(s ?? "").trim())
          .filter(Boolean)
          .join("\n")
          .replace(/^.*Proxy environment variables.*$/gm, "")
          .trim(),
    );
    process.exit(1);
  }

  const { missingTables, missingColumns } = schemaDrift(declared, live);
  if (missingTables.length === 0 && missingColumns.length === 0) {
    const n = [...declared.values()].reduce((t, c) => t + c.length, 0);
    console.log(`✓ ${DB}: ${declared.size} tables, ${n} columns — the live schema matches schema.sql`);
    return;
  }

  console.error(`✘ ${DB} is behind workers/portal/schema.sql:`);
  for (const t of missingTables) console.error(`    missing table:  ${t}`);
  for (const c of missingColumns) console.error(`    missing column: ${c}`);
  console.error(
    "\n  Deploying a worker whose SQL names these will 500 on every request\n" +
      "  that touches them. Apply the migration that adds them first:\n\n" +
      "    cd workers/portal && npx wrangler d1 execute " + DB + " --remote --file migrations/<file>.sql\n\n" +
      "  then run this again before deploying.",
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
