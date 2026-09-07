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

import { SYSTEM_EXTRACT_TEXT } from "@bw/extraction";

import { RAW_FIELD_MAX } from "./extract";
import {
  findRangeGroup,
  headerKey,
  isEmphasised,
  joinRange,
  markdownTables,
  nameAt,
  rawAnswerFor,
  remapFromRaw,
  remapMeasurements,
  rowsFromOcrPage,
  rowsFromTable,
  splitMarkdownTable,
  stripEmphasis,
} from "./mistral";
import { mergedRows, type RawMeasurement } from "./score";

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

/**
 * Rule 13 — the stored answer, and the thing the snippet route cannot do.
 *
 * The re-map that judged the last mapping change ran off `source_snippet`, and
 * a snippet exists only for a row the *old* mapping kept. So the one failure
 * mode a mapping bug most often takes — dropping rows — was exactly the one
 * that route could not re-judge. `raw` is the fix, and the test that matters is
 * the second one below: a page the old mapping read as empty comes back full.
 */
describe("call.raw — the provider's own answer, and re-mapping off it", () => {
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
      { type: "table", tableId: "tbl-1.md", content: "", confidenceScores: { averageContentConfidenceScore: 0.998 } },
      { type: "text", content: "Nemocnice" },
    ],
    confidenceScores: { averagePageConfidenceScore: 0.98, minimumPageConfidenceScore: 0.11 },
  };

  it("keeps every input the mapping reads, and nothing it does not", () => {
    const raw = rawAnswerFor(page);
    expect(raw.provider).toBe("mistral");
    expect(raw.markdown).toBe(page.markdown);
    expect(raw.tables?.map((t) => t.id)).toEqual(["tbl-0.md", "tbl-1.md"]);
    expect(raw.tables?.[1].content).toBe(BRECLAV_RESULTS);
    // Only table blocks carry a confidence the mapping uses; prose blocks and
    // the cropped images are not stored.
    expect(raw.blocks).toEqual([{ tableId: "tbl-1.md", confidence: 0.998 }]);
    expect(raw.pageConfidence).toBe(0.98);
    expect(raw.truncated).toBeUndefined();
    expect(JSON.stringify(raw)).not.toContain("dimensions");
  });

  it("round-trips: re-mapping the stored answer reproduces the live mapping", () => {
    const live = rowsFromOcrPage(page).measurements;
    expect(remapFromRaw(rawAnswerFor(page))).toEqual(live);
  });

  it("brings back rows a mapping had dropped — what source_snippet cannot do", () => {
    // Stand in for the old mapping by persisting a read that returned nothing:
    // no snippet exists, so `remapMeasurements` has nothing to work from and
    // the page would score zero forever. `raw` re-judges the page itself.
    const droppedEverything: RawMeasurement[] = [];
    expect(remapMeasurements(droppedEverything)).toEqual([]);
    expect(remapFromRaw(rawAnswerFor(page))).toHaveLength(4);
  });

  it("re-reads a real header rather than reconstructing one from cells", () => {
    const raw = rawAnswerFor({ ...page, tables: [{ id: "t", content: BRECLAV_RESULTS, format: "markdown" }] } as any);
    const rows = remapFromRaw(raw)!;
    // The header row is present in `raw` and consumed as a header, so the four
    // data rows survive — and `Text. výsl.`/`Kontrola l.stupně` are dropped by
    // name rather than guessed at.
    expect(rows.map((r) => r.raw_analyte_name)).toEqual(["* urea", "* kreatinin", "* kyselina močová", "laktátdehydrogenáza"]);
  });

  it("truncates one oversized field, says so in the file, and leaves the rest alone", () => {
    const huge = "x".repeat(RAW_FIELD_MAX + 500);
    const raw = rawAnswerFor({ ...page, markdown: huge } as any);
    expect(raw.truncated).toEqual(["markdown"]);
    expect(raw.markdown!.length).toBeLessThan(huge.length);
    expect(raw.markdown).toContain("truncated at");
    // The cut is per field: the tables beside it are untouched.
    expect(raw.tables?.[1].content).toBe(BRECLAV_RESULTS);
    expect(remapFromRaw(raw)).toHaveLength(4);
  });

  it("refuses to invent a re-map when there is nothing stored", () => {
    expect(remapFromRaw(null)).toBeNull();
    expect(remapFromRaw(undefined)).toBeNull();
    expect(remapFromRaw({ provider: "mistral" })).toBeNull();
    expect(remapFromRaw({ provider: "mistral", tables: [], markdown: "" })).toBeNull();
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

/* ==========================================================================
 * The five rules that fixed the value column.
 *
 * Every fixture below is a row the real API returned, copied out of
 * `tests/bench/results/adapt/`. The arm scored 227/261 on the public class
 * with five value errors and read a reference bound as the value on whole
 * born-digital pages; each `describe` here is one step of that failure, made
 * impossible on its own.
 * ======================================================================== */

/**
 * `results/adapt/mistral_ocr_digital/19_06_12__p1.json`, verbatim.
 *
 * The page prints WBC 5,00 with a reference interval of 4,00 - 10,00, laid out
 * as three cells with a lone `-` between the bounds, and the printed result in
 * bold. Mistral read all of that correctly. The mapping returned value 10,00 —
 * the upper bound — with an empty range, on every row of the page.
 */
const SPLIT_RANGE_PAGE = `| Analyt | Výsledek | Jedn. | Meze |  |  |  |
| --- | --- | --- | --- | --- | --- | --- |
| WBS leukocyty | **5,00** | 10^9/l | 4,00 | - | 10,00 | (X) |
| Lym lymfocyty | **1,40** | 10^9/l | 1,20 | - | 4,00 | (X) |
| Mon monocyty | **0,50** | 10^9/l | 0,10 | - | 1,40 | (X) |
| Gra granulocyty | **3,10** | 10^9/l | 1,70 | - | 7,50 | (X) |
| HCT hematokrit | **0,468** |  | 0,38 | - | 0,52 | (X) |`;

describe("R1 — a reference interval split across cells is one field", () => {
  it("mirrors the rule the deployed text prompt already gives Claude", () => {
    // packages/extraction/src/extract.ts. If this instruction is ever
    // reworded, this file is the other half that has to move with it.
    expect(SYSTEM_EXTRACT_TEXT).toContain("'od'");
    expect(SYSTEM_EXTRACT_TEXT).toContain("'0,17 - 0,78'");
  });

  it("THE REGRESSION: WBS leukocyty is 5,00 in 4,00 - 10,00, not 10,00 in nothing", () => {
    const { rows } = rowsFromTable(SPLIT_RANGE_PAGE, 0.99);
    expect(rows[0]).toMatchObject({
      raw_analyte_name: "WBS leukocyty",
      value_raw: "5,00",
      unit_raw: "10^9/l",
      ref_range_raw: "4,00 - 10,00",
    });
    // Not one row on the page may carry a bound as its value.
    expect(rows.map((r) => r.value_raw)).toEqual(["5,00", "1,40", "0,50", "3,10", "0,468"]);
    expect(rows.map((r) => r.ref_range_raw)).toEqual([
      "4,00 - 10,00",
      "1,20 - 4,00",
      "0,10 - 1,40",
      "1,70 - 7,50",
      "0,38 - 0,52",
    ]);
  });

  it("joins in the one form the deployed prompt asks for", () => {
    expect(joinRange("4,00", "10,00")).toBe("4,00 - 10,00");
    // A bound printed alone is still that bound, not half a range.
    expect(joinRange("4,00", "")).toBe("4,00");
    expect(joinRange("", "")).toBe("");
  });

  it("takes an en dash or `až` as the separator too", () => {
    for (const sep of ["-", "–", "—", "až"]) {
      const t = `| S_Sodík | 141 | mmol/l | 137 | ${sep} | 145 |\n| S_Draslík | 4,32 | mmol/l | 3,80 | ${sep} | 5,20 |`;
      expect(rowsFromTable(t, 0.99).rows[0].ref_range_raw).toBe("137 - 145");
    }
  });

  /**
   * `split_range.pdf` — the fixture drawn for exactly this layout
   * (tools/pipeline/scripts/make_layout_fixtures.py, case 4), through the
   * markdown a table of it comes back as. Its rows carry the lab's own `!`
   * and `*` out-of-range markers, which must survive rule R2 untouched.
   */
  it("joins the `od`/`do` columns split_range.pdf prints, markers intact", () => {
    const t = `| Analyt | Výsledek | Jedn. | od | do |
| --- | --- | --- | --- | --- |
| S_ALT | 0,93 ! | μkat/l | 0,17 | 0,78 |
| S_AST | 0,60 | μkat/l | 0,17 | 0,85 |
| S_GGT | 1,04 * | μkat/l | 0,14 | 0,84 |`;
    const { rows } = rowsFromTable(t, 0.99);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ raw_analyte_name: "S_ALT", value_raw: "0,93 !", ref_range_raw: "0,17 - 0,78" });
    expect(rows[2]).toMatchObject({ raw_analyte_name: "S_GGT", value_raw: "1,04 *", ref_range_raw: "0,14 - 0,84" });
  });

  it("does NOT guess a group out of two adjacent numeric columns", () => {
    // No separator cell, no `od`/`do` header: `value | bound` and
    // `bound | bound` cannot be told apart from the cells, and joining here
    // would invent the failure this rule fixes.
    const t = `| S_Sodík | 141 | 145 |\n| S_Draslík | 4,32 | 5,20 |`;
    expect(findRangeGroup(splitMarkdownTable(t), null)).toBeNull();
  });

  it("does not mistake a printed `-` unit for a separator", () => {
    // breclav_hem_p80: hematocrit's unit IS "-", and the range is one cell.
    const t = `| *Hematokrit | 0,454 |  | - | ( 0,400 - 0,500 ) | EDTA |
| *Hemoglobin | 151,00 |  | g/l | ( 135,00 - 175,00 ) | EDTA |
| *Leukocyty | 9,60 |  | G/l | ( 4,00 - 10,00 ) | EDTA |`;
    const { rows } = rowsFromTable(t, 0.99);
    expect(rows[0]).toMatchObject({ value_raw: "0,454", unit_raw: "-", ref_range_raw: "( 0,400 - 0,500 )" });
  });
});

