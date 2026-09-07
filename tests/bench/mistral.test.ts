/**
 * The OCR row mapping, against responses the real API actually returned.
 *
 * `mistral.ts` is the only arm whose accuracy is decided by *our* code rather
 * than by a model: Mistral OCR hands back markdown tables and this repository
 * decides which cells are the four fields. So the mapping gets the same
 * treatment as the range guard — the traps are fed in verbatim, from three
 * probe calls made on 2026-09-07 ($0.012, `mistral-ocr-4-1`).
 *
 * The trap worth naming: **markdown has no headerless table**, so when a sheet
 * prints no column titles Mistral promotes the first *data* row into the
 * header slot. `tight_rows.pdf` came back with `S_Sodík | 141 | mmol/l |
 * 137-145` as its header. Skipping row one unconditionally would have deleted
 * a measurement on every such page, silently and without a single wrong digit
 * to show for it.
 */
import { describe, expect, it } from "vitest";

import { headerKey, markdownTables, rowsFromOcrPage, rowsFromTable, splitMarkdownTable } from "./mistral";
import { mergedRows } from "./score";

/** breclav.pdf p121, rendered at 220 DPI — the results table, verbatim. */
const BRECLAV_RESULTS = `|  Zkr. | Vyšetření | Výsl. | Text. výsl. | Jedn. |  | Referenční hodnoty | Kontrola l.stupně | Uvolnil  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  URE | * urea | 4,9000 |  | mmol/l | . | ( 2,5000 - 6,4000 ) | nozic | krutiire  |
|  KRE | * kreatinin | 86,0000 |  | µmol/l | . | ( 49,0000 - 90,0000 ) | nozic | krutiire  |
|  KM | * kyselina močová | 396,0000 |  | µmol/l | H | ( 150,0000 - 350,0000 ) | nozic | krutiire  |
|  LD | laktátdehydrogenáza | 2,7400 |  | µkat/l |  |  | nozic | krutiire  |`;

/** The same page's *other* table: the patient block, which is not results. */
const BRECLAV_PATIENT = `|  Jméno: |  | Datum a čas odběru: | 21.05.2024 10:08  |
| --- | --- | --- | --- |
|  Oddělení: | NTS | Přijat: | dasholuc  |
|  Pojišťovna: | 111 | Nároky: | R  |
|  Diagnóza: | D649 | Primární materiál: | Plná krev  |`;

/** tight_rows.pdf at 220 DPI — a sheet with no printed column titles. */
const TIGHT_ROWS = `|  S_Sodík | 141 | mmol/l | 137-145  |
| --- | --- | --- | --- |
|  S_Draslík | 4,32 | mmol/l | (3,80-5,20)  |
|  S_Chloridy | 104 | mmol/l | (97-108)  |
|  S_Vápník | 2,38 | mmol/l | (2,15-2,55)  |`;

describe("splitMarkdownTable", () => {
  it("drops the separator row and trims Mistral's cell padding", () => {
    const grid = splitMarkdownTable(BRECLAV_RESULTS);
    expect(grid).toHaveLength(5); // header + 4 data rows, no `| --- |`
    expect(grid[0][0]).toBe("Zkr.");
    expect(grid[1][1]).toBe("* urea");
  });

  it("keeps interior whitespace, because the printed range depends on it", () => {
    const grid = splitMarkdownTable(BRECLAV_RESULTS);
    expect(grid[1][6]).toBe("( 2,5000 - 6,4000 )");
  });
});

describe("headerKey — Czech labels folded before matching", () => {
  it("folds diacritics, case and punctuation", () => {
    expect(headerKey("Vyšetření")).toBe("vysetreni");
    expect(headerKey("Referenční hodnoty")).toBe("referencnihodnoty");
    expect(headerKey("Text. výsl.")).toBe("textvysl");
  });
});

describe("rowsFromTable — a labelled results table", () => {
  const { rows, droppedColumns } = rowsFromTable(BRECLAV_RESULTS, 0.998);

  it("reads the four fields off the header, verbatim", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      raw_analyte_name: "* urea",
      value_raw: "4,9000",
      unit_raw: "mmol/l",
      ref_range_raw: "( 2,5000 - 6,4000 )",
    });
  });

  it("never reads `Text. výsl.` as `Výsl.`", () => {
    // The value column is `Výsl.` (index 2), not the empty textual-result cell.
    expect(rows.map((r) => r.value_raw)).toEqual(["4,9000", "86,0000", "396,0000", "2,7400"]);
    expect(droppedColumns).toContain("Text. výsl. — textual result");
  });

  it("names every column it drops, so an unmodelled one is visible not silent", () => {
    expect(droppedColumns).toContain("Zkr. — abbreviation");
    expect(droppedColumns).toContain("signature column"); // Kontrola / Uvolnil
    expect(droppedColumns).toContain("(unlabelled)"); // the ./H/L flag cell
  });

  it("carries an empty range through rather than borrowing the row above", () => {
    expect(rows[3]).toMatchObject({ raw_analyte_name: "laktátdehydrogenáza", ref_range_raw: "" });
  });

  it("keeps the whole printed row as the snippet", () => {
    expect(rows[0].source_snippet).toContain("URE | * urea | 4,9000");
  });

  it("derives confidence from the block score and the shape of the value", () => {
    expect(rows[0].confidence).toBe("high");
    expect(rowsFromTable(BRECLAV_RESULTS, 0.95).rows[0].confidence).toBe("medium");
    expect(rowsFromTable(BRECLAV_RESULTS, 0.4).rows[0].confidence).toBe("low");
  });
});

