#!/usr/bin/env node
/**
 * Report the working tree at the start of a session.
 *
 * A session that opens believing the tree is clean will happily start a large
 * refactor on top of someone's half-finished work. That happened here: a
 * session began with a "clean" snapshot while five files were modified and an
 * untracked lib/inflight.ts — a finished counting semaphore with a measured
 * rationale, no test and no caller — sat waiting to be rebased across a
 * directory move.
 *
 * Untracked source files are called out separately from modified ones. A
 * modified file is visible in any diff; an untracked one is invisible to
 * `git diff`, survives `git stash` by default, and is the kind that gets lost.
 *
 * Writes context on stdout; never blocks.
 */
import { execSync } from "node:child_process";

const git = (args) => {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

if (!git("rev-parse --is-inside-work-tree").trim()) process.exit(0);

const status = git("status --porcelain").trim();
const stashes = git("stash list").trim();
const branch = git("rev-parse --abbrev-ref HEAD").trim();

if (!status && !stashes) {
  console.log(`Working tree clean on ${branch}.`);
  process.exit(0);
}

const lines = status ? status.split("\n") : [];
const untracked = lines.filter((l) => l.startsWith("??")).map((l) => l.slice(3));
const modified = lines.filter((l) => !l.startsWith("??"));

const SOURCE = /\.(ts|tsx|js|mjs|py|css|json|md)$/;
const untrackedSource = untracked.filter((f) => SOURCE.test(f));

const out = [`Working tree on ${branch} is NOT clean:`];
if (modified.length) out.push(`  ${modified.length} tracked file(s) modified or staged`);
if (untrackedSource.length) {
  out.push(
    `  ${untrackedSource.length} untracked source file(s) — invisible to git diff:`,
    ...untrackedSource.slice(0, 10).map((f) => `      ${f}`),
  );
}
if (stashes) out.push(`  ${stashes.split("\n").length} stash entr(ies)`);
out.push("", "Reconcile this before starting structural work.");
console.log(out.join("\n"));
