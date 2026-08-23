/**
 * Head-to-head: does comparing printed reference intervals actually beat
 * comparing this patient's observed values?
 *
 * Both strategies answer one question — "is this unknown analyte the same
 * measurement as this candidate?" — so they can be scored on the same labelled
 * pairs. The cases are drawn from real Czech lab conventions: analytes that
 * genuinely are the same thing under different spellings, and analytes that
 * are confusably named but clinically distinct.
 *
 * Run: npx vitest run tests/bench/plausibility.bench.test.ts
 */
import { describe, expect, it } from "vitest";
import { rangesCompatible, type Range } from "@bw/lab-core";

interface Case {
  name: string;
  /** The unknown analyte's printed interval and observed values. */
  incoming: { range: Range | null; values: number[] };
  /** What is already recorded for the candidate. */
  candidate: { range: Range | null; values: number[]; curated?: Range | null };
  /** Ground truth: are these the same measurement? */
  same: boolean;
}

const CASES: Case[] = [
  // --- same measurement, different spelling -------------------------------
  {
    name: "Glukóza vs Glykémie",
    incoming: { range: { low: 4.11, high: 5.6 }, values: [5.1, 5.32] },
    candidate: { range: { low: 3.9, high: 5.6 }, values: [4.9, 5.2], curated: { low: 3.9, high: 5.6 } },
    same: true,
  },
  {
    name: "ALT vs Alaninaminotransferáza",
    incoming: { range: { low: 0.17, high: 0.78 }, values: [0.61, 0.93] },
    candidate: { range: { low: 0.17, high: 0.85 }, values: [0.48, 0.72], curated: { low: 0.17, high: 0.85 } },
    same: true,
  },
  {
    name: "Kreatinin, two labs with different intervals",
    incoming: { range: { low: 62, high: 110 }, values: [88, 94] },
    candidate: { range: { low: 59, high: 104 }, values: [91, 89], curated: { low: 62, high: 110 } },
    same: true,
  },
  {
    name: "Feritin, same analyte but this patient sits low in range",
    incoming: { range: { low: 30, high: 400 }, values: [88, 96] },
    // Ferritin is not in the curated table — exercises the printed-range fallback.
    candidate: { range: { low: 30, high: 400 }, values: [310, 350], curated: null },
    same: true,
  },
  {
    name: "TSH across labs",
    incoming: { range: { low: 0.27, high: 4.2 }, values: [2.11, 3.15] },
    candidate: { range: { low: 0.35, high: 4.94 }, values: [1.8, 2.4], curated: { low: 0.27, high: 4.2 } },
    same: true,
  },
  // --- different measurements, confusable names ---------------------------
  {
    name: "Homocystein vs Kyselina močová (both µmol/l)",
    incoming: { range: { low: 5, high: 15 }, values: [11.2, 14.0] },
    candidate: { range: { low: 202, high: 417 }, values: [331, 392], curated: { low: 202, high: 417 } },
    same: false,
  },
  {
    name: "U_Bílkovina vs S_Celková bílkovina (both g/l)",
    incoming: { range: { low: 0, high: 0.15 }, values: [0.08, 0.12] },
    candidate: { range: { low: 64, high: 83 }, values: [72, 74], curated: { low: 64, high: 83 } },
    same: false,
  },
  {
    name: "Cholesterol vs HDL cholesterol (both mmol/l)",
    incoming: { range: { low: 2.9, high: 5.0 }, values: [4.8, 6.01] },
    candidate: { range: { low: 1.0, high: 2.1 }, values: [1.42, 1.15], curated: { low: 1.0, high: 2.1 } },
    same: false,
  },
  {
    name: "Bilirubin celkový vs konjugovaný (both µmol/l)",
    incoming: { range: { low: 3, high: 21 }, values: [12, 14] },
    candidate: { range: { low: 0, high: 3.4 }, values: [2.1, 2.8], curated: { low: 0, high: 3.4 } },
    same: false,
  },
  {
    name: "Erytrocyty vs Leukocyty (adjacent rows, similar magnitude)",
    incoming: { range: { low: 4.2, high: 5.8 }, values: [4.91, 5.02] },
    candidate: { range: { low: 4.0, high: 10.0 }, values: [6.2, 7.1], curated: { low: 4.0, high: 10.0 } },
    same: false,
  },
  {
    name: "Vápník vs Draslík (both mmol/l, overlapping magnitudes)",
    incoming: { range: { low: 2.15, high: 2.55 }, values: [2.38] },
    candidate: { range: { low: 3.8, high: 5.2 }, values: [4.32, 4.5], curated: { low: 3.8, high: 5.2 } },
    same: false,
  },
  // --- cold start: the candidate has no data in these documents yet -------
  //
  // This is where the curated table earns its place. With no history, both
  // the observed-value check and the printed-interval check have nothing to
  // compare against and abstain — which means they accept. The curated table
  // still knows what the analyte is.
  {
    name: "COLD Homocystein vs Kyselina močová, candidate unseen",
    incoming: { range: { low: 5, high: 15 }, values: [11.2, 14.0] },
    candidate: { range: null, values: [], curated: { low: 202, high: 417 } },
    same: false,
  },
  {
    name: "COLD U_Bílkovina vs S_Celková bílkovina, candidate unseen",
    incoming: { range: { low: 0, high: 0.15 }, values: [0.08] },
    candidate: { range: null, values: [], curated: { low: 64, high: 83 } },
    same: false,
  },
  {
    name: "COLD Glukóza vs Glykémie, candidate unseen",
    incoming: { range: { low: 4.11, high: 5.6 }, values: [5.1] },
    candidate: { range: null, values: [], curated: { low: 3.9, high: 5.6 } },
    same: true,
  },
  {
    name: "COLD Sodík vs Draslík, candidate unseen",
    incoming: { range: { low: 137, high: 145 }, values: [141] },
    candidate: { range: null, values: [], curated: { low: 3.8, high: 5.2 } },
    same: false,
  },
];

