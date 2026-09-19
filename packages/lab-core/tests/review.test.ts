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
    expect(r.chip).toBe("0,61 nebo 0,67 — ověřit");
  });

  it("opens the reason with the doubt, offers both numbers, and names the two ways out", () => {
    // Shown bare above the input, the stored fact said what the program had
    // noticed and not what was wanted of the reader.
    const r = reviewOf(m({ disagreement: "dvě nezávislá čtení se liší: 0,61 / 0,67" }), noRange);
    expect(r.reason).toBe(
      "Touto hodnotou si nejsme jistí — mohlo by tam být 0,61 nebo 0,67. " +
        "Porovnejte ji s vyznačeným řádkem na stránce níže a potvrďte ji, nebo ji opravte.",
    );
  });

  it("gives a page read once, a row seen once and a low-confidence row the same plain sentence", () => {
    // The cause differs only inside the app; what the reader must do is the
    // same, so the sentence is the same and says nothing about readings.
    const plain =
      "Touto hodnotou si nejsme jistí. " +
      "Porovnejte ji s vyznačeným řádkem na stránce níže a potvrďte ji, nebo ji opravte.";
    for (const over of [
      { disagreement: "druhé čtení se nezdařilo" },
      { disagreement: "řádek našlo jen jedno ze dvou čtení" },
      { confidence: "low" as const },
    ]) {
      const r = reviewOf(m(over), noRange);
      expect(r.level).toBe("unconfirmed");
      expect(r.chip).toBe("ověřit hodnotu");
      expect(r.reason).toBe(plain);
    }
  });

  it("names the correction first when the value is believed wrong", () => {
    const r = reviewOf(m({ valueRaw: "532" }), GLUCOSE);
    expect(r.level).toBe("withheld");
    expect(r.reason).toBe(
      "Hodnota 532 u tohoto parametru není možná — vypadá to na posunutou desetinnou " +
        "čárku a na stránce je nejspíš 5,32. " +
        "Porovnejte ji s vyznačeným řádkem na stránce níže a opravte ji, nebo ji potvrďte.",
    );
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

describe("the sentences are for a person who does not know the page is read twice", () => {
  // Ondrej, 2026-09-19: a lay reader does not know there are two readings
  // and does not care. Every variant — and the chips beside them — must say
  // what the reader needs and nothing about how the app got there.
  const variants = [
    m({ disagreement: "dvě nezávislá čtení se liší: 0,61 / 0,67" }),
    m({ disagreement: "dvě nezávislá čtení se liší: 1 / 2 / 3" }),
    m({ disagreement: "druhé čtení se nezdařilo" }),
    m({ disagreement: "řádek našlo jen jedno ze dvou čtení" }),
    m({ confidence: "low" }),
    m({ valueRaw: "532" }),
    m({ valueRaw: "99999" }),
    m({ valueRaw: "44,5" }),
  ];

  it("never mentions readings, models, confidence or 'nepotvrzeno'", () => {
    for (const x of variants) {
      const r = reviewOf(x, GLUCOSE);
      expect(r.level).not.toBe("ok");
      for (const text of [r.chip, r.reason]) {
        expect(text).not.toMatch(/čtení|model|nepotvrzen|přepis|jistot|nejist[ýé] čtení/i);
        expect(text).not.toContain("!");
      }
    }
  });

  it("ends every reason with the same two ways out", () => {
    for (const x of variants) {
      expect(reviewOf(x, GLUCOSE).reason).toMatch(
        /Porovnejte ji s vyznačeným řádkem na stránce níže a (potvrďte ji, nebo ji opravte|opravte ji, nebo ji potvrďte)\.$/,
      );
    }
  });

  it("lists three readings as 'a, b nebo c'", () => {
    const r = reviewOf(m({ disagreement: "dvě nezávislá čtení se liší: 1 / 2 / 3" }), noRange);
    expect(r.chip).toBe("1, 2 nebo 3 — ověřit");
    expect(r.reason).toContain("mohlo by tam být 1, 2 nebo 3.");
  });
});

describe("confirmation answers every kind of doubt at once", () => {
  it("clears a probable misread once a human vouched for the value", () => {
    // The implausibility check is recomputed from the value on every render,
    // so only a stored fact can settle it — a same-value "correction" cannot.
    const r = reviewOf(m({ valueRaw: "44,5", confirmed: true }), GLUCOSE);
    expect(r.level).toBe("ok");
    expect(r.chip).toBe("");
  });

  it("clears a disagreement and a low-confidence read the same way", () => {
    const disagreed = m({
      disagreement: "dvě nezávislá čtení se liší: 0,61 / 0,67",
      confirmed: true,
    });
    expect(reviewOf(disagreed, noRange).level).toBe("ok");
    expect(reviewOf(m({ confidence: "low", confirmed: true }), noRange).level).toBe("ok");
  });

  it("changes nothing for an unconfirmed measurement", () => {
    expect(reviewOf(m({ valueRaw: "44,5", confirmed: false }), GLUCOSE).level).toBe("withheld");
    expect(reviewOf(m({ valueRaw: "44,5" }), GLUCOSE).level).toBe("withheld");
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
