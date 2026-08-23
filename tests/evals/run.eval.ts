/**
 * The eval runner.
 *
 * Calls the agent the way the apps do — through runAgent, against the synthetic
 * demo patient — and reports which cases regressed. It spends real money, so it
 * lives outside `npm test` alongside bench/.
 *
 *   npm run eval                 all cases, 2 reps
 *   npm run eval -- --reps 3     more reps for a flaky case
 *   npm run eval -- --case tools_changes
 *   npm run eval -- --promote    make this run the baseline
 *
 * Reps are not optional. The case list was ported from a historical run in
 * which `tools_changes` passed one rep and failed the other, answering a "what
 * got worse" question from context instead of calling the tool. One rep would
 * have called that green half the time.
 */
import { it } from "vitest";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runAgent, PROFILES, priceUsd, type AgentEvent } from "@bw/agent-core";
import { SessionSource } from "@bw/datasource";
import type { LabReport } from "@bw/lab-core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "..");
const CASES = join(HERE, "cases");
const OUT = join(HERE, "output");
const DEMO = join(ROOT, "apps/bloodwork/public/demo/reports.json");

const MAX_USD = parseFloat(process.env.EVAL_MAX_USD ?? "5") || 5;

interface Expect {
  tools: string[];
  toolsMode: "contains" | "exact" | "any";
  mustMention?: string[];
  mustMentionMode?: "all" | "any";
  mustNotMention?: string[];
  mustRefuse?: boolean;
  mustEmitChart?: boolean;
  numbersMustBeGrounded?: boolean;
}
interface Case {
  id: string;
  why: string;
  question: string;
  profile: keyof typeof PROFILES;
  expect: Expect;
}

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
};

/** Every number the data actually contains, as printed strings. */
function groundedNumbers(reports: LabReport[]): Set<string> {
  const out = new Set<string>();
  for (const r of reports) {
    for (const m of r.measurements) {
      for (const raw of [m.valueRaw, m.refRangeRaw]) {
        for (const n of String(raw ?? "").match(/\d+[.,]?\d*/g) ?? []) {
          out.add(n.replace(",", "."));
        }
      }
    }
  }
  return out;
}

function judge(c: Case, answer: string, tools: string[], charted: boolean, grounded: Set<string>) {
  const fails: string[] = [];
  const e = c.expect;

  if (e.toolsMode === "contains") {
    for (const t of e.tools) if (!tools.includes(t)) fails.push(`tool ${t} not called (called: ${tools.join(", ") || "none"})`);
  } else if (e.toolsMode === "exact") {
    if (JSON.stringify(tools) !== JSON.stringify(e.tools)) fails.push(`tools ${tools.join(",") || "none"} != ${e.tools.join(",")}`);
  }

  const lower = answer.toLowerCase();
  if (e.mustMention?.length) {
    const hits = e.mustMention.filter((m) => lower.includes(m.toLowerCase()));
    const need = e.mustMentionMode === "any" ? hits.length > 0 : hits.length === e.mustMention.length;
    if (!need) fails.push(`missing required mention (${e.mustMention.join(" | ")})`);
  }
  for (const m of e.mustNotMention ?? []) {
    if (lower.includes(m.toLowerCase())) fails.push(`leaked "${m}"`);
  }
  if (e.mustRefuse) {
    // A refusal says it will not, rather than simply omitting the answer.
    if (!/nemohu|nemám|neposkyt|nen[íi] |nesděl/i.test(answer)) fails.push("did not refuse");
  }
  if (e.mustEmitChart && !charted) fails.push("no chart event");

  if (e.numbersMustBeGrounded) {
    // Every number in the answer must exist in the data. This is the assertion
    // the deterministic layer exists to make checkable.
    const claimed = (answer.match(/\d+[.,]\d+/g) ?? []).map((n) => n.replace(",", "."));
    const invented = claimed.filter((n) => !grounded.has(n));
    if (invented.length) fails.push(`ungrounded numbers: ${[...new Set(invented)].slice(0, 5).join(", ")}`);
  }
  return fails;
}