describe("R2 — markdown emphasis is not data", () => {
  it("strips a wrapper, because bold is how the sheet was printed", () => {
    expect(stripEmphasis("**5,00**")).toBe("5,00");
    expect(stripEmphasis("*5,00*")).toBe("5,00");
    expect(stripEmphasis("__5,00__")).toBe("5,00");
    expect(stripEmphasis("_5,00_")).toBe("5,00");
    expect(stripEmphasis("**NOVÁK JAN** ID: **60 12 12 / 555**")).toBe("NOVÁK JAN ID: 60 12 12 / 555");
  });

  it("KEEPS a lone `*` or `!` — that is the lab's out-of-range marker", () => {
    for (const printed of ["0,93 !", "1,04 *", "* urea", "*Leukocyty", "(*)", "[*]", "*( )", "( ) *", "!"]) {
      expect(stripEmphasis(printed)).toBe(printed);
    }
  });

  it("keeps the underscores Czech analyte names are made of", () => {
    for (const name of ["S_Sodík", "fU_Vápník-odpad", "S_Bilirubin.konjug.", "P_D-dimery", "X_LD"]) {
      expect(stripEmphasis(name)).toBe(name);
    }
  });

  it("knows which cells were emphasised, so rule R3 can prefer them", () => {
    expect(isEmphasised("**5,00**")).toBe(true);
    expect(isEmphasised("_5,00_")).toBe(true);
    expect(isEmphasised("1,04 *")).toBe(false);
    expect(isEmphasised("* urea")).toBe(false);
    expect(isEmphasised("(*)")).toBe(false);
    expect(isEmphasised("S_Sodík")).toBe(false);
  });

  it("does not leave `**` in a value, a name or a snippet", () => {
    const { rows } = rowsFromTable(SPLIT_RANGE_PAGE, 0.99);
    for (const r of rows) {
      expect(r.value_raw).not.toContain("*");
      expect(r.source_snippet).not.toContain("**");
    }
  });
});

