/**
 * Stage 1c — accuracy and output size, per *component* rather than per arm.
 *
 *   npm run bench:accuracy
 *
 * Running every arm end to end would pay twice for the same information. An
 * arm is a composition of reader configurations, and both things this stage
 * measures — how accurately a configuration reads a page, and how many output
 * tokens it spends doing it — are properties of the configuration, not of the
 * arm. Six components cover all eleven arms, at a quarter of the calls.
 *
 * Latency deliberately is *not* concluded here. It comes from the Stage 1b
 * grid, which was built to measure it under controlled ordering; a number
 * taken from this file would be contaminated by whatever else was in flight.
 *
 * What is scored, in three columns that are never averaged together:
 *   - agreement with the accepted reports in data/reports (not truth — a
 *     disagreement is a case to adjudicate);
 *   - fabrications, which are objective and disqualifying;
 *   - range integrity, the named check from score.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { it } from "vitest";

import { parsePdf, screenSamples } from "./corpus";
import { callReader, type Anchor, type Arm, type Reader } from "./extract";
import { CHEAP, ESCALATION, PRIMARY } from "./arms";
import {
  fabrications,
  loadBaseline,
  rangeIntegrity,
  scoreAgainstBaseline,
  type RawMeasurement,
} from "./score";

const OUT = "bench/results";
const MAX_USD = parseFloat(process.env.BENCH_MAX_USD ?? "30");

interface Component {
  name: string;
  reader: Reader;
  anchor: Anchor;
  mode?: "rows" | "columnMap";
  /** Which arms are built out of this component. */
  usedBy: string[];
}

const COMPONENTS: Component[] = [
  {
    name: "sonnet5/snippet",
    reader: { model: PRIMARY },
    anchor: "snippet",
    usedBy: ["A0", "A1", "A2"],
  },
  {
    name: "sonnet5/index",
    reader: { model: PRIMARY, effort: "low", thinking: "disabled" },
    anchor: "index",
    usedBy: ["A3", "A4", "A5", "A6"],
  },
  {
    name: "opus48/index",
    reader: { model: ESCALATION, effort: "low", thinking: "disabled" },
    anchor: "index",
    usedBy: ["A3", "A6"],
  },
  {
    name: "haiku45/index",
    reader: { model: CHEAP, thinking: "disabled" },
    anchor: "index",
    usedBy: ["A5"],
  },
  {
    name: "sonnet5/columnmap",
    reader: { model: PRIMARY, effort: "low", thinking: "disabled" },
    anchor: "index",
    mode: "columnMap",
    usedBy: ["A9"],
  },
  {
    name: "haiku45/columnmap",
    reader: { model: CHEAP, thinking: "disabled" },
    anchor: "index",
    mode: "columnMap",
    usedBy: ["A9b"],
  },
];

function shell(c: Component): Arm {
  return {
    id: c.name,
    label: c.name,
    why: "component",
    readers: [c.reader],
    anchor: c.anchor,
    mode: c.mode,
    escalation: "always",
  };
}

