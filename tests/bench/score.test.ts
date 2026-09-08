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

import {
  censoredLostMarker,
  countIntervals,
  isMeasurementRow,
  loadTruthAliases,
  looksCollapsed,
  mergedRows,
  nameFusesTwoTruthRows,
  nameKey,
  pairStats,
  rowMaterialCode,
  scopeExclusion,
  scoreAgainstBaseline,
  splitTruth,
  twoIntervals,
  twoValues,
  valueErrors,
  type TruthAliases,
} from "./score";

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

/**
 * The asymmetry this suite exists to prevent coming back.
 *
 * `valueErrors` folded the lab's printed `!` away; `scoreAgainstBaseline`
 * compared values text-exact. So the same two reads — one keeping the printed
 * marker, as the deployed prompt asks, one dropping it, as `normalize()` does
 * a moment later — scored clean on a photographed page and as 25 "value
 * errors" on the born-digital page beside it, none of which was a disagreement
 * about a number. Both directions are asserted here, on both scorers, because
 * a rule that only holds one way round is the same bug wearing a mirror.
 */
describe("a printed out-of-range marker is not a value disagreement", () => {
  const withMarker = { raw_analyte_name: "S_IGF 1", value_raw: "53,1 !", unit_raw: "µg/l", ref_range_raw: "41,0 - 246,0" };
  const without = { ...withMarker, value_raw: "53,1" };

  it("scoreAgainstBaseline: the arm keeps the marker the baseline dropped", () => {
    const s = scoreAgainstBaseline([without], [withMarker]);
    expect(s.matched).toBe(1);
    expect(s.valueMismatch).toEqual([]);
  });

  it("scoreAgainstBaseline: the arm drops the marker the baseline kept", () => {
    const s = scoreAgainstBaseline([withMarker], [without]);
    expect(s.matched).toBe(1);
    expect(s.valueMismatch).toEqual([]);
  });

  it("valueErrors: both directions, the same answer", () => {
    expect(valueErrors([withMarker], [without]).errors).toEqual([]);
    expect(valueErrors([without], [withMarker]).errors).toEqual([]);
  });

  it("pairStats: two readers that disagree only about the marker confirm the row", () => {
    const p = pairStats([withMarker], [without], [without]);
    expect(p.confirmedRows).toBe(1);
    expect(p.flaggedRows).toBe(0);
    expect(p.uncaughtValueErrors).toEqual([]);
  });

  it("covers every marker normalize() strips, and no more", () => {
    for (const marked of ["53,1 !", "53,1 *", "53,1 ↑", "53,1↓", "! 53,1"]) {
      const s = scoreAgainstBaseline([without], [{ ...withMarker, value_raw: marked }]);
      expect(s.valueMismatch, marked).toEqual([]);
    }
  });

  it("a real digit difference still counts, marker or no marker", () => {
    // The one genuine value error the photo arm has left: 358 read as 359.
    const s = scoreAgainstBaseline([withMarker], [{ ...withMarker, value_raw: "53,2 !" }]);
    expect(s.valueMismatch).toHaveLength(1);
    const t = scoreAgainstBaseline([withMarker], [{ ...withMarker, value_raw: "53,2" }]);
    expect(t.valueMismatch).toHaveLength(1);
    expect(valueErrors([{ ...withMarker, value_raw: "53,2" }], [withMarker]).errors).toHaveLength(1);
  });

  it("does not fold a censor away with the marker", () => {
    const truth = [{ raw_analyte_name: "S_CRP", value_raw: "<1,0" }];
    expect(scoreAgainstBaseline(truth, [{ raw_analyte_name: "S_CRP", value_raw: "1,0 !" }]).valueMismatch).toHaveLength(1);
    expect(scoreAgainstBaseline(truth, [{ raw_analyte_name: "S_CRP", value_raw: "< 1,0 !" }]).valueMismatch).toEqual([]);
  });

  it("censoredLostMarker reads through the marker rather than tripping over it", () => {
    expect(censoredLostMarker("<1,0", "! <1,0")).toBe(false);
    expect(censoredLostMarker("! <1,0", "1,0")).toBe(true);
  });

  it("units and ranges stay text-exact — the marker rule is about values", () => {
    const s = scoreAgainstBaseline([withMarker], [{ ...withMarker, ref_range_raw: "41,0 - 246,0 *", unit_raw: "µg/l *" }]);
    expect(s.rangeMismatch).toHaveLength(1);
    expect(s.unitMismatch).toHaveLength(1);
  });

  it("a value that is nothing but a marker never folds into a blank", () => {
    // AGILAB prints a bare "*" where a panel row's number would be. Emptying it
    // would let it match a reader that returned no value at all.
    const panel = [{ raw_analyte_name: "KO+diferenciál 5p.", value_raw: "*" }];
    const blank = [{ raw_analyte_name: "KO+diferenciál 5p.", value_raw: "" }];
    expect(scoreAgainstBaseline(panel, blank).valueMismatch).toHaveLength(1);
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

describe("isMeasurementRow — a marker row is not a measurement", () => {
  // AGILAB's `KO+diferenciál 5p.` is the panel's name printed in the analyte
  // column with `#` for a value. The text-layer baseline carries it as a row;
  // no reader returns it, and none should.
  it("rejects the bare markers a panel row is printed with", () => {
    for (const v of ["#", "*", "-", "—", "", "   "]) {
      expect(isMeasurementRow({ raw_analyte_name: "KO+diferenciál 5p.", value_raw: v }), JSON.stringify(v)).toBe(false);
    }
    expect(isMeasurementRow({ raw_analyte_name: "x" })).toBe(false);
    expect(isMeasurementRow(undefined)).toBe(false);
  });

  it("keeps every row that carries a result, including a censor, a zero and a qualitative one", () => {
    for (const v of ["5,32", "<1,0", "0", "0,0", "negativní", "málo materiálu", "1,0 pozitívne", "-1,2"]) {
      expect(isMeasurementRow({ raw_analyte_name: "x", value_raw: v }), v).toBe(true);
    }
  });
});

describe("marker rows are excluded from truth, never from the read", () => {
  const truth = [
    { raw_analyte_name: "Leukocyty", value_raw: "6,17" },
    { raw_analyte_name: "KO+diferenciál 5p.", value_raw: "#" },
  ];

  it("does not charge a reader for skipping it", () => {
    const s = valueErrors([truth[0]], truth);
    expect(s.truthRows).toBe(1);
    expect(s.markerRows).toBe(1);
    expect(s.matched).toBe(1);
    expect(s.missing).toEqual([]);
    expect(s.extra).toEqual([]);
  });

  it("still charges a reader that returns it as an extra", () => {
    const s = valueErrors(truth, truth);
    expect(s.truthRows).toBe(1);
    expect(s.extra).toEqual(["KO+diferenciál 5p."]);
  });

  it("keeps it out of the pair's truth as well", () => {
    const read = [truth[0]];
    const s = pairStats(read, read, truth);
    expect(s.confirmedRows).toBe(1);
    expect(s.flaggedRows).toBe(0);
    expect(s.uncaughtValueErrors).toEqual([]);
  });
});

/**
 * The two scorers disagreeing about what a measurement is — the bug, and the
 * two things the fix must not break.
 *
 * `valueErrors` dropped a bare-marker truth row and `pairStats` did not, so
 * two readers that both faithfully returned AGILAB's printed
 * `KO+diferenciál 5p.  #` were recorded as having *invented* a row between
 * them: six UNCAUGHT on `gemini38_ultra+sonnet_vision_dF`, seven carried by
 * `gemini38_tiled+gemini38_ultra` for two days, every one of them
 * `KO+diferenciál 5p. ∅→#`. Fidelity scored as invention.
 *
 * Both functions now read `splitTruth`, so they cannot drift apart again. The
 * exemption is deliberately narrow, and the two tests below are the fence
 * around it: an agreed wrong number on a real measurement is still uncaught,
 * and a name the page does not print at all is still charged.
 */
describe("splitTruth — one rule, read by both scorers", () => {
  const marker = { raw_analyte_name: "KO+diferenciál 5p.", value_raw: "#" };
  const truth = [
    { raw_analyte_name: "Leukocyty", value_raw: "6,17" },
    { raw_analyte_name: "Sodík", value_raw: "141" },
    marker,
  ];

  it("partitions truth into measurements, markers and out-of-scope rows", () => {
    const withUrine = [...truth, { raw_analyte_name: "U_Kreatinin", value_raw: "5,60" }];
    const s = splitTruth(withUrine, nameKey);
    expect(s.measurements.map((t) => t.raw_analyte_name)).toEqual(["Leukocyty", "Sodík"]);
    expect(s.markerRows).toBe(1);
    expect(s.scopeRows).toBe(1);
    expect(s.measurements.length + s.markerRows + s.scopeRows).toBe(withUrine.length);
    expect(s.markers.get(nameKey("KO+diferenciál 5p."))).toBe(1);
  });

  it("both readers returning the printed marker row is fidelity, not invention", () => {
    const read = [truth[0], truth[1], marker];
    const s = pairStats(read, read, truth);
    expect(s.uncaughtValueErrors).toEqual([]);
    // Not a measurement, so not confirmed either — `valueErrors` does not
    // count it in `matched`, and the pair must not count it in `confirmed`.
    expect(s.confirmedRows).toBe(2);
    expect(s.flaggedRows).toBe(0);
    expect(s.markerRows).toBe(1);
  });

  it("still counts an agreed wrong number on a real measurement as uncaught", () => {
    const read = [truth[0], { raw_analyte_name: "Sodík", value_raw: "144" }, marker];
    const s = pairStats(read, read, truth);
    expect(s.uncaughtValueErrors).toEqual([{ name: "Sodík", truth: "141", read: "144" }]);
    expect(s.markerRows).toBe(1);
  });

  it("still counts a row the page does not print as an invention", () => {
    const ghost = { raw_analyte_name: "S_Neexistuje", value_raw: "1,0" };
    const read = [...truth.slice(0, 2), marker, ghost];
    const s = pairStats(read, read, truth);
    expect(s.uncaughtValueErrors).toEqual([{ name: "S_Neexistuje", truth: "", read: "1,0" }]);
    expect(s.markerRows).toBe(1);
  });

  it("the exemption is spent per printed marker row, so a duplicate is still charged", () => {
    // Truth prints the panel line once. A reader returning it twice invented
    // the second one, and the budget runs out rather than forgiving both.
    const read = [truth[0], truth[1], marker, marker];
    const s = pairStats(read, read, truth);
    expect(s.markerRows).toBe(1);
    expect(s.uncaughtValueErrors).toEqual([{ name: "KO+diferenciál 5p.", truth: "", read: "#" }]);
  });
});

/* ------------------------------------------------------ D0: what a row is */

/**
 * docs/plans/lab-adaptability.md, Phase D, D0. Every rule below was seen
 * failing on 2026-09-08 before `scopeExclusion` existed: each of these rows
 * was in the truth, and every reader that (rightly) left it out was charged a
 * miss for it.
 */
describe("D0 scope — material decides, and it is never read off the name", () => {
  const urine = (extra: Record<string, string>) => ({ raw_analyte_name: "Glukóza", value_raw: "negat.", ...extra });

  it("drops a urine row named by its prefix", () => {
    expect(scopeExclusion({ raw_analyte_name: "U_Kreatinin", value_raw: "5,60" })).toBe("material");
    expect(scopeExclusion({ raw_analyte_name: "dU_Kreatinin", value_raw: "12,4" })).toBe("material");
    expect(scopeExclusion({ raw_analyte_name: "U-amyláza", value_raw: "3,15" })).toBe("material");
  });

  it("drops a prefix-free urine row by its Materiál column or its heading", () => {
    expect(scopeExclusion(urine({ material: "moč" }))).toBe("material");
    expect(scopeExclusion(urine({ section: "Moč chemicky + sediment" }))).toBe("material");
    expect(scopeExclusion(urine({ section: "Moč - odpady" }))).toBe("material");
    // `printed_material` is what annotateMaterial reads off the printed page.
    expect(scopeExclusion(urine({ printed_material: "u" }))).toBe("material");
  });

  it("keeps the serum row printed beside it, with the same analyte name", () => {
    expect(scopeExclusion({ raw_analyte_name: "Glukóza", value_raw: "5,10", section: "Metabolity", material: "sérum" })).toBeNull();
    expect(scopeExclusion({ raw_analyte_name: "S_Glukóza", value_raw: "6,00" })).toBeNull();
    expect(scopeExclusion({ raw_analyte_name: "B_Glukóza enzym.", value_raw: "6,00" })).toBeNull();
    expect(scopeExclusion({ raw_analyte_name: "P_Laktát", value_raw: "2,50" })).toBeNull();
  });

  // `xxx_eGF (CKD-EPI)` is five real serum rows in data/reports. Treating an
  // unrecognised prefix as a non-blood material would have dropped them.
  it("ignores a prefix that is not a known material code", () => {
    expect(rowMaterialCode({ raw_analyte_name: "xxx_eGF (CKD-EPI)" })).toBeNull();
    expect(scopeExclusion({ raw_analyte_name: "xxx_eGF (CKD-EPI)", value_raw: "1,49" })).toBeNull();
    expect(scopeExclusion({ raw_analyte_name: "anti-TPO", value_raw: "9,0" })).toBeNull();
    expect(scopeExclusion({ raw_analyte_name: "25-OH vitamin D", value_raw: "80,7" })).toBeNull();
  });

  it("drops a patient's weight and height, and nothing that merely sounds like them", () => {
    expect(scopeExclusion({ raw_analyte_name: "Pt_Hmotnost pacienta", value_raw: "50,0", unit_raw: "kg" })).toBe("anthropometric");
    expect(scopeExclusion({ raw_analyte_name: "Pt_Výška pacienta", value_raw: "150", unit_raw: "cm" })).toBe("anthropometric");
    expect(scopeExclusion({ raw_analyte_name: "Stred.hmot.HGB v RBC [MCH]", value_raw: "30,10" })).toBeNull();
  });

  it("drops a toxicology screen, including the one row of it printed from serum", () => {
    expect(scopeExclusion({ raw_analyte_name: "U_THC", value_raw: "pozitivní", section: "Toxikologie" })).toBe("toxicology");
    expect(scopeExclusion({ raw_analyte_name: "S_Etanol", value_raw: "0,50", section: "Toxikologie" })).toBe("toxicology");
    // The same analyte outside that block is a blood result like any other.
    expect(scopeExclusion({ raw_analyte_name: "S_Etanol", value_raw: "0,50", section: "Speciální metody" })).toBeNull();
  });

  it("drops an auxiliary / POMOCNÉ specimen-handling row", () => {
    expect(scopeExclusion({ raw_analyte_name: "S_Separace séra 1", value_raw: "1", section: "POMOCNÉ", group: "POMOCNÉ" })).toBe("auxiliary");
    expect(scopeExclusion({ raw_analyte_name: "P_Separace séra 2", value_raw: "1" })).toBe("auxiliary");
  });

  // truth_todo.md, 21_10_29.pdf#2: both readers returned nothing for the page
  // and both were right. Receipt vocabulary, no unit, no range.
  it("drops a specimen-receipt row", () => {
    for (const n of ["Krev srážlivá", "Krev nesrážlivá", "Moč"]) {
      expect(scopeExclusion({ raw_analyte_name: n, value_raw: "přijato", unit_raw: "", ref_range_raw: "" }), n).toBe("receipt");
    }
  });

  /**
   * The asymmetry D0 exists to state, tested in both directions: a status is
   * a result when the analyte is in scope, and being a status never puts a row
   * out of scope. Without the first half a vanished TSH looks like a reading
   * failure; without the second half every urine `negat.` would come back.
   */
  it("keeps a blood analyte whose printed result is a status", () => {
    for (const v of ["málo materiálu", "neprovedeno", "negativní", "negat.", "nevyšetřeno"]) {
      expect(scopeExclusion({ raw_analyte_name: "S_TSH", value_raw: v, unit_raw: "", ref_range_raw: "" }), v).toBeNull();
      expect(isMeasurementRow({ raw_analyte_name: "S_TSH", value_raw: v }), v).toBe(true);
    }
  });

  it("drops the same statuses when the material is not blood", () => {
    for (const v of ["málo materiálu", "neprovedeno", "negativní", "negat."]) {
      expect(isMeasurementRow({ raw_analyte_name: "U_Bilirubin", value_raw: v }), v).toBe(false);
      expect(isMeasurementRow({ raw_analyte_name: "Bilirubin", value_raw: v, printed_material: "u" }), v).toBe(false);
    }
  });
});

describe("out-of-scope rows leave the read as well as the truth", () => {
  // Unlike a bare marker: the prompt never tells the model to skip urine —
  // material is deterministic and the model keeps transcribing — so a reader
  // that returns the row must not be charged an extra for obeying.
  const truth = [
    { raw_analyte_name: "S_Glukóza", value_raw: "5,10" },
    { raw_analyte_name: "Glukóza", value_raw: "negat.", printed_material: "u" },
    { raw_analyte_name: "Krev srážlivá", value_raw: "přijato", unit_raw: "", ref_range_raw: "" },
  ];

  it("charges no extra to the reader that transcribed them", () => {
    const s = valueErrors(truth, truth);
    expect(s.truthRows).toBe(1);
    expect(s.scopeRows).toBe(2);
    expect(s.matched).toBe(1);
    expect(s.extra).toEqual([]);
    expect(s.missing).toEqual([]);
  });

  it("charges no miss to the reader that left them out", () => {
    const s = valueErrors([truth[0]], truth);
    expect(s.truthRows).toBe(1);
    expect(s.matched).toBe(1);
    expect(s.missing).toEqual([]);
  });

  it("keeps them out of the pair, so one reader's judgement call is not a flag", () => {
    const s = pairStats(truth, [truth[0]], truth);
    expect(s.confirmedRows).toBe(1);
    expect(s.flaggedRows).toBe(0);
    expect(s.uncaughtValueErrors).toEqual([]);
  });
});

describe("page-specific printed-name aliases", () => {
  // 20_10_6 p1 clips its analyte column: the sheet prints `Vazebná kapacita I`
  // where the text layer the truth came from has `Vazebná kapacita Fe`.
  const PAGE = "20_10_6.pdf#1";
  const aliases: TruthAliases = {
    [PAGE]: {
      "Vazebná kapacita Fe": ["Vazebná kapacita", "Vazebná kapacita I"],
      "Saturace transf.-výp": ["Saturace transf.-vý", "Saturace transf.-výj"],
    },
  };
  const truth = [
    { raw_analyte_name: "Vazebná kapacita Fe", value_raw: "69,6" },
    { raw_analyte_name: "Saturace transf.-výp", value_raw: "34,1" },
  ];
  const clipped = [
    { raw_analyte_name: "Vazebná kapacita I", value_raw: "69,6" },
    { raw_analyte_name: "Saturace transf.-vý", value_raw: "34,1" },
  ];

  it("matches the printed spelling on the keyed page", () => {
    const s = valueErrors(clipped, truth, { pageKey: PAGE, aliases });
    expect(s.matched).toBe(2);
    expect(s.missing).toEqual([]);
    expect(s.extra).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("is a miss without the alias — the rule is what makes it match, not the loose key", () => {
    const s = valueErrors(clipped, truth);
    expect(s.matched).toBe(0);
    expect(s.missing).toHaveLength(2);
    expect(s.extra).toHaveLength(2);
  });

  it("never applies to another page, which prints the same names in full", () => {
    const s = valueErrors(clipped, truth, { pageKey: "2022_07_01.pdf#1", aliases });
    expect(s.missing).toHaveLength(2);
    expect(s.extra).toHaveLength(2);
  });

  it("leaves the full printed name matching on the aliased page too", () => {
    const s = valueErrors(truth, truth, { pageKey: PAGE, aliases });
    expect(s.matched).toBe(2);
    expect(s.errors).toEqual([]);
  });

  it("does not fold two different analytes together", () => {
    const other = [{ raw_analyte_name: "Transferin", value_raw: "2,72" }];
    const s = valueErrors(other, truth, { pageKey: PAGE, aliases });
    expect(s.matched).toBe(0);
    expect(s.extra).toEqual(["Transferin"]);
  });

  it("confirms a pair that spelled the clipped name two ways with the same value", () => {
    const opus = [{ raw_analyte_name: "Vazebná kapacita", value_raw: "69,6" }];
    const sonnet = [{ raw_analyte_name: "Vazebná kapacita I", value_raw: "69,6" }];
    const s = pairStats(opus, sonnet, [truth[0]], { pageKey: PAGE, aliases });
    expect(s.confirmedRows).toBe(1);
    expect(s.flaggedRows).toBe(0);
    expect(s.uncaughtValueErrors).toEqual([]);
  });

  it("still reports a real disagreement on an aliased row", () => {
    const opus = [{ raw_analyte_name: "Vazebná kapacita", value_raw: "69,6" }];
    const sonnet = [{ raw_analyte_name: "Vazebná kapacita I", value_raw: "68,6" }];
    const s = pairStats(opus, sonnet, [truth[0]], { pageKey: PAGE, aliases });
    expect(s.confirmedRows).toBe(0);
    expect(s.flaggedRows).toBe(1);
    expect(s.caughtValueErrors).toBe(1);
  });

  it("ships the 20_10_6 page in truth_aliases.json, and no _about pseudo-page", () => {
    const table = loadTruthAliases();
    expect(Object.keys(table)).toEqual([PAGE]);
    expect(table[PAGE]["Vazebná kapacita Fe"]).toContain("Vazebná kapacita I");
  });
});

describe("mergedRows — the Docling class: two printed rows fused into one record", () => {
  // The exact records docs/extraction-speed.md records under "A7, Docling —
  // the layout-parser family, properly tested". They are what disqualified a
  // layout parser from this project, and no existing column catches them:
  // both numbers in the range are printed, so `fabrications` is clean, and
  // neither value is wrong, so `valueErrors` is clean too.
  const truth = [
    { raw_analyte_name: "Glukóza", value_raw: "5,32", ref_range_raw: "3,6 - 5,6" },
    { raw_analyte_name: "Cholesterol", value_raw: "4,80", ref_range_raw: "2,9 - 5,0" },
    { raw_analyte_name: "Monocyty", value_raw: "6,4", ref_range_raw: "2,0 - 12,0" },
    { raw_analyte_name: "Eozinofily", value_raw: "1,1", ref_range_raw: "0,0 - 5,0" },
  ];

  it("catches Docling's `Glukóza Cholesterol` with both intervals concatenated", () => {
    const read = [{ raw_analyte_name: "Glukóza Cholesterol", value_raw: "5,32", ref_range_raw: "3,6 - 5,6 2,9 - 5,0" }];
    const [row] = mergedRows(read, truth);
    expect(row.name).toBe("Glukóza Cholesterol");
    expect(row.reasons).toContain("range");
    expect(row.reasons).toContain("name");
  });

  it("catches Docling's `Monocyty Eozinofily` the same way", () => {
    const read = [{ raw_analyte_name: "Monocyty Eozinofily", value_raw: "6,4", ref_range_raw: "2,0 - 12,0 0,0 - 5,0" }];
    const [row] = mergedRows(read, truth);
    expect(row.reasons).toEqual(expect.arrayContaining(["range", "name"]));
  });

  it("catches a fused row by its two values even when the range is clean", () => {
    const read = [{ raw_analyte_name: "Glukóza Cholesterol", value_raw: "5,32 4,80", ref_range_raw: "3,6 - 5,6" }];
    const [row] = mergedRows(read, truth);
    expect(row.reasons).toContain("value");
  });

  it("reports one entry per fused row, listing every rule that fired", () => {
    const read = [
      { raw_analyte_name: "Glukóza Cholesterol", value_raw: "5,32 4,80", ref_range_raw: "3,6 - 5,6 2,9 - 5,0" },
      { raw_analyte_name: "Monocyty", value_raw: "6,4", ref_range_raw: "2,0 - 12,0" },
    ];
    const rows = mergedRows(read, truth);
    expect(rows).toHaveLength(1);
    expect(rows[0].reasons.sort()).toEqual(["name", "range", "value"]);
  });

  it("stays silent on a correctly read page", () => {
    expect(mergedRows(truth, truth)).toEqual([]);
  });

  it("cannot fire the name rule without truth, and still catches the range", () => {
    const read = [{ raw_analyte_name: "Glukóza Cholesterol", value_raw: "5,32", ref_range_raw: "3,6 - 5,6 2,9 - 5,0" }];
    expect(mergedRows(read).map((r) => r.reasons)).toEqual([["range"]]);
    expect(mergedRows(read, [])).toHaveLength(1);
  });
});

describe("twoIntervals — rule 1, and the boundary with looksCollapsed", () => {
  it("fires on two complete intervals, however they are spaced", () => {
    expect(twoIntervals("3,6 - 5,6 2,9 - 5,0")).toBe(true);
    expect(twoIntervals("2,0 - 12,0 0,0 - 5,0")).toBe(true);
    expect(twoIntervals("( 2,5000 - 6,4000 ) ( 3,4000 - 17,1000 )")).toBe(true);
    expect(twoIntervals("137-145 3,80-5,20")).toBe(true);
  });

  it("does not fire on one interval, however it is printed", () => {
    for (const ok of ["3,6 - 5,6", "4,11-5,60", "( 2,5000 - 6,4000 )", "0,00 – 3,50", "2,5 až 6,4", "do 5,0", "", undefined]) {
      expect(twoIntervals(ok), String(ok)).toBe(false);
    }
  });

  it("leaves the collapsed-separator fault to looksCollapsed, and is not covered by it in return", () => {
    // `4,11-5,60` read back as `4,115,60` is one corrupted interval, not two:
    // only looksCollapsed sees it, and this rule must not claim it.
    expect(twoIntervals("4,115,60")).toBe(false);
    expect(looksCollapsed("4,115,60")).toBe(true);
    // The reverse overlap is real and worth stating: looksCollapsed squashes
    // whitespace, so `3,6 - 5,6 2,9 - 5,0` also trips it — but it reports a
    // corrupted separator, which is the wrong diagnosis and the wrong repair.
    // Only this rule says "two intervals, so two printed rows".
    expect(twoIntervals("3,6 - 5,6 2,9 - 5,0")).toBe(true);
    // And a merged range whose halves are integers trips nothing else at all,
    // which is why the merge needs its own column.
    expect(looksCollapsed("137-145 97-108")).toBe(false);
    expect(twoIntervals("137-145 97-108")).toBe(true);
  });

  it("counts intervals rather than dashes", () => {
    expect(countIntervals("3,6 - 5,6")).toBe(1);
    expect(countIntervals("3,6 - 5,6 2,9 - 5,0")).toBe(2);
    expect(countIntervals("negativní")).toBe(0);
  });
});

describe("twoValues — rule 2, and the false positives it must not have", () => {
  it("fires when one cell carries two printed numbers", () => {
    expect(twoValues("5,32 4,80")).toBe(true);
    expect(twoValues("0,527 2,900")).toBe(true);
    expect(twoValues("6,4 1,1")).toBe(true);
  });

  it("reads a Czech thousands group as one number", () => {
    for (const ok of ["10 000", "2 900", "1 234 567"]) {
      expect(twoValues(ok), ok).toBe(false);
    }
  });

  it("leaves a censor, the lab's markers and a qualifier alone", () => {
    for (const ok of ["<1,0", "> 140", "0,93 !", "1,0 pozitívne", "0,4 negatívne", "<1,0 negatívne", "málo materiálu", "141", "", undefined]) {
      expect(twoValues(ok), String(ok)).toBe(false);
    }
  });

  it("does not fire on a printed date, or on a range that landed in the value column", () => {
    expect(twoValues("21.05.2024")).toBe(false);
    expect(twoValues("3.6.2025")).toBe(false);
    expect(twoValues("3,9 - 5,6")).toBe(false);
  });
});

describe("nameFusesTwoTruthRows — rule 3, checked against this page's own truth", () => {
  const truth = [
    { raw_analyte_name: "Glukóza", value_raw: "5,32" },
    { raw_analyte_name: "Cholesterol", value_raw: "4,80" },
    { raw_analyte_name: "Vazebná kapacita Fe", value_raw: "69,6" },
  ];

  it("fires only when both halves are separate truth rows on the page", () => {
    expect(nameFusesTwoTruthRows("Glukóza Cholesterol", truth, nameKey)).toBe(true);
    expect(nameFusesTwoTruthRows("Cholesterol Glukóza", truth, nameKey)).toBe(true);
  });

  it("never fires on a multi-word analyte the page really prints", () => {
    expect(nameFusesTwoTruthRows("Vazebná kapacita Fe", truth, nameKey)).toBe(false);
    // Even if one half were a truth row, the whole name being a truth row wins.
    expect(nameFusesTwoTruthRows("Glukóza", truth, nameKey)).toBe(false);
  });

  it("does not fire when only one half is a truth row", () => {
    expect(nameFusesTwoTruthRows("Glukóza nalačno", truth, nameKey)).toBe(false);
    expect(nameFusesTwoTruthRows("S_Neexistuje Cholesterol", truth, nameKey)).toBe(false);
  });

  it("ignores a marker row in truth, which is not a measurement to be fused with", () => {
    const withMarker = [...truth, { raw_analyte_name: "KO+diferenciál 5p.", value_raw: "#" }];
    expect(nameFusesTwoTruthRows("Glukóza KO+diferenciál 5p.", withMarker, nameKey)).toBe(false);
  });

  it("goes through the page's aliases, like every other match in this file", () => {
    const PAGE = "20_10_6.pdf#1";
    const aliases: TruthAliases = { [PAGE]: { "Vazebná kapacita Fe": ["Vazebná kapacita I"] } };
    const page = [
      { raw_analyte_name: "Glukóza", value_raw: "5,32" },
      { raw_analyte_name: "Vazebná kapacita Fe", value_raw: "69,6" },
    ];
    const read = [{ raw_analyte_name: "Glukóza Vazebná kapacita I", value_raw: "5,32", ref_range_raw: "" }];
    expect(mergedRows(read, page, { pageKey: PAGE, aliases })).toHaveLength(1);
  });
});
