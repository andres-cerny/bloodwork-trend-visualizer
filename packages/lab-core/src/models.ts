/**
 * Types for the extracted data model.
 *
 * Ported from src/models.py. The split it encodes is load-bearing: the model
 * only ever fills the `*_raw` fields (verbatim transcription); every derived
 * numeric field (value, refRange*, flag) is computed by normalize.ts. Keep it
 * that way — it is what stops a misread decimal becoming a silent trend.
 */

export type Flag = "normal" | "low" | "high" | "unknown";
export type Confidence = "high" | "medium" | "low";

/** Pixel bbox on the rendered page image: [x0, y0, x1, y1]. */
export type Box = [number, number, number, number];

export interface Measurement {
  rawAnalyteName: string;
  valueRaw: string;
  unitRaw: string;
  refRangeRaw: string;
  sourceSnippet: string;
  /** Text path only: index into the page's reconstructed rows. */
  rowIndex?: number;
  sourcePage: number;
  confidence: Confidence;

  // derived by normalize.ts — never by the model
  canonicalId: string | null;
  value: number | null;
  unit: string | null;
  refRangeLow: number | null;
  refRangeHigh: number | null;
  refRangeText: string | null;
  flag: Flag;

  // provenance / QA
  extractedBy: string;
  escalated: boolean;
  disagreement: string | null;
  corrected: boolean;

  /** Precomputed at build time (src/locate.py) or derived from pdf.js. */
  bbox: Box | null;
  /**
   * Snapshot of the machine transcription, kept so a correction can be undone.
   *
   * The whole QA state is captured, not just the value: clearing a
   * disagreement on correction is right (a human has adjudicated it), but
   * restoring only the value on undo would leave the row looking clean while
   * the two readings still disagree — quietly laundering a disputed value
   * into a trusted one.
   */
  original: {
    valueRaw: string;
    disagreement: string | null;
    confidence: Confidence;
  } | null;
}

export interface Page {
  pageNum: number;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
}

export interface LabReport {
  id: string;
  sourceFile: string;
  reportDate: string | null; // ISO YYYY-MM-DD
  labName: string | null;
  patientName: string | null;
  patientId: string | null; // rodné číslo
  pages: Page[];
  measurements: Measurement[];
}

export interface AnalyteDef {
  canonicalId: string;
  displayNameCs: string;
  synonyms: string[];
  canonicalUnit: string;
  unitConversions: Record<string, number>;
  /**
   * Typical adult interval, for telling analytes apart when mapping — never
   * for deciding whether a result is abnormal. That always comes from the
   * interval printed on the patient's own report. See
   * scripts/reference_ranges.json.
   */
  referenceRange?: [number, number] | null;
}

/** A measurement with only the raw fields filled — what an extractor returns. */
export type RawMeasurement = Pick<
  Measurement,
  "rawAnalyteName" | "valueRaw" | "unitRaw" | "refRangeRaw"
> &
  Partial<Measurement>;

export function makeMeasurement(raw: RawMeasurement): Measurement {
  return {
    sourceSnippet: "",
    sourcePage: 1,
    confidence: "high",
    canonicalId: null,
    value: null,
    unit: null,
    refRangeLow: null,
    refRangeHigh: null,
    refRangeText: null,
    flag: "unknown",
    extractedBy: "",
    escalated: false,
    disagreement: null,
    corrected: false,
    bbox: null,
    original: null,
    ...raw,
  };
}
