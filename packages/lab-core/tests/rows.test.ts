/**
 * Row reconstruction is what makes the text path usable, and the provenance
 * check is what makes it trustworthy. Both are tested against coordinates
 * shaped like a real Czech lab table: an analyte name, a value with a decimal
 * comma, a unit and a parenthesised reference range, laid out in columns.
 */
import { describe, expect, it } from "vitest";
import {
  type Box,
  type TextRow,
  buildRows,
  isPrintedOnPage,
  printedMaterial,
  rowBoxFor,
  rowMaterial,
  rowsAsText,
  rowTextAt,
  sectionMaterial,
} from "@bw/lab-core";

/** Build a word at a column x and row y, as pdf.js would report it. */
const w = (text: string, x: number, y: number, h = 12): { text: string; box: Box } => ({
  text,
  box: [x, y, x + text.length * 6, y + h],
});

const PAGE = [
  // Deliberately out of document order — pdf.js does not promise reading order.
  ...[w("mmol/l", 330, 100), w("S_Glukóza", 50, 100), w("(4,11-5,60)", 420, 100), w("3,802", 250, 100)],
  ...[w("S_Cholesterol", 50, 130), w("4,80", 250, 130), w("mmol/l", 330, 130), w("(2,90-5,00)", 420, 130)],
  // A row whose cells sit on slightly different baselines — different font size.
  ...[w("S_CRP", 50, 160), w("<1,0", 250, 162, 10), w("mg/l", 330, 159), w("(1,0-5,0)", 420, 161)],
];

describe("buildRows", () => {
  it("groups items into printed rows regardless of document order", () => {
    const rows = buildRows(PAGE);
    expect(rows).toHaveLength(3);
    expect(rows[0].cells).toEqual(["S_Glukóza", "3,802", "mmol/l", "(4,11-5,60)"]);
  });

  it("tolerates baseline jitter within a row", () => {
    const rows = buildRows(PAGE);
    expect(rows[2].cells).toEqual(["S_CRP", "<1,0", "mg/l", "(1,0-5,0)"]);
  });

  it("spans the row bbox across all its cells", () => {
    const [first] = buildRows(PAGE);
    expect(first.box[0]).toBe(50);
    expect(first.box[2]).toBeGreaterThan(420);
  });

  it("returns nothing for a page with no text layer", () => {
    expect(buildRows([])).toEqual([]);
  });
});

describe("rowsAsText", () => {
  it("renders one printed row per line, indexed, with pipe-separated cells", () => {
    expect(rowsAsText(buildRows(PAGE)).split("\n")[1]).toBe(
      "1\tS_Cholesterol | 4,80 | mmol/l | (2,90-5,00)",
    );
  });

  it("numbers every line from zero, contiguously", () => {
    const lines = rowsAsText(buildRows(PAGE)).split("\n");
    lines.forEach((line, i) => expect(line.startsWith(`${i}\t`), line).toBe(true));
  });
});

describe("rowTextAt — the round trip the row_index anchor depends on", () => {
  const rows = buildRows(PAGE);

  it("resolves an index back to the printed row", () => {
    // What the model returns as row_index must land on the row it read, or the
    // verification tab shows the wrong line beside the page image.
    const lines = rowsAsText(rows).split("\n");
    lines.forEach((line, i) => {
      const printed = line.slice(line.indexOf("\t") + 1).split(" | ").join(" ");
      expect(rowTextAt(i, rows)).toBe(printed);
    });
  });

  it("returns nothing for an index off either end, rather than throwing", () => {
    expect(rowTextAt(-1, rows)).toBe("");
    expect(rowTextAt(rows.length, rows)).toBe("");
    expect(rowTextAt(undefined, rows)).toBe("");
  });
});

describe("isPrintedOnPage", () => {
  const rows = buildRows(PAGE);

  it("accepts a value that is printed, decimal comma and all", () => {
    expect(isPrintedOnPage("3,802", rows)).toBe(true);
    expect(isPrintedOnPage("<1,0", rows)).toBe(true);
  });

  it("rejects a value that is not on the page — the fabrication case", () => {
    // A plausible misread of "3,802": right digits, wrong decimal placement.
    expect(isPrintedOnPage("38,02", rows)).toBe(false);
    expect(isPrintedOnPage("4,81", rows)).toBe(false);
  });

  it("ignores whitespace, since pdf.js splits cells arbitrarily", () => {
    expect(isPrintedOnPage(" 4,80 ", rows)).toBe(true);
  });

  it("treats an empty claim as nothing to verify", () => {
    expect(isPrintedOnPage("", rows)).toBe(true);
  });
});

