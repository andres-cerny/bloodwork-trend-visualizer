/**
 * Deterministic parsing of the raw strings a model transcribed.
 *
 * Ported from src/normalize.py, kept pure and side-effect free so the same
 * assertions the Python tests make can be made here. This is where every
 * number, unit and reference range is *computed* — the model never does
 * arithmetic. A misread decimal is the cardinal bug this module guards.
 */
import type { Confidence, Flag, Measurement } from "./models";

const MICRO_VARIANTS: Array<[string, string]> = [["μ", "µ"]]; // Greek mu → micro sign
const DASHES = ["‒", "–", "—", "−"]; // figure/en/em dash, minus
const THIN_SPACES = [" ", " ", " ", " "]; // NBSP, narrow NBSP, thin, figure

// Micro has three spellings: the micro sign, Greek mu (both above) and the
// ASCII fallback a lab prints when its LIS cannot emit either. Lowercase only,
// and only before a stem that has a micro form — "U/l" is the enzyme unit.
const MICRO_ASCII = /(?<![A-Za-z])u(?=(?:mol|kat|g|l)(?![A-Za-z]))/g;
// The count units, whose exponent survives a PDF text layer as plain digits:
// printed "x 10⁹/l", extracted "x 109/l". Only the exponents labs use.
const EXPONENT = /^\s*[x×*]?\s*10\s*[\^˄*Ee]?\s*(3|6|9|12)(?=\/)/;

const NUMBER_CORE = /^\+?\d[\d\s.,]*$/;
const HAS_LETTER = /\p{L}/u;
const VALUE_MARKERS = ["!", "*", "↑", "↓"]; // out-of-range decoration beside a value

