#!/usr/bin/env node
/**
 * The privacy guard's own tests.
 *
 * `docs/constraints.md` says a guard that only runs on the happy fixture is not
 * a guard, and this one proved the point on its first day: it blocked its own
 * commit because the message *mentioned* data/, and then blocked the patch that
 * would have fixed that. Both cases are pinned below.
 *
 * The two halves matter equally. Blocking too little loses patient data;
 * blocking too much gets the hook disabled, which loses patient data more
 * slowly. Plain node, no test framework — it runs before anything is installed.
 *
 *   npm run test:hooks
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GUARD = fileURLToPath(new URL("./privacy-guard.mjs", import.meta.url));

const ALLOW = 0;
const BLOCK = 2;

const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const write = (file_path) => ({ tool_name: "Write", tool_input: { file_path } });

const CASES = [
  // Prose that names a protected path is not a path. Both of these blocked a
  // real commit before `argumentText` existed.
  ["commit message in a heredoc", bash("git commit -F - <<'EOF'\nrework data/ handling\nsee samples/x.pdf\nEOF"), ALLOW],
  ["commit message via -m", bash('git commit -m "fixes data/ handling"'), ALLOW],
  ["patch script quoting paths", bash("python3 - <<'PY'\ns = 'git add data/x'\nPY"), ALLOW],

  // Ordinary work must stay frictionless, or the hook gets turned off.
  ["git add -A", bash("git add -A"), ALLOW],
  ["git add .", bash("git add ."), ALLOW],
  ["adding a source file", bash("git add worker/pricing.ts"), ALLOW],
  ["reading a sample", bash("ls samples/*.pdf"), ALLOW],
  ["writing normal source", write("web/src/lib/trends.ts"), ALLOW],

  // The real thing.
  ["forced add of data/", bash("git add -f data/reports/x.json"), BLOCK],
  ["forced add, long flag", bash("git add --force data/registry.json"), BLOCK],
  ["staging a source PDF", bash("git add samples/2025_08.pdf"), BLOCK],
  ["staging page images", bash("git add data/page_images/a.png"), BLOCK],
  ["staging bench results", bash("git add bench/results/run.jsonl"), BLOCK],
  ["un-caching into the tree", bash("git rm --cached data/reports/x.json"), BLOCK],
  ["writing into the published demo", write("web/public/demo/real/a.json"), BLOCK],
];

let failed = 0;
for (const [name, payload, want] of CASES) {
  let got = ALLOW;
  try {
    execFileSync("node", [GUARD], { input: JSON.stringify(payload), stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    got = e.status ?? 1;
  }
  const ok = got === want;
  if (!ok) failed += 1;
  const verdict = want === BLOCK ? "block" : "allow";
  console.log(`  ${ok ? "ok  " : "FAIL"} ${verdict}  ${name}${ok ? "" : `  (exit ${got})`}`);
}

console.log(
  failed === 0
    ? `\n${CASES.length} cases pass.`
    : `\n${failed} of ${CASES.length} cases FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
