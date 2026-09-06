/**
 * The deterministic completeness checks for a single-reader text path.
 *
 * Each case is a row shape from the real corpus that a first version of the
 * rule got wrong: a unit split across cells, a lab code before the name, a
 * name that starts with a digit, a qualitative result spread over cells, an
 * accreditation flag in the first column. The fixtures are synthetic; the
 * shapes are not.
 */
import { describe, expect, it } from "vitest";
import {
  candidateRows,
  nameFromRow,
  nameOnRow,
  repairRowIndex,
  unclaimedRows,
  type Box,
  type TextRow,
} from "@bw/lab-core";

const row = (cells: string[], y = 0): TextRow => ({
  cells,
  cellBoxes: cells.map((c, i) => [50 + i * 100, y, 50 + i * 100 + c.length * 6, y + 10] as Box),
  box: [50, y, 700, y + 10],
});

describe("candidateRows", () => {
  it("finds a plain measurement row and skips headers, dates and patient lines", () => {
    const rows = [
      row(["Pacient :", "Novák Jan", "Žadatel :", "Ambulance"]),
      row(["Datum a čas odběru:", "1. 7. 2022 8:55:00"]),
      row(["A", "Výkon", "Název metody", "Hodnocení", "Ref.meze", "Rozměr"]),
      row(["S_Glukóza", "5,4", "mmol/l", "3,9 - 5,6"]),
    ];
    expect(candidateRows(rows).map((c) => c.index)).toEqual([3]);
  });

  it("sees a unit printed as several cells, and a range printed as three", () => {
    const rows = [
      row(["WBS leukocyty", "5,00", "10", "˄", "9/l", "4,00", "-", "10,00", "(X)"]),
      row(["HCT hematokrit", "0,468", "0,38", "-", "0,52", "(X)"]),
    ];
    expect(candidateRows(rows).map((c) => c.kind)).toEqual(["numeric", "numeric"]);
  });

  it("looks past an accreditation flag and a lab code, and accepts a name that starts with a digit", () => {
    const rows = [
      row(["A", "81383", "LD", "3,33", "|", "|*|", "|", "3,50 - 7,00", "μkat/l"]),
      row(["81681", "25-OH vitamin D", "80,7", "|", "|*|", "|", "75,0 - 200,0", "nmol/l"]),
      row(["odhad GF (CKD-EPI)", "ml/s/1.73m2", "1,61", "|", "|*|", "> 1,00"]),
    ];
    const found = candidateRows(rows);
    expect(found.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(found.map((c) => c.name)).toEqual(["LD", "25-OH vitamin D", "odhad GF (CKD-EPI)"]);
  });

  it("finds qualitative results spread over cells, with the printed result", () => {
    const rows = [
      row(["S_Kyselina", "listová", "málo", "materiálu"]),
      row(["S_T4", "volný", "málo", "materiálu"]),
      row(["Hemolýza-index", "negat."]),
      row(["96167", "KO+diferenciál 5p.", "#"]),
    ];
    const found = candidateRows(rows);
    expect(found.map((c) => [c.index, c.kind, c.result])).toEqual([
      [0, "qualitative", "málo materiálu"],
      [1, "qualitative", "málo materiálu"],
      [2, "qualitative", "negat."],
    ]);
    expect(found[0].name).toBe("S_Kyselina listová");
  });
});

describe("nameFromRow", () => {
  const rows = [
    row(["A", "81365", "Bílkovina celková", "66,4", "|", "|*|", "|", "65,0 - 85,0", "g/l"]),
    row(["KOSTI", "25-hydroxyvitamin D", "30,7", "ng/ml", "30,0", "-", "100"]),
    row(["#", "B_Hemoglobin [HGB]", "g/l", "165", "|", "|*|", "135 - 175"]),
    row(["S_IGF", "1", "245", "µg/l", "(96,4-227,8)"]),
    row(["S_Vitamin", "D", "celkový", "71", "nmol/l"]),
  ];
  it("drops the flag, the code, a section label, a marker and a unit before the value", () => {
    expect(nameFromRow(rows, 0, "66,4")).toBe("Bílkovina celková");
    expect(nameFromRow(rows, 1, "30,7")).toBe("25-hydroxyvitamin D");
    expect(nameFromRow(rows, 2, "165")).toBe("B_Hemoglobin [HGB]");
  });
  it("uses the value to tell where a name with a digit ends", () => {
    expect(nameFromRow(rows, 3, "245")).toBe("S_IGF 1");
    expect(nameFromRow(rows, 4, "71")).toBe("S_Vitamin D celkový");
  });
  it("is loose about accents and punctuation when asked whether a name is on a row", () => {
    expect(nameOnRow("Bilkovina celkova", rows, 0)).toBe(true);
    expect(nameOnRow("S_Kyselina možná", rows, 0)).toBe(false);
    expect(nameOnRow("x", rows, 99)).toBe(false);
  });
});

describe("repairRowIndex", () => {
  const rows = [
    row(["Biochemie - sérum"]),
    row(["Bílkovina celková", "69,8", "g/l", "65,0 - 85,0"]),
    row(["Bilirubin celkový", "11", "μmol/l", "< 17"]),
    row(["ALT", "0,42", "μkat/l", "< 0,78"]),
  ];
  it("keeps an index whose row carries the value", () => {
    expect(repairRowIndex("11", "Bilirubin celkový", 2, rows)).toEqual({ index: 2, repaired: false, broken: false });
  });
  it("moves a drifted index to the neighbour that carries the value and the name", () => {
    // Reintroduces the fault: a whole page numbered one too high.
    expect(repairRowIndex("69,8", "Bílkovina celková", 2, rows)).toEqual({ index: 1, repaired: true, broken: false });
    expect(repairRowIndex("0,42", "ALT", 4, rows)).toEqual({ index: 3, repaired: true, broken: false });
  });
  it("does not jump to a row that carries the value under a different name", () => {
    // "11" is printed on row 2 only; the name "ALT" is not there.
    expect(repairRowIndex("11", "ALT", 3, rows).broken).toBe(true);
  });
  it("leaves a read without an index alone", () => {
    expect(repairRowIndex("11", "x", undefined, rows)).toEqual({ index: undefined, repaired: false, broken: false });
  });
});

describe("unclaimedRows", () => {
  it("lists the candidate rows nobody pointed at", () => {
    const rows = [
      row(["S_Glukóza", "5,4", "mmol/l", "3,9 - 5,6"]),
      row(["S_Urea", "6,1", "mmol/l", "2,8 - 8,0"]),
      row(["S_TSH", "málo", "materiálu"]),
    ];
    const left = unclaimedRows(rows, [0, undefined]);
    expect(left.map((c) => [c.index, c.kind])).toEqual([
      [1, "numeric"],
      [2, "qualitative"],
    ]);
  });
});
