/**
 * Stage 3 — the number the doctor actually experiences.
 *
 *   npm run bench:batch
 *
 * Ten real lab PDFs, read end to end, at the same bounded concurrency the
 * browser now uses (`CONCURRENCY` in web/src/ui/UploadPanel.tsx). Everything
 * before this stage measured a page; this measures the wait.
 *
 * It deliberately does *not* go through a browser. Stage 0 established that
 * pdf.js and `buildRows` cost ~8 ms/page — about 0.2 s across a whole batch —
 * so a headless run reproduces the browser's wall-clock to within a rounding
 * error while being reproducible and cheap. Where the two disagree, the
 * browser wins; this is the estimate that says whether it is worth checking.
 *
 * Reports both wall-clock and **time to first page**, because a table that
 * starts filling in after four seconds feels finished long before a spinner
 * that ends at the same moment.
 */
import { appendFileSync, mkdirSync } from "node:fs";

import { it } from "vitest";

import { parsePdf, realSamples } from "./corpus";
import { callReader, runArmOnPage, type Anchor, type Arm, type Reader } from "./extract";
import { CHEAP, ESCALATION, PRIMARY } from "./arms";

const OUT = "bench/results";
const MAX_USD = parseFloat(process.env.BENCH_MAX_USD ?? "30");
/** Matches UploadPanel's bound. Override to explore the curve. */
const CONCURRENCY = parseInt(process.env.BENCH_CONCURRENCY ?? "4", 10);
/** The scenario: a doctor drops ten files in. */
const FILES = parseInt(process.env.BENCH_FILES ?? "10", 10);
/**
 * Repeat the corpus to simulate a bigger drop than the sample set contains.
 *
 * Only 15 real PDFs exist, so a 30-file scenario reuses them. That is fine for
 * the question this answers — where rate limiting starts — because the API
 * neither knows nor cares that two requests carry the same page. It would NOT
 * be fine for an accuracy measurement, which is why nothing here scores rows.
 */
const REPEAT = parseInt(process.env.BENCH_REPEAT ?? "1", 10);

interface Scenario {
  id: string;
  label: string;
  readers: Reader[];
  anchor: Anchor;
  mode?: "rows" | "columnMap";
  /** "onFlag" sends the second reader only when the first flags the page. */
  escalation?: "always" | "onFlag";
}

const SCENARIOS: Record<string, Scenario> = {
  A0: {
    id: "A0",
    label: "deployed: snippet, Sonnet 5 + Opus 4.8",
    readers: [{ model: PRIMARY }, { model: ESCALATION }],
    anchor: "snippet",
  },
  A3: {
    id: "A3",
    label: "row_index, Sonnet 5 + Opus 4.8",
    readers: [
      { model: PRIMARY, effort: "low", thinking: "disabled" },
      { model: ESCALATION, effort: "low", thinking: "disabled" },
    ],
    anchor: "index",
  },
  A4: {
    id: "A4",
    label: "row_index, Sonnet 5 only",
    readers: [{ model: PRIMARY, effort: "low", thinking: "disabled" }],
    anchor: "index",
  },
  A4h: {
    id: "A4h",
    label: "row_index, Haiku 4.5 only",
    readers: [{ model: CHEAP, thinking: "disabled" }],
    anchor: "index",
  },
  A6: {
    id: "A6",
    label: "row_index, Sonnet 5, Opus 4.8 only on flagged pages",
    readers: [
      { model: PRIMARY, effort: "low", thinking: "disabled" },
      { model: ESCALATION, effort: "low", thinking: "disabled" },
    ],
    anchor: "index",
    escalation: "onFlag",
  },
  A5: {
    id: "A5",
    label: "row_index, Sonnet 5 + Haiku 4.5",
    readers: [
      { model: PRIMARY, effort: "low", thinking: "disabled" },
      { model: CHEAP, thinking: "disabled" },
    ],
    anchor: "index",
  },
};

