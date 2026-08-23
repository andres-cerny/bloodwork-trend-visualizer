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
import { prettyUnit } from "./czech";

export interface Occurrence {
  reportId: string;
  date: string | null;
  valueRaw: string;
  value: number | null;
  page: number;
}

/** A printed reference interval, as parsed by normalize. */
export interface Range {
  low: number;
  high: number;
}

/**
 * Do two reference intervals describe the same measurement?
 *
 * This is the strongest signal available for mapping, and it is free: the lab
 * prints the analyte's defining interval on every row. Two spellings of the
 * same analyte carry near-identical intervals even across labs, while two
 * different analytes usually do not overlap at all — homocysteine at
 * 5,0–15,0 µmol/l against uric acid at 202–417 µmol/l share nothing.
 *
 * Unlike comparing this patient's own past values, it works on a first-ever
 * report, where there is no history to compare against.
 */
export function rangesCompatible(a: Range, b: Range): boolean {
  const overlap = Math.min(a.high, b.high) - Math.max(a.low, b.low);
  if (overlap <= 0) return false;
  const union = Math.max(a.high, b.high) - Math.min(a.low, b.low);
  return union <= 0 ? true : overlap / union >= 0.3;
}

/** An analyte name we could not map, with everywhere it was seen. */
export interface UnmappedAnalyte {
  rawName: string;
  unitRaw: string;
  occurrences: Occurrence[];
  /** The reference interval printed beside it, when the lab printed one. */
  refRange: Range | null;
}

