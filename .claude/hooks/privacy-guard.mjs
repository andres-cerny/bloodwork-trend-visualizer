#!/usr/bin/env node
/**
 * Refuse to stage, commit, or write personal medical data.
 *
 * This repo's one hard rule (docs/constraints.md, "Privacy") is that lab
 * reports never leave the machine: `data/`, `samples/*.pdf` and everything
 * derived from them are git-ignored. A .gitignore is a default, not a
 * guarantee — `git add -f`, a path that slips outside the patterns, or a
 * generator writing somewhere new all get past it, and the failure is
 * unrecoverable once pushed.
 *
 * A paragraph in a document cannot make that promise. This can.
 *
 * Reads a PreToolUse payload on stdin; exit 2 blocks the call and returns the
 * message to Claude. Anything it cannot parse is allowed through — a guard
 * that crashes closed would make the repo unusable, and every path it protects
 * is still git-ignored underneath.
 */

const FORBIDDEN = [
  { re: /(^|[\s"'/])data\//, what: "data/ — extracted reports, page images, the registry" },
  { re: /samples\/[^\s"']*\.pdf/i, what: "samples/*.pdf — source lab reports" },
  { re: /public\/demo\/real\//, what: "public/demo/real/ — real reports staged for the demo" },
  { re: /bench\/results\//, what: "bench/results/ — derived from real lab PDFs" },
];

/**
 * Commands that can make an ignored file tracked. `git add` is the whole risk:
 * `git commit` cannot add an ignored path, and its message is prose that will
 * often *mention* these directories — this guard blocked its own commit that
 * way, twice, which is how the distinction got drawn.
 */
const STAGING = /\bgit\s+(add|stash\s+push|rm\s+--cached)\b/;

/**
 * The parts of a shell command that name paths.
 *
 * Heredoc bodies and -m messages are prose, not arguments, so they are dropped
 * before matching. Without this, writing a protected directory's name into a
 * commit message is indistinguishable from staging it.
 */
function argumentText(command) {
  const out = [];
  let heredoc = null;
  for (const line of String(command).split("\n")) {
    if (heredoc !== null) {
      if (line.trim() === heredoc) heredoc = null;
      continue;
    }
    const open = line.match(/<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (open) heredoc = open[1];
    out.push(
      line.replace(/-m\s+"(?:[^"\\]|\\.)*"/g, " ").replace(/-m\s+'[^']*'/g, " "),
    );
  }
  return out.join("\n");
}

function read() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
  });
}

function block(reason, detail) {
  console.error(
    `Blocked: ${reason}\n\n${detail}\n\n` +
      `This repository ships without any patient data — see the Privacy section\n` +
      `of docs/constraints.md. If this file is genuinely synthetic, generate it\n` +
      `into a tracked path (scripts/make_demo_data.py) rather than moving it in.`,
  );
  process.exit(2);
}

const raw = await read();
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // unparseable: allow, .gitignore still applies
}

const tool = payload.tool_name ?? "";
const input = payload.tool_input ?? {};

if (tool === "Bash") {
  const cmd = argumentText(input.command ?? "");
  if (STAGING.test(cmd)) {
    for (const { re, what } of FORBIDDEN) {
      if (re.test(cmd)) block(`this git command names ${what}`, `  ${cmd.trim().slice(0, 300)}`);
    }
    // `git add -A` / `git add .` are fine: ignored paths stay ignored. `-f` is
    // the one that overrides them, and that is exactly the case to stop.
    if (/\bgit\s+add\b[^&|;]*\s-{1,2}(f|force)\b/.test(cmd)) {
      block(
        "git add --force overrides .gitignore",
        `  ${cmd.trim().slice(0, 300)}\n\n` +
          `  The ignore rules here exist to keep medical data out of the history.`,
      );
    }
  }
}

if (tool === "Write" || tool === "Edit" || tool === "NotebookEdit") {
  const path = String(input.file_path ?? "");
  // Writing *into* data/ is normal for the pipeline; the rule is about making
  // it tracked. Only the demo directory is guarded here, because that is the
  // one that gets committed and published.
  if (/public\/demo\/real\//.test(path)) {
    block(
      "writing real patient data into the published demo directory",
      `  ${path}`,
    );
  }
}

process.exit(0);