function shell(s: Scenario): Arm {
  return {
    id: s.id,
    label: s.label,
    why: "batch",
    readers: s.readers,
    anchor: s.anchor,
    mode: s.mode,
    escalation: s.escalation ?? "always",
  };
}

it("stage 3 — ten files, bounded concurrency, real API", async () => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  mkdirSync(OUT, { recursive: true });

  const want = (process.env.BENCH_SCENARIOS ?? "A4").split(",").map((s) => s.trim());
  const scenarios = want.map((id) => SCENARIOS[id]).filter(Boolean);

  // Build the work list once: every text-layer page of the first N files.
  const work: Array<{ key: string; rows: any[] }> = [];
  for (const path of realSamples().slice(0, FILES)) {
    const { doc } = await parsePdf(path);
    for (const p of doc.pages) {
      // Scan pages would take the vision path, which this stage does not model.
      if (!p.hasTextLayer) continue;
      work.push({ key: `${doc.file}#${p.pageNum}`, rows: p.rows });
    }
  }
  if (REPEAT > 1) {
    const once = [...work];
    for (let r = 1; r < REPEAT; r++) {
      for (const w of once) work.push({ key: `${w.key}~r${r}`, rows: w.rows });
    }
  }
  console.log(
    `${FILES * REPEAT} files -> ${work.length} text-layer pages, ` +
      `concurrency ${CONCURRENCY} (${CONCURRENCY * 2} calls in flight)\n`,
  );

  const records: any[] = [];
  let spent = 0;

  for (const scenario of scenarios) {
    if (spent >= MAX_USD) {
      console.log(`!! spend cap $${MAX_USD} reached`);
      break;
    }
    const arm = shell(scenario);
    let claimed = 0;
    let firstPageMs = Infinity;
    const perPage: number[] = [];
    let armSpend = 0;
    let failures = 0;

    const t0 = performance.now();
    const worker = async () => {
      for (;;) {
        const i = claimed++;
        if (i >= work.length) return;
        const pageT0 = performance.now();
        // runArmOnPage honours the arm's escalation policy: "always" fires both
        // readers concurrently as the Worker does, "onFlag" pays a second
        // round-trip only when the first reader flags the page.
        const { calls } = await runArmOnPage(key, arm, work[i].rows);
        const pageMs = performance.now() - pageT0;
        perPage.push(pageMs);
        for (const c of calls) {
          armSpend += c.costUsd;
          if (!c.ok) failures++;
        }
        firstPageMs = Math.min(firstPageMs, performance.now() - t0);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker),
    );
    const totalMs = performance.now() - t0;
    spent += armSpend;

    perPage.sort((a, b) => a - b);
    const p50 = perPage[Math.floor(perPage.length / 2)] ?? 0;
    const p95 = perPage[Math.floor(perPage.length * 0.95)] ?? 0;

    records.push({
      stage: "3",
      scenario: scenario.id,
      label: scenario.label,
      files: FILES,
      pages: work.length,
      concurrency: CONCURRENCY,
      totalMs,
      firstPageMs,
      pageP50Ms: p50,
      pageP95Ms: p95,
      failures,
      costUsd: armSpend,
    });

    console.log(
      `${scenario.id.padEnd(4)} ${scenario.label.padEnd(38)}\n` +
        `     batch ${(totalMs / 1000).toFixed(1)} s` +
        `   first page ${(firstPageMs / 1000).toFixed(1)} s` +
        `   page p50 ${(p50 / 1000).toFixed(1)} s / p95 ${(p95 / 1000).toFixed(1)} s` +
        `   $${armSpend.toFixed(3)}` +
        (failures ? `   ${failures} FAILED calls` : "") +
        `\n     ${totalMs / 1000 < 60 ? "under" : "OVER"} the 60 s target\n`,
    );
  }

  // Appended, not overwritten: each run explores a different concurrency or
  // reader set, and the comparison between runs *is* the result.
  appendFileSync(`${OUT}/batch.jsonl`, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`spent $${spent.toFixed(3)}\nwrote ${OUT}/batch.jsonl`);
});
