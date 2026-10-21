/**
 * The cross-check, round 2 of docs/plans/model-loop.md (H1–H5).
 *
 * Before this, two reads were compared on the value string alone: a unit or
 * reference range the primary got wrong passed with any second reader, and
 * every high/low flag came from the primary's range. The opposite fault also
 * held: "<1,0" and "< 1,0" were two readings, and two names for one printed
 * row ("URE urea" / "urea") became two rows, each "seen by one reader".
 */
import { describe, expect, it } from "vitest";
import {
  isPrintedOnRow,
  leadingCodeKey,
  reconcile,
  reviewOf,
  Registry,
  RANGE_DIFFERS,
  UNIT_DIFFERS,
  type RawRead,
  type TextRow,
} from "@bw/lab-core";

const row = (name: string, value: string, unit = "mmol/l", ref = "3,9 - 5,6", row_index?: number) => ({
  raw_analyte_name: name,
  value_raw: value,
  unit_raw: unit,
  ref_range_raw: ref,
  confidence: "high" as const,
  ...(row_index === undefined ? {} : { row_index }),
});
const a = (rows: any[]): RawRead => ({ model: "claude-sonnet-5-5", measurements: rows });
const b = (rows: any[]): RawRead => ({ model: "claude-haiku-5-5", measurements: rows });
const noCurated = () => null;

describe("unit and range are cross-checked too (H1)", () => {
  it("a unit only the primary has is a disagreement, not the primary's word", () => {
    const [m] = reconcile([a([row("S_Kreatinin", "80", "mmol/l")]), b([row("S_Kreatinin", "80", "µmol/l")])]);
    expect(m.disagreement).toBe(UNIT_DIFFERS);
    expect(reviewOf(m, noCurated).level).toBe("unconfirmed");
  });

  it("spellings of one unit agree (canonicalizeUnit folds them)", () => {
    const [m] = reconcile([a([row("B_Leukocyty", "6,2", "10^9/l")]), b([row("B_Leukocyty", "6,2", "10˄9/l")])]);
    expect(m.disagreement).toBeNull();
  });

  it("a different printed interval is a disagreement — it decides the flag", () => {
    const [m] = reconcile([a([row("S_Glukóza", "5,8", "mmol/l", "3,9 - 6,5")]), b([row("S_Glukóza", "5,8", "mmol/l", "3,9 - 5,6")])]);
    expect(m.disagreement).toBe(RANGE_DIFFERS);
  });

  it("the same interval written two ways agrees", () => {
    const [m] = reconcile([a([row("S_Glukóza", "5,1", "mmol/l", "(3,9 - 5,6)")]), b([row("S_Glukóza", "5,1", "mmol/l", "3,9-5,6")])]);
    expect(m.disagreement).toBeNull();
  });

  it("a value disagreement still wins over a unit one: the numbers are what to check", () => {
    const [m] = reconcile([a([row("S_Na", "141", "mmol/l")]), b([row("S_Na", "147", "µmol/l")])]);
    expect(m.disagreement).toContain("141");
    expect(m.disagreement).toContain("147");
  });
});

describe("formatting is not a second reading (H4)", () => {
  it.each([
    ["<1,0", "< 1,0"],
    ["negativní", "Negativní"],
    ["0,87 !", "0,87"],
    ["1,2 ↑", "1,2"],
  ])("%s and %s agree", (x, y) => {
    const [m] = reconcile([a([row("S_CRP", x, "mg/l", "")]), b([row("S_CRP", y, "mg/l", "")])]);
    expect(m.disagreement).toBeNull();
  });

  it("but a different censor or digit is still a disagreement", () => {
    const [m] = reconcile([a([row("S_CRP", "<1,0", "mg/l", "")]), b([row("S_CRP", ">1,0", "mg/l", "")])]);
    expect(m.disagreement).not.toBeNull();
  });
});

