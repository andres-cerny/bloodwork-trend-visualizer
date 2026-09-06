/**
 * The range-integrity guard, proven by reintroducing the original fault.
 *
 * A check that has never been seen to fire is not a check. `docs/` records a
 * real defect — a reference range printed `4,11-5,60` read back as `4,115,60`,
 * a plausible wrong number rather than a failure — so that exact string is fed
 * in here and must be caught. If this file ever goes green because the guard
 * stopped detecting anything, the sweep would report clean accuracy on a
 * corrupted range.
 *
 * Runs in the normal `npm test`, not in the benchmark: it costs nothing and it
 * is the reason the benchmark's accuracy column can be believed.
 */
import { describe, expect, it } from "vitest";

import { censoredLostMarker, looksCollapsed, nameKey, pairStats, scoreAgainstBaseline, valueErrors } from "./score";

describe("looksCollapsed — the hyphen-loss class", () => {
  it("catches the exact defect from docs: 4,11-5,60 read back as 4,115,60", () => {
    expect(looksCollapsed("4,115,60")).toBe(true);
  });

  it("catches it with the whitespace pdf.js sometimes leaves behind", () => {
    expect(looksCollapsed("4,115, 60")).toBe(true);
    expect(looksCollapsed("0,003,50")).toBe(true);
  });

  it("does not fire on a correctly separated range", () => {
    for (const ok of ["4,11 - 5,60", "4,11-5,60", "0,00 – 3,50", "3,9 - 5,6"]) {
      expect(looksCollapsed(ok), ok).toBe(false);
    }
  });

  it("does not fire on ordinary single values or one-sided ranges", () => {
    for (const ok of ["5,32", "<1,0", "> 140", "", undefined, "do 5,0"]) {
      expect(looksCollapsed(ok), String(ok)).toBe(false);
    }
  });

  it("does not fire on a thousands separator, which is a different shape", () => {
    // "10 000" and "1.234" are not two decimals fused together.
    expect(looksCollapsed("10 000")).toBe(false);
    expect(looksCollapsed("140")).toBe(false);
  });
});

describe("censoredLostMarker — a censored value must not become a number", () => {
  it("fires when '<' is dropped", () => {
    expect(censoredLostMarker("<1,0", "1,0")).toBe(true);
    expect(censoredLostMarker(">140", "140")).toBe(true);
  });

  it("stays quiet when the marker survives", () => {
    expect(censoredLostMarker("<1,0", "<1,0")).toBe(false);
    expect(censoredLostMarker("5,32", "5,32")).toBe(false);
  });
});

describe("nameKey — lines the same printed row up across two reads", () => {
  it("folds case, diacritics and punctuation", () => {
    expect(nameKey("S_Glukóza")).toBe(nameKey("s glukoza"));
    expect(nameKey("WBS leukocyty")).toBe(nameKey("wbs-leukocyty"));
  });

  it("keeps genuinely different analytes apart", () => {
    expect(nameKey("S_Glukóza")).not.toBe(nameKey("S_Cholesterol"));
  });
});

describe("scoreAgainstBaseline", () => {
  const baseline = [
    { raw_analyte_name: "S_Glukóza", value_raw: "5,32", unit_raw: "mmol/l", ref_range_raw: "3,9 - 5,6" },
    { raw_analyte_name: "S_CRP", value_raw: "<1,0", unit_raw: "mg/l", ref_range_raw: "0,0 - 5,0" },
  ];

  it("reports a clean match as clean", () => {
    const s = scoreAgainstBaseline(baseline, baseline);
    expect(s.matched).toBe(2);
    expect(s.missing).toEqual([]);
    expect(s.extra).toEqual([]);
    expect(s.valueMismatch).toEqual([]);
  });

  it("ignores whitespace but never the decimal comma", () => {
    const arm = [
      { ...baseline[0], ref_range_raw: "3,9-5,6" }, // whitespace only
      { ...baseline[1], value_raw: "<1.0" }, // comma -> dot is a real change
    ];
    const s = scoreAgainstBaseline(baseline, arm);
    expect(s.rangeMismatch).toEqual([]);
    expect(s.valueMismatch).toHaveLength(1);
    expect(s.valueMismatch[0].name).toBe("S_CRP");
  });

  it("separates a dropped row from a hallucinated one", () => {
    const arm = [baseline[0], { raw_analyte_name: "S_Neexistuje", value_raw: "1,0" }];
    const s = scoreAgainstBaseline(baseline, arm);
    expect(s.missing).toEqual(["S_CRP"]);
    expect(s.extra).toEqual(["S_Neexistuje"]);
  });
});

describe("duplicate analyte names — the differential-count page", () => {
  // A real lab page prints B_Neutrofily twice: once as a fraction and once as
  // an absolute count, on two separate printed rows. Keying by name alone
  // dropped one of them and charged every arm a phantom disagreement.
  const baseline = [
    { raw_analyte_name: "B_Neutrofily", value_raw: "0,527", unit_raw: "-", ref_range_raw: "0,450-0,700" },
    { raw_analyte_name: "B_Neutrofily", value_raw: "2,900", unit_raw: "10^9/l", ref_range_raw: "2,000-7,000" },
  ];

  it("matches both occurrences instead of collapsing them", () => {
    const s = scoreAgainstBaseline(baseline, baseline);
    expect(s.matched).toBe(2);
    expect(s.valueMismatch).toEqual([]);
    expect(s.missing).toEqual([]);
    expect(s.extra).toEqual([]);
  });

  it("pairs occurrences in printed order, not arbitrarily", () => {
    const swapped = [baseline[1], baseline[0]];
    const s = scoreAgainstBaseline(baseline, swapped);
    // Both rows are present but in the other order, so both values disagree —
    // which is a real finding, not a silent match.
    expect(s.matched).toBe(2);
    expect(s.valueMismatch).toHaveLength(2);
  });

  it("counts an unreturned duplicate as missing, not as a match", () => {
    const s = scoreAgainstBaseline(baseline, [baseline[0]]);
    expect(s.matched).toBe(1);
    expect(s.missing).toEqual(["B_Neutrofily"]);
  });
});

