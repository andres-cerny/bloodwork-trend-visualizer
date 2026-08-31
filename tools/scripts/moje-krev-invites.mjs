#!/usr/bin/env node
/**
 * Mint invite codes for Moje krev.
 *
 *   node tools/scripts/moje-krev-invites.mjs 3 "máma, táta, Ondřej"   # print SQL
 *   node tools/scripts/moje-krev-invites.mjs 3 "note" --apply         # run it remotely
 *
 * Codes are word-word-word from a small Czech-friendly list: easy to read
 * aloud over the phone, hard to guess (24^3 ≈ 14k combinations is plenty when
 * every failed attempt costs a round trip and codes are single-use).
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";

const WORDS = [
  "kapka", "krev", "puls", "srdce", "zdravi", "sila", "klid", "rano",
  "voda", "vitr", "slunce", "mesic", "hora", "reka", "les", "louka",
  "jablko", "hruska", "svestka", "trnka", "lipa", "dub", "javor", "buk",
];

const n = parseInt(process.argv[2] ?? "1", 10) || 1;
const note = (process.argv[3] ?? "").replace(/'/g, "''");
const apply = process.argv.includes("--apply");

const code = () =>
  Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]).join("-") +
  "-" +
  String(randomInt(10, 100));

const nowIso = new Date().toISOString();
const values = Array.from({ length: n }, () => `('${code()}', '${note}', '${nowIso}')`);
const sql = `INSERT INTO invites (code, note, created_at) VALUES ${values.join(", ")};`;

console.log(sql);

if (apply) {
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "moje-krev", "--remote", `--command=${sql}`],
    { stdio: "inherit", cwd: new URL("../../workers/portal", import.meta.url).pathname },
  );
} else {
  console.log("\n(dry run — add --apply to execute against the remote database)");
}
