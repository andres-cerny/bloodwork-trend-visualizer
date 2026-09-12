/**
 * Rule-based, strictly descriptive Czech summary of what changed.
 *
 * Ported from src/summary.py. Deterministic templates only — no LLM, so no
 * interpretive or diagnostic language can slip in. Describes direction,
 * magnitude and any reference-range transition between an analyte's two most
 * recent numeric results. Never says what a change *means*.
 */
import type { Flag } from "./models";
import { czDate, prettyUnit } from "./czech";
import { latestTwo, type Trend, type TrendPoint } from "./trends";

/**
 * Format a number Czech-style (decimal comma), trimming trailing noise.
 *
 * Rounds for display only. Where the printed value matters — a table beside
 * the source page, a trend row a reader may check against the document — use
 * `czExact`, because showing 3,8 for a printed 3,802 in a tool whose pitch is
 * verification against the source is exactly what makes a reader stop
 * trusting it.
 */
export function czNum(x: number | null | undefined): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  let s = a >= 100 ? x.toFixed(1) : a >= 1 ? x.toFixed(2) : x.toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace(".", ",");
}

/**
 * The value as printed, without rounding. Falls back to a formatted number
 * when there is no raw string to show (a converted unit, say).
 *
 * "As printed" minus the lab's own out-of-range marker: a "!" or "*" beside
 * the number is the lab's flag, which every screen here says in its own
 * words already. The stored valueRaw keeps it, so provenance is untouched.
 */
export function czExact(value: number | null | undefined, raw?: string | null): string {
  const printed = (raw ?? "").replace(/[!*]/g, "").trim();
  if (printed) return printed;
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  // No rounding: render the number as-is with a Czech decimal comma.
  return String(value).replace(".", ",");
}

/**
 * A reference range as one string, the same on every screen.
 *
 * A lab that prints only an upper limit prints "< 4,14"; rendered as "–4,14"
 * that reads as a negative number, and a reader asked which side of it they
 * are on has to guess. Ondrej's call (2026-09-12): say "0–4,14" — the lower
 * limit that was implied all along, written down. An upper limit missing is
 * rarer and has no such implied number, so it keeps the lab's own "> 3,2".
 * Every screen formats a range through here; the sites used to each carry
 * their own template, and disagreed.
 */
export function czRange(low: number | null | undefined, high: number | null | undefined): string {
  const l = low ?? null;
  const h = high ?? null;
  if (l !== null && h !== null) return `${czNum(l)}–${czNum(h)}`;
  if (h !== null) return `0–${czNum(h)}`;
  if (l !== null) return `> ${czNum(l)}`;
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

  const unit = prettyUnit(trend.unit);
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

  // Dates included: a +17% move over six days and over six months are
  // different clinical facts, and the reader cannot tell them apart otherwise.
  let text =
    `${trend.displayName}: ${czNum(ov)} → ${czNum(nv)}${unitSfx} (${change})` +
    ` · ${czDate(older.date)} → ${czDate(newer.date)}`;

  const transition = rangeTransition(older.flag, newer.flag);
  if (transition) {
    const rng = czRange(newer.refLow, newer.refHigh);
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