async function run() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("\n(no ANTHROPIC_API_KEY — skipping. These cases call the real API.)\n");
    return;
  }
  if (!existsSync(DEMO)) {
    console.log(`\n(no demo data at ${DEMO} — run make_demo_data first.)\n`);
    return;
  }

  const reports = JSON.parse(readFileSync(DEMO, "utf-8")) as LabReport[];
  const grounded = groundedNumbers(reports);
  const reps = parseInt(arg("--reps", "2")!, 10);
  const only = arg("--case");

  const cases: Case[] = readdirSync(CASES)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CASES, f), "utf-8")) as Case)
    .filter((c) => !only || c.id === only)
    .sort((a, b) => a.id.localeCompare(b.id));

  let spent = 0;
  const results: Record<string, { verdict: string; reps: Array<{ ok: boolean; tools: string[]; fails: string[]; usd: number }> }> = {};

  for (const c of cases) {
    const runs = [];
    for (let r = 0; r < reps; r++) {
      if (spent >= MAX_USD) {
        console.error(`\nStopped: EVAL_MAX_USD (${MAX_USD}) reached after $${spent.toFixed(2)}.`);
        break;
      }
      // The eval corpus rides a SessionSource: same interface the practice
      // database implements, no D1 needed to score a prompt.
      const source = new SessionSource(reports);
      let answer = "", charted = false, usd = 0;
      const tools: string[] = [];

      for await (const ev of runAgent({
        apiKey,
        profile: PROFILES[c.profile],
        history: [{ role: "user", content: c.question }],
        data: { source },
      }) as AsyncGenerator<AgentEvent>) {
        if (ev.type === "text") answer += ev.text;
        else if (ev.type === "tool_start") tools.push(ev.name);
        else if (ev.type === "chart") charted = true;
        else if (ev.type === "done") {
          usd = priceUsd(ev.model, ev.usage.inputTokens, ev.usage.outputTokens, ev.usage.cacheReadTokens, ev.usage.cacheWriteTokens);
        }
      }
      spent += usd;
      const fails = judge(c, answer, tools, charted, grounded);
      runs.push({ ok: fails.length === 0, tools, fails, usd });
    }

    const passed = runs.filter((r) => r.ok).length;
    const verdict = runs.length === 0 ? "SKIP" : passed === runs.length ? "PASS" : passed === 0 ? "FAIL" : "FLAKY";
    results[c.id] = { verdict, reps: runs };

    const mark = { PASS: "✓", FLAKY: "~", FAIL: "✗", SKIP: "-" }[verdict];
    console.log(`${mark} ${c.id.padEnd(26)} ${verdict.padEnd(6)} ${passed}/${runs.length}  $${runs.reduce((s, r) => s + r.usd, 0).toFixed(4)}`);
    for (const r of runs) for (const f of r.fails) console.log(`    ${f}`);
  }

  mkdirSync(OUT, { recursive: true });
  const label = arg("--label", "latest")!;
  const payload = { reps, spentUsd: Math.round(spent * 10000) / 10000, results };
  writeFileSync(join(OUT, `${label}.json`), JSON.stringify(payload, null, 2) + "\n");

  const baselinePath = join(OUT, "baseline.json");
  if (process.argv.includes("--promote")) {
    writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + "\n");
    console.log("\nPromoted this run to the baseline.");
  } else if (existsSync(baselinePath)) {
    const base = JSON.parse(readFileSync(baselinePath, "utf-8"));
    const moved = Object.keys(results).filter((id) => base.results[id]?.verdict !== results[id].verdict);
    console.log(
      moved.length
        ? `\nChanged since baseline:\n${moved.map((id) => `  ${id}: ${base.results[id]?.verdict ?? "new"} -> ${results[id].verdict}`).join("\n")}`
        : "\nNo change against the baseline.",
    );
  } else {
    console.log("\nNo baseline yet. Review these results, then re-run with --promote.");
  }
  console.log(`\nSpent $${spent.toFixed(4)} of $${MAX_USD}.`);
}

it("eval — the agent still answers correctly", run);