/** Strategy A — the original: compare this patient's observed values. */
function statisticalSaysSame(c: Case): boolean {
  const iv = c.incoming.values;
  const cv = c.candidate.values;
  if (iv.length === 0 || cv.length === 0) return true; // no opinion → accepts
  const mean = iv.reduce((s, v) => s + v, 0) / iv.length;
  const lo = Math.min(...cv);
  const hi = Math.max(...cv);
  const slack = Math.max(hi - lo, Math.abs(hi), 1e-9);
  return lo - slack <= mean && mean <= hi + slack;
}

/** Strategy B: compare the intervals the labs actually printed. */
function rangeSaysSame(c: Case): boolean {
  if (!c.incoming.range || !c.candidate.range) return true; // no opinion
  return rangesCompatible(c.incoming.range, c.candidate.range);
}

/** Strategy C: compare against the curated table, when it covers the analyte. */
function curatedSaysSame(c: Case): boolean {
  const curated = c.candidate.curated;
  if (!c.incoming.range || !curated) return true; // no opinion
  return rangesCompatible(c.incoming.range, curated);
}

/**
 * Strategy D — what the app ships: curated first, the documents' own printed
 * intervals when the table does not cover the analyte, and only then the
 * observed-value check.
 */
function chainSaysSame(c: Case): boolean {
  const curated = c.candidate.curated;
  if (c.incoming.range && curated) return rangesCompatible(c.incoming.range, curated);
  if (c.incoming.range && c.candidate.range) {
    return rangesCompatible(c.incoming.range, c.candidate.range);
  }
  return statisticalSaysSame(c);
}

function score(fn: (c: Case) => boolean) {
  let tp = 0, tn = 0, fp = 0, fn_ = 0;
  for (const c of CASES) {
    const said = fn(c);
    if (c.same && said) tp++;
    else if (!c.same && !said) tn++;
    else if (!c.same && said) fp++;
    else fn_++;
  }
  return { tp, tn, fp, fn: fn_, correct: tp + tn, total: CASES.length };
}

describe("plausibility strategies, head to head", () => {
  const stat = score(statisticalSaysSame);
  const range = score(rangeSaysSame);
  const curated = score(curatedSaysSame);
  const chain = score(chainSaysSame);

  it("reports every strategy's score", () => {
    const fmt = (s: ReturnType<typeof score>) =>
      `${String(s.correct).padStart(2)}/${s.total} correct — ${s.fp} false accepts, ${s.fn} false rejects`;
    console.log(`\n  A observed values  : ${fmt(stat)}`);
    console.log(`  B printed ranges   : ${fmt(range)}`);
    console.log(`  C curated table    : ${fmt(curated)}`);
    console.log(`  D shipped chain    : ${fmt(chain)}\n`);
    for (const c of CASES) {
      const mark = (fn: (x: Case) => boolean) => (fn(c) === c.same ? "ok  " : "MISS");
      console.log(
        `    A:${mark(statisticalSaysSame)} B:${mark(rangeSaysSame)} ` +
          `C:${mark(curatedSaysSame)} D:${mark(chainSaysSame)}  ${c.name}`,
      );
    }
    expect(stat.total).toBe(CASES.length);
  });

  it("the shipped chain is at least as good as any single strategy", () => {
    expect(chain.correct).toBeGreaterThanOrEqual(stat.correct);
    expect(chain.correct).toBeGreaterThanOrEqual(range.correct);
    expect(chain.correct).toBeGreaterThanOrEqual(curated.correct);
  });

  it("the chain makes no false accepts", () => {
    expect(chain.fp).toBe(0);
  });

  it("only the curated table survives a cold start", () => {
    // A first-ever report has no history, so both other strategies abstain —
    // and abstaining means accepting, which is a false accept on a wrong pair.
    const cold = CASES.filter((c) => c.name.startsWith("COLD"));
    const wrongPairs = cold.filter((c) => !c.same);
    for (const c of wrongPairs) {
      expect(statisticalSaysSame(c), `A should abstain: ${c.name}`).toBe(true);
      expect(rangeSaysSame(c), `B should abstain: ${c.name}`).toBe(true);
      expect(curatedSaysSame(c), `C should reject: ${c.name}`).toBe(false);
      expect(chainSaysSame(c), `D should reject: ${c.name}`).toBe(false);
    }
  });

  it("falls back when the curated table does not cover an analyte", () => {
    // Ferritin has no curated entry; the printed intervals must still carry it.
    const ferritin = CASES.find((c) => c.name.startsWith("Feritin"))!;
    expect(ferritin.candidate.curated).toBeNull();
    expect(chainSaysSame(ferritin)).toBe(true);
  });

  it("printed ranges make fewer false accepts — the dangerous error", () => {
    // A false accept merges two different tests into one trend line, and the
    // resulting chart looks perfectly normal. A false reject only means the
    // doctor maps it by hand.
    expect(range.fp).toBeLessThan(stat.fp);
  });

  it("printed ranges are at least as accurate overall", () => {
    expect(range.correct).toBeGreaterThanOrEqual(stat.correct);
  });

  it("printed ranges still recognise the same analyte across labs", () => {
    for (const c of CASES.filter((x) => x.same)) {
      expect(rangeSaysSame(c), c.name).toBe(true);
    }
  });
});
