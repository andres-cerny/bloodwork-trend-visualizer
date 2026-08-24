/**
 * Czech numeral agreement in the step summaries a doctor actually reads.
 *
 * Every phrase is checked at 0, 1, 2, 4, 5 and a large number, because the
 * boundaries are the whole rule: 1 takes the singular, 2–4 the nominative
 * plural, and 0 together with 5 and up the genitive plural. A single form for
 * all of them — which is what these strings had — is right at exactly one of
 * those six counts.
 *
 * The animate/inanimate split is pinned deliberately: "2 pacienti" against
 * "2 odběry" is the pair that a one-size rule would collapse, and collapsing
 * it is the regression this file exists to catch.
 */
import { describe, expect, it } from "vitest";
import {
  analytesListed,
  derivedComputed,
  documentsListed,
  documentsMatched,
  drawsCompared,
  patientsInCohort,
  patientsInDirectory,
} from "../src/summaries";

describe("pacient — masculine animate", () => {
  it("takes -i in the 2–4 form, not -y", () => {
    expect(patientsInDirectory(0)).toBe("0 pacientů v kartotéce");
    expect(patientsInDirectory(1)).toBe("1 pacient v kartotéce");
    expect(patientsInDirectory(2)).toBe("2 pacienti v kartotéce");
    expect(patientsInDirectory(4)).toBe("4 pacienti v kartotéce");
    expect(patientsInDirectory(5)).toBe("5 pacientů v kartotéce");
    expect(patientsInDirectory(137)).toBe("137 pacientů v kartotéce");
  });

  it("says the same about a cohort", () => {
    expect(patientsInCohort(0)).toBe("0 pacientů ve výběru");
    expect(patientsInCohort(1)).toBe("1 pacient ve výběru");
    expect(patientsInCohort(2)).toBe("2 pacienti ve výběru");
    expect(patientsInCohort(4)).toBe("4 pacienti ve výběru");
    expect(patientsInCohort(5)).toBe("5 pacientů ve výběru");
    expect(patientsInCohort(41)).toBe("41 pacientů ve výběru");
  });

  it("carries no verb, so nothing has to agree with the subject", () => {
    // "nalezeno" is neuter singular and cannot stand over "2 pacienti"; the
    // phrase is a bare noun phrase precisely so that question never arises.
    for (const n of [0, 1, 2, 4, 5, 137]) {
      expect(patientsInDirectory(n)).not.toMatch(/nalezen/);
      expect(patientsInCohort(n)).not.toMatch(/nalezen/);
    }
  });
});

describe("dokument — masculine inanimate", () => {
  it("takes -y in the 2–4 form, not -i", () => {
    expect(documentsListed(0)).toBe("vypsal 0 dokumentů");
    expect(documentsListed(1)).toBe("vypsal 1 dokument");
    expect(documentsListed(2)).toBe("vypsal 2 dokumenty");
    expect(documentsListed(4)).toBe("vypsal 4 dokumenty");
    expect(documentsListed(5)).toBe("vypsal 5 dokumentů");
    expect(documentsListed(23)).toBe("vypsal 23 dokumentů");
  });

  it("goes into the locative after a preposition, and vocalises v to ve for 2–4", () => {
    expect(documentsMatched(0)).toBe("nalezeno v 0 dokumentech");
    expect(documentsMatched(1)).toBe("nalezeno v 1 dokumentu");
    expect(documentsMatched(2)).toBe("nalezeno ve 2 dokumentech");
    expect(documentsMatched(4)).toBe("nalezeno ve 4 dokumentech");
    expect(documentsMatched(5)).toBe("nalezeno v 5 dokumentech");
    expect(documentsMatched(10)).toBe("nalezeno v 10 dokumentech");
  });
});

describe("parametr — masculine inanimate", () => {
  it("agrees at every boundary", () => {
    expect(analytesListed(0)).toBe("vypsal 0 parametrů");
    expect(analytesListed(1)).toBe("vypsal 1 parametr");
    expect(analytesListed(2)).toBe("vypsal 2 parametry");
    expect(analytesListed(4)).toBe("vypsal 4 parametry");
    expect(analytesListed(5)).toBe("vypsal 5 parametrů");
    expect(analytesListed(13)).toBe("vypsal 13 parametrů");
  });
});

describe("odběr — masculine inanimate", () => {
  it("agrees at every boundary", () => {
    expect(drawsCompared(0)).toBe("porovnal 0 odběrů");
    expect(drawsCompared(1)).toBe("porovnal 1 odběr");
    expect(drawsCompared(2)).toBe("porovnal 2 odběry");
    expect(drawsCompared(4)).toBe("porovnal 4 odběry");
    expect(drawsCompared(5)).toBe("porovnal 5 odběrů");
    expect(drawsCompared(10)).toBe("porovnal 10 odběrů");
  });
});

describe("odvozená hodnota — feminine, in the accusative the verb governs", () => {
  it("agrees at every boundary, adjective included", () => {
    expect(derivedComputed(0)).toBe("spočítal 0 odvozených hodnot");
    expect(derivedComputed(1)).toBe("spočítal 1 odvozenou hodnotu");
    expect(derivedComputed(2)).toBe("spočítal 2 odvozené hodnoty");
    expect(derivedComputed(4)).toBe("spočítal 4 odvozené hodnoty");
    expect(derivedComputed(5)).toBe("spočítal 5 odvozených hodnot");
    expect(derivedComputed(12)).toBe("spočítal 12 odvozených hodnot");
  });
});

describe("the genitive plural is not the answer to everything", () => {
  it("no phrase reads as the old one-form string at 1, 2 or 4", () => {
    // The bug, stated as a test: every summary used the 5+ form always.
    const wrong = [
      ...[1, 2, 4].map(patientsInDirectory),
      ...[1, 2, 4].map(patientsInCohort),
      ...[1, 2, 4].map(documentsListed),
      ...[1, 2, 4].map(analytesListed),
      ...[1, 2, 4].map(drawsCompared),
      ...[1, 2, 4].map(derivedComputed),
    ];
    for (const s of wrong) {
      expect(s).not.toMatch(/\d+ (pacientů|dokumentů|parametrů|odběrů|odvozených hodnot)\b/);
    }
  });
});
