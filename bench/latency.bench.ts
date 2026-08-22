/**
 * Stage 1b — the latency model.
 *
 *   npm run bench:latency
 *
 * This is the only place that has to spend money, because it measures the one
 * thing nothing else can substitute for: how long a real `messages.create`
 * takes as a function of `(model, effort, thinking, anchor)`. Every latency
 * number the notebook reports is predicted from this grid plus an arm's
 * measured output size — which is why it is worth measuring carefully once
 * rather than sloppily eight times.
 *
 * Design choices that exist to stop the measurement lying:
 *
 *  - **Round-robin, not config-by-config.** API latency drifts minute to
 *    minute. Running A0's config for five minutes and then A3's would hand
 *    whichever ran in the quiet window a win it did not earn.
 *  - **`maxRetries: 0`** (in extract.ts). A backoff retry would be recorded as
 *    model latency, silently inflating whichever config happened to hit a 429.
 *  - **A discarded warm-up call.** The first request pays TLS and connection
 *    setup; charging that to whichever config ran first is not a measurement.
 *  - **Repetitions with a median**, not a single sample.
 *  - **`thought` recorded per call.** Whether a forced `tool_choice` already
 *    suppresses adaptive thinking is an assumption the A2 hypothesis rests on,
 *    so it is observed rather than believed.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { it } from "vitest";

import { parsePdf, screenSamples } from "./corpus";
import { callReader, priceUsd, type Anchor, type Arm, type Reader } from "./extract";
import { CHEAP, ESCALATION, PRIMARY } from "./arms";

const OUT = "bench/results";
const MAX_USD = parseFloat(process.env.BENCH_MAX_USD ?? "30");
const REPS = parseInt(process.env.BENCH_REPS ?? "2", 10);

/**
 * The grid. Each row is a reader configuration whose latency we need in order
 * to predict any arm built from it.
 */
const CONFIGS: Array<{ name: string; reader: Reader }> = [
  // What the Worker sends today: no effort, no thinking parameter.
  { name: "sonnet5/default", reader: { model: PRIMARY } },
  { name: "sonnet5/low+nothink", reader: { model: PRIMARY, effort: "low", thinking: "disabled" } },
  { name: "sonnet5/low", reader: { model: PRIMARY, effort: "low" } },
  { name: "opus48/default", reader: { model: ESCALATION } },
  { name: "opus48/low+nothink", reader: { model: ESCALATION, effort: "low", thinking: "disabled" } },
  { name: "haiku45/nothink", reader: { model: CHEAP, thinking: "disabled" } },
];

const ANCHORS: Anchor[] = ["snippet", "index"];

