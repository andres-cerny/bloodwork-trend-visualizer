/**
 * Evidence for the analyte-mapping review.
 *
 * The question a doctor is actually answering is not "are these two names
 * similar" but "is the thing I already have under this heading the same
 * measurement as the thing I am looking at". So a suggestion has to carry
 * both sides: where the unknown name appears and what it read, and what data
 * already sits under the candidate.
 *
 * Mirrors `suggest_mappings` and `observed_stats` in src/matching.py,
 * including the value-plausibility check that compares the unknown's values
 * against the range already observed for the candidate.
 */
import type { LabReport } from "./models";
import { normKey, type Registry } from "./registry";

export interface Occurrence {
  reportId: string;
  date: string | null;
  valueRaw: string;
  value: number | null;
  page: number;
}

/** An analyte name we could not map, with everywhere it was seen. */
export interface UnmappedAnalyte {
  rawName: string;
  unitRaw: string;
  occurrences: Occurrence[];
}

/** What the existing data already holds under a canonical id. */
export interface Observed {
  count: number;
  unit: string;
  min: number | null;
  max: number | null;
  mean: number | null;
  firstDate: string | null;
  lastDate: string | null;
  /** Report dates the candidate already appears in. */
  dates: string[];
}

export interface Candidate {
  canonicalId: string;
  displayName: string;
  score: number;
  nameSim: number;
  unitMatch: boolean | null;
  valueOk: boolean | null;
  canonicalUnit: string;
  observed: Observed | null;
}

export function findUnmapped(reports: LabReport[]): UnmappedAnalyte[] {
  const seen = new Map<string, UnmappedAnalyte>();
  for (const r of reports) {
    for (const m of r.measurements) {
      if (m.canonicalId !== null) continue;
      let e = seen.get(m.rawAnalyteName);
      if (!e) {
        e = { rawName: m.rawAnalyteName, unitRaw: m.unitRaw, occurrences: [] };
        seen.set(m.rawAnalyteName, e);
      }
      e.occurrences.push({
        reportId: r.id,
        date: r.reportDate,
        valueRaw: m.valueRaw,
        value: m.value,
        page: m.sourcePage,
      });
    }
  }
  for (const e of seen.values()) {
    e.occurrences.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }
  return [...seen.values()];
}

/** Per-canonical-id evidence from measurements that are already mapped. */
export function observedStats(reports: LabReport[]): Map<string, Observed> {
  const acc = new Map<string, { values: number[]; units: Map<string, number>; dates: Set<string> }>();
  for (const r of reports) {
    for (const m of r.measurements) {
      if (m.canonicalId === null) continue;
      let e = acc.get(m.canonicalId);
      if (!e) {
        e = { values: [], units: new Map(), dates: new Set() };
        acc.set(m.canonicalId, e);
      }
      if (m.value !== null) e.values.push(m.value);
      if (m.unit) e.units.set(m.unit, (e.units.get(m.unit) ?? 0) + 1);
      if (r.reportDate) e.dates.add(r.reportDate);
    }
  }

  const out = new Map<string, Observed>();
  for (const [cid, e] of acc) {
    const dates = [...e.dates].sort();
    const unit = [...e.units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    out.set(cid, {
      count: e.values.length,
      unit,
      min: e.values.length ? Math.min(...e.values) : null,
      max: e.values.length ? Math.max(...e.values) : null,
      mean: e.values.length ? e.values.reduce((s, v) => s + v, 0) / e.values.length : null,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      dates,
    });
  }
  return out;
}

/** Character-bigram Dice coefficient — cheap, and stable for Czech names. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hits = 0;
  for (const [g, n] of ga) hits += Math.min(n, gb.get(g) ?? 0);
  return (2 * hits) / (a.length - 1 + b.length - 1);
}

const unitKey = (u: string | null | undefined) => (u ?? "").toLowerCase().replace(/\s+/g, "");

export function suggestMappings(
  analyte: UnmappedAnalyte,
  registry: Registry,
  stats: Map<string, Observed>,
  topN = 3,
): Candidate[] {
  const key = normKey(analyte.rawName);
  if (!key) return [];
  const ru = unitKey(analyte.unitRaw);
  const values = analyte.occurrences.map((o) => o.value).filter((v): v is number => v !== null);
  const meanV = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

  const out: Candidate[] = [];
  for (const a of registry.analytes.values()) {
    const keys = [a.canonicalId, a.displayNameCs, ...a.synonyms].map(normKey).filter(Boolean);
    if (keys.length === 0) continue;

    const nameSim = Math.max(...keys.map((k) => similarity(key, k)));
    let score = nameSim;
    // Substring containment is strong evidence the fuzzy score under-rates.
    if (key.length >= 3 && keys.some((k) => k.length >= 3 && (k.includes(key) || key.includes(k)))) {
      score += 0.15;
    }

    const observed = stats.get(a.canonicalId) ?? null;
    const candUnit = unitKey(a.canonicalUnit) || unitKey(observed?.unit);
    let unitMatch: boolean | null = null;
    if (ru && candUnit) {
      unitMatch =
        ru === candUnit || Object.keys(a.unitConversions).some((u) => unitKey(u) === ru);
      score += unitMatch ? 0.2 : -0.25;
    }

    // Plausibility: would this value sit anywhere near what the candidate has
    // already recorded? Slack is generous because one analyte legitimately
    // moves a long way between samples.
    let valueOk: boolean | null = null;
    if (meanV !== null && observed && observed.min !== null && observed.max !== null) {
      const slack = Math.max(observed.max - observed.min, Math.abs(observed.max), 1e-9);
      valueOk = observed.min - slack <= meanV && meanV <= observed.max + slack;
      score += valueOk ? 0.1 : -0.2;
    }

    if (score >= 0.45) {
      out.push({
        canonicalId: a.canonicalId,
        displayName: a.displayNameCs,
        score,
        nameSim,
        unitMatch,
        valueOk,
        canonicalUnit: a.canonicalUnit,
        observed,
      });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, topN);
}
