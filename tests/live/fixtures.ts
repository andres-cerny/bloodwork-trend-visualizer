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
  /**
   * The heading the row sits under, when the page carries no material prefix
   * and the same name is printed twice ("Glukóza" under "Sérum" and again
   * under "Moč"). The live matcher pairs rows by name alone today, so it takes
   * the first "Glukóza" for both — Phase B teaches it to use this.
   */
  section?: string;
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
  {
    file: "slash_prefix.pdf",
    why: "Slash material prefix, a separate 'Hodnocení' column carrying '( * )', the unit printed last.",
    rows: [
      { name: "S/Sodík", valueRaw: "141", unit: "mmol/l", value: 141, flag: "normal" },
      { name: "S/Draslík", valueRaw: "5,45", unit: "mmol/l", value: 5.45, flag: "high" },
      { name: "S/Chloridy", valueRaw: "104", unit: "mmol/l", value: 104, flag: "normal" },
      { name: "S/Glukóza", valueRaw: "5,32", unit: "mmol/l", value: 5.32, flag: "normal" },
      { name: "S/Kreatinin", valueRaw: "89", unit: "µmol/l", value: 89, flag: "normal" },
      { name: "B/Hemoglobin", valueRaw: "148", unit: "g/l", value: 148, flag: "normal" },
      { name: "B/Leukocyty", valueRaw: "11,20", unit: "10^9/l", value: 11.2, flag: "high" },
      { name: "B/Trombocyty", valueRaw: "243", unit: "10^9/l", value: 243, flag: "normal" },
    ],
  },
  {
    file: "hyphen_comma_prefix.pdf",
    why: "Hyphen, comma and underscore prefixes beside two names that only look prefixed (anti-TPO, 25-OH vitamin D).",
    rows: [
      { name: "S-Na", valueRaw: "141", unit: "mmol/l", value: 141, flag: "normal" },
      { name: "S-K", valueRaw: "4,32", unit: "mmol/l", value: 4.32, flag: "normal" },
      { name: "S,P-glukóza", valueRaw: "5,32", unit: "mmol/l", value: 5.32, flag: "normal" },
      { name: "U-amyláza", valueRaw: "3,15", unit: "µkat/l", value: 3.15, flag: "normal" },
      { name: "P_Amoniak", valueRaw: "32", unit: "µmol/l", value: 32, flag: "normal" },
      { name: "dU_Kreatinin", valueRaw: "12,4", unit: "mmol/d", value: 12.4, flag: "normal" },
      // Not prefixes: the hyphen is part of the name and must survive intact.
      { name: "anti-TPO", valueRaw: "18,5", unit: "kIU/l", value: 18.5, flag: "normal" },
      { name: "25-OH vitamin D", valueRaw: "62", unit: "nmol/l", value: 62, flag: "low" },
    ],
  },
  {
    file: "zkr_column.pdf",
    why: "Abbreviation column before the name, four-decimal values, the lab's 'H' in its own column, signature cells.",
    rows: [
      { name: "urea", valueRaw: "4,9000", unit: "mmol/l", value: 4.9, flag: "normal" },
      { name: "kreatinin", valueRaw: "78,0000", unit: "µmol/l", value: 78, flag: "normal" },
      { name: "kyselina močová", valueRaw: "396,0000", unit: "µmol/l", value: 396, flag: "high" },
      { name: "glukóza", valueRaw: "5,1000", unit: "mmol/l", value: 5.1, flag: "normal" },
      { name: "cholesterol", valueRaw: "4,8000", unit: "mmol/l", value: 4.8, flag: "normal" },
    ],
  },
  {
    file: "slovak_grouped.pdf",
    why: "Slovak sheet: group headings, en-dash ranges, a 'Materiál' column, a qualitative row whose result is a word.",
    rows: [
      { name: "Leukocyty [WBC]", valueRaw: "6,90", unit: "10^9/l", value: 6.9, flag: "normal" },
      { name: "Erytrocyty [RBC]", valueRaw: "4,85", unit: "10^12/l", value: 4.85, flag: "normal" },
      { name: "Hemoglobín [HGB]", valueRaw: "151", unit: "g/l", value: 151, flag: "normal" },
      { name: "Trombocyty [PLT]", valueRaw: "238", unit: "10^9/l", value: 238, flag: "normal" },
      { name: "Glukóza", valueRaw: "5,10", unit: "mmol/l", value: 5.1, flag: "normal" },
      { name: "Kreatinín", valueRaw: "82", unit: "µmol/l", value: 82, flag: "normal" },
      { name: "Kyselina močová", valueRaw: "430", unit: "µmol/l", value: 430, flag: "high" },
      { name: "TSH", valueRaw: "2,15", unit: "mIU/l", value: 2.15, flag: "normal" },
      { name: "fT4", valueRaw: "16,2", unit: "pmol/l", value: 16.2, flag: "normal" },
      // Qualitative: the result is a word, the criteria are words — never a number.
      { name: "Anti CMV IgM (skríning)", valueRaw: "<1,0 negatívne", unit: "index", value: null, flag: "unknown" },
    ],
  },
  {
    file: "urine_no_prefix.pdf",
    why: "No prefix anywhere: numeric urine rows under a 'Moč chemicky' heading, ranges overlapping the serum ones.",
    rows: [
      { name: "Glukóza", valueRaw: "5,4", unit: "mmol/l", value: 5.4, flag: "normal", section: "Biochemie" },
      { name: "Urea", valueRaw: "5,1", unit: "mmol/l", value: 5.1, flag: "normal", section: "Biochemie" },
      { name: "Kreatinin", valueRaw: "84", unit: "µmol/l", value: 84, flag: "normal", section: "Biochemie" },
      { name: "Glukóza", valueRaw: "0,3", unit: "mmol/l", value: 0.3, flag: "normal", section: "Moč chemicky" },
      { name: "Bílkovina", valueRaw: "0,10", unit: "g/l", value: 0.1, flag: "normal", section: "Moč chemicky" },
      { name: "pH", valueRaw: "6,0", unit: "", value: 6, flag: "normal", section: "Moč chemicky" },
      { name: "Hustota", valueRaw: "1,015", unit: "", value: 1.015, flag: "normal", section: "Moč chemicky" },
      { name: "Močový sediment", valueRaw: "negativní", unit: "", value: null, flag: "unknown", section: "Moč chemicky" },
    ],
  },
  {
    file: "mixed_material.pdf",
    why: "The disambiguation case: the same analyte name under 'Sérum' and again under 'Moč', nothing but the heading to tell them apart.",
    rows: [
      { name: "Glukóza", valueRaw: "5,4", unit: "mmol/l", value: 5.4, flag: "normal", section: "Sérum" },
      { name: "Kreatinin", valueRaw: "84", unit: "µmol/l", value: 84, flag: "normal", section: "Sérum" },
      { name: "Glukóza", valueRaw: "0,3", unit: "mmol/l", value: 0.3, flag: "normal", section: "Moč" },
      { name: "Kreatinin", valueRaw: "9,8", unit: "mmol/l", value: 9.8, flag: "normal", section: "Moč" },
    ],
  },
];

/** The scanned fixture — no text layer, so it must go through vision. */
export const SCAN_FIXTURE: Fixture = {
  file: "scanned.pdf",
  why: "No text layer at all — exercises the vision fallback.",
  rows: [{ name: "S_Glukóza", valueRaw: "5,32", unit: "mmol/l", value: 5.32, flag: "normal" }],
};

/**
 * The photo-like scan — scanned.pdf rotated 3° with the contrast flattened.
 * No text layer either, so the same vision path; what it adds is the geometry
 * and the greyness a phone camera gives a printed sheet.
 */
export const PHOTO_SCAN_FIXTURE: Fixture = {
  file: "scanned_photo_like.pdf",
  why: "No text layer, rotated 3°, low contrast — the synthetic stand-in for a phone shot.",
  rows: [
    { name: "S_Glukóza", valueRaw: "5,32", unit: "mmol/l", value: 5.32, flag: "normal" },
    { name: "S_Cholesterol", valueRaw: "6,01", unit: "mmol/l", value: 6.01, flag: "high" },
    { name: "S_Kreatinin", valueRaw: "89", unit: "µmol/l", value: 89, flag: "normal" },
  ],
};
