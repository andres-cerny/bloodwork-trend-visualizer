/**
 * Analyte name → canonical id. Ported from the registry half of
 * src/matching.py. Mapping *suggestions* are precomputed at build time (the
 * analyte set is fixed), so only the lookup side is needed at runtime.
 */
import type { AnalyteDef } from "./models";
import { MATERIAL_CODES, compartmentCompatible, materialPrefix, stripMaterialPrefix } from "./normalize";
import { printedMaterial, type TextRow } from "./pdf/rows";

// The material-prefix rule (S_, S/, S-, S,P-, dU_ …) lives in normalize.ts,
// beside its Python twin, so the registry and the mapping evidence agree.
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
  s = stripMaterialPrefix(s.trim()); // drop material prefix
  s = stripDiacritics(s);
  s = s.replace(NONALNUM, " ").trim();
  s = s.replace(/\s+/g, " ");
  return s;
}

// The bracketed abbreviation some LIS print after their own long form:
// "B_Střed.obj.erytr. [MCV]", "B-Trombocyty hematokrit [PCT]". Trailing only,
// and only a short code — a bracket in the middle of a name is not one.
const TRAILING_ABBREVIATION = /\[([a-z0-9]{2,6})\]\s*$/i;

/**
 * The second key a printed name is looked up under: its trailing bracketed
 * abbreviation, or null when it has none. Every lab that prints the bracket
 * meets the bare "MCV" synonym whatever Czech long form it chose, and the
 * full key is still tried first, so a lab whose bracket says something the
 * catalog does not know loses nothing.
 */
export function abbreviationKey(name: string): string | null {
  const m = TRAILING_ABBREVIATION.exec((name || "").trim());
  return m ? m[1].toLowerCase() : null;
}

/** A code the registry can reason about; any other prefix is no evidence. */
const knownMaterial = (code: string | null | undefined): string | null =>
  code && MATERIAL_CODES.has(code) ? code : null;

/**
 * The material a set of names announces: the union of their known prefix
 * codes, comma-joined so `materialsCompatible` can split it again
 * ("S_Glukóza", "P_Glukóza" → "s,p"). Null when no name carries one — the
 * twelve seed entries without a prefix (eGFR, IgA, troponin…), and any
 * synonym whose underscore prefix is not a material ("xxx_eGF").
 */
export function materialOfNames(names: Iterable<string>): string | null {
  const codes: string[] = [];
  for (const n of names) {
    const code = knownMaterial(materialPrefix(n));
    if (!code) continue;
    for (const c of code.split(",")) if (!codes.includes(c)) codes.push(c);
  }
  return codes.length > 0 ? codes.join(",") : null;
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
    a.material = materialOfNames(a.synonyms);
    // A canonical id is not a printed name: "non_hdl" must not lose its
    // "non_" to the material-prefix rule and land on the bare "hdl" key.
    // Guard seen failing 2026-09-06 (registry.test.ts "keeps non_hdl").
    this.index.set(normKey(a.canonicalId.replace(/_/g, " ")), a.canonicalId);
    for (const n of [a.displayNameCs, ...a.synonyms]) {
      const k = normKey(n);
      if (k) this.index.set(k, a.canonicalId);
      // A synonym that carries the bracket teaches the bare code too, so
      // "B_Leukocyty [WBC]" in the seed answers for a lab printing "[WBC]"
      // after a long form the seed never saw.
      const abbr = abbreviationKey(n);
      if (abbr && !this.index.has(abbr)) this.index.set(abbr, a.canonicalId);
    }
  }

  /**
   * Drop an analyte the reader founded, with every index key it claimed.
   *
   * The counterpart of `addAnalyte` for a parameter created in the mapping
   * screen and later deleted. Keys are handed back to any analyte that still
   * claims them rather than simply cleared: the index is last-writer-wins, so
   * a blind sweep could take a shipped entry's own name down with the founded
   * one. The mapping screen refuses to found a parameter whose name collides
   * with a known one, so nothing should be shadowed in practice — but a
   * method that corrupts the index when pointed at any other entry is not one
   * worth having.
   */
  removeAnalyte(canonicalId: string): boolean {
    if (!this.analytes.delete(canonicalId)) return false;
    for (const key of this.learned) {
      if (key.startsWith(`${canonicalId}\\u0000`)) this.learned.delete(key);
    }
    for (const [k, id] of [...this.index]) {
      if (id !== canonicalId) continue;
      this.index.delete(k);
      for (const a of this.analytes.values()) {
        const named = [a.canonicalId.replace(/_/g, " "), a.displayNameCs, ...a.synonyms];
        if (named.some((n) => normKey(n) === k)) {
          this.index.set(k, a.canonicalId);
          break;
        }
      }
    }
    return true;
  }

  /**
   * The canonical id a printed name resolves to, or null.
   *
   * Name first, then material: the index is keyed on the name with its
   * prefix stripped, so "Glukóza", "S_Glukóza" and "U_Glukóza" all find the
   * serum glukoza. The material check then refuses what the name found when
   * the row's stated material contradicts the entry's — a urine Glukóza is a
   * different test, and a refused row stays unmapped for the mapping tab,
   * where the suggester explains why. The row's material is its prefix
   * when it has one, else `pageMaterial`: what the page says for the row
   * (its Materiál cell or the heading above it; see `matchRow`). Unknown on
   * either side is compatible, so a page that says nothing maps as before.
   */
  match(rawName: string, pageMaterial?: string | null): string | null {
    const abbr = abbreviationKey(rawName);
    const id = this.index.get(normKey(rawName)) ?? (abbr ? this.index.get(abbr) : undefined);
    if (!id) return null;
    const stated = knownMaterial(materialPrefix(rawName)) ?? knownMaterial(pageMaterial);
    const known = this.analytes.get(id)?.material;
    // Guard seen failing 2026-09-06 (registry.test.ts "material",
    // layouts.test.ts mixed_material.pdf): without this line the urine
    // Glukóza auto-mapped to the serum glukoza.
    if (stated && known && !compartmentCompatible(stated, known)) return null;
    return id;
  }

  /**
   * `match` for a measurement the text path placed on a page row: the
   * material comes from the row's own cells when the name carries none.
   * With no rows (a scan) or no index it is plain `match`.
   */
  matchRow(rawName: string, rows: TextRow[], rowIndex: number | undefined): string | null {
    return this.match(rawName, printedMaterial(rows, rowIndex)?.code);
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
    // Accepting "P_Glukóza" onto a serum entry teaches it plasma too, so the
    // next report from that lab needs no click.
    a.material = materialOfNames(a.synonyms);
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
    a.material = materialOfNames(a.synonyms);
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
