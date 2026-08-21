/**
 * Ground truth for the generated layout fixtures.
 *
 * These PDFs are produced by `scripts/make_layout_fixtures.py` from literal
 * values, so what is printed on each page is known exactly. That is what makes
 * a live extraction test meaningful rather than a smoke test: every character
 * the model returns can be compared against the character that was printed,
 * including the Czech decimal comma and the lab's out-of-range marker.
 */

export interface ExpectedRow {
  /** Analyte name as printed, including the material prefix. */
  name: string;
  /** Value as printed — exact, decimal comma and any "!" or "*" included. */
  valueRaw: string;
  /** Unit as printed. Compared with the micro-sign fold applied. */
  unit: string;
  /** What normalize should derive, or null for censored/qualitative. */
  value: number | null;
  flag: "normal" | "low" | "high" | "unknown";
}

export interface Fixture {
  file: string;
  /** Why this layout is worth spending an API call on. */
  why: string;
  rows: ExpectedRow[];
}

export const FIXTURES: Fixture[] = [
  {
    file: "standard.pdf",
    why: "Baseline: four clean columns, one censored value.",
    rows: [
      { name: "S_Glukóza", valueRaw: "5,32", unit: "mmol/l", value: 5.32, flag: "normal" },
      { name: "S_Cholesterol", valueRaw: "6,01", unit: "mmol/l", value: 6.01, flag: "high" },
      // Censored: must survive verbatim and must never become a number.
      { name: "S_CRP", valueRaw: "<1,0", unit: "mg/l", value: null, flag: "unknown" },
    ],
  },
  {
    file: "split_range.pdf",
    why: "Reference range split across 'od'/'do' columns, values carrying the lab's own !/* markers.",
    rows: [
      { name: "S_ALT", valueRaw: "0,93 !", unit: "µkat/l", value: 0.93, flag: "high" },
      { name: "S_AST", valueRaw: "0,60", unit: "µkat/l", value: 0.6, flag: "normal" },
      { name: "S_GGT", valueRaw: "1,04 *", unit: "µkat/l", value: 1.04, flag: "high" },
    ],
  },
  {
    file: "two_column.pdf",
    why: "Two tables printed side by side — the layout that used to merge rows.",
    rows: [
      { name: "S_Sodík", valueRaw: "141", unit: "mmol/l", value: 141, flag: "normal" },
      { name: "S_Draslík", valueRaw: "4,32", unit: "mmol/l", value: 4.32, flag: "normal" },
      { name: "S_Chloridy", valueRaw: "104", unit: "mmol/l", value: 104, flag: "normal" },
      { name: "B_Hemoglobin", valueRaw: "148", unit: "g/l", value: 148, flag: "normal" },
      { name: "B_Leukocyty", valueRaw: "6,20", unit: "10^9/l", value: 6.2, flag: "normal" },
      { name: "B_Trombocyty", valueRaw: "243", unit: "10^9/l", value: 243, flag: "normal" },
    ],
  },
];

/** The scanned fixture — no text layer, so it must go through vision. */
export const SCAN_FIXTURE: Fixture = {
  file: "scanned.pdf",
  why: "No text layer at all — exercises the vision fallback.",
  rows: [{ name: "S_Glukóza", valueRaw: "5,32", unit: "mmol/l", value: 5.32, flag: "normal" }],
};