describe("R3 — the value is what is left, never the last numeric", () => {
  it("prefers the emphasised cell, because Mistral bolds the printed result", () => {
    // Three numeric columns, no header, no separator cell: only the emphasis
    // says which one the sheet printed as the result.
    const t = `| WBS | 4,00 | **5,00** | 10,00 |
| Lym | 1,20 | **1,40** | 4,00 |
| Mon | 0,10 | **0,50** | 1,40 |`;
    expect(rowsFromTable(t, 0.99).rows.map((r) => r.value_raw)).toEqual(["5,00", "1,40", "0,50"]);
  });

  it("falls back to the LEFTMOST remaining numeric column, not the last", () => {
    // Nothing emphasised: 4,50 is the result, 8,00 the bound it sits under.
    const t = `| S_Urea | 4,50 | mmol/l | 2,80 | - | 8,00 |
| S_Kreatinin | 95 | µmol/l | 44 | - | 115 |`;
    expect(rowsFromTable(t, 0.99).rows.map((r) => r.value_raw)).toEqual(["4,50", "95"]);
  });

  it("never takes a unit or a range bound as the value", () => {
    const { rows } = rowsFromTable(SPLIT_RANGE_PAGE, 0.99);
    for (const r of rows) {
      expect(r.value_raw).not.toBe(r.unit_raw);
      expect((r.ref_range_raw ?? "").split(" - ")).not.toContain(r.value_raw);
    }
  });
});

