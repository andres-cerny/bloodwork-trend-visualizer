/**
 * The single authority for "can this reading be trusted".
 *
 * The rule it exists to enforce: a doubt raised anywhere travels all the way
 * to the screen a patient is shown. The bug it replaces was a misread flag
 * reaching the chart while a model disagreement did not, so a trend could be
 * drawn from a value the app had recorded as a coin-flip between two readings.
 */
import { describe, expect, it } from "vitest";
import { makeMeasurement, normalizeMeasurement, needsReview, reviewOf } from "@bw/lab-core";

const GLUCOSE = () => ({ low: 3.9, high: 5.6 });
const noRange = () => null;

const m = (over: Partial<Parameters<typeof makeMeasurement>[0]> = {}) =>
  normalizeMeasurement(
    makeMeasurement({
      rawAnalyteName: "S_Glukóza",
      valueRaw: "5,32",
      unitRaw: "mmol/l",
      refRangeRaw: "(4,11-5,60)",
      ...over,
    }),
  );

describe("tiers", () => {
  it("passes a clean reading", () => {
    const r = reviewOf(m(), GLUCOSE);
    expect(r.level).toBe("ok");
    expect(needsReview(r)).toBe(false);
  });

  it("withholds a probable misread — the value is believed wrong", () => {
    const r = reviewOf(m({ valueRaw: "44,5" }), GLUCOSE);
    expect(r.level).toBe("withheld");
  });

  it("marks a model disagreement as unconfirmed rather than withholding it", () => {
    // The value may well be right; dropping it would hide real data.
    const r = reviewOf(m({ disagreement: "dvě nezávislá čtení se liší: 0,61 / 0,67" }), noRange);
    expect(r.level).toBe("unconfirmed");
  });

  it("puts the two readings in the chip, not just the word 'neshoda'", () => {
    // "neshoda" alone reads as housekeeping and hides the fact that matters.
    const r = reviewOf(m({ disagreement: "dvě nezávislá čtení se liší: 0,61 / 0,67" }), noRange);
    expect(r.chip).toBe("0,61 vs 0,67 — nepotvrzeno");
  });

  it("marks a low-confidence transcription as unconfirmed", () => {
    expect(reviewOf(m({ confidence: "low" }), noRange).level).toBe("unconfirmed");
  });

  it("treats a censored result as ordinary, with no chip at all", () => {
    // "<1,0" is a normal lab result, not a transcription problem. Chipping it
    // put a marker on a row the review filter does not list.
    const r = reviewOf(m({ valueRaw: "<1,0", refRangeRaw: "(1,0-5,0)" }), noRange);
    expect(r.level).toBe("ok");
    expect(r.chip).toBe("");
  });

  it("ranks a misread above a disagreement when both apply", () => {
    const r = reviewOf(
      m({ valueRaw: "44,5", disagreement: "dvě nezávislá čtení se liší: 44,5 / 44,6" }),
      GLUCOSE,
    );
    expect(r.level).toBe("withheld");
  });
});

describe("needsReview drives one consistent worklist", () => {
  it("counts exactly the rows that show a chip", () => {
    // The filter counter and the table chips were computed separately and
    // disagreed, so the checkbox under-counted the worklist it invites you to
    // use. Chips and worklist are now the same set, by construction.
    const rows = [
      m(),
      m({ valueRaw: "44,5" }),
      m({ disagreement: "dvě nezávislá čtení se liší: 1 / 2" }),
      m({ confidence: "low" }),
      m({ valueRaw: "negativní", refRangeRaw: "negativní" }),
    ];
    const reviews = rows.map((x) => reviewOf(x, GLUCOSE));
    expect(reviews.filter(needsReview).length).toBe(3);
    expect(reviews.filter((r) => r.chip !== "").length).toBe(3);
  });
});
