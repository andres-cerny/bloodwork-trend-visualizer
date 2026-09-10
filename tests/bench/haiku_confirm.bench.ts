/**
 * Confirmation run for the Haiku-only text path — real API, capped.
 *
 *   BENCH_MAX_USD=5 npx vitest run --config tests/bench/vitest.config.ts tests/bench/haiku_confirm.bench.ts
 *
 * Every text-layer page of the real corpus goes through `extractPageText` —
 * the deployed call, prompt and schema, not a restatement — once with Haiku
 * 4.5 and once with Sonnet 5. Outputs land beside the subagent run's in
 * results/subagent/out/api_<model>_text/<slug>.json, so
 * subagent_score.bench.ts scores both with the same rules and the two runs
 * can be read side by side. Latency and tokens per call go to
 * results/subagent/api_runs.jsonl.
 *
 * Pages run four at a time, as the portal does, so the latency recorded is
 * the shape the app sees rather than a controlled single-call number.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

import { it } from "vitest";

import { extractPageText, MODEL_ESCALATION, MODEL_PRIMARY } from "@bw/extraction";
import { rowsAsText } from "@bw/lab-core";

import { parsePdf, realSamples } from "./corpus";
import { priceUsd } from "./extract";

const OUT = "tests/bench/results/subagent";
const MAX_USD = parseFloat(process.env.BENCH_MAX_USD ?? "5");
const IN_FLIGHT = 4;

it("haiku-only confirmation — every text page, both readers, capped", async () => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");

  const pages: Array<{ slug: string; text: string }> = [];
  for (const path of realSamples()) {
    const { doc } = await parsePdf(path);
    for (const p of doc.pages) {
      if (!p.hasTextLayer) continue;
      pages.push({ slug: `${p.file.replace(/\.pdf$/, "")}__p${p.pageNum}`, text: rowsAsText(p.rows) });
    }
  }

  let spent = 0;
  let stopped = false;
  const jobs = pages.flatMap((p) => [
    { ...p, model: MODEL_ESCALATION, dir: "api_haiku_text" },
    { ...p, model: MODEL_PRIMARY, dir: "api_sonnet_text" },
  ]);
  for (const j of jobs) mkdirSync(`${OUT}/out/${j.dir}`, { recursive: true });
  writeFileSync(`${OUT}/api_runs.jsonl`, "");

  let next = 0;
  const worker = async () => {
    for (;;) {
      if (stopped) return;
      const i = next++;
      if (i >= jobs.length) return;
      const j = jobs[i];
      const t0 = performance.now();
      try {
        const x = await extractPageText(key, j.model, j.text);
        const ms = Math.round(performance.now() - t0);
        const cost = priceUsd(j.model, x.usage);
        spent += cost;
        writeFileSync(`${OUT}/out/${j.dir}/${j.slug}.json`, JSON.stringify({ measurements: x.measurements }, null, 1));
        appendFileSync(
          `${OUT}/api_runs.jsonl`,
          JSON.stringify({ slug: j.slug, model: j.model, ms, in: x.usage.inputTokens, out: x.usage.outputTokens, cacheRead: x.usage.cacheReadTokens, usd: cost, rows: x.measurements.length }) + "\n",
        );
        console.log(`${j.slug.padEnd(24)} ${j.model.padEnd(18)} ${String(ms).padStart(6)} ms  out=${String(x.usage.outputTokens).padStart(5)}  rows=${String(x.measurements.length).padStart(3)}  $${cost.toFixed(4)}  total $${spent.toFixed(3)}`);
      } catch (e: any) {
        console.log(`${j.slug} ${j.model} FAILED ${e?.status ?? ""} ${e?.message ?? e}`);
        appendFileSync(`${OUT}/api_runs.jsonl`, JSON.stringify({ slug: j.slug, model: j.model, error: String(e?.message ?? e) }) + "\n");
      }
      if (spent >= MAX_USD) {
        console.log(`\n!! spend cap $${MAX_USD} reached — stopping cleanly`);
        stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  console.log(`\nspent $${spent.toFixed(3)} of $${MAX_USD} cap over ${next} calls`);
});
