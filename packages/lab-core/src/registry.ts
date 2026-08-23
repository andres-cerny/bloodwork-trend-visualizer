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
  /** `canonicalId\u0000rawName` for every synonym taught by the UI. */
  private learned = new Set<string>();

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
    if (!a.synonyms.includes(rawName)) {
      a.synonyms.push(rawName);
      this.learned.add(`${canonicalId}\u0000${rawName}`);
    }
    const k = normKey(rawName);
    if (k) this.index.set(k, canonicalId);
  }

  /**
   * Forget a synonym taught by a mapping acceptance.
   *
   * Accepting a mapping merges one analyte's history into another's, and it
   * takes two clicks. Without a way back, a misclick is permanent for the
   * session and — worse — invisible afterwards, because the merged rows now
   * look like they always belonged. Only synonyms this registry learned can
   * be withdrawn: a name that came from the shipped table is not the user's
   * to unlearn, and dropping it would silently change how future reports
   * parse.
   */
  removeSynonym(canonicalId: string, rawName: string): boolean {
    const a = this.analytes.get(canonicalId);
    if (!a) return false;
    if (!this.learned.delete(`${canonicalId}\u0000${rawName}`)) return false;
    const i = a.synonyms.indexOf(rawName);
    if (i < 0) return false;
    a.synonyms.splice(i, 1);
    const k = normKey(rawName);
    // Only clear the index entry if it still points here and no remaining
    // name normalizes to the same key.
    if (k && this.index.get(k) === canonicalId) {
      const stillNamed = [a.canonicalId, a.displayNameCs, ...a.synonyms].some(
        (n) => normKey(n) === k,
      );
      if (!stillNamed) this.index.delete(k);
    }
    return true;
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
