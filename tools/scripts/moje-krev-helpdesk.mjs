#!/usr/bin/env node
/**
 * Read and mark the help-desk messages of Moje krev.
 *
 *   node tools/scripts/moje-krev-helpdesk.mjs --list                    # print SQL
 *   node tools/scripts/moje-krev-helpdesk.mjs --list --apply            # the last 50 messages
 *   node tools/scripts/moje-krev-helpdesk.mjs --list --unanswered --apply
 *   node tools/scripts/moje-krev-helpdesk.mjs --read <id> --apply       # one message, whole
 *   node tools/scripts/moje-krev-helpdesk.mjs --answered <id> --apply   # after the e-mail went
 *
 * A message is answered by e-mail, by hand — this script keeps no reply and
 * sends nothing. `--answered` sets `answered_at` so `--unanswered` shrinks;
 * it is the same UPDATE the Telegram notice prints under each message.
 * Read wrangler's row count: "rows written: 0" means the id was not found.
 *
 * Same shape as moje-krev-budget.mjs: the SQL is printed first and executed
 * only with --apply, so a wrong id costs a look, not a write.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The list: newest first, the text clipped to a line, the account only as "yes/no". */
export function listSql({ unanswered = false, limit = 50 } = {}) {
  const where = unanswered ? " WHERE answered_at IS NULL" : "";
  return (
    "SELECT id, created_at, email, CASE WHEN user_id IS NULL THEN 'ne' ELSE 'ano' END AS ucet, " +
    "COALESCE(report_id, '') AS report, COALESCE(answered_at, '') AS odpovezeno, " +
    `substr(replace(text, char(10), ' '), 1, 80) AS zprava FROM messages${where} ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(500, limit | 0))};`
  );
}

/** One message, whole. */
export function readSql(id) {
  return `SELECT id, created_at, email, user_id, report_id, user_agent, answered_at, text FROM messages WHERE id = ${q(id)};`;
}

/** Mark as answered, now. Null `at` means "now" on the database's clock. */
export function answeredSql(id, at = null) {
  const when = at === null ? "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')" : q(at);
  return `UPDATE messages SET answered_at = ${when} WHERE id = ${q(id)} AND answered_at IS NULL;`;
}

function run(sql) {
  execFileSync("npx", ["wrangler", "d1", "execute", "moje-krev", "--remote", `--command=${sql}`], {
    stdio: "inherit",
    cwd: new URL("../../workers/portal", import.meta.url).pathname,
  });
}

function usage() {
  console.error("usage: moje-krev-helpdesk.mjs --list [--unanswered] [--apply]   ·   --read <id> [--apply]   ·   --answered <id> [--apply]");
  process.exit(1);
}

function main(argv) {
  const apply = argv.includes("--apply");
  const dry = (what) => console.log(`\n(dry run — add --apply to ${what})`);
  const idAfter = (flag) => {
    const id = argv[argv.indexOf(flag) + 1];
    if (!id || !ID.test(id)) {
      console.error(`not a message id: ${id ?? "(missing)"} — the Telegram notice and --list print them`);
      process.exit(1);
    }
    return id;
  };

  if (argv.includes("--list")) {
    const sql = listSql({ unanswered: argv.includes("--unanswered") });
    console.log(sql);
    if (apply) run(sql);
    else dry("read the remote database");
    return;
  }
  if (argv.includes("--read")) {
    const sql = readSql(idAfter("--read"));
    console.log(sql);
    if (apply) run(sql);
    else dry("read the remote database");
    return;
  }
  if (argv.includes("--answered")) {
    const sql = answeredSql(idAfter("--answered"));
    console.log(sql);
    if (apply) run(sql);
    else dry("execute against the remote database");
    return;
  }
  usage();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
