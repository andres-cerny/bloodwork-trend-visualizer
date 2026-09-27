/** Assemble per-analyte time series across reports. Ported from src/trends.py. */
import type { Flag, LabReport } from "./models";
import { type UnitDef, inCanonicalUnit } from "./units";

export interface TrendPoint {
  date: string; // ISO date of the report
  value: number | null;
  unit: string | null;
  flag: Flag;
  refLow: number | null;
  refHigh: number | null;
  valueRaw: string;
  reportId: string;
  /** The name as the lab printed it — what Ověření keys its highlight on. */
  rawName: string;
  /**
   * Set when the reading is probably *wrong* (a misread decimal). Kept out of
   * the plotted series — see numericPoints.
   */
  suspect: string | null;
  /**
   * Set when the reading may well be right but nothing has confirmed it — two
   * reads disagreed, or the transcription was flagged uncertain. Plotted, but
   * marked: dropping it would hide real data.
   */
  unconfirmed: string | null;
  /** The reading as printed, when it was converted to the trend's unit (units.ts). */
  convertedFrom?: { value: number | null; unit: string } | null;
}

export interface Trend {
  canonicalId: string;
  displayName: string;
  unit: string;
  points: TrendPoint[];
  /**
   * Readings left out of the series because they are in a unit nothing
   * converts to this one — by unit, how many. Plotting them on the same axis
   * would draw a jump that never happened; the card names them instead.
   */
  otherUnits?: Record<string, number>;
}

/**
 * The points a trend may actually be drawn or summarised from.
 *
 * A reading flagged as a probable transcription error is excluded. Plotting it
 * would put a value the app has already identified as a typo — glucose read as
 * 44,5 instead of 4,45 — onto the chart a patient is shown, with the real
 * series flattened beneath it and no warning anywhere on that screen. The
 * point is not discarded: it stays in `points`, is listed by `suspectPoints`,
 * and rejoins the series the moment it is confirmed or corrected in Ověření.
 */
export function numericPoints(t: Trend): TrendPoint[] {
  return t.points.filter((p) => p.value !== null && p.suspect === null);
}

/**
 * The newest reading when it is a bound past the range — ">200" against 0–5 —
 * and so has no number to plot but is a result all the same. Without this
 * the newest CRP of ">200" was invisible: the headline showed the older
 * numeric value, and nothing said "out of range".
 */
export function latestCensoredOut(t: Trend): TrendPoint | null {
  const last = t.points[t.points.length - 1];
  if (!last || last.value !== null || last.suspect !== null) return null;
  if (last.flag !== "high" && last.flag !== "low") return null;
  return last;
}

/** Readings held out of the series pending verification. */
export function suspectPoints(t: Trend): TrendPoint[] {
  return t.points.filter((p) => p.suspect !== null);
}

/**
 * Group measurements by canonicalId, sorted by report date.
 *
 * Only dated reports contribute. Unmapped measurements (canonicalId null) are
 * excluded — they surface in the mapping review flow instead.
 */