/** A minimal Arm shell — only `anchor` affects the request the grid sends. */
function shell(anchor: Anchor): Arm {
  return {
    id: `grid-${anchor}`,
    label: `grid ${anchor}`,
    why: "latency grid",
    readers: [],
    anchor,
    escalation: "always",
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

it("stage 1b — latency as a function of model, effort, thinking and anchor", async () => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) throw new Error("ANTHROPIC_API_KEY not set — this stage needs the real API");
  mkdirSync(OUT, { recursive: true });

  // Two dense, text-layer pages from different labs and different years, so a
  // config cannot win by suiting one layout. Selected by density from opposite
  // ends of the corpus rather than by filename — sample names encode
  // blood-draw dates and must not appear in a committed file.
  const probes: Array<{ label: string; rows: any[] }> = [];
  const files = screenSamples();
  for (const path of [files[1], files[files.length - 1]]) {
    const { doc } = await parsePdf(path);
    const densest = doc.pages
      .filter((x) => x.hasTextLayer)
      .sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!densest) continue;
    const label = `${doc.file}#${densest.pageNum}`;
    probes.push({ label, rows: densest.rows });
    console.log(`probe ${label}: ${densest.rows.length} rows`);
  }

  let spent = 0;
  let stopped = false;
  const records: any[] = [];

  // Warm-up, discarded: the first call pays connection setup.
  console.log("\nwarm-up call (discarded)...");
  const warm = await callReader(key, shell("index"), { model: CHEAP, thinking: "disabled" }, probes[0].rows);
  spent += warm.costUsd;
  console.log(`  ${warm.ok ? "ok" : "FAILED: " + warm.error} — ${warm.ms.toFixed(0)} ms\n`);

  // Round-robin: rep, then probe, then anchor, then config.
  outer: for (let rep = 0; rep < REPS; rep++) {
    for (const probe of probes) {
      for (const anchor of ANCHORS) {
        for (const cfg of CONFIGS) {
          if (spent >= MAX_USD) {
            console.log(`\n!! spend cap $${MAX_USD} reached — stopping cleanly`);
            stopped = true;
            break outer;
          }
          const res = await callReader(key, shell(anchor), cfg.reader, probe.rows);
          spent += res.costUsd;
          records.push({
            stage: "1b",
            rep,
            probe: probe.label,
            anchor,
            config: cfg.name,
            model: cfg.reader.model,
            effort: cfg.reader.effort ?? "(default)",
            thinking: cfg.reader.thinking ?? "(default)",
            ok: res.ok,
            error: res.error,
            ms: res.ms,
            inputTokens: res.usage.inputTokens,
            outputTokens: res.usage.outputTokens,
            cacheReadTokens: res.usage.cacheReadTokens,
            cacheWriteTokens: res.usage.cacheWriteTokens,
            thought: res.thought,
            measurements: res.extraction?.measurements.length ?? 0,
            costUsd: res.costUsd,
          });
          console.log(
            `rep${rep} ${probe.label.padEnd(24)} ${anchor.padEnd(8)} ${cfg.name.padEnd(20)} ` +
              (res.ok
                ? `${res.ms.toFixed(0).padStart(6)} ms  out=${String(res.usage.outputTokens).padStart(5)}  ` +
                  `meas=${String(res.extraction?.measurements.length ?? 0).padStart(3)}  ` +
                  `think=${res.thought ? "YES" : "no "}  $${res.costUsd.toFixed(4)}`
                : `FAILED  ${res.error}`),
          );
        }
      }
    }
  }

  writeFileSync(`${OUT}/latency.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

  /* ------------------------------------------------------------- summary */
  console.log("\n=== median latency by config x anchor ===\n");
  console.log("config".padEnd(22) + "anchor".padEnd(10) + "med ms".padStart(8) +
    "med out".padStart(10) + "meas".padStart(7) + "think".padStart(8) + "$/page".padStart(10));
  for (const cfg of CONFIGS) {
    for (const anchor of ANCHORS) {
      const hits = records.filter((r) => r.config === cfg.name && r.anchor === anchor && r.ok);
      if (!hits.length) continue;
      console.log(
        cfg.name.padEnd(22) +
          anchor.padEnd(10) +
          median(hits.map((h) => h.ms)).toFixed(0).padStart(8) +
          median(hits.map((h) => h.outputTokens)).toFixed(0).padStart(10) +
          median(hits.map((h) => h.measurements)).toFixed(0).padStart(7) +
          (hits.some((h) => h.thought) ? "YES" : "no").padStart(8) +
          ("$" + median(hits.map((h) => h.costUsd)).toFixed(4)).padStart(10),
      );
    }
  }

  const failures = records.filter((r) => !r.ok);
  if (failures.length) {
    console.log(`\n${failures.length} failed call(s):`);
    for (const f of failures.slice(0, 6)) console.log(`  ${f.config}/${f.anchor}: ${f.error}`);
  }

  console.log(
    `\nspent $${spent.toFixed(3)} of $${MAX_USD} cap` +
      (stopped ? " (STOPPED EARLY)" : "") +
      `\nwrote ${OUT}/latency.jsonl\n`,
  );
});
