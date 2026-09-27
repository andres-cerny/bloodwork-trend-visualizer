/**
 * One place that decides whether a reading can be trusted, and why.
 *
 * The rule this exists to enforce: a doubt raised anywhere must travel all the
 * way to the screen a patient is shown. Previously the misread check reached
 * the chart and the other two flags did not, so a trend line could be drawn
 * from a value the app had recorded as a coin-flip between two readings —
 * with nothing on that screen to say so.
 *
 * There are two tiers, because the two kinds of doubt are not the same:
 *
 *   withheld    — the value is probably *wrong* (a decimal read in the wrong
 *                 place). Plotting it would draw a number we believe to be
 *                 false, so it is kept out of the series until resolved.
 *   unconfirmed — the value may well be *right*, but nothing has confirmed it:
 *                 two reads disagreed, or the reader reported low confidence.
 *                 Dropping it would hide real data, so it is plotted and
 *                 marked.
 */
import type { Measurement } from "./models";
import { checkImplausible } from "./implausible";
import { parseValue } from "./normalize";

export type ReviewLevel = "ok" | "unconfirmed" | "withheld";

export interface Review {
  level: ReviewLevel;
  /** Short label for a table chip. */
  chip: string;
  /** Full sentence for the verification pane and the trend card. */
  reason: string;
}

const OK: Review = { level: "ok", chip: "", reason: "" };

export function reviewOf(
  m: Measurement,
  /**
   * The curated interval, in the analyte's canonical unit. Given the
   * reading's unit too, so a caller can refuse to answer for a reading in
   * another unit — comparing 150 mg/dl of triglycerides with 0,45–1,7
   * mmol/l would call a normal value impossible.
   */
  curatedRange: (canonicalId: string | null, unit?: string | null) => { low: number; high: number } | null,
): Review {
  // The report's date is in doubt: the value may be right, the day it is
  // drawn on may not be — so it is plotted, hollow, and named. Before the
  // confirmation below, which vouches for the value and not for the date.
  if (m.reportDateDoubt) {
    return { level: "unconfirmed", chip: "ověřit datum", reason: `${m.reportDateDoubt} Datum doplníte nebo potvrdíte v záložce Ověření.` };
  }
  // A human vouched for this exact value against the printed page. That
  // answers every kind of doubt below at once — an implausibility check
  // recomputed from the value would otherwise reopen the question on every
  // render, which is why confirmation is a stored fact and not a same-value
  // correction.
  if (m.confirmed) return OK;

  // A result the lab printed as text ("negativní", "málo materiálu", an
  // index), taken from the page's own text layer rather than from a reader:
  // it is exactly what the page says, and has no number to misread. It was
  // marked low-confidence to surface it, and so asked for a check on every
  // row of every report (2026-09-27, 36 of one account's 87 asks).
  if (m.extractedBy === "printed-row" && m.value === null) return OK;

  const range =
    curatedRange(m.canonicalId, m.unit) ??
    (m.refRangeLow !== null && m.refRangeHigh !== null
      ? { low: m.refRangeLow, high: m.refRangeHigh }
      : null);

  // Two things rule a misread out, and without them the check asked about
  // every value moderately outside a wide range — a CK at twice its upper
  // limit divides by ten into the range, so it read as a slipped decimal:
  //   - the value sits inside the interval printed beside it: the lab's own
  //     range holds it, so it is not a slip of an in-range value (and a
  //     curated interval an order of magnitude off — trombokrit — cannot
  //     overrule the page);
  //   - the value is the text of its own printed row (a born-digital PDF's
  //     text layer, checked against the page at upload): it was copied, not
  //     transcribed from pixels, and a copy does not move a decimal point.
  const implausible = insidePrinted(m) || printedOnPage(m) ? null : checkImplausible(m, range);
  if (implausible) {
    return {
      level: "withheld",
      chip: implausible.level === "impossible" ? "nemožná hodnota" : "ověřit desetinnou čárku",
      // The value is believed wrong, so the way out named first is the
      // correction.
      reason: `${implausible.reason} ${ASK_CORRECT_OR_CONFIRM}`,
    };
  }

  // Two readings that differ only in decoration — "0,87 !" and "0,87", the
  // lab's out-of-range mark copied by one reader and not the other — agree.
  if (m.disagreement && !sameReadings(m.disagreement)) {
    return {
      // The chip carries the readings themselves. "neshoda" alone reads as a
      // housekeeping note and hides the one fact that matters — which two
      // numbers are in play.
      level: "unconfirmed",
      chip: disagreementChip(m.disagreement),
      reason: disagreementReason(m.disagreement),
    };
  }

  if (m.confidence === "low") {
    // Low confidence and an uncorroborated row ask the same thing of the
    // reader, so they share the sentence (`disagreementReason` without
    // readings). The cause is different only inside the app.
    return { level: "unconfirmed", chip: CHIP_UNSURE, reason: UNSURE_REASON };
  }

  // A printed result that is not a number — "negativní", "stopy", "<1,0" — is
  // an ordinary lab result and carries no chip at all. Chips and the review
  // worklist are deliberately the same set: a chip on a row the filter does
  // not list, or a listed row showing no chip, both leave the reader unable to
  // tell what is being asked of them.
  return OK;
}

