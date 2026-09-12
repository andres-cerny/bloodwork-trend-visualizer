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
import type { AnalyteDef, LabReport, Measurement } from "./models";
import { normKey, type Registry } from "./registry";
import { canonicalizeUnit, isBloodMaterial, materialPrefix, materialsCompatible } from "./normalize";
import { prettyUnit } from "./czech";
import { printedMaterial } from "./pdf/rows";

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

/** Where a measurement's material was read from, closest to the row first. */
export type MaterialSource = "prefix" | "column" | "heading";

/** An analyte name we could not map, with everywhere it was seen. */
export interface UnmappedAnalyte {
  rawName: string;
  unitRaw: string;
  occurrences: Occurrence[];
  /** The reference interval printed beside it, when the lab printed one. */
  refRange: Range | null;
  /** The same interval as the lab printed it ("49,0 - 90,0", "< 1,12") — what a model is shown. */
  refRangeRaw: string;
  /**
   * Which document `refRange` was read from. A screen that offers to found a
   * parameter on that interval has to be able to say where it came from, and
   * digging back through the raw measurements to find out is reasoning the
   * apps are not supposed to do.
   */
  refRangeFrom: { reportId: string; date: string | null } | null;
  /**
   * The material the page states: a prefix on the name, else the row's
   * `Materiál` cell, else the heading over the block — the same lowercase
   * codes `materialPrefix` returns. Null when the page says nothing, which is
   * also what a scan and the demo reports yield (no rows to read).
   */
  material: string | null;
  materialSource: MaterialSource | null;
}

/**
 * The material of one measurement, prefix first.
 *
 * The name is the closest evidence and the only one that survives without
 * the page: "U_Bílkovina" is urine whatever heading it sits under. When the
 * name is bare, the page's rows (kept on the report's Page for the text path)
 * are read at the measurement's own row — its `Materiál` cell, then the
 * nearest heading above it.
 */
export function materialOf(m: Measurement, report: LabReport): { code: string; source: MaterialSource } | null {
  const prefix = materialPrefix(m.rawAnalyteName);
  if (prefix) return { code: prefix, source: "prefix" };
  const rows = report.pages.find((p) => p.pageNum === m.sourcePage)?.rows;
  if (!rows) return null;
  return printedMaterial(rows, m.rowIndex);
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
  rangeSource: "curated" | "documents" | "manual" | null;
  canonicalUnit: string;
  observed: Observed | null;
  /** Populated when valueOk is false, so the UI can show the two ranges. */
  incomingRange: [number, number] | null;
}

