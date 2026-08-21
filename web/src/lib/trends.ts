/** Assemble per-analyte time series across reports. Ported from src/trends.py. */
import type { Flag, LabReport } from "./models";

export interface TrendPoint {
  date: string; // ISO date of the report
  value: number | null;
  unit: string | null;
  flag: Flag;
  refLow: number | null;
  refHigh: number | null;
  valueRaw: string;
  reportId: string;
}

export interface Trend {
  canonicalId: string;
  displayName: string;
  unit: string;
  points: TrendPoint[];
}

export function numericPoints(t: Trend): TrendPoint[] {
  return t.points.filter((p) => p.value !== null);
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
): Map<string, Trend> {
  const trends = new Map<string, Trend>();
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
      if (!t.unit && m.unit) t.unit = m.unit;
      t.points.push({
        date: report.reportDate,
        value: m.value,
        unit: m.unit,
        flag: m.flag,
        refLow: m.refRangeLow,
        refHigh: m.refRangeHigh,
        valueRaw: m.valueRaw,
        reportId: report.id,
      });
    }
  }
  for (const t of trends.values()) {
    t.points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return trends;
}

/** The two most recent points carrying a numeric value, as [older, newer]. */
export function latestTwo(trend: Trend): [TrendPoint | null, TrendPoint | null] {
  const pts = numericPoints(trend);
  if (pts.length >= 2) return [pts[pts.length - 2], pts[pts.length - 1]];
  if (pts.length === 1) return [null, pts[pts.length - 1]];
  return [null, null];
}