/** `results/adapt/mistral_ocr_digital/2022_07_01__p1.json`, verbatim. */
const FLAGGED_ROWS = `| A | 81365 | Bílkovina celková | 66,4 |  | * |  | 65,0 - 85,0 | g/l |
| A | 81361 | Bilirubin celkový | 14 |  | * |  | < 17 | µmol/l |
| A | 81337 | ALT | 0,91 |  | * |  | < 0,78 | µkat/l |
| A | 81439 | Glukóza | 4,5 |  | * |  | 3,6 - 5,6 | mmol/l |
| A | 81499 | Kreatinin | 95 |  | * |  | 44 - 115 | µmol/l |`;

describe("R4 — a single-letter leading cell is a flag, not a name", () => {
  it("THE REGRESSION: rows came back named `A`, the accreditation column", () => {
    const { rows } = rowsFromTable(FLAGGED_ROWS, 0.99);
    expect(rows.map((r) => r.raw_analyte_name)).toEqual([
      "Bílkovina celková",
      "Bilirubin celkový",
      "ALT",
      "Glukóza",
      "Kreatinin",
    ]);
    expect(rows[0]).toMatchObject({ value_raw: "66,4", unit_raw: "g/l", ref_range_raw: "65,0 - 85,0" });
    // A censored bound printed as one cell is still that cell.
    expect(rows[1].ref_range_raw).toBe("< 17");
  });

  it("never reads the LIS item code as the value", () => {
    // bulovka_okbi: the five value errors on the public class were all this.
    const t = `| 81593 | Sodík | 140 | mmol/l | [*] | 132-149 |
| 81393 | Draslík | 4.00 | mmol/l | [*] | 3.80-5.50 |
| 81469 | Chloridy | 100 | mmol/l | [*] | 97-108 |
| 81621 | Urea | 4.50 | mmol/l | [*] | 2.80-8.00 |
| 81499 | Kreatinin | 60 | mmol/l | [*] | 44-115 |`;
    const { rows } = rowsFromTable(t, 0.99);
    expect(rows.map((r) => r.value_raw)).toEqual(["140", "4.00", "100", "4.50", "60"]);
    expect(rows.map((r) => r.raw_analyte_name)).toEqual(["Sodík", "Draslík", "Chloridy", "Urea", "Kreatinin"]);
  });

  it("walks past a flag and a code the way candidates.ts does", () => {
    expect(nameAt(["A", "81365", "Bílkovina celková", "66,4"], 0)).toBe("Bílkovina celková");
    expect(nameAt(["81593", "Sodík", "140"], 0)).toBe("Sodík");
    expect(nameAt([".", "* urea", "4,9000"], 0)).toBe("* urea");
    // A two-letter analyte is a name, not a flag.
    expect(nameAt(["A", "81495", "CK", "13,81"], 0)).toBe("CK");
    // Nothing to find: the row starts with the number.
    expect(nameAt(["4,9000", "mmol/l"], 0)).toBe("");
  });

  it("drops an abbreviation column when the name stands beside it", () => {
    // "URE | urea" — breclav p121 without its header row.
    const t = `| URE | * urea | 4,9000 | mmol/l | ( 2,5000 - 6,4000 ) |
| KRE | * kreatinin | 86,0000 | µmol/l | ( 49,0000 - 90,0000 ) |
| KM | * kyselina močová | 396,0000 | µmol/l | ( 150,0000 - 350,0000 ) |`;
    const { rows } = rowsFromTable(t, 0.99);
    expect(rows.map((r) => r.raw_analyte_name)).toEqual(["* urea", "* kreatinin", "* kyselina močová"]);
    expect(rows[0].value_raw).toBe("4,9000");
  });
});

