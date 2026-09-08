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

// ---------------------------------------------------------------------------
// Phase B5 — the conventions zkr_column.pdf and slovak_grouped.pdf print.
// ---------------------------------------------------------------------------

// Guard seen failing 2026-09-06: "URE | urea" named the row "URE urea" and
// "KM | kyselina močová" named it "KM kyselina močová"; the Anti CMV row was
// not a candidate at all because "<1,0 negatívne" starts with a bound; and
// "nevykonané" / "nedostatok materiálu" were not qualitative results.
describe("candidateRows on an abbreviation column with four-decimal values (zkr_column.pdf shape)", () => {
  const rows = [
    row(["Zkr.", "Vyšetření", "Výsl.", "Text.výsl.", "Jedn.", "Referenční hodnoty", "Kontrola I.stupně", "Uvolnil"]),
    row(["URE", "urea", "4,9000", "mmol/l", "( 2,5000 - 6,4000 )", "kontr1", "uvoln1"]),
    row(["KREA", "kreatinin", "78,0000", "µmol/l", "( 44,0000 - 80,0000 )", "kontr1", "uvoln1"]),
    row(["KM", "kyselina močová", "396,0000", "H", "µmol/l", "( 150,0000 - 350,0000 )", "kontr1", "uvoln1"]),
    row(["GLU", "glukóza", "5,1000", "mmol/l", "( 3,9000 - 5,6000 )", "kontr1", "uvoln1"]),
    row(["TRFSAT", "saturace transferinu", "0,2800", ".", "1", "( 0,2000 - 0,4500 )", "kontr1", "uvoln1"]),
  ];

  it("finds every measurement row as numeric and skips the header", () => {
    const found = candidateRows(rows);
    expect(found.map((c) => [c.index, c.kind])).toEqual([
      [1, "numeric"],
      [2, "numeric"],
      [3, "numeric"],
      [4, "numeric"],
      [5, "numeric"],
    ]);
  });

  it("names the row by the word after the abbreviation, not by the abbreviation", () => {
    expect(candidateRows(rows).map((c) => c.name)).toEqual([
      "urea",
      "kreatinin",
      "kyselina močová",
      "glukóza",
      "saturace transferinu",
    ]);
    expect(nameFromRow(rows, 1, "4,9000")).toBe("urea");
    expect(nameFromRow(rows, 3, "396,0000")).toBe("kyselina močová");
  });

  it("keeps an all-caps cell that is the name itself", () => {
    // Followed by a number, not by a lowercase name: LD and TSH are the names.
    const own = [row(["LD", "3,33", "µkat/l", "3,50 - 7,00"]), row(["TSH", "2,15", "0,27–4,20", "mIU/l", "sérum"])];
    expect(candidateRows(own).map((c) => c.name)).toEqual(["LD", "TSH"]);
  });
});

describe("candidateRows on a Slovak sheet with a Materiál column (slovak_grouped.pdf shape)", () => {
  const rows = [
    row(["Test", "Výsledok", "Hodnotiace kritériá", "Jednotky", "Materiál", "Schválil"]),
    row(["Základná hematológia - Krvný obraz"]),
    row(["Leukocyty [WBC]", "6,90", "3,80–10,70", "10^9/l", "krv EDTA"]),
    row(["Erytrocyty [RBC]", "4,85", "4,20–5,80", "10^12/l", "krv EDTA"]),
    row(["Metabolity"]),
    row(["Glukóza", "5,10", "3,90–5,60", "mmol/l", "sérum"]),
    row(["Kyselina močová", "430", "202–417", "µmol/l", "sérum"]),
    row(["Anti CMV IgM (skríning)", "<1,0 negatívne", "<1,0 negatívne, >=1,0 pozitívne", "index", "sérum"]),
    row(["Anti HBs", "pozitívne", "index", "sérum"]),
    row(["HIV Ag/Ab", "nevykonané", "sérum"]),
    row(["Feritín", "nedostatok materiálu", "µg/l", "sérum"]),
  ];

  it("finds the numeric rows and skips the header and the group headings", () => {
    const found = candidateRows(rows);
    expect(found.filter((c) => c.kind === "numeric").map((c) => c.index)).toEqual([2, 3, 5, 6]);
    expect(found.some((c) => c.index === 0 || c.index === 1 || c.index === 4)).toBe(false);
  });

  it("reads a value cell like '<1,0 negatívne' as a qualitative result, with the name intact", () => {
    const cmv = candidateRows(rows).find((c) => c.index === 7);
    expect(cmv).toEqual({ index: 7, kind: "qualitative", name: "Anti CMV IgM (skríning)", result: "<1,0 negatívne" });
  });

  it("knows the Slovak qualitative words", () => {
    const found = candidateRows(rows);
    expect(found.filter((c) => c.kind === "qualitative").map((c) => [c.name, c.result])).toEqual([
      ["Anti CMV IgM (skríning)", "<1,0 negatívne"],
      ["Anti HBs", "pozitívne"],
      ["HIV Ag/Ab", "nevykonané"],
      ["Feritín", "nedostatok materiálu"],
    ]);
  });
});

// Guard seen failing 2026-09-06: with the marker rule removed, "( * )" printed
// before the value became part of the name, and a lone "( * )" tail was
// weighed as if it were a result.
describe("markers and flag cells do not decide a row's shape", () => {
  it("ignores '( * )', '(*)', '* ( )', '( ) *', a lone flag letter and a lone dot", () => {
    const rows = [
      row(["S/Draslík", "5,45", "( * )", "3,80 - 5,20", "mmol/l"]),
      row(["S/Glukóza", "5,32", "(*)", "4,11 - 5,60", "mmol/l"]),
      row(["S/Sodík", "( * )", "141", "137 - 145", "mmol/l"]),
      row(["S/Chloridy", "* ( )", "104", "97 - 108", "mmol/l"]),
      row(["S/Vápník", "( ) *", "2,31", "2,15 - 2,55", "mmol/l"]),
      row(["S/Hořčík", "L", "0,62", "0,70 - 1,00", "mmol/l"]),
      row(["S/Fosfor", ".", "1,02", "0,80 - 1,50", "mmol/l"]),
    ];
    const found = candidateRows(rows);
    expect(found.map((c) => c.kind)).toEqual(Array(7).fill("numeric"));
    expect(found.map((c) => c.name)).toEqual([
      "S/Draslík", "S/Glukóza", "S/Sodík", "S/Chloridy", "S/Vápník", "S/Hořčík", "S/Fosfor",
    ]);
  });

  it("does not turn a name followed only by a marker into a candidate", () => {
    expect(candidateRows([row(["Poznámka", "( * )"]), row(["Hodnocení", "H"])])).toEqual([]);
  });

  it("treats a four-decimal value as numeric", () => {
    expect(candidateRows([row(["urea", "4,9000", "mmol/l"])]).map((c) => c.kind)).toEqual(["numeric"]);
  });
});