describe("rowBoxFor", () => {
  it("returns the row's own bbox — no text search needed", () => {
    const rows = buildRows(PAGE);
    expect(rowBoxFor("S_Cholesterol", rows)).toEqual(rows[1].box);
  });

  it("returns null for a name not on the page", () => {
    expect(rowBoxFor("S_Neexistuje", buildRows(PAGE))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase B2 — the material a page states beside or above a row.
// ---------------------------------------------------------------------------

/** A row from cells alone; geometry does not matter to the material rules. */
const cellsRow = (cells: string[], y = 0): TextRow => ({
  cells,
  cellBoxes: cells.map((c, i) => [50 + i * 100, y, 50 + i * 100 + c.length * 6, y + 10] as Box),
  box: [50, y, 700, y + 10],
});

// Guard seen failing 2026-09-06: before sectionMaterial existed the import
// itself failed; with the heading table emptied every code below came back
// null, and with the "stop at any heading" rule removed the Glukóza under
// "Metabolity" inherited "b" from the Krvný obraz block above it.
describe("sectionMaterial — the heading a row sits under", () => {
  // The mixed_material.pdf shape: two blocks, nothing but the heading differs.
  const mixed = [
    cellsRow(["Výsledkový list"]),
    cellsRow(["Pacient:", "Novák Jan"]),
    cellsRow(["Sérum"]),
    cellsRow(["Glukóza", "5,4", "mmol/l", "3,9 - 5,6"]),
    cellsRow(["Kreatinin", "84", "µmol/l", "62 - 106"]),
    cellsRow(["Moč"]),
    cellsRow(["Glukóza", "0,3", "mmol/l", "0 - 0,8"]),
    cellsRow(["Kreatinin", "9,8", "mmol/l", "3,5 - 25,0"]),
  ];

  it("attributes each row to the nearest heading above it", () => {
    expect(sectionMaterial(mixed, 3)).toBe("s");
    expect(sectionMaterial(mixed, 4)).toBe("s");
    expect(sectionMaterial(mixed, 6)).toBe("u");
    expect(sectionMaterial(mixed, 7)).toBe("u");
  });

  it("returns null above the first heading, and for an index off the page", () => {
    expect(sectionMaterial(mixed, 1)).toBeNull();
    expect(sectionMaterial(mixed, -1)).toBeNull();
    expect(sectionMaterial(mixed, 99)).toBeNull();
  });

  it("reads the urine_no_prefix shape: Biochemie is serum by default, Moč chemicky is urine", () => {
    const rows = [
      cellsRow(["Biochemie"]),
      cellsRow(["Glukóza", "5,4", "mmol/l", "3,9 - 5,6"]),
      cellsRow(["Moč chemicky"]),
      cellsRow(["Glukóza", "0,3", "mmol/l", "0 - 0,8"]),
      cellsRow(["pH", "6,0", "5,0 - 7,0"]),
      cellsRow(["Močový sediment", "negativní"]),
    ];
    expect(sectionMaterial(rows, 1)).toBe("s");
    expect(sectionMaterial(rows, 3)).toBe("u");
    expect(sectionMaterial(rows, 4)).toBe("u");
    // A multi-cell row whose cell is exactly a known heading counts too.
    expect(sectionMaterial(rows, 5)).toBe("u");
  });

  it("is case- and accent-insensitive, and reads Slovak and compound headings", () => {
    const rows = [
      cellsRow(["HEMATOLOGIE"]),
      cellsRow(["Hemoglobin", "148", "g/l"]),
      cellsRow(["Základná hematológia - Krvný obraz"]),
      cellsRow(["Leukocyty [WBC]", "6,90", "10^9/l"]),
      cellsRow(["Biochemie - serum"]),
      cellsRow(["Urea", "5,1", "mmol/l"]),
      cellsRow(["PLAZMA"]),
      cellsRow(["Amoniak", "32", "µmol/l"]),
      cellsRow(["Vyšetření moči"]),
      cellsRow(["Bílkovina", "0,10", "g/l"]),
    ];
    expect(sectionMaterial(rows, 1)).toBe("b");
    expect(sectionMaterial(rows, 3)).toBe("b");
    expect(sectionMaterial(rows, 5)).toBe("s");
    expect(sectionMaterial(rows, 7)).toBe("p");
    expect(sectionMaterial(rows, 9)).toBe("u");
  });

  it("stops at a heading that names no material rather than borrowing the block above", () => {
    // The slovak_grouped.pdf shape: Glukóza sits under "Metabolity", which
    // says nothing about material; the Krvný obraz block above must not leak.
    const rows = [
      cellsRow(["Základná hematológia - Krvný obraz"]),
      cellsRow(["Leukocyty [WBC]", "6,90", "3,80–10,70", "10^9/l", "krv EDTA"]),
      cellsRow(["Metabolity"]),
      cellsRow(["Glukóza", "5,10", "3,90–5,60", "mmol/l", "sérum"]),
    ];
    expect(sectionMaterial(rows, 1)).toBe("b");
    expect(sectionMaterial(rows, 3)).toBeNull();
  });

  it("does not take a material legend or a wrapped-name fragment for a heading", () => {
    const rows = [
      cellsRow(["Krevní obraz"]),
      cellsRow(["Alaninaminotransferáza v", "0,93", "µkat/l"]),
      cellsRow(["séru"]),
      cellsRow(["(ALT)"]),
      cellsRow(["Hemoglobin", "148", "g/l"]),
      cellsRow(["Označení vyšetřovaného materiálu: S=sérum, P=plazma, B=plná krev, U=moč"]),
      cellsRow(["Trombocyty", "243", "10^9/l"]),
    ];
    // "séru" and "(ALT)" are continuation lines; the heading is still Krevní obraz.
    expect(sectionMaterial(rows, 4)).toBe("b");
    // The legend lists every material; it is not a heading for the row below it.
    expect(sectionMaterial(rows, 6)).toBe("b");
  });
});

// Guard seen failing 2026-09-06: with the material-word table emptied,
// "sérum" and "krv EDTA" returned null and the combined lookup fell through
// to the (wrong) heading.
describe("rowMaterial and printedMaterial — the Materiál column", () => {
  const rows = [
    cellsRow(["Základná hematológia - Krvný obraz"]),
    cellsRow(["Leukocyty [WBC]", "6,90", "3,80–10,70", "10^9/l", "krv EDTA"]),
    cellsRow(["Metabolity"]),
    cellsRow(["Glukóza", "5,10", "3,90–5,60", "mmol/l", "sérum"]),
    cellsRow(["Amoniak", "32", "µmol/l", "plazma"]),
    cellsRow(["Moč"]),
    cellsRow(["Bílkovina", "0,10", "g/l"]),
  ];

  it("reads a cell that is exactly a known material word", () => {
    expect(rowMaterial(rows[1])).toBe("b");
    expect(rowMaterial(rows[3])).toBe("s");
    expect(rowMaterial(rows[4])).toBe("p");
    expect(rowMaterial(rows[6])).toBeNull();
    expect(rowMaterial(cellsRow(["Glukóza", "5,1", "mmol/l", "Plná krev"]))).toBe("b");
    expect(rowMaterial(cellsRow(["Glukóza", "5,1", "mmol/l", "moč"]))).toBe("u");
  });

  it("does not read a material word that is part of a longer cell", () => {
    expect(rowMaterial(cellsRow(["Kreatinin v séru", "84", "µmol/l"]))).toBeNull();
    expect(rowMaterial(cellsRow(["Moč chemicky"]))).toBeNull();
  });

  it("prefers the column, then the heading, and says which it used", () => {
    expect(printedMaterial(rows, 3)).toEqual({ code: "s", source: "column" });
    expect(printedMaterial(rows, 1)).toEqual({ code: "b", source: "column" });
    expect(printedMaterial(rows, 6)).toEqual({ code: "u", source: "heading" });
    expect(printedMaterial(rows, 2)).toBeNull();
    expect(printedMaterial(rows, undefined)).toBeNull();
  });
});