/** What the existing data already holds under a canonical id. */
export interface Observed {
  count: number;
  unit: string;
  /** Material prefixes seen on this analyte's printed names: S_, B_, U_, P_. */
  materials: string[];
  /** The reference interval labs printed for this analyte. */
  refRange: Range | null;
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
  /** True when the names are too dissimilar for this to be the same analyte. */
  nameWeak: boolean;
  /** Comparison of reference intervals — the strongest signal. */
  rangeMatch: boolean | null;
  candidateRange: Range | null;
  /** Where the candidate's interval came from, for the UI to explain itself. */
  rangeSource: "curated" | "documents" | null;
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
        e = { rawName: m.rawAnalyteName, unitRaw: m.unitRaw, occurrences: [], refRange: null };
        seen.set(m.rawAnalyteName, e);
      }
      if (e.refRange === null && m.refRangeLow !== null && m.refRangeHigh !== null) {
        e.refRange = { low: m.refRangeLow, high: m.refRangeHigh };
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
    {
      values: number[];
      units: Map<string, number>;
      dates: Set<string>;
      materials: Set<string>;
      ranges: Range[];
    }
  >();
  for (const r of reports) {
    for (const m of r.measurements) {
      if (m.canonicalId === null) continue;
      let e = acc.get(m.canonicalId);
      if (!e) {
        e = { values: [], units: new Map(), dates: new Set(), materials: new Set(), ranges: [] };
        acc.set(m.canonicalId, e);
      }
      if (m.value !== null) e.values.push(m.value);
      if (m.unit) e.units.set(m.unit, (e.units.get(m.unit) ?? 0) + 1);
      if (r.reportDate) e.dates.add(r.reportDate);
      const mat = materialPrefix(m.rawAnalyteName);
      if (mat) e.materials.add(mat);
      if (m.refRangeLow !== null && m.refRangeHigh !== null) {
        e.ranges.push({ low: m.refRangeLow, high: m.refRangeHigh });
      }
    }
  }

  const out = new Map<string, Observed>();
  for (const [cid, e] of acc) {
    const dates = [...e.dates].sort();
    const unit = [...e.units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    // Median bounds, so one mistyped interval cannot define the analyte.
    const mid = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    const refRange = e.ranges.length
      ? { low: mid(e.ranges.map((r) => r.low)), high: mid(e.ranges.map((r) => r.high)) }
      : null;

    out.set(cid, {
      count: e.values.length,
      unit,
      materials: [...e.materials].sort(),
      refRange,
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

/** Below this the names are too different to present as a clean suggestion. */
const NAME_SIM_FLOOR = 0.45;
/** Below this it is not the same analyte under any reading — do not offer it. */
const NAME_SIM_CUTOFF = 0.28;

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

    // Reference intervals first — the strongest signal, and the only one that
    // works on a first-ever report where no history exists to compare against.
    //
    // Three sources in order of authority:
    //   1. the curated table (consistent, and present before any data exists),
    //   2. the interval labs actually printed for this analyte here,
    //   3. nothing — in which case the observed-value check below has its say.
    const candidateRange = a.referenceRange
      ? { low: a.referenceRange[0], high: a.referenceRange[1] }
      : (observed?.refRange ?? null);
    let rangeMatch: boolean | null = null;
    if (analyte.refRange && candidateRange) {
      rangeMatch = rangesCompatible(analyte.refRange, candidateRange);
      score += rangeMatch ? 0.3 : -0.6;
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

    // Name similarity is a necessary condition, not just another contributor.
    //
    // Unit and interval agreement can otherwise outvote a completely unrelated
    // name: homocysteine (5-15 µmol/l) and total bilirubin (3-21 µmol/l) share
    // a unit and overlap substantially, which scored total bilirubin as a
    // clean suggestion for homocysteine with no warning at all. Two clicks and
    // one analyte's history becomes another's, looking entirely believable.
    const nameWeak = nameSim < NAME_SIM_FLOOR;
    if (nameSim < NAME_SIM_CUTOFF) continue;

    // Select on name similarity, rank on the full score.
    //
    // Filtering on the final score would hide contradicted candidates
    // entirely, and "no similar analyte found" is less useful to a clinician
    // than "this one looks similar, and here is why it is wrong". They stay
    // visible, ranked last and marked.
    if (nameSim >= 0.45 || score >= 0.45) {
      out.push({
        canonicalId: a.canonicalId,
        displayName: a.displayNameCs,
        score,
        nameSim,
        nameWeak,
        unitMatch,
        valueOk,
        materialMatch,
        rangeMatch,
        candidateRange,
        rangeSource: a.referenceRange ? "curated" : observed?.refRange ? "documents" : null,
        canonicalUnit: a.canonicalUnit,
        observed,
        incomingRange: valueOk === false ? incomingRange : null,
      });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, topN);
}

/**
 * How much the evidence supports one candidate.
 *
 * `contradicted` is the important one: it is the difference between "we could
 * not find corroboration" and "we found a reason this is a different test".
 * The scorer already knows the difference — it applies penalties of -0.25 to
 * -0.6 — but the score is one number, and a number cannot be argued with at
 * the point of decision. This turns it back into a verdict the screen can
 * lead with.
 */
export type Verdict = "recommended" | "possible" | "contradicted";

/**
 * A single line of evidence, in the form the screen renders.
 *
 * Derived here rather than in the component so the wording and the state can
 * be asserted in unit tests: "shows a tick" and "says why" are exactly the
 * things that regress silently when markup is refactored.
 */
export interface Signal {
  key: "name" | "unit" | "range" | "values" | "material";
  label: string;
  state: "ok" | "bad" | "unknown";
  detail: string;
}

/** A candidate contradicted by name, unit, material, interval or magnitude. */
export function isImplausible(c: Candidate): boolean {
  return (
    c.nameWeak ||
    c.unitMatch === false ||
    c.materialMatch === false ||
    c.valueOk === false ||
    // The reference interval carries the largest weight in the scorer (-0.6).
    // Leaving it out of this test meant a candidate the algorithm had all but
    // rejected could still be presented as the clean best match.
    c.rangeMatch === false
  );
}

export function verdictOf(c: Candidate): Verdict {
  if (isImplausible(c)) return "contradicted";
  // Nothing contradicts it — but "nothing known" is not the same as "checked
  // and agrees", and offering the two under one word is how a guess gets
  // accepted as a finding.
  const corroborated =
    c.rangeMatch === true || c.unitMatch === true || c.valueOk === true || c.materialMatch === true;
  return corroborated ? "recommended" : "possible";
}

const czRange = (r: Range | null): string =>
  r ? `${czMappingNum(r.low)}–${czMappingNum(r.high)}` : "";

/** Czech decimal comma, without pulling the summary module into this one. */
function czMappingNum(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "?";
  const s = Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
  return s.replace(/\.?0+$/, "").replace(".", ",") || "0";
}

const MATERIAL_CS: Record<string, string> = {
  s: "sérum", b: "plná krev", p: "plazma", u: "moč", pk: "plazma", fw: "krev",
};
export const materialCs = (m: string): string => MATERIAL_CS[m] ?? m.toUpperCase();

/**
 * The evidence for one candidate, strongest signal first.
 *
 * Order matters: the reference interval is the only signal that works on a
 * first-ever report and carries the heaviest weight, so it is read before the
 * value comparison that needs history to mean anything.
 */
export function signalsOf(c: Candidate, incoming: UnmappedAnalyte): Signal[] {
  const o = c.observed;
  const out: Signal[] = [];

  out.push({
    key: "name",
    label: "Název",
    state: c.nameWeak ? "bad" : "ok",
    detail: c.nameWeak
      ? "jiný název — pravděpodobně jiné vyšetření"
      : `podobá se názvu ${c.displayName}`,
  });

  out.push({
    key: "unit",
    label: "Jednotka",
    state: c.unitMatch === null ? "unknown" : c.unitMatch ? "ok" : "bad",
    detail:
      c.unitMatch === null
        ? "nelze porovnat"
        : c.unitMatch
          ? `obojí ${prettyUnit(c.canonicalUnit || o?.unit) || "bez jednotky"}`
          : `${prettyUnit(incoming.unitRaw) || "bez jednotky"} vs ${prettyUnit(c.canonicalUnit || o?.unit) || "bez jednotky"}`,
  });

  out.push({
    key: "range",
    label: "Referenční rozmezí",
    state: c.rangeMatch === null ? "unknown" : c.rangeMatch ? "ok" : "bad",
    detail:
      c.rangeMatch === null
        ? incoming.refRange
          ? "u tohoto parametru rozmezí neznáme"
          : "laboratoř rozmezí neuvedla"
        : `${czRange(incoming.refRange)} vs ${czRange(c.candidateRange)}` +
          (c.rangeSource === "curated" ? " (z tabulky)" : " (z dokumentů)") +
          (c.rangeMatch ? "" : " — neodpovídá"),
  });

  out.push({
    key: "values",
    label: "Naměřené hodnoty",
    state: c.valueOk === null ? "unknown" : c.valueOk ? "ok" : "bad",
    detail:
      c.valueOk === null
        ? "pod tímto názvem zatím nemáme data"
        : c.valueOk
          ? "řádově odpovídají"
          : c.incomingRange
            ? `${czMappingNum(c.incomingRange[0])}–${czMappingNum(c.incomingRange[1])} vs ${czMappingNum(o?.min)}–${czMappingNum(o?.max)}`
            : "neodpovídají",
  });

  // Worth a line whenever the lab printed a material prefix — including when
  // it cannot be compared. A urine result mapped onto a serum analyte is a
  // different test however alike the names look, so leaving the row out when
  // the candidate has no history yet hid the one fact most likely to stop a
  // wrong mapping: that this reading came from urine at all.
  const incomingMaterial = materialPrefix(incoming.rawName);
  if (incomingMaterial) {
    const mats = o?.materials.map(materialCs).join(", ") ?? "";
    out.push({
      key: "material",
      label: "Materiál",
      state: c.materialMatch === null ? "unknown" : c.materialMatch ? "ok" : "bad",
      detail:
        c.materialMatch === null
          ? `${materialCs(incomingMaterial)} — není s čím porovnat`
          : c.materialMatch
            ? `obojí ${mats}`
            : `${materialCs(incomingMaterial)} vs ${mats}`,
    });
  }

  return out;
}