describe("rowsFromTable — the headerless trap", () => {
  it("does NOT lose the row markdown put in the header slot", () => {
    const { rows } = rowsFromTable(TIGHT_ROWS, 0.99);
    expect(rows.map((r) => r.raw_analyte_name)).toEqual(["S_Sodík", "S_Draslík", "S_Chloridy", "S_Vápník"]);
    expect(rows[0]).toMatchObject({ value_raw: "141", unit_raw: "mmol/l", ref_range_raw: "137-145" });
  });

  it("infers the columns from the shape of the cells", () => {
    const { rows } = rowsFromTable(TIGHT_ROWS, 0.99);
    expect(rows[3]).toMatchObject({ raw_analyte_name: "S_Vápník", value_raw: "2,38", ref_range_raw: "(2,15-2,55)" });
  });
});

describe("rowsFromTable — what is not a results table", () => {
  it("contributes nothing from the patient block Mistral returns beside the real table", () => {
    const m = rowsFromTable(BRECLAV_PATIENT, 0.99);
    expect(m.rows).toEqual([]);
    expect(m.skipped).toBe("no name/value column");
  });

  it("says why an empty table contributed nothing", () => {
    expect(rowsFromTable("", null).skipped).toBe("no rows");
  });
});

describe("rowsFromOcrPage — one page, several tables", () => {
  const page: any = {
    index: 0,
    markdown: "# Nemocnice\n\n[tbl-0.md](tbl-0.md)\n\n[tbl-1.md](tbl-1.md)",
    images: [],
    dimensions: { dpi: 200, width: 1820, height: 2573 },
    tables: [
      { id: "tbl-0.md", content: BRECLAV_PATIENT, format: "markdown" },
      { id: "tbl-1.md", content: BRECLAV_RESULTS, format: "markdown" },
    ],
    blocks: [
      { type: "table", tableId: "tbl-0.md", content: "", topLeftX: 0, topLeftY: 0, bottomRightX: 1, bottomRightY: 1, confidenceScores: { averageContentConfidenceScore: 0.99 } },
      { type: "table", tableId: "tbl-1.md", content: "", topLeftX: 0, topLeftY: 0, bottomRightX: 1, bottomRightY: 1, confidenceScores: { averageContentConfidenceScore: 0.998 } },
    ],
    confidenceScores: { averagePageConfidenceScore: 0.98, minimumPageConfidenceScore: 0.11 },
  };

  it("reads only the results table and says the other was skipped", () => {
    const m = rowsFromOcrPage(page);
    expect(m.measurements).toHaveLength(4);
    expect(m.skippedTables).toEqual(["tbl-0.md: no name/value column"]);
  });

  it("falls back to tables inlined in the page markdown when `tables` is empty", () => {
    const inline = { ...page, tables: [], blocks: [], markdown: `# Lab\n\n${TIGHT_ROWS}\n\nPoznámka` };
    expect(rowsFromOcrPage(inline).measurements).toHaveLength(4);
  });

  it("mines no rows out of prose", () => {
    const prose = { ...page, tables: [], blocks: [], markdown: "Glukóza 5,32 mmol/l 3,9 - 5,6" };
    expect(rowsFromOcrPage(prose).measurements).toEqual([]);
  });
});

describe("markdownTables", () => {
  it("finds a pipe block of at least two lines and nothing else", () => {
    expect(markdownTables(`intro\n${TIGHT_ROWS}\nvýsledek`)).toHaveLength(1);
    expect(markdownTables("a | b\n\nnot a table")).toEqual([]);
  });
});

describe("the merged-row guard sees this arm's output like any other", () => {
  it("reports nothing on a clean OCR read of a real page", () => {
    const { rows } = rowsFromTable(BRECLAV_RESULTS, 0.998);
    expect(mergedRows(rows)).toEqual([]);
  });

  it("would report a fused row if the parser ever produced one", () => {
    const fused = `|  Vyšetření | Výsl. | Jedn. | Referenční hodnoty  |
| --- | --- | --- | --- |
|  Glukóza Cholesterol | 5,32 | mmol/l | 3,6 - 5,6 2,9 - 5,0  |`;
    const { rows } = rowsFromTable(fused, 0.99);
    const truth = [{ raw_analyte_name: "Glukóza" }, { raw_analyte_name: "Cholesterol", value_raw: "4,80" }];
    expect(mergedRows(rows, [{ ...truth[0], value_raw: "5,32" }, truth[1]])[0].reasons.sort()).toEqual(["name", "range"]);
  });
});