describe("two names for one printed row are one row (H5)", () => {
  it("text path: the same row_index pairs reads whose names differ", () => {
    const out = reconcile([
      a([row("B_Neutrofily %", "52,7", "%", "45 - 70", 7)]),
      b([row("B_Neutrofily - relativně", "52,7", "%", "45 - 70", 7)]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].disagreement).toBeNull();
    expect(out[0].rawAnalyteName).toBe("B_Neutrofily %");
  });

  it("image path: a glued abbreviation pairs on value and unit when it is unambiguous", () => {
    const out = reconcile([
      a([row("urea", "4,9000", "mmol/l", "( 2,8 - 8,1 )"), row("kreatinin", "86,0000", "µmol/l", "( 64 - 104 )")]),
      b([row("URE urea", "4,9000", "mmol/l", "( 2,8 - 8,1 )"), row("KRE * kreatinin", "86,0000", "µmol/l", "( 64 - 104 )")]),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((m) => m.disagreement === null)).toBe(true);
  });

  it("does not pair on value when two unpaired rows share it", () => {
    const out = reconcile([
      a([row("Glukóza X", "5,1"), row("Urea X", "5,1")]),
      b([row("Glukóza Y", "5,1"), row("Urea Y", "5,1")]),
    ]);
    expect(out).toHaveLength(4);
  });

  it("a shared row_index with different values is one row with two readings", () => {
    const out = reconcile([a([row("S_Kyselina močová", "396", "µmol/l", "", 3)]), b([row("S_Kyselina možná", "398", "µmol/l", "", 3)])]);
    expect(out).toHaveLength(1);
    expect(out[0].disagreement).toContain("396");
  });
});

describe("agreement lowers doubt (H2)", () => {
  // ALT 1,2 µkat/l against 0,1-0,78: a tenth of it lands in range, so the
  // decimal check withheld it. Two independent readers read 1,2.
  const alt = (reads: RawRead[]) => reconcile(reads)[0];
  const curated = () => ({ low: 0.1, high: 0.78 });

  it("one reader alone: still withheld as a possible decimal slip", () => {
    const m = alt([a([row("S_ALT", "1,2", "µkat/l", "")])]);
    expect(reviewOf(m, curated).level).toBe("withheld");
  });

  it("two readers agreeing: plotted, marked, not withheld", () => {
    const m = alt([a([row("S_ALT", "1,2", "µkat/l", "")]), b([row("S_ALT", "1,2", "µkat/l", "")])]);
    const r = reviewOf(m, curated);
    expect(r.level).toBe("unconfirmed");
  });

  it("an impossible value stays withheld even when both readers agree", () => {
    const m = alt([a([row("S_ALT", "1200", "µkat/l", "")]), b([row("S_ALT", "1200", "µkat/l", "")])]);
    expect(reviewOf(m, curated).level).toBe("withheld");
  });
});

describe("printed on its own row, as a whole cell (H3)", () => {
  const box: [number, number, number, number] = [0, 0, 1, 1];
  const row = (cells: string[]): TextRow => ({ cells, cellBoxes: cells.map(() => box), box });
  const rows = [
    row(["S_Glukóza", "5,45", "mmol/l", "3,9 - 5,6"]),
    row(["S_CRP", "<", "1,0", "mg/l"]),
    row(["S_ALT", "0,93 !", "µkat/l"]),
  ];
  it("a dropped digit is not printed, though it is a substring", () => {
    expect(isPrintedOnRow("5,4", rows, 0)).toBe(false);
    expect(isPrintedOnRow("5,45", rows, 0)).toBe(true);
  });
  it("a cell split by the PDF still counts", () => {
    expect(isPrintedOnRow("<1,0", rows, 1)).toBe(true);
  });
  it("the lab's marker may be dropped or kept", () => {
    expect(isPrintedOnRow("0,93", rows, 2)).toBe(true);
    expect(isPrintedOnRow("0,93 !", rows, 2)).toBe(true);
  });
  it("another row's value is not this row's", () => {
    expect(isPrintedOnRow("5,45", rows, 1)).toBe(false);
    expect(isPrintedOnRow("5,45", rows, undefined)).toBe(false);
  });
});

describe("a leading code glued onto the name (abbreviation column)", () => {
  it.each([
    ["URE urea", "urea"],
    ["KM * kyselina močová", "kyselina mocova"],
    ["ALT * alaninaminotransferáza", "alaninaminotransferaza"],
    ["GGT gama-glutamyltransferáza", "gama glutamyltransferaza"],
  ])("%s → %s", (name, key) => expect(leadingCodeKey(name)).toBe(key));

  it.each([["HDL cholesterol"], ["LDL cholesterol"], ["S_Glukóza"], ["TSH"], ["urea"], ["Glukóza"]])("%s has none", (name) =>
    expect(leadingCodeKey(name)).toBeNull(),
  );

  it("the registry finds the long name behind the code, after the full key", () => {
    const reg = new Registry([
      { canonicalId: "urea", displayNameCs: "Urea", synonyms: ["S_Urea", "urea"], canonicalUnit: "mmol/l", unitConversions: {} } as any,
      { canonicalId: "hdl", displayNameCs: "HDL cholesterol", synonyms: ["S_HDL cholesterol"], canonicalUnit: "mmol/l", unitConversions: {} } as any,
      { canonicalId: "cholesterol", displayNameCs: "Cholesterol", synonyms: ["S_Cholesterol"], canonicalUnit: "mmol/l", unitConversions: {} } as any,
    ]);
    expect(reg.match("URE urea")).toBe("urea");
    expect(reg.match("HDL cholesterol")).toBe("hdl");
  });

  it("a code whose letter does not start the name counts only when both name one entry", () => {
    const reg = new Registry([
      { canonicalId: "zelezo", displayNameCs: "Železo", synonyms: ["S_Železo", "Fe"], canonicalUnit: "µmol/l", unitConversions: {} } as any,
      { canonicalId: "hdl", displayNameCs: "HDL cholesterol", synonyms: ["HDL"], canonicalUnit: "mmol/l", unitConversions: {} } as any,
      { canonicalId: "cholesterol", displayNameCs: "Cholesterol", synonyms: ["S_Cholesterol"], canonicalUnit: "mmol/l", unitConversions: {} } as any,
    ]);
    expect(reg.match("FE železo")).toBe("zelezo");
    expect(reg.match("XYZ železo")).toBeNull(); // unknown code
    expect(reg.match("HDL Cholesterol LDL")).toBeNull(); // code and name disagree
  });
});

describe("a punctate is not blood", () => {
  it("X_glukóza does not map onto the blood glucose entry", () => {
    const reg = new Registry([
      { canonicalId: "glukoza", displayNameCs: "Glukóza", synonyms: ["S_Glukóza", "Glukóza"], canonicalUnit: "mmol/l", unitConversions: {} } as any,
    ]);
    expect(reg.match("S_Glukóza")).toBe("glukoza");
    expect(reg.match("X_glukóza")).toBeNull();
  });
});
