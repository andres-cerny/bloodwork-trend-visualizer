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

import type { TextRow } from "./pdf/rows";

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
  /**
   * A human looked at the printed page and vouched for this exact value.
   * `reviewOf` returns ok for a confirmed measurement, so every doubt channel
   * (chips, worklist, hollow trend dots, the held-back banner) clears at once.
   * Editing the value afterwards resets it — a new number is a new question.
   */
  confirmed?: boolean;

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
  /**
   * Text path only: the page's reconstructed rows, kept so a measurement's
   * `rowIndex` can still be read against its heading and its `Materiál`
   * column after extraction (mapping.ts). Absent on a scan and on the demo
   * reports, which are built outside the browser.
   */
  rows?: TextRow[];
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
  /**
   * Where `referenceRange` above came from, on a parameter the reader founded
   * in the mapping screen. Absent means the curated table, which is the only
   * source a shipped analyte has.
   *
   *   "document" — printed beside the result on their own report.
   *   "manual"   — they typed it, because no lab printed one.
   *
   * It changes nothing about how the interval is used. It is what the UI must
   * say about where it came from: the mapping evidence line names the source
   * of every interval it compares, and a founded parameter that claimed the
   * curated table would be asserting a provenance the app has not got. A
   * typed one is the reader's own figure and is labelled as such — it is
   * never presented as something a lab or a clinician stated.
   */
  rangeOrigin?: "document" | "manual";
  /**
   * The material this analyte is measured in — `s`, `b`, `u`, or `s,p` when
   * two are known — read off the prefixes of its synonyms (`S_Glukóza` → s).
   * Set by the Registry, not authored: recomputed whenever a synonym is
   * learned or withdrawn. Null when no synonym carries a known code, which
   * `Registry.match` treats as compatible with anything.
   */
  material?: string | null;
  /**
   * What the analyte is and what it is usually used for, in Czech, for the
   * "i" beside its name in Trendy and Souhrn. Two short paragraphs about the
   * analyte in general — never about the person's numbers, their flags or
   * their ranges, and never a disclaimer or a diagnosis. Written into
   * registry.json by the generator; absent on a parameter the reader
   * founded, and on an entry the texts have not reached yet, and the UI
   * shows no "i" for either. The Registry passes it through untouched.
   */
  about?: { what: string; usedFor: string };
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
