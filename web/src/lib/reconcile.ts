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
    confidence?: "high" | "medium" | "low";
  }>;
}

export function reconcile(reads: RawRead[]): Measurement[] {
  const byKey = new Map<
    string,
    { m: Measurement; models: Set<string>; values: Set<string> }
  >();

  for (const read of reads) {
    for (const raw of read.measurements ?? []) {
      // Group on the normalized analyte name so "S_Glukóza" and "Glukóza"
      // from two models are recognised as the same row rather than both
      // surviving as separate, each looking like the other model missed it.
      const key = normKey(raw.raw_analyte_name);
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
  const out: Measurement[] = [];
  for (const { m, models, values } of byKey.values()) {
    let disagreement: string | null = null;
    if (values.size > 1) {
      disagreement = `modely přečetly různé hodnoty: ${[...values].join(" / ")}`;
    } else if (total > 1 && models.size < total) {
      disagreement = `řádek viděl jen ${[...models].join(", ")}`;
    }
    out.push(normalizeMeasurement({ ...m, disagreement, escalated: total > 1 }));
  }
  return out;
}
