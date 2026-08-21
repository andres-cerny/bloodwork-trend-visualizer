/**
 * Analyte name → canonical id. Ported from the registry half of
 * src/matching.py. Mapping *suggestions* are precomputed at build time (the
 * analyte set is fixed), so only the lookup side is needed at runtime.
 */
import type { AnalyteDef } from "./models";

const PREFIX = /^[a-z]{1,4}_/; // Czech material prefixes: S_, B_, P_, U_, …
const NONALNUM = /[^a-z0-9]+/g;

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "");
}

/**
 * Normalize an analyte name to a match key.
 * "S_Glukóza" → "glukoza"; "B_Neutrofily #" → "neutrofily abs"; "gGT" → "ggt".
 */
export function normKey(name: string): string {
  let s = (name || "").trim().toLowerCase();
  s = s.replace(/\s+#/g, " abs"); // standalone "#" = absolute count
  s = s.split("#").join(" "); // any other "#" is decoration
  s = s.trim().replace(PREFIX, ""); // drop material prefix
  s = stripDiacritics(s);
  s = s.replace(NONALNUM, " ").trim();
  s = s.replace(/\s+/g, " ");
  return s;
}

export class Registry {
  readonly analytes = new Map<string, AnalyteDef>();
  private index = new Map<string, string>();

  constructor(analytes: AnalyteDef[]) {
    for (const a of analytes) this.addAnalyte(a);
  }

  addAnalyte(a: AnalyteDef): void {
    this.analytes.set(a.canonicalId, a);
    for (const n of [a.canonicalId, a.displayNameCs, ...a.synonyms]) {
      const k = normKey(n);
      if (k) this.index.set(k, a.canonicalId);
    }
  }

  match(rawName: string): string | null {
    return this.index.get(normKey(rawName)) ?? null;
  }

  get(canonicalId: string): AnalyteDef | undefined {
    return this.analytes.get(canonicalId);
  }

  displayName(canonicalId: string): string {
    return this.analytes.get(canonicalId)?.displayNameCs ?? canonicalId;
  }

  /** Teach the registry a new synonym (from a UI mapping acceptance). */
  addSynonym(canonicalId: string, rawName: string): void {
    const a = this.analytes.get(canonicalId);
    if (!a) return;
    if (!a.synonyms.includes(rawName)) a.synonyms.push(rawName);
    const k = normKey(rawName);
    if (k) this.index.set(k, canonicalId);
  }
}

/**
 * Convert a value + range to the analyte's canonical unit, when a factor is
 * declared. Raw value/unit stay untouched for the verification view.
 */
export function convertToCanonical(
  m: { value: number | null; unit: string | null; refRangeLow: number | null; refRangeHigh: number | null },
  a: AnalyteDef,
): void {
  if (m.value === null || m.unit === null) return;
  if (m.unit === a.canonicalUnit) return;
  const factor = a.unitConversions[m.unit];
  if (factor === undefined) return;
  m.value *= factor;
  if (m.refRangeLow !== null) m.refRangeLow *= factor;
  if (m.refRangeHigh !== null) m.refRangeHigh *= factor;
  m.unit = a.canonicalUnit;
}
