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

function direction(delta: number, eps: number): "up" | "down" | "flat" {
  if (delta > eps) return "up";
  if (delta < -eps) return "down";
  return "flat";
}

/**
 * Clause about the reference range.
 *
 * Written without a verb on purpose. Czech verbs agree with the subject's
 * gender and number, and the subject here is an analyte name pulled from a
 * registry of 109 entries — "Triacylglyceroly vzrostlo" instead of "vzrostly"
 * is instantly visible to a native reader. Gendering the whole registry would
 * be a large, fragile change to fix phrasing; dropping the verb removes the
 * agreement problem entirely and reads like a lab report rather than prose.
 */
function rangeTransition(oldFlag: Flag, newFlag: Flag): string {
  if (newFlag === "high") return oldFlag !== "high" ? "nově nad rozmezím" : "stále nad rozmezím";
  if (newFlag === "low") return oldFlag !== "low" ? "nově pod rozmezím" : "stále pod rozmezím";
  if (newFlag === "normal")
    return oldFlag === "high" || oldFlag === "low" ? "nově v rozmezí" : "v rozmezí";
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

  const sign = delta > 0 ? "+" : "−";
  const pct = ov ? (delta / ov) * 100 : null;
  // Whole percent: a doctor reads this as a magnitude, and "+16,67 %" implies
  // a precision that two measurements do not carry.
  const pctPart = pct !== null ? ` / ${sign}${Math.round(Math.abs(pct))} %` : "";

  // "beze změny" printed beside two visibly different numbers reads as a
  // contradiction and undermines the rest of the list, so a sub-threshold
  // move says so explicitly and still shows its size.
  const change =
    dir === "flat"
      ? `prakticky beze změny, ${sign}${czNum(Math.abs(delta))}${unitSfx}`
      : `${sign}${czNum(Math.abs(delta))}${unitSfx}${pctPart}`;

  let text = `${trend.displayName}: ${czNum(ov)} → ${czNum(nv)}${unitSfx} (${change})`;

  const transition = rangeTransition(older.flag, newer.flag);
  if (transition) {
    const rng = rangeStr(newer.refLow, newer.refHigh);
    text += ` — ${transition}${rng !== "—" ? ` ${rng}` : ""}`;
  }

  // rank: out-of-range first, then bigger relative moves
  const outOfRange = newer.flag === "high" || newer.flag === "low";
  const rel = ov ? Math.abs(delta) / Math.abs(ov) : 0;
  return {
    canonicalId: trend.canonicalId,
    displayName: trend.displayName,
    text,
    outOfRange,
    changed: dir !== "flat",
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
