#!/usr/bin/env node
/**
 * Mint links into Moje krev: sign-up links, and set-password links.
 *
 *   node tools/scripts/moje-krev-invites.mjs 3 "máma, táta, Ondřej"    # print SQL + links
 *   node tools/scripts/moje-krev-invites.mjs 3 "note" --apply          # run it remotely
 *   node tools/scripts/moje-krev-invites.mjs 1 "Ondřej" --email o@x.cz # set-password link
 *   ... --origin https://moje-krev.example                             # links under another host
 *
 * Every link lives 24 hours and spends once. A sign-up link opens a new
 * account (/registrace?kod=…); with --email the code is bound to that
 * account and only sets its password (/heslo?kod=…) — the forgotten-password
 * path, by hand, until there is a mail domain. A bound code is written with
 * INSERT … SELECT, so an e-mail nobody has inserts nothing: read wrangler's
 * row count before sending the link.
 *
 * Codes are word-word-word from a small Czech-friendly list: easy to read
 * aloud over the phone, hard to guess (24^3 ≈ 14k combinations is plenty when
 * every failed attempt costs a round trip and codes are single-use).
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { pathToFileURL } from "node:url";

const WORDS = [
  "kapka", "krev", "puls", "srdce", "zdravi", "sila", "klid", "rano",
  "voda", "vitr", "slunce", "mesic", "hora", "reka", "les", "louka",
  "jablko", "hruska", "svestka", "trnka", "lipa", "dub", "javor", "buk",
];

export const DEFAULT_ORIGIN = "https://moje-krev.andres-cerny.workers.dev";
export const TTL_HOURS = 24;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const code = () =>
  Array.from({ length: 3 }, () => WORDS[randomInt(WORDS.length)]).join("-") +
  "-" +
  String(randomInt(10, 100));

/**
 * The SQL that mints the codes and the links that carry them. Pure apart
 * from the random codes, so a test can run it and read the result back
 * through the worker.
 */
export function mintInvites({ n = 1, note = "", email, origin = DEFAULT_ORIGIN, now = new Date() } = {}) {
  const bound = email ? email.trim().toLowerCase() : undefined;
  // A set-password link names one account, so one is all that makes sense.
  const count = bound ? 1 : n;
  const created = now.toISOString();
  const expires = new Date(now.getTime() + TTL_HOURS * 3600 * 1000).toISOString();
  const codes = Array.from({ length: count }, code);
  const base = origin.replace(/\/$/, "");
  const sql = bound
    ? `INSERT INTO invites (code, note, created_at, expires_at, user_id) ` +
      `SELECT ${q(codes[0])}, ${q(note || bound)}, ${q(created)}, ${q(expires)}, id FROM users WHERE email = ${q(bound)};`
    : `INSERT INTO invites (code, note, created_at, expires_at) VALUES ${codes
        .map((c) => `(${q(c)}, ${q(note)}, ${q(created)}, ${q(expires)})`)
        .join(", ")};`;
  const links = codes.map((c) => `${base}/${bound ? "heslo" : "registrace"}?kod=${encodeURIComponent(c)}`);
  return { sql, links, codes, expires };
}

function main(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--email" && argv[i - 1] !== "--origin");
  const { sql, links, expires } = mintInvites({
    n: parseInt(positional[0] ?? "1", 10) || 1,
    note: positional[1] ?? "",
    email: flag("--email"),
    origin: flag("--origin"),
  });

  console.log(sql);
  console.log("");
  for (const link of links) console.log(link);
  console.log(`\n(valid ${TTL_HOURS} h, until ${expires})`);

  if (argv.includes("--apply")) {
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "moje-krev", "--remote", `--command=${sql}`],
      { stdio: "inherit", cwd: new URL("../../workers/portal", import.meta.url).pathname },
    );
  } else {
    console.log("(dry run — add --apply to execute against the remote database)");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