export function buildTrends(
  reports: LabReport[],
  displayNameFn: (cid: string) => string = (cid) => cid,
  /** Returns a reason when a measurement looks misread, else null. */
  suspectFn: (m: LabReport["measurements"][number]) => string | null = () => null,
  /** Returns a reason when a reading is plotted but unconfirmed, else null. */
  unconfirmedFn: (m: LabReport["measurements"][number]) => string | null = () => null,
  /**
   * The parameter's canonical unit and conversion factors (units.ts). With
   * it, every reading is put in the canonical unit; without it, the series
   * keeps the unit most of its readings carry. Either way a reading in a
   * unit that cannot be put on the same axis is left out and counted in
   * `otherUnits` — never plotted beside the others.
   */
  unitDefFn: (cid: string) => UnitDef | null | undefined = () => null,
): Map<string, Trend> {
  const trends = new Map<string, Trend>();
  /** Points whose unit is the series' by construction: converted, or already canonical. */
  const settled = new Set<TrendPoint>();
  for (const report of reports) {
    if (!report.reportDate) continue;
    for (const m of report.measurements) {
      if (m.canonicalId === null) continue;
      let t = trends.get(m.canonicalId);
      if (!t) {
        t = {
          canonicalId: m.canonicalId,
          displayName: displayNameFn(m.canonicalId),
          unit: m.unit || "",
          points: [],
        };
        trends.set(m.canonicalId, t);
      }
      const def = unitDefFn(m.canonicalId);
      const c = def ? inCanonicalUnit(m, def) : null;
      const point: TrendPoint = {
        date: report.reportDate,
        value: c ? c.value : m.value,
        unit: c ? c.unit : m.unit,
        flag: m.flag,
        refLow: c ? c.refLow : m.refRangeLow,
        refHigh: c ? c.refHigh : m.refRangeHigh,
        // A converted reading carries its converted number as its text too:
        // every screen prints `valueRaw` as the value "as printed", and the
        // printed 0,9 beside a µmol/l axis would be the wrong number in the
        // right place. The print itself is kept in `convertedFrom`.
        valueRaw: c?.from && c.value !== null ? String(c.value).replace(".", ",") : m.valueRaw,
        reportId: report.id,
        rawName: m.rawAnalyteName,
        suspect: suspectFn(m),
        unconfirmed: unconfirmedFn(m),
        convertedFrom: c?.from ?? null,
      };
      if (c) settled.add(point);
      t.points.push(point);
    }
  }
  for (const t of trends.values()) {
    const def = unitDefFn(t.canonicalId);
    const anySettled = t.points.some((p) => settled.has(p));
    // The series' unit: the canonical one when any reading is in it or was
    // converted to it; otherwise the unit most readings carry.
    let unit: string;
    if (def && anySettled) unit = def.canonicalUnit;
    else {
      const counts = new Map<string, number>();
      for (const p of t.points) if (p.unit) counts.set(p.unit.toLowerCase(), (counts.get(p.unit.toLowerCase()) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      unit = top ? t.points.find((p) => p.unit?.toLowerCase() === top)!.unit! : t.unit;
    }
    const kept: TrendPoint[] = [];
    const other: Record<string, number> = {};
    for (const p of t.points) {
      const fits = settled.has(p) || !p.unit || p.unit.toLowerCase() === unit.toLowerCase();
      if (fits) kept.push(p);
      else other[p.unit!] = (other[p.unit!] ?? 0) + 1;
    }
    t.unit = unit;
    t.points = kept;
    if (Object.keys(other).length) t.otherUnits = other;
    t.points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  // A parameter whose every reading was in a unit nothing converts is not a
  // series at all; it has no points left, and no card.
  for (const [cid, t] of trends) if (t.points.length === 0) trends.delete(cid);
  return trends;
}

/** The two most recent points carrying a numeric value, as [older, newer]. */
export function latestTwo(trend: Trend): [TrendPoint | null, TrendPoint | null] {
  const pts = numericPoints(trend);
  if (pts.length >= 2) return [pts[pts.length - 2], pts[pts.length - 1]];
  if (pts.length === 1) return [null, pts[pts.length - 1]];
  return [null, null];
}


/** Plotted points that nothing has confirmed. */
export function unconfirmedPoints(t: Trend): TrendPoint[] {
  return t.points.filter((p) => p.value !== null && p.suspect === null && p.unconfirmed !== null);
}

/** Every point held out of the series or plotted with a caveat. */
export function hasDoubt(t: Trend): boolean {
  return t.points.some((p) => p.suspect !== null || p.unconfirmed !== null);
}

/**
 * The shape of a whole series, not just its last step.
 *
 * `latestTwo` answers "what changed since the previous draw", which is the
 * right question for the summary list and the wrong one for a patient with ten
 * draws over four years: ALT climbing 0,61 → 1,02 across two and a half years
 * is the arresting fact, and comparing only the last pair reports "+5 %". This
 * is the view that can see the climb.
 *
 * Everything here is computed from `numericPoints`, so a reading the app has
 * itself withheld can never contribute to a described trend.
 */
export interface SeriesShape {
  first: TrendPoint;
  last: TrendPoint;
  /** Numeric, non-withheld points only. */
  count: number;
  spanDays: number;
  change: number;
  /** Fraction, not percent. Null when the first value is zero. */
  relChange: number | null;
  direction: "rising" | "falling" | "flat";
  /** Points sitting outside their own printed reference range. */
  outOfRangeCount: number;
  /** Out of range now, and in range at the first draw. */
  newlyOut: boolean;
  /** Consecutive out-of-range draws ending at the most recent one. */
  outStreak: number;
  /**
   * Moving one way throughout, allowing steps below the noise threshold.
   *
   * A steady drift and the same total change arrived at by bouncing are
   * different clinical facts, and only one of them is worth a sentence.
   */
  monotone: boolean;
}

const OUT = (p: TrendPoint) => p.flag === "high" || p.flag === "low";

/** Whole days between two ISO dates, or 0 if either will not parse. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Null when fewer than two numeric points exist — one draw is not a shape. */
export function seriesShape(trend: Trend): SeriesShape | null {
  const pts = numericPoints(trend);
  if (pts.length < 2) return null;

  const first = pts[0];
  const last = pts[pts.length - 1];
  const fv = first.value as number;
  const lv = last.value as number;
  const change = lv - fv;

  // Same convention the per-step summary uses, so "prakticky beze změny" means
  // the same thing in both places.
  const eps = Math.max(Math.abs(fv) * 0.01, 1e-9);
  const direction = change > eps ? "rising" : change < -eps ? "falling" : "flat";

  let monotone = true;
  let sign = 0;
  for (let i = 1; i < pts.length; i++) {
    const step = (pts[i].value as number) - (pts[i - 1].value as number);
    const stepEps = Math.max(Math.abs(pts[i - 1].value as number) * 0.01, 1e-9);
    if (Math.abs(step) <= stepEps) continue; // noise, not a reversal
    const s = step > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) {
      monotone = false;
      break;
    }
  }

  let outStreak = 0;
  for (let i = pts.length - 1; i >= 0 && OUT(pts[i]); i--) outStreak++;

  return {
    first,
    last,
    count: pts.length,
    spanDays: daysBetween(first.date, last.date),
    change,
    relChange: fv ? change / fv : null,
    direction,
    outOfRangeCount: pts.filter(OUT).length,
    newlyOut: OUT(last) && !OUT(first),
    outStreak,
    monotone,
  };
}