it("stage 1c — accuracy and output size per component", async () => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  mkdirSync(OUT, { recursive: true });

  const baseline = loadBaseline();

  // The densest text-layer page of each screening file. Density is where
  // column assignment is hardest and where output volume actually matters.
  const probes: Array<{ file: string; pageNum: number; rows: any[]; key: string }> = [];
  for (const path of screenSamples()) {
    const { doc } = await parsePdf(path);
    const best = doc.pages
      .filter((p) => p.hasTextLayer)
      .sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!best) continue;
    const k = `${doc.file}#${best.pageNum}`;
    probes.push({ file: doc.file, pageNum: best.pageNum, rows: best.rows, key: k });
    console.log(
      `probe ${k.padEnd(26)} rows=${String(best.rows.length).padStart(3)}  ` +
        `baseline rows=${baseline.get(k)?.length ?? 0}`,
    );
  }

  let spent = 0;
  const records: any[] = [];

  // Round-robin by probe so a slow minute cannot land entirely on one component.
  outer: for (const probe of probes) {
    for (const c of COMPONENTS) {
      if (spent >= MAX_USD) {
        console.log(`\n!! spend cap $${MAX_USD} reached — stopping cleanly`);
        break outer;
      }
      const res = await callReader(key, shell(c), c.reader, probe.rows);
      spent += res.costUsd;

      const arm: RawMeasurement[] = (res.extraction?.measurements ?? []) as any;
      const base = baseline.get(probe.key) ?? [];
      const score = scoreAgainstBaseline(base, arm);
      const fab = fabrications(arm, probe.rows);
      const integ = rangeIntegrity(base, arm);

      records.push({
        stage: "1c",
        component: c.name,
        usedBy: c.usedBy,
        probe: probe.key,
        ok: res.ok,
        error: res.error,
        ms: res.ms,
        outputTokens: res.usage.outputTokens,
        inputTokens: res.usage.inputTokens,
        cacheReadTokens: res.usage.cacheReadTokens,
        costUsd: res.costUsd,
        armRows: score.armRows,
        baselineRows: score.baselineRows,
        matched: score.matched,
        missing: score.missing,
        extra: score.extra,
        valueMismatch: score.valueMismatch,
        unitMismatch: score.unitMismatch,
        rangeMismatch: score.rangeMismatch,
        fabrications: fab,
        collapsedRanges: integ.collapsed,
        decensored: integ.decensored,
        // The raw output is persisted so the run can be re-scored offline when
        // the scorer changes. It was not, the first time, and a scorer fix
        // meant paying for the same calls twice.
        measurements: arm,
      });

      console.log(
        `${probe.key.padEnd(26)} ${c.name.padEnd(20)} ` +
          (res.ok
            ? `out=${String(res.usage.outputTokens).padStart(5)}  ` +
              `rows=${String(score.armRows).padStart(3)}/${String(score.baselineRows).padStart(3)}  ` +
              `match=${String(score.matched).padStart(3)}  ` +
              `miss=${String(score.missing.length).padStart(2)}  ` +
              `extra=${String(score.extra.length).padStart(2)}  ` +
              `valΔ=${String(score.valueMismatch.length).padStart(2)}  ` +
              `fab=${String(fab.length).padStart(2)}  ` +
              `collapse=${integ.collapsed.length}`
            : `FAILED ${res.error}`),
      );
    }
  }

  writeFileSync(`${OUT}/accuracy.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");

  /* ------------------------------------------------------------- summary */
  console.log("\n=== per component, summed over probes ===\n");
  console.log(
    "component".padEnd(20) + "out tok".padStart(9) + "rows".padStart(8) +
    "matched".padStart(9) + "missing".padStart(9) + "extra".padStart(7) +
    "valΔ".padStart(7) + "rangeΔ".padStart(8) + "fab".padStart(6) + "collapse".padStart(10),
  );
  for (const c of COMPONENTS) {
    const hits = records.filter((r) => r.component === c.name && r.ok);
    if (!hits.length) continue;
    const sum = (f: (r: any) => number) => hits.reduce((n, r) => n + f(r), 0);
    console.log(
      c.name.padEnd(20) +
        String(sum((r) => r.outputTokens)).padStart(9) +
        String(sum((r) => r.armRows)).padStart(8) +
        String(sum((r) => r.matched)).padStart(9) +
        String(sum((r) => r.missing.length)).padStart(9) +
        String(sum((r) => r.extra.length)).padStart(7) +
        String(sum((r) => r.valueMismatch.length)).padStart(7) +
        String(sum((r) => r.rangeMismatch.length)).padStart(8) +
        String(sum((r) => r.fabrications.length)).padStart(6) +
        String(sum((r) => r.collapsedRanges.length)).padStart(10),
    );
  }

  console.log(`\nspent $${spent.toFixed(3)} of $${MAX_USD} cap\nwrote ${OUT}/accuracy.jsonl\n`);
});