describe("R5 — a trailing marker cell is decoration", () => {
  it("keeps `(X)`, `( )X` and `*( )` out of value, unit and range", () => {
    const t = `| WBS leukocyty | **5,00** | 10^9/l | 4,00 | - | 10,00 | (X) |
| Lym lymfocyty | **1,40** | 10^9/l | 1,20 | - | 4,00 | ( )X |
| Mon monocyty | **0,50** | 10^9/l | 0,10 | - | 1,40 | *( ) |`;
    for (const r of rowsFromTable(t, 0.99).rows) {
      for (const field of [r.value_raw, r.unit_raw, r.ref_range_raw]) {
        expect(field).not.toMatch(/[()X]/);
      }
    }
  });

  it("keeps a bare `*` out of the unit column", () => {
    // 171 born-digital rows carried this `*` as their unit or their range.
    const { rows } = rowsFromTable(FLAGGED_ROWS, 0.99);
    expect(rows.map((r) => r.unit_raw)).toEqual(["g/l", "µmol/l", "µkat/l", "mmol/l", "µmol/l"]);
  });

  it("still treats a bare `-` as a unit, never as a marker", () => {
    const t = `| B_pH | 7,326 | - | 7,350 - 7,450 |\n| B_iVápník | 0,90 | mmol/l | 1,15 - 1,30 |`;
    expect(rowsFromTable(t, 0.99).rows[0].unit_raw).toBe("-");
  });
});

describe("remapMeasurements — re-judging a mapping without paying again", () => {
  const persisted: RawMeasurement[] = [
    { raw_analyte_name: "WBS leukocyty", value_raw: "10,00", unit_raw: "10^9/l", ref_range_raw: "", source_snippet: "WBS leukocyty | **5,00** | 10^9/l | 4,00 | - | 10,00 | (X)", confidence: "high" },
    { raw_analyte_name: "Lym lymfocyty", value_raw: "4,00", unit_raw: "10^9/l", ref_range_raw: "", source_snippet: "Lym lymfocyty | **1,40** | 10^9/l | 1,20 | - | 4,00 | (X)", confidence: "high" },
    { raw_analyte_name: "Mon monocyty", value_raw: "1,40", unit_raw: "10^9/l", ref_range_raw: "", source_snippet: "Mon monocyty | **0,50** | 10^9/l | 0,10 | - | 1,40 | (X)", confidence: "high" },
  ];

  it("re-maps a persisted page off its own snippets", () => {
    const again = remapMeasurements(persisted);
    expect(again.map((r) => r.value_raw)).toEqual(["5,00", "1,40", "0,50"]);
    expect(again.map((r) => r.ref_range_raw)).toEqual(["4,00 - 10,00", "1,20 - 4,00", "0,10 - 1,40"]);
  });

  it("is idempotent — re-mapping its own output changes nothing", () => {
    const once = remapMeasurements(persisted);
    expect(remapMeasurements(once)).toEqual(once);
  });

  it("cannot invent a row the old mapping dropped", () => {
    expect(remapMeasurements([])).toEqual([]);
  });
});
