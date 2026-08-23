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

const NUMBER_CORE = /^\+?\d[\d\s.,]*$/;
const HAS_LETTER = /\p{L}/u;

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
  // Strip lab out-of-range markers ("!", "*") — decoration, not the number.
  const s = valueRaw.trim().split("!").join("").split("*").join("").trim();
  if (!s) return null;
  if (s.includes("<") || s.includes(">")) return null;
  if (HAS_LETTER.test(s)) return null;
  return parseCzechNumber(s);
}

/**
 * Fold cosmetic unit variants to one form so the same analyte lines up across
 * labs. Dimensionless markers ("-", "") → "".
 */
export function canonicalizeUnit(unitRaw: string | null | undefined): string | null {
  if (unitRaw === null || unitRaw === undefined) return null;
  let s = unitRaw.trim();
  if (s === "" || s === "-" || s === "–" || s === "—") return "";
  s = applyMicro(s);
  s = s.split("˄").join("^"); // modifier caret ˄ → ^
  s = s.replace(/\/l\b/gi, "/l"); // litre symbol case
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
 * "< 5,00", "> 0,5" and non-numeric ranges ("negativní"). An unparseable range
 * degrades to text rather than being dropped.
 */
export function parseRange(refRaw: string | null | undefined): ParsedRange {
  const none: ParsedRange = { low: null, high: null, text: null };
  if (refRaw === null || refRaw === undefined) return none;
  let s = refRaw.trim().replace(/^[()]+|[()]+$/g, "").trim();
  if (!s) return none;
  for (const d of DASHES) s = s.split(d).join("-");

  if (s.startsWith("<")) {
    const high = parseCzechNumber(s.slice(1));
    return high !== null ? { low: null, high, text: null } : { low: null, high: null, text: s };
  }
  if (s.startsWith(">")) {
    const low = parseCzechNumber(s.slice(1));
    return low !== null ? { low, high: null, text: null } : { low: null, high: null, text: s };
  }

  // a - b (both bounds): split on the first hyphen sitting between digits.
  const m = /^\s*([0-9][0-9\s.,]*?)\s*-\s*([0-9][0-9\s.,]*)\s*$/.exec(s);
  if (m) {
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