// One-sided bounds, as labs print them: "< 5,00" / "≤ 5,00" / "do 5,0" cap
// the range from above; "> 0,5" / "≥ 0,5" / "nad 0,5" from below. The words
// must be followed by whitespace so "dospělí…" is not read as "do".
const UPPER_BOUND = /^(?:<|≤|do\s)\s*/iu;
const LOWER_BOUND = /^(?:>|≥|nad\s)\s*/iu;
// Both bounds: "a - b" or "a až b", split on the separator between digits, with
// an optional trailing cell the lab printed after the numbers ("7,8 - 12,8 fl").
const TWO_BOUNDS = /^\s*([0-9][0-9\s.,]*?)\s*(?:-|až)\s*([0-9][0-9\s.,]*?)\s*([A-Za-zµμ%‰/(×°][\s\S]*)?$/iu;
// A tail must *start* like a unit, be at most three words, and its first word
// must not be one of these. Two closed Czech/Slovak vocabularies, because they
// are the only tails where the numbers in front are not an interval:
//   "0 - 15 let"      — the numbers are ages, printed in the same column shape
//   "<1,0 negatívne"  — the numbers define a criterion, not a range
// Anything else after the numbers ("muži", "nekuřáci") only names the
// population the interval belongs to, so accepting it costs nothing.
const NOT_A_UNIT: ReadonlySet<string> = new Set([
  "let", "léta", "rok", "roku", "roky", "roků", "rokov", "r",
  "měsíc", "měsíce", "měsíců", "mesiac", "mesiace", "mesiacov", "m",
  "týden", "týdne", "týdny", "týdnů", "týždeň", "týždne", "týždňov", "t",
  "den", "dne", "dny", "dní", "dnů", "deň", "dni", "dňov", "d",
  "hod", "hodin", "hodina", "hodiny", "hodín", "trimestr",
  "negativní", "negativně", "negatívne", "negatívny", "pozitivní",
  "pozitívne", "pozitívny", "hraniční", "hraničné", "reaktivní",
  "nereaktivní", "normální", "patologické", "stopy", "neprovedeno",
  "nevykonané", "přítomny", "přítomen", "nepřítomny", "nález",
]);
// A number followed by the unit the lab printed beside it ("50 ng/ml", "4g/den").
const NUMBER_THEN_TAIL = /^\s*([0-9][0-9\s.,]*?)\s*([A-Za-zµμ%‰/(×°][\s\S]*)$/u;

/** Is this trailing cell the unit, rather than an age band or a criterion? */
function tailIsAUnit(tail: string): boolean {
  const words = tail.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  return !NOT_A_UNIT.has(words[0].replace(/[.,;:)]+$/, "").toLowerCase());
}

/** A bound, whether or not the lab printed its unit in the same cell. */
function numberWithOptionalUnit(raw: string): number | null {
  const n = parseCzechNumber(raw);
  if (n !== null) return n;
  const m = NUMBER_THEN_TAIL.exec(raw);
  if (m && tailIsAUnit(m[2])) return parseCzechNumber(m[1]);
  return null;
}

function applyMicro(s: string): string {
  for (const [bad, good] of MICRO_VARIANTS) s = s.split(bad).join(good);
  return s;
}

/**
 * Parse a Czech-formatted number: comma decimal, space thousands.
 * "5,4" → 5.4 ; "1 234,5" → 1234.5 ; "114" → 114. Non-numbers → null.
 */
export function parseCzechNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  let s = raw.trim();
  if (!s) return null;
  s = applyMicro(s);
  for (const sp of THIN_SPACES) s = s.split(sp).join("");
  s = s.replace(/\s+/g, "");
  if (!NUMBER_CORE.test(s)) return null;
  // Both separators present: "." is the thousands grouping, drop it.
  if (s.includes(",") && s.includes(".")) s = s.split(".").join("");
  s = s.split(",").join(".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Numeric value of a result cell, or null for censored/qualitative cells.
 * Censored ("<1,0") and qualitative ("neprovedeno") deliberately return null —
 * we never invent a number for a trend.
 */
export function parseValue(valueRaw: string | null | undefined): number | null {
  if (valueRaw === null || valueRaw === undefined) return null;
  // Strip lab out-of-range markers ("!", "*", "↑", "↓") — decoration, not the
  // number. A marker alone ("( * )", "H") has no digits left and parses null.
  let s = valueRaw.trim();
  for (const mark of VALUE_MARKERS) s = s.split(mark).join("");
  s = s.trim();
  if (!s) return null;
  if (s.includes("<") || s.includes(">")) return null;
  if (HAS_LETTER.test(s)) return null;
  return parseCzechNumber(s);
}

/**
 * Material codes Czech and Slovak labs print before an analyte name, in the
 * lowercase form `materialPrefix` returns. `s,p` is one code: the lab measured
 * serum or plasma and did not say which (mapping.ts treats it as compatible
 * with either).
 */
export const MATERIAL_CODES: ReadonlySet<string> = new Set([
  "s", "p", "b", "u", "du", "pk", "pe", "fw", "sp", "s,p", "k", "l",
]);

// Underscore is generic — any 1–4 letters (S_, B_, dU_, xxx_). Slash and
// hyphen are allowlisted to MATERIAL_CODES, because a generic
// `^[a-z]{1,4}-` strips "anti-" from anti-TPO and "c-" from C-peptid. Two
// further refusals, both from names labs really print: a digit after the
// separator (S-100 protein, 25-OH vitamin D) is part of the name, and a
// *spaced* hyphen is the abbreviation convention (ALP - alkalická fosfatasa,
// K - draslík), where the letters are the analyte, not the material.
const PREFIX_UNDERSCORE = /^([a-z]{1,4})_/i;
const PREFIX_SEPARATED = /^([a-z]{1,4}(?:,[a-z]{1,4})?)[-/](?=\p{L})/iu;

function matchMaterialPrefix(name: string): { code: string; length: number } | null {
  const u = PREFIX_UNDERSCORE.exec(name);
  if (u) return { code: u[1].toLowerCase(), length: u[0].length };
  const m = PREFIX_SEPARATED.exec(name);
  if (m && MATERIAL_CODES.has(m[1].toLowerCase())) {
    return { code: m[1].toLowerCase(), length: m[0].length };
  }
  return null;
}

/**
 * The material a lab prints before the analyte name: S_ (sérum), B_ (plná
 * krev), P_ (plazma), U_ (moč), dU_ (sbíraná moč), or the same codes before
 * "/" or "-" (S/Sodík, S-Na, S,P-glukóza) — lowercased, or null.
 */
export function materialPrefix(rawName: string | null | undefined): string | null {
  return matchMaterialPrefix((rawName || "").trim())?.code ?? null;
}

/**
 * Mapping a urine result onto a serum analyte is a different test, not a
 * synonym, however similar the names look. `materialPrefix` reads the code;
 * this is the comparison, shared by the mapping suggester and the registry's
 * automatic match. A lab that prints `S,P-` measured serum or plasma and did
 * not say which, so that code is compatible with either — split on the comma
 * and ask whether the two share a material.
 */
export function materialsCompatible(a: string, b: string): boolean {
  const bs = b.split(",");
  return a.split(",").some((x) => bs.includes(x));
}

/**
 * Blood compartments a lab reports the same analyte from. Serum, plasma and
 * whole blood are one family for the *automatic* match: a lab that prints
 * P_Glukóza is measuring the glucose the registry's S_Glukóza means, and
 * refusing it would send every plasma-reporting lab to the mapping tab.
 * Urine and the rest are not blood, and that is the line the match holds.
 * The mapping suggester keeps the stricter materialsCompatible so its
 * "plazma vs sérum" line still shows.
 */
const BLOOD = new Set(["s", "p", "b", "pk", "pe", "sp", "fw", "k"]);

/** Is this material code one of the blood compartments? Unknown is not. */
export const isBloodMaterial = (code: string | null | undefined): boolean =>
  !!code && code.split(",").some((c) => BLOOD.has(c));

export function compartmentCompatible(a: string, b: string): boolean {
  if (materialsCompatible(a, b)) return true;
  const fam = (m: string) => m.split(",").map((x) => (BLOOD.has(x) ? "blood" : x));
  const bf = fam(b);
  return fam(a).some((x) => bf.includes(x));
}

/** The name with its material prefix removed; unchanged when there is none. */
export function stripMaterialPrefix(name: string): string {
  const m = matchMaterialPrefix(name);
  return m ? name.slice(m.length) : name;
}

/**
 * Fold cosmetic unit variants to one form so the same analyte lines up across
 * labs: the micro-sign codepoints (including the ASCII "umol/l" fallback), the
 * "10^9" vs "10˄9" vs flattened-superscript "x 109/l" exponent spellings,
 * spacing around the solidus, and the litre-case. Dimensionless ("-", "") → "".
 */
export function canonicalizeUnit(unitRaw: string | null | undefined): string | null {
  if (unitRaw === null || unitRaw === undefined) return null;
  let s = unitRaw.trim();
  // "1" is the SI spelling of dimensionless, which "-" and "" already fold to:
  // a hematocrit printed as 0,42 with unit 1 is the same 0,42 as one with "-".
  if (s === "" || s === "-" || s === "–" || s === "—" || s === "1") return "";
  s = applyMicro(s);
  s = s.replace(MICRO_ASCII, "µ"); // ASCII fallback umol/l, ug/l → µmol/l, µg/l
  s = s.split("˄").join("^"); // modifier caret ˄ → ^
  s = s.replace(/\s*\/\s*/g, "/"); // "µmol / 24 h" → "µmol/24 h"
  s = s.replace(/\/l\b/gi, "/l"); // litre symbol case
  s = s.replace(EXPONENT, "10^$1"); // x 10⁹/l, 109/l, 10E9/l → 10^9/l
  // The body-surface metre: ml/s/1,73m^2, ml/s/1,73 m2 and ml/s/1,73m2 are one
  // unit, printed three ways. Only after the count exponent above, which is
  // the one "^" that means something else.
  s = s.replace(/m\^([23])\b/g, "m$1");
  s = s.replace(/(\d)(m[23])\b/g, "$1 $2");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export interface ParsedRange {
  low: number | null;
  high: number | null;
  text: string | null;
}

/**
 * Parse a printed reference range into low/high/text. Handles "4,11-5,60",
 * "0,5 až 1,5", "< 5,00", "≤ 5,00", "do 5,0", "> 0,5", "≥ 0,5", "nad 0,5", the
 * same forms carrying the unit the lab printed in the cell ("7,8 - 12,8 fl",
 * "< 50 ng/ml"), and non-numeric ranges ("negativní"). An unparseable range
 * degrades to text rather than being dropped.
 */
export function parseRange(refRaw: string | null | undefined): ParsedRange {
  const none: ParsedRange = { low: null, high: null, text: null };
  if (refRaw === null || refRaw === undefined) return none;
  let s = refRaw.trim().replace(/^[()]+|[()]+$/g, "").trim();
  if (!s) return none;
  for (const d of DASHES) s = s.split(d).join("-");

  // A bound whose remainder is not a number ("<1,0 negatívne") stays text:
  // that is a criterion, not an interval, and we never invent a number.
  const up = UPPER_BOUND.exec(s);
  if (up) {
    const high = numberWithOptionalUnit(s.slice(up[0].length));
    return high !== null ? { low: null, high, text: null } : { low: null, high: null, text: s };
  }
  const lo = LOWER_BOUND.exec(s);
  if (lo) {
    const low = numberWithOptionalUnit(s.slice(lo[0].length));
    return low !== null ? { low, high: null, text: null } : { low: null, high: null, text: s };
  }

  const m = TWO_BOUNDS.exec(s);
  if (m && (m[3] === undefined || tailIsAUnit(m[3]))) {
    const low = parseCzechNumber(m[1]);
    const high = parseCzechNumber(m[2]);
    if (low !== null && high !== null) return { low, high, text: null };
  }

  // Non-numeric (e.g. "negativní") — keep as descriptive text.
  return { low: null, high: null, text: s };
}

/**
 * Recompute normal/low/high/unknown from value vs. parsed range.
 * We never trust the lab's printed flag glyph — this is lab-independent.
 */
export function computeFlag(
  value: number | null,
  low: number | null,
  high: number | null,
): Flag {
  if (value === null) return "unknown";
  if (low === null && high === null) return "unknown";
  if (low !== null && value < low) return "low";
  if (high !== null && value > high) return "high";
  return "normal";
}

/**
 * Fill the derived numeric fields on a measurement, returning a new object.
 *
 * Returning a copy rather than mutating (as the Python does) matters in the
 * UI: correcting a value in the verify tab re-runs this and React needs a new
 * reference to notice.
 */
export function normalizeMeasurement(m: Measurement): Measurement {
  const value = parseValue(m.valueRaw);
  const unit = canonicalizeUnit(m.unitRaw);
  const { low, high, text } = parseRange(m.refRangeRaw);
  const flag = computeFlag(value, low, high);

  // QA: a numeric-looking value that failed to parse is exactly the row the
  // verify UI must surface.
  let confidence: Confidence = m.confidence;
  const vr = m.valueRaw.trim();
  if (value === null && vr && !HAS_LETTER.test(vr) && !vr.includes("<") && !vr.includes(">")) {
    confidence = "low";
  }

  return {
    ...m,
    value,
    unit,
    refRangeLow: low,
    refRangeHigh: high,
    refRangeText: text,
    flag,
    confidence,
  };
}

/** A row needing a human: low confidence, model disagreement, or unparseable. */
export function isFlagged(m: Measurement): boolean {
  return (
    m.confidence === "low" ||
    m.disagreement !== null ||
    (m.value === null && m.valueRaw.trim() !== "" && !HAS_LETTER.test(m.valueRaw))
  );
}
