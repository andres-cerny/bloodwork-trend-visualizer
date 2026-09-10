/**
 * Union two independent reads of the same page.
 *
 * Agreement marks a row trustworthy. A differing value, or a row that only one
 * model saw, is flagged for the verification tab. That second case is the one
 * that matters: a model occasionally drops most of a page and returns what it
 * did read with high confidence, and a per-row confidence score on a single
 * read cannot see that. Two reads act as each other's completeness
 * expectation.
 */
import { makeMeasurement, type Measurement } from "./models";
import { normalizeMeasurement } from "./normalize";
import { normKey } from "./registry";

export interface RawRead {
  model: string;
  measurements: Array<{
    raw_analyte_name: string;
    value_raw: string;
    unit_raw?: string;
    ref_range_raw?: string;
    source_snippet?: string;
    /** Text path: the index of the printed row this came from. */
    row_index?: number;
    confidence?: "high" | "medium" | "low";
  }>;
}

/**
 * A page read by one reader when two were asked. Every row carries it, because
 * every row on such a page is uncorroborated — `review.ts` then renders them
 * `unconfirmed`, which is the whole point.
 */
export const SECOND_READ_FAILED = "druhé čtení se nezdařilo";

export interface ReconcileOptions {
  /**
   * How many readers were **asked**, not how many answered.
   *
   * Without it a failed request is invisible: one read means no two values to
   * differ and no row only one reader saw, so `reconcile` finds nothing to say
   * and every row comes back confirmed. A page nobody cross-checked then looks
   * fully verified — the strongest claim the app makes, made about the one
   * case with the least behind it. Defaults to `reads.length`, which is the
   * old behaviour for any caller that does not know.
   */
  expected?: number;
}

export function reconcile(reads: RawRead[], opts: ReconcileOptions = {}): Measurement[] {
  const byKey = new Map<
    string,
    { m: Measurement; models: Set<string>; values: Set<string> }
  >();

  // A page can print one name twice — Glukóza under Sérum and again under
  // Moč. Keyed on the name alone those two rows collapse into one measurement
  // with a false "two readings differ" flag. So a name any single read
  // returned more than once is keyed on its row index as well (or, without
  // indices, on the order it came in); a name returned once per read keeps
  // the plain key, so two readers numbering the same row differently still
  // meet. Guard seen failing 2026-09-06 (reconcile.test.ts, "printed twice").
  const twice = new Set<string>();
  for (const read of reads) {
    const seen = new Set<string>();
    for (const raw of read.measurements ?? []) {
      const k = normKey(raw.raw_analyte_name);
      if (seen.has(k)) twice.add(k);
      seen.add(k);
    }
  }

  for (const read of reads) {
    const ordinal = new Map<string, number>();
    for (const raw of read.measurements ?? []) {
      // Group on the normalized analyte name so "S_Glukóza" and "Glukóza"
      // from two models are recognised as the same row rather than both
      // surviving as separate, each looking like the other model missed it.
      const name = normKey(raw.raw_analyte_name);
      const nth = ordinal.get(name) ?? 0;
      ordinal.set(name, nth + 1);
      const key = twice.has(name) ? `${name}\u0000${raw.row_index ?? nth}` : name;
      const existing = byKey.get(key);
      if (existing) {
        existing.models.add(read.model);
        existing.values.add(raw.value_raw);
      } else {
        byKey.set(key, {
          m: makeMeasurement({
            rawAnalyteName: raw.raw_analyte_name,
            valueRaw: raw.value_raw,
            unitRaw: raw.unit_raw ?? "",
            refRangeRaw: raw.ref_range_raw ?? "",
            sourceSnippet: raw.source_snippet ?? "",
            // Carried through so the caller can resolve it against its own
            // rows; on the text path the model no longer sends any text here.
            rowIndex: raw.row_index,
            confidence: raw.confidence ?? "high",
            extractedBy: read.model,
          }),
          models: new Set([read.model]),
          values: new Set([raw.value_raw]),
        });
      }
    }
  }

  const total = reads.length;
  // A caller may report fewer readers than answered — it cannot report more
  // answers than there are — so the two are reconciled rather than trusted.
  const expected = Math.max(opts.expected ?? total, total);
  const out: Measurement[] = [];
  for (const { m, models, values } of byKey.values()) {
    // Say what the readings were, not which program produced them. A model id
    // tells a clinician nothing; two conflicting numbers side by side tell
    // them exactly what to check on the page.
    let disagreement: string | null = null;
    if (values.size > 1) {
      disagreement = `dvě nezávislá čtení se liší: ${[...values].join(" / ")}`;
    } else if (expected > total) {
      // A whole reader is missing. Nothing on this page was corroborated, so
      // nothing on it may be presented as confirmed.
      disagreement = SECOND_READ_FAILED;
    } else if (total > 1 && models.size < total) {
      disagreement = "řádek našlo jen jedno ze dvou čtení";
    }
    // `escalated` says a cross-check was *attempted*, not that it landed.
    out.push(normalizeMeasurement({ ...m, disagreement, escalated: expected > 1 }));
  }
  return out;
}
