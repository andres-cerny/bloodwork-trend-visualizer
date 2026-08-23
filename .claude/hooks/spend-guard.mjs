#!/usr/bin/env node
/**
 * Ask before starting something that calls a paid API.
 *
 * Three suites here spend real money: the benchmark sweeps, the live extraction
 * tests, and the agent evals. Each has an internal ceiling — BENCH_MAX_USD,
 * EVAL_MAX_USD — but a ceiling protects a run from itself. Nothing protected
 * anyone from *starting* one, and the commands look exactly like the free ones
 * sitting next to them in package.json: `npm run test:live` is one character
 * away from `npm test`.
 *
 * This does not block; it asks. A guard that refused outright would be wrong —
 * these suites exist to be run, and the whole point of the evals is to run them
 * often. It surfaces the ceiling and makes the spend a decision rather than a
 * side effect.
 *
 * Reads a PreToolUse payload on stdin. Exit 0 allows; the "ask" decision is
 * returned as JSON so the harness prompts.
 */

const PAID = [
  {
    re: /\bnpm\s+(run\s+)?bench:/,
    what: "a benchmark sweep",
    ceiling: "BENCH_MAX_USD",
    fallback: "30",
    note: "Sweeps run the full corpus through both models, per arm.",
  },
  {
    re: /\bnpm\s+run\s+(test:live|test:handoff)\b/,
    what: "the live extraction tests",
    ceiling: null,
    fallback: null,
    note: "17 real extractions against the Claude API, two models each.",
  },
  {
    re: /\bnpm\s+run\s+eval\b/,
    what: "the agent evals",
    ceiling: "EVAL_MAX_USD",
    fallback: "5",
    note: "Every case, times the rep count, as real agent turns with tool calls.",
  },
];

function read() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
  });
}

const raw = await read();
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

if ((payload.tool_name ?? "") !== "Bash") process.exit(0);
const command = String(payload.tool_input?.command ?? "");

for (const { re, what, ceiling, fallback, note } of PAID) {
  if (!re.test(command)) continue;

  const configured = ceiling ? (process.env[ceiling] ?? fallback) : null;
  const limit = configured
    ? `Its ceiling is ${ceiling}=$${configured}.`
    : `It has no ceiling of its own.`;

  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason:
          `This starts ${what}, which calls the Claude API and costs real money.\n` +
          `${note}\n${limit}`,
      },
    }),
  );
  process.exit(0);
}

process.exit(0);