export function findUnmapped(reports: LabReport[]): UnmappedAnalyte[] {
  const seen = new Map<string, UnmappedAnalyte>();
  for (const r of reports) {
    for (const m of r.measurements) {
      if (m.canonicalId !== null) continue;
      let e = seen.get(m.rawAnalyteName);
      if (!e) {
        e = {
          rawName: m.rawAnalyteName,
          unitRaw: m.unitRaw,
          occurrences: [],
          refRange: null,
          refRangeRaw: "",
          refRangeFrom: null,
          material: null,
          materialSource: null,
        };
        seen.set(m.rawAnalyteName, e);
      }
      if (!e.refRangeRaw && m.refRangeRaw.trim()) e.refRangeRaw = m.refRangeRaw.trim();
      if (e.refRange === null && m.refRangeLow !== null && m.refRangeHigh !== null) {
        e.refRange = { low: m.refRangeLow, high: m.refRangeHigh };
        e.refRangeFrom = { reportId: r.id, date: r.reportDate };
      }
      // Occurrences are grouped by name; the first one that states a material
      // speaks for the group (a name the mapping UI acts on is one name).
      if (e.material === null) {
        const mat = materialOf(m, r);
        if (mat) {
          e.material = mat.code;
          e.materialSource = mat.source;
        }
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

/**
 * Could this name ever appear in a trend, if it were mapped?
 *
 * Two kinds cannot, and asking the reader to file them is noise with a cost:
 * a urine row (`U_pH`, the strip and the sediment) is not a blood test — a
 * real report from one lab carried 22 of them, padding a "78 names are not
 * shown" banner — and a name that never carried a number (a stage grade, a
 * "negativní" serology) has nothing to plot under any heading. A censored
 * value ("<1,0") counts as no number, which is what the trend would say too.
 * Neither is dropped: both stay in Ověření beside their document.
 */
export function trendable(a: UnmappedAnalyte): boolean {
  if (a.material !== null && !isBloodMaterial(a.material)) return false;
  return a.occurrences.some((o) => o.value !== null);
}

/**
 * A report's unmapped rows, tried again against a registry that may have
 * grown since the report was uploaded.
 *
 * `canonicalId` is computed once, at upload, and stored in the payload. A
 * catalog that learns a lab's spelling a week later — a shipped synonym, a
 * name another account taught — would otherwise never reach the reports
 * already there. Only null rows are tried; a row the reader mapped or
 * unmapped by hand keeps their decision. Returns the new report when any row
 * changed, else null, so the caller knows whether there is anything to save.
 */
export function rematchReport(report: LabReport, registry: Registry): LabReport | null {
  let changed = false;
  const measurements = report.measurements.map((m) => {
    if (m.canonicalId !== null) return m;
    const id = registry.match(m.rawAnalyteName, materialOf(m, report)?.code ?? null);
    if (id === null) return m;
    changed = true;
    return { ...m, canonicalId: id };
  });
  return changed ? { ...report, measurements } : null;
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
      const mat = materialOf(m, r);
      if (mat) e.materials.add(mat.code);
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

// Canonicalised first, as the Python twin does: a lab that prints Greek mu
// (μmol/l, U+03BC) must not be told its unit differs from the catalog's micro
// sign (µmol/l, U+00B5). Seen failing 2026-09-12 on every BioLAB candidate.
const unitKey = (u: string | null | undefined) => (canonicalizeUnit(u) ?? "").toLowerCase().replace(/\s+/g, "");

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
  const out: Candidate[] = [];
  for (const a of registry.analytes.values()) {
    const c = scoreCandidate(analyte, a, stats);
    // Name similarity is a necessary condition, not just another contributor.
    //
    // Unit and interval agreement can otherwise outvote a completely unrelated
    // name: homocysteine (5-15 µmol/l) and total bilirubin (3-21 µmol/l) share
    // a unit and overlap substantially, which scored total bilirubin as a
    // clean suggestion for homocysteine with no warning at all. Two clicks and
    // one analyte's history becomes another's, looking entirely believable.
    if (!c || c.nameSim < NAME_SIM_CUTOFF) continue;
    // Select on name similarity, rank on the full score.
    //
    // Filtering on the final score would hide contradicted candidates
    // entirely, and "no similar analyte found" is less useful to a clinician
    // than "this one looks similar, and here is why it is wrong". They stay
    // visible, ranked last and marked.
    if (c.nameSim >= NAME_SIM_FLOOR || c.score >= 0.45) out.push(c);
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, topN);
}

/**
 * One analyte as a candidate for one unmapped name: the evidence, scored.
 *
 * `suggestMappings` runs this over the whole registry and keeps the names
 * that look alike. It is exported on its own for the candidate a model
 * named: "S_Na" and "sodik" share no bigram, so the suggester would never
 * offer it, but the unit, interval, material and magnitude checks apply to
 * it exactly as to any other — and it is those, not the model, that decide
 * whether it can be applied without a click (`verdictOf`).
 */
export function scoreCandidate(analyte: UnmappedAnalyte, a: AnalyteDef, stats: Map<string, Observed>): Candidate | null {
  const key = normKey(analyte.rawName);
  if (!key) return null;
  const ru = unitKey(analyte.unitRaw);
  // Dimensionless folds to "" — the same "" as a cell the lab left empty. Only
  // the second means "nothing to compare": a printed "-" or "1" against g/l
  // is a mismatch the screen must say, and against a dimensionless catalog
  // entry (hematocrit, an index) it is agreement.
  const unitPrinted = (analyte.unitRaw ?? "").trim() !== "";
  const values = analyte.occurrences.map((o) => o.value).filter((v): v is number => v !== null);
  const meanV = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

  {
    const keys = [a.canonicalId, a.displayNameCs, ...a.synonyms].map(normKey).filter(Boolean);
    if (keys.length === 0) return null;

    const nameSim = Math.max(...keys.map((k) => similarity(key, k)));
    let score = nameSim;
    // Substring containment is strong evidence the fuzzy score under-rates.
    if (key.length >= 3 && keys.some((k) => k.length >= 3 && (k.includes(key) || key.includes(k)))) {
      score += 0.15;
    }

    const observed = stats.get(a.canonicalId) ?? null;
    const candUnit = unitKey(a.canonicalUnit) || unitKey(observed?.unit);
    let unitMatch: boolean | null = null;
    if (unitPrinted && (candUnit || a.canonicalUnit === "")) {
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
    // Read off the name, the Materiál column or the heading (findUnmapped).
    const incomingMaterial = analyte.material;
    let materialMatch: boolean | null = null;
    if (incomingMaterial && observed && observed.materials.length > 0) {
      materialMatch = observed.materials.some((m) => materialsCompatible(m, incomingMaterial));
      score += materialMatch ? 0.05 : -0.4;
    }

    const nameWeak = nameSim < NAME_SIM_FLOOR;
    {
      return {
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
        // A founded parameter names its own source: the report the reader
        // founded it on, or the reader themselves. Saying "z tabulky" for
        // either would claim a curated provenance the app has not got. See
        // AnalyteDef.rangeOrigin.
        rangeSource: a.referenceRange
          ? a.rangeOrigin === "document"
            ? "documents"
            : a.rangeOrigin === "manual"
              ? "manual"
              : "curated"
          : observed?.refRange
            ? "documents"
            : null,
        canonicalUnit: a.canonicalUnit,
        observed,
        incomingRange: valueOk === false ? incomingRange : null,
      };
    }
  }
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
  du: "sbíraná moč", l: "likvor", "s,p": "sérum/plazma",
};
export const materialCs = (m: string): string => MATERIAL_CS[m] ?? m.toUpperCase();

const MATERIAL_SOURCE_CS: Record<MaterialSource, string> = {
  prefix: "",
  column: " (podle sloupce)",
  heading: " (podle nadpisu)",
};

/** "moč", or "moč (podle nadpisu)" when the name itself does not say. */
export const materialWithSource = (code: string, source: MaterialSource | null): string =>
  materialCs(code) + (source ? MATERIAL_SOURCE_CS[source] : "");

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
          (c.rangeSource === "curated"
            ? " (z tabulky)"
            : c.rangeSource === "manual"
              ? " (zadané ručně)"
              : " (z dokumentů)") +
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

  // Worth a line whenever the page states a material — including when it
  // cannot be compared. A urine result mapped onto a serum analyte is a
  // different test however alike the names look, so leaving the row out when
  // the candidate has no history yet hid the one fact most likely to stop a
  // wrong mapping: that this reading came from urine at all. A material read
  // off the page rather than the name says so, because the reader looking at
  // "Glukóza" cannot see it in the name and needs to know where to look.
  const incomingMaterial = incoming.material;
  if (incomingMaterial) {
    const mats = o?.materials.map(materialCs).join(", ") ?? "";
    const mine = materialWithSource(incomingMaterial, incoming.materialSource);
    out.push({
      key: "material",
      label: "Materiál",
      state: c.materialMatch === null ? "unknown" : c.materialMatch ? "ok" : "bad",
      detail:
        c.materialMatch === null
          ? `${mine} — není s čím porovnat`
          : c.materialMatch
            ? incoming.materialSource === "prefix"
              ? `obojí ${mats}`
              : `${mine}, obojí ${mats}`
            : `${mine} vs ${mats}`,
    });
  }

  return out;
}
