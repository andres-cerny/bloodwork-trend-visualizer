/**
 * Rule-based, strictly descriptive Czech summary of what changed.
 *
 * Ported from src/summary.py. Deterministic templates only — no LLM, so no
 * interpretive or diagnostic language can slip in. Describes direction,
 * magnitude and any reference-range transition between an analyte's two most
 * recent numeric results. Never says what a change *means*.
 */
import type { Flag } from "./models";
import { latestTwo, type Trend, type TrendPoint } from "./trends";

/** Format a number Czech-style (decimal comma), trimming trailing noise. */
export function czNum(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  let s = a >= 100 ? x.toFixed(1) : a >= 1 ? x.toFixed(2) : x.toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(".", ",");
}

function rangeStr(low: number | null, high: number | null): string {
  if (low !== null && high !== null) return `${czNum(low)}–${czNum(high)}`;
  if (high !== null) return `< ${czNum(high)}`;
  if (low !== null) return `> ${czNum(low)}`;
  return "—";
}

function direction(delta: number, eps: number): string {
  if (delta > eps) return "vzrostlo";
  if (delta < -eps) return "kleslo";
  return "beze změny";
}

/** Descriptive clause about crossing the reference range (or not). */
function rangeTransition(oldFlag: Flag, newFlag: Flag): string {
  if (newFlag === "high")
    return oldFlag !== "high" ? "a je nad referenčním rozmezím" : "a zůstává nad referenčním rozmezím";
  if (newFlag === "low")
    return oldFlag !== "low" ? "a je pod referenčním rozmezím" : "a zůstává pod referenčním rozmezím";
  if (newFlag === "normal")
    return oldFlag === "high" || oldFlag === "low"
      ? "a je nyní v referenčním rozmezí"
      : "a je v referenčním rozmezí";
  return "";
}

export interface SummaryRecord {
  canonicalId: string;
  displayName: string;
  text: string;
  outOfRange: boolean;
  changed: boolean;
  newFlag: Flag;
  older: TrendPoint;
  newer: TrendPoint;
  rank: [number, number];
}

/** One descriptive record for a trend's two most recent numeric results. */
export function summarizeTrend(trend: Trend): SummaryRecord | null {
  const [older, newer] = latestTwo(trend);
  if (older === null || newer === null) return null;
  const ov = older.value as number;
  const nv = newer.value as number;

  const unit = (trend.unit || "").trim();
  const unitSfx = unit ? ` ${unit}` : "";
  const delta = nv - ov;
  // magnitude threshold: 1% of the older value (or tiny absolute) counts
  const eps = Math.max(Math.abs(ov) * 0.01, 1e-9);
  const dir = direction(delta, eps);

  let text: string;
  if (dir === "beze změny") {
    text = `${trend.displayName} beze změny (${czNum(ov)} → ${czNum(nv)}${unitSfx})`;
  } else {
    const pct = ov ? (delta / ov) * 100 : null;
    const sign = delta > 0 ? "+" : "−";
    const pctPart = pct !== null ? `, ${sign}${czNum(Math.abs(pct))} %` : "";
    text =
      `${trend.displayName} ${dir} z ${czNum(ov)} na ${czNum(nv)}${unitSfx} ` +
      `(${sign}${czNum(Math.abs(delta))}${pctPart})`;
  }

  const transition = rangeTransition(older.flag, newer.flag);
  if (transition) {
    const rng = rangeStr(newer.refLow, newer.refHigh);
    text += ` ${transition}${rng !== "—" ? ` (${rng})` : ""}`;
  }
  text += ".";

  // rank: out-of-range first, then bigger relative moves
  const outOfRange = newer.flag === "high" || newer.flag === "low";
  const rel = ov ? Math.abs(delta) / Math.abs(ov) : 0;
  return {
    canonicalId: trend.canonicalId,
    displayName: trend.displayName,
    text,
    outOfRange,
    changed: dir !== "beze změny",
    newFlag: newer.flag,
    older,
    newer,
    rank: [outOfRange ? 0 : 1, -rel],
  };
}

/** Descriptive records for all comparable trends, most notable first. */
export function summarizeChanges(trends: Map<string, Trend>): SummaryRecord[] {
  const records: SummaryRecord[] = [];
  for (const t of trends.values()) {
    const r = summarizeTrend(t);
    if (r) records.push(r);
  }
  records.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
  return records;
}