describe("valueErrors — column 2 for image classes, against hand-verified truth", () => {
  const truth = [
    { raw_analyte_name: "S_Glukóza", value_raw: "5,32", unit_raw: "mmol/l" },
    { raw_analyte_name: "S_ALT", value_raw: "0,93 !", unit_raw: "µkat/l" },
    { raw_analyte_name: "S_CRP", value_raw: "<1,0", unit_raw: "mg/l" },
  ];

  it("reports a verbatim read as clean", () => {
    const s = valueErrors(truth, truth);
    expect(s.matched).toBe(3);
    expect(s.errors).toEqual([]);
    expect(s.missing).toEqual([]);
    expect(s.extra).toEqual([]);
  });

  it("ignores whitespace and the lab's !/* markers, never the decimal comma or a censor", () => {
    const read = [
      { raw_analyte_name: "S_Glukóza", value_raw: "5.32" }, // comma -> dot: a wrong number
      { raw_analyte_name: "S_ALT", value_raw: "0,93" }, // marker dropped: normalize() drops it too
      { raw_analyte_name: "S_CRP", value_raw: "1,0" }, // decensored: a wrong number
    ];
    const s = valueErrors(read, truth);
    expect(s.matched).toBe(3);
    expect(s.errors.map((e) => e.name)).toEqual(["S_Glukóza", "S_CRP"]);
  });

  it("separates a missed row from an invented one", () => {
    const read = [truth[0], { raw_analyte_name: "S_Neexistuje", value_raw: "1,0" }];
    const s = valueErrors(read, truth);
    expect(s.missing).toEqual(["S_ALT", "S_CRP"]);
    expect(s.extra).toEqual(["S_Neexistuje"]);
    expect(s.errors).toEqual([]);
  });

  it("pairs a duplicated analyte by value first, so order does not create errors", () => {
    const diff = [
      { raw_analyte_name: "B_Neutrofily", value_raw: "0,527" },
      { raw_analyte_name: "B_Neutrofily", value_raw: "2,900" },
    ];
    const s = valueErrors([diff[1], diff[0]], diff);
    expect(s.matched).toBe(2);
    expect(s.errors).toEqual([]);
  });
});

describe("pairStats — two numbers for a reader pair, never merged", () => {
  const truth = [
    { raw_analyte_name: "S_Glukóza", value_raw: "5,32" },
    { raw_analyte_name: "S_Sodík", value_raw: "141" },
    { raw_analyte_name: "S_CRP", value_raw: "<1,0" },
  ];

  it("confirms rows both readers agree on, and counts an agreed wrong value as uncaught", () => {
    const a = [truth[0], { raw_analyte_name: "S_Sodík", value_raw: "144" }, truth[2]];
    const b = [truth[0], { raw_analyte_name: "S_Sodík", value_raw: "144" }, truth[2]];
    const s = pairStats(a, b, truth);
    expect(s.singleReader).toBe(false);
    expect(s.confirmedRows).toBe(3);
    expect(s.flaggedRows).toBe(0);
    // Both misread 141 as 144 the same way: the pair let it through.
    expect(s.uncaughtValueErrors).toEqual([{ name: "S_Sodík", truth: "141", read: "144" }]);
  });

  it("flags a disagreement and a row only one reader found, and credits the flag when a read was wrong", () => {
    const a = [truth[0], { raw_analyte_name: "S_Sodík", value_raw: "144" }, truth[2]];
    const b = [truth[0], truth[1]]; // CRP missing on this side
    const s = pairStats(a, b, truth);
    expect(s.confirmedRows).toBe(1);
    expect(s.flaggedRows).toBe(2);
    expect(s.uncaughtValueErrors).toEqual([]);
    expect(s.caughtValueErrors).toBe(1); // the 144
  });

  it("counts a row both readers invented as uncaught, with an empty truth", () => {
    const ghost = { raw_analyte_name: "S_Neexistuje", value_raw: "1,0" };
    const s = pairStats([...truth, ghost], [...truth, ghost], truth);
    expect(s.uncaughtValueErrors).toEqual([{ name: "S_Neexistuje", truth: "", read: "1,0" }]);
  });

  it("the silent-single-reader rule: one read missing flags every row and confirms none", () => {
    const only = [truth[0], { raw_analyte_name: "S_Sodík", value_raw: "144" }, truth[2]];
    for (const [a, b] of [
      [only, null],
      [null, only],
    ] as const) {
      const s = pairStats(a, b, truth);
      expect(s.singleReader).toBe(true);
      expect(s.flaggedRows).toBe(only.length);
      expect(s.confirmedRows).toBe(0);
      expect(s.uncaughtValueErrors).toEqual([]);
      // The surviving read's own error is still visible, per shot.
      expect(s.singleReaderErrors).toEqual([{ name: "S_Sodík", truth: "141", read: "144" }]);
    }
  });

  it("both reads missing is a single-reader case with nothing to flag", () => {
    const s = pairStats(null, null, truth);
    expect(s.singleReader).toBe(true);
    expect(s.flaggedRows).toBe(0);
    expect(s.confirmedRows).toBe(0);
  });
});
