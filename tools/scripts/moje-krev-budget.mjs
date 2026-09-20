#!/usr/bin/env node
/**
 * Set one person's monthly extraction ceiling in Moje krev.
 *
 *   node tools/scripts/moje-krev-budget.mjs kdo@example.com 20        # print SQL
 *   node tools/scripts/moje-krev-budget.mjs kdo@example.com 20 --apply
 *   node tools/scripts/moje-krev-budget.mjs kdo@example.com --default # back to PORTAL_USD_LIMIT
 *   node tools/scripts/moje-krev-budget.mjs --show --apply            # who is on what
 *   node tools/scripts/moje-krev-budget.mjs kdo@example.com --documents 5 --apply   # grant documents
 *   node tools/scripts/moje-krev-budget.mjs kdo@example.com --documents -5 --apply  # take them back (a refund)
 *
 * The account has to exist: this UPDATEs a row keyed by e-mail, so it is run
 * after the person has registered, not before. Read wrangler's row count —
 * "rows written: 0" means the address has no account, not that the budget is
 * already right.
 *
 * A budget of 0 is allowed and is not the same as --default: it freezes that
 * account's uploads while leaving everyone else alone. The worker reads the
 * column with `??`, so 0 survives rather than falling back.
 *
 * Nothing here is retroactive. The ceiling applies to the running calendar
 * month's spend, which lives in KV (src/ledger.ts) and is not touched: raise
 * a frozen person and their next upload goes through immediately.
 *
 * --documents is the other allowance, the one the person sees: it adds to
 * `doc_allowance` (five free, plus what was bought or granted). Whole
 * numbers, either sign — a refund takes back what a purchase gave — and the
 * total never drops under what the account has already used, so a refund
 * cannot leave someone at "7 of 5". Used documents are not touched: what
 * was read was read.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The one statement, and the sentence that says what it will do. */
export function budgetSql({ email, usd }) {
  const addr = String(email).trim().toLowerCase();
  const value = usd === null ? "NULL" : String(usd);
  return {
    sql: `UPDATE users SET budget_usd = ${value} WHERE email = ${q(addr)};`,
    says:
      usd === null
        ? `${addr} → back to the deployment default (PORTAL_USD_LIMIT)`
        : `${addr} → ${usd} USD per month`,
  };
}

/** Grant (or, negative, take back) documents; the sentence says which. */
export function documentsSql({ email, n }) {
  const addr = String(email).trim().toLowerCase();
  const value = Number(n);
  if (!Number.isInteger(value) || value === 0) throw new Error(`not a number of documents: ${n}`);
  return {
    sql: `UPDATE users SET doc_allowance = MAX(doc_used, doc_allowance ${value < 0 ? "-" : "+"} ${Math.abs(value)}) WHERE email = ${q(addr)};`,
    says: value > 0 ? `${addr} → +${value} documents` : `${addr} → ${value} documents (never under what is used)`,
  };
}

export const SHOW_SQL =
  "SELECT email, COALESCE(CAST(budget_usd AS TEXT), 'default') AS budget_usd, doc_used, doc_allowance FROM users ORDER BY email;";

function run(sql) {
  execFileSync("npx", ["wrangler", "d1", "execute", "moje-krev", "--remote", `--command=${sql}`], {
    stdio: "inherit",
    cwd: new URL("../../workers/portal", import.meta.url).pathname,
  });
}

function main(argv) {
  const apply = argv.includes("--apply");
  const rest = argv.filter((a) => !a.startsWith("--"));

  if (argv.includes("--show")) {
    console.log(SHOW_SQL);
    if (apply) run(SHOW_SQL);
    else console.log("\n(dry run — add --apply to read the remote database)");
    return;
  }

  const email = rest[0];
  if (!email || !email.includes("@")) {
    console.error("usage: moje-krev-budget.mjs <e-mail> <usd|--default> [--apply]   ·   <e-mail> --documents <n> [--apply]   ·   --show [--apply]");
    process.exit(1);
  }

  const docs = argv.indexOf("--documents");
  if (docs >= 0) {
    let out;
    try {
      out = documentsSql({ email, n: argv[docs + 1] });
    } catch (e) {
      console.error(`${e.message} — give a whole number, e.g. --documents 5 or --documents -5`);
      process.exit(1);
    }
    console.log(out.sql);
    console.log(`\n${out.says}`);
    if (apply) run(out.sql);
    else console.log("\n(dry run — add --apply to execute against the remote database)");
    return;
  }

  let usd = null;
  if (!argv.includes("--default")) {
    usd = Number(rest[1]);
    if (!Number.isFinite(usd) || usd < 0) {
      console.error(`not a budget: ${rest[1] ?? "(missing)"} — give a number of USD, or --default`);
      process.exit(1);
    }
  }

  const { sql, says } = budgetSql({ email, usd });
  console.log(sql);
  console.log(`\n${says}`);
  if (apply) run(sql);
  else console.log("\n(dry run — add --apply to execute against the remote database)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
