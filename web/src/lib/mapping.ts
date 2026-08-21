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
  /** Material prefixes seen on this analyte's printed names: S_, B_, U_, P_. */
  materials: string[];
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
  /** False when the printed material differs (urine vs serum, say). */
  materialMatch: boolean | null;
  canonicalUnit: string;
  observed: Observed | null;
  /** Populated when valueOk is false, so the UI can show the two ranges. */
  incomingRange: [number, number] | null;
}

/**
 * The material a Czech lab prints before the analyte name: S_ (sérum),
 * B_ (plná krev), P_ (plazma), U_ (moč). Mapping a urine result onto a serum
 * analyte is a different test, not a synonym, however similar the names look.
 */
export function materialPrefix(rawName: string): string | null {
  const m = /^([a-zA-Z]{1,4})_/.exec((rawName || "").trim());
  return m ? m[1].toLowerCase() : null;
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
  const acc = new Map<
    string,
    { values: number[]; units: Map<string, number>; dates: Set<string>; materials: Set<string> }
  >();
  for (const r of reports) {
    for (const m of r.measurements) {
      if (m.canonicalId === null) continue;
      let e = acc.get(m.canonicalId);
      if (!e) {
        e = { values: [], units: new Map(), dates: new Set(), materials: new Set() };
        acc.set(m.canonicalId, e);
      }
      if (m.value !== null) e.values.push(m.value);
      if (m.unit) e.units.set(m.unit, (e.units.get(m.unit) ?? 0) + 1);
      if (r.reportDate) e.dates.add(r.reportDate);
      const mat = materialPrefix(m.rawAnalyteName);
      if (mat) e.materials.add(mat);
    }
  }

  const out = new Map<string, Observed>();
  for (const [cid, e] of acc) {
    const dates = [...e.dates].sort();
    const unit = [...e.units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    out.set(cid, {
      count: e.values.length,
      unit,
      materials: [...e.materials].sort(),
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

    // Plausibility, as a ratio rather than an additive window.
    //
    // The previous additive slack (max(range, |max|)) widened the accepted
    // window to roughly -61..784 for an analyte observed at 331..392, so a
    // value of 14 passed as plausible and the UI showed a green tick on a
    // clinically wrong mapping. A ratio test is what actually matters here:
    // the same analyte moves within an order of magnitude between samples,
    // and a different analyte is usually orders away.
    let valueOk: boolean | null = null;
    let incomingRange: [number, number] | null = null;
    if (meanV !== null && observed && observed.min !== null && observed.max !== null) {
      incomingRange = [Math.min(...values), Math.max(...values)];
      // Signs must agree before a ratio means anything.
      if (meanV <= 0 || observed.min <= 0) {
        valueOk = observed.min - Math.abs(observed.max) <= meanV && meanV <= observed.max + Math.abs(observed.max);
      } else {
        valueOk = meanV >= observed.min / 3 && meanV <= observed.max * 3;
      }
      score += valueOk ? 0.1 : -0.35;
    }

    // Material: a urine result is not a serum result, whatever the names do.
    const incomingMaterial = materialPrefix(analyte.rawName);
    let materialMatch: boolean | null = null;
    if (incomingMaterial && observed && observed.materials.length > 0) {
      materialMatch = observed.materials.includes(incomingMaterial);
      score += materialMatch ? 0.05 : -0.4;
    }

    if (score >= 0.45) {
      out.push({
        canonicalId: a.canonicalId,
        displayName: a.displayNameCs,
        score,
        nameSim,
        unitMatch,
        valueOk,
        materialMatch,
        canonicalUnit: a.canonicalUnit,
        observed,
        incomingRange: valueOk === false ? incomingRange : null,
      });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, topN);
}