/**
 * The sentences a reader sees are for a person who does not know, and need
 * not know, that a page is read twice (Ondrej, 2026-09-19). Nothing here may
 * say how the app arrived at its doubt — no readings, no models, no
 * confidence — only what the reader is asked to do: compare the value with
 * the highlighted row on the page and either confirm it or correct it. The
 * stored `disagreement` keeps the cause, for the bench and the logs.
 */
const CHIP_UNSURE = "ověřit hodnotu";
const COMPARE = "Porovnejte ji s vyznačeným řádkem na stránce níže";
const ASK_CONFIRM_OR_CORRECT = `${COMPARE} a potvrďte ji, nebo ji opravte.`;
const ASK_CORRECT_OR_CONFIRM = `${COMPARE} a opravte ji, nebo ji potvrďte.`;
const UNSURE_REASON = `Touto hodnotou si nejsme jistí. ${ASK_CONFIRM_OR_CORRECT}`;

/**
 * The readings, if the stored fact carries them:
 * "dvě nezávislá čtení se liší: 0,61 / 0,67" → ["0,61", "0,67"]. A fact
 * without a colon ("druhé čtení se nezdařilo") has none.
 */
function readingsOf(disagreement: string): string[] {
  const m = /:\s*(.+)$/.exec(disagreement);
  if (!m) return [];
  return m[1].split("/").map((s) => s.trim()).filter(Boolean);
}

/** "dvě nezávislá čtení se liší: 0,61 / 0,67" → "0,61 nebo 0,67 — ověřit". */
function disagreementChip(disagreement: string): string {
  const parts = readingsOf(disagreement);
  return parts.length >= 2 ? `${joinNebo(parts)} — ověřit` : CHIP_UNSURE;
}

/** ["a", "b", "c"] → "a, b nebo c". */
function joinNebo(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} nebo ${parts[parts.length - 1]}`;
}

/**
 * The sentence beside the correction field. It opens with the ask and, when
 * two numbers are in play, offers both — they are what to look for on the
 * page — without saying where they came from. A row only one reader saw, or
 * a page read once, gets the plain sentence: the reader's job is the same.
 */
function disagreementReason(disagreement: string): string {
  const parts = readingsOf(disagreement);
  if (parts.length < 2) return UNSURE_REASON;
  return `Touto hodnotou si nejsme jistí — mohlo by tam být ${joinNebo(parts)}. ${ASK_CONFIRM_OR_CORRECT}`;
}

/** Rows a reviewer must look at. Matches exactly what the table chips show. */
export function needsReview(r: Review): boolean {
  return r.level !== "ok";
}

/** Inside the interval printed on the report, where one was printed. */
function insidePrinted(m: Pick<Measurement, "value" | "refRangeLow" | "refRangeHigh">): boolean {
  if (m.value === null || (m.refRangeLow === null && m.refRangeHigh === null)) return false;
  return (m.refRangeLow === null || m.value >= m.refRangeLow) && (m.refRangeHigh === null || m.value <= m.refRangeHigh);
}

/**
 * The value is its printed row's own text. Set at upload for every row
 * (`printedOnPage`); a row stored before that is judged the way the upload
 * judged it — on the text path (it has a row box) and its value is a token
 * of its row's text. A scan's or photo's snippet is the reader's, never
 * trusted here: those rows carry `printedOnPage: false`, or no box.
 */
function printedOnPage(m: Pick<Measurement, "printedOnPage" | "bbox" | "sourceSnippet" | "valueRaw">): boolean {
  if (m.printedOnPage !== undefined) return m.printedOnPage === true;
  if (!m.bbox || !m.sourceSnippet) return false;
  const clean = (s: string) => s.replace(/[!*↑↓]/g, " ").trim();
  const value = clean(m.valueRaw).replace(/\s+/g, " ");
  if (!value) return false;
  return ` ${clean(m.sourceSnippet).replace(/\s+/g, " ")} `.includes(` ${value} `);
}

/** Every reading in a stored disagreement is the same number. */
function sameReadings(disagreement: string): boolean {
  const parts = readingsOf(disagreement).map((p) => parseValue(p));
  return parts.length >= 2 && parts.every((v) => v !== null && v === parts[0]);
}
