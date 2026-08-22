/**
 * Values worth plotting that no lab prints.
 *
 * The demo measures total cholesterol, HDL and triglycerides but never LDL —
 * which is the number a doctor actually asks about. LDL is not measured on a
 * routine panel; it is calculated, and the calculation is arithmetic over three
 * values already on the report.
 *
 * These are computed, never transcribed and never asked of a model. That is the
 * point: a derived series is as checkable as the values under it, and it fails
 * the same way — loudly. Two rules follow, and both are enforced below rather
 * than trusted:
 *
 *   1. **A draw contributes only if every input came from that same draw.**
 *      Pairing by nearest date instead would silently combine a cholesterol
 *      from March with a triglyceride from September, which is not a lipid
 *      panel, it is two halves of different ones.
 *   2. **A formula outside its validity conditions refuses.** Friedewald is not
 *      an approximation above 4,5 mmol/l of triglycerides — it is wrong, and an
 *      LDL quietly produced from it is exactly the silent wrongness the rest of
 *      this app exists to prevent. That draw is dropped and the reason is
 *      carried on the series.
 *
 * Nothing here invents a reference range. `scripts/reference_ranges.json` is
 * already documented as not verified against a Czech clinical source, and
 * ratios have conventional targets that vary by guideline, so every derived
 * point carries flag "unknown" and no bounds. A derived value is offered as a
 * number to look at, never as normal or abnormal.
 */
import type { Flag } from "./models";
import { numericPoints, type Trend, type TrendPoint } from "./trends";

export interface DerivedTrend extends Trend {
  derived: {
    /** Shown beside the series so the reader can check the arithmetic. */
    formula: string;
    /** Draws dropped because the formula did not hold there. */
    skipped: number;
    skipReason: string | null;
  };
}

interface DerivedDef {
  id: string;
  displayNameCs: string;
  /** Empty for a ratio, which is dimensionless. */
  unit: string;
  /** canonicalId → the unit that input must be in. */
  inputs: Record<string, string>;
  formula: string;
  /** Null when the formula does not hold for this draw. */
  compute: (v: Record<string, number>) => number | null;
  invalidReason: string;
}

/** Above this, Friedewald does not estimate LDL — it gets it wrong. */
export const FRIEDEWALD_MAX_TG = 4.5;

export const DERIVED: DerivedDef[] = [
  {
    id: "derived:non_hdl",
    displayNameCs: "non-HDL cholesterol",
    unit: "mmol/l",
    inputs: { cholesterol: "mmol/l", hdl: "mmol/l" },
    formula: "celkový cholesterol − HDL",
    compute: (v) => v.cholesterol - v.hdl,
    invalidReason: "",
  },
  {
    id: "derived:ldl_friedewald",
    displayNameCs: "LDL cholesterol (výpočet)",
    unit: "mmol/l",
    inputs: { cholesterol: "mmol/l", hdl: "mmol/l", triacylglyceroly: "mmol/l" },
    formula: "Friedewald: celkový − HDL − (triacylglyceroly / 2,2)",
    compute: (v) =>
      v.triacylglyceroly > FRIEDEWALD_MAX_TG
        ? null
        : v.cholesterol - v.hdl - v.triacylglyceroly / 2.2,
    invalidReason: `nad ${String(FRIEDEWALD_MAX_TG).replace(".", ",")} mmol/l triacylglycerolů Friedewaldův výpočet neplatí`,
  },
  {
    id: "derived:chol_hdl",
    displayNameCs: "Cholesterol / HDL",
    unit: "",
    inputs: { cholesterol: "mmol/l", hdl: "mmol/l" },
    formula: "celkový cholesterol ÷ HDL",
    compute: (v) => (v.hdl > 0 ? v.cholesterol / v.hdl : null),
    invalidReason: "HDL je nula",
  },
  {
    id: "derived:ast_alt",
    displayNameCs: "AST / ALT",
    unit: "",
    inputs: { ast: "µkat/l", alt: "µkat/l" },
    formula: "AST ÷ ALT (de Ritis)",
    compute: (v) => (v.alt > 0 ? v.ast / v.alt : null),
    invalidReason: "ALT je nula",
  },
];

/** Numeric points of one analyte, keyed by the draw they came from. */
function byReport(trends: Map<string, Trend>, canonicalId: string): Map<string, TrendPoint> {
  const out = new Map<string, TrendPoint>();
  const t = trends.get(canonicalId);
  if (t) for (const p of numericPoints(t)) out.set(p.reportId, p);
  return out;
}

/**
 * Build every derived series the loaded reports can support.
 *
 * A definition whose inputs are missing, or which yields fewer than two usable
 * draws, is left out entirely rather than offered as an empty chart.
 */
export function buildDerived(trends: Map<string, Trend>): Map<string, DerivedTrend> {
  const out = new Map<string, DerivedTrend>();

  for (const def of DERIVED) {
    const ids = Object.keys(def.inputs);
    const sources = ids.map((id) => [id, byReport(trends, id)] as const);
    if (sources.some(([, m]) => m.size === 0)) continue;

    const points: TrendPoint[] = [];
    let skipped = 0;

    // Draws where every input is present. Report id, not date: pairing by
    // nearest date would combine halves of different panels.
    const [, firstMap] = sources[0];
    for (const reportId of firstMap.keys()) {
      const found = sources.map(([id, m]) => [id, m.get(reportId)] as const);
      if (found.some(([, p]) => !p)) continue;

      // A unit we did not expect means the arithmetic would be nonsense. Refuse
      // the draw rather than convert silently.
      if (found.some(([id, p]) => (p!.unit ?? "") !== def.inputs[id])) {
        skipped++;
        continue;
      }

      const values: Record<string, number> = {};
      for (const [id, p] of found) values[id] = p!.value as number;

      const value = def.compute(values);
      if (value === null) {
        skipped++;
        continue;
      }

      const anchor = found[0][1]!;
      points.push({
        date: anchor.date,
        value,
        unit: def.unit,
        // Computed, so never flagged normal or abnormal — see the file header.
        flag: "unknown" as Flag,
        refLow: null,
        refHigh: null,
        valueRaw: "",
        reportId,
        suspect: null,
        // Every input was already plotted, so nothing new is doubted here.
        unconfirmed: null,
      });
    }

    points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (points.length < 2) continue;

    out.set(def.id, {
      canonicalId: def.id,
      displayName: def.displayNameCs,
      unit: def.unit,
      points,
      derived: {
        formula: def.formula,
        skipped,
        skipReason: skipped > 0 ? def.invalidReason || null : null,
      },
    });
  }

  return out;
}

export const isDerivedId = (id: string): boolean => id.startsWith("derived:");
