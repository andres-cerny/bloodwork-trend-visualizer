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
  curatedRange: (canonicalId: string | null) => { low: number; high: number } | null,
): Review {
  const range =
    curatedRange(m.canonicalId) ??
    (m.refRangeLow !== null && m.refRangeHigh !== null
      ? { low: m.refRangeLow, high: m.refRangeHigh }
      : null);

  const implausible = checkImplausible(m, range);
  if (implausible) {
    return {
      level: "withheld",
      chip: implausible.level === "impossible" ? "nemožná hodnota" : "ověřit desetinnou čárku",
      reason: implausible.reason,
    };
  }

  if (m.disagreement) {
    return {
      // The chip carries the readings themselves. "neshoda" alone reads as a
      // housekeeping note and hides the one fact that matters — which two
      // numbers are in play.
      level: "unconfirmed",
      chip: disagreementChip(m.disagreement),
      reason: m.disagreement,
    };
  }

  if (m.confidence === "low") {
    return {
      level: "unconfirmed",
      chip: "nejisté čtení",
      reason:
        "Přepis tohoto řádku byl označen jako nejistý — na stránce je špatně " +
        "čitelný nebo nejednoznačný. Ověřte ho prosím proti dokumentu.",
    };
  }

  // A printed result that is not a number — "negativní", "stopy", "<1,0" — is
  // an ordinary lab result and carries no chip at all. Chips and the review
  // worklist are deliberately the same set: a chip on a row the filter does
  // not list, or a listed row showing no chip, both leave the reader unable to
  // tell what is being asked of them.
  return OK;
}

/** "dvě nezávislá čtení se liší: 0,61 / 0,67" → "0,61 vs 0,67 — nepotvrzeno". */
function disagreementChip(disagreement: string): string {
  const m = /:\s*(.+)$/.exec(disagreement);
  if (!m) return "nepotvrzeno";
  const parts = m[1].split("/").map((s) => s.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[0]} vs ${parts[1]} — nepotvrzeno` : "nepotvrzeno";
}

/** Rows a reviewer must look at. Matches exactly what the table chips show. */
export function needsReview(r: Review): boolean {
  return r.level !== "ok";
}
