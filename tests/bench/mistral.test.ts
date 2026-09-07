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

import { SYSTEM_EXTRACT_TEXT, TOOL } from "@bw/extraction";

import { computeFlag, parseRange } from "@bw/lab-core";

import { RAW_FIELD_MAX } from "./extract";
import {
  ANNOT_PAGE_PRICE_USD,
  PAGE_PRICE_USD,
  annotationFormat,
  collapseMarkerRuns,
  describeRequest,
  findRangeGroup,
  headerKey,
  isEmphasised,
  joinRange,
  markdownTables,
  measurementsFromAnnotation,
  mistralRequest,
  nameAt,
  operatorOf,
  pagePriceUsd,
  rawAnswerFor,
  remapFromRaw,
  remapMeasurements,
  rowsFromOcrPage,
  rowsFromTable,
  splitMarkdownTable,
  stripEmphasis,
  toAnnotationSchema,
  type AnnotRawAnswer,
} from "./mistral";
import { mergedRows, rangeIntegrity, type RawMeasurement } from "./score";

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

/* ==========================================================================
 * The three rules that fixed the range and unit columns.
 *
 * Same class as R1 and found the same way — from `call.raw`, not from a
 * suspicion about the model. On the born-digital class the arm scored 485 unit
 * and 503 range disagreements against the accepted reports; 444 of each were
 * one column split into several by Mistral and read one place to the left by
 * us, and six ranges were an upper bound whose `<` we had thrown away.
 * ======================================================================== */

/**
 * `results/adapt/mistral_ocr_digital/19_06_12__p1.json`, verbatim.
 *
 * The same page and the same three range columns as `SPLIT_RANGE_PAGE`, on the
 * rows where the interval is one-sided: the lab prints `< 2,85` and Mistral
 * returns the operator in the cell the two-sided rows use for their `-`.
 */
const ONE_SIDED_PAGE = `|  BIOCHEMIE - sérum | Výsledek | Jednotka | Referenční interval |   |   | Hodnocení  |
| --- | --- | --- | --- | --- | --- | --- |
|  Celkový bilirubin | **14,86** | µmol/l | 2,00 | - | 21,00 | (X)  |
|  CK | **12,54** | µkat/l |  | < | 2,85 | ( )X  |
|  ALT | **0,49** | µkat/l |  | < | 0,75 | (X)  |
|  AST | **0,60** | µkat/l |  | < | 0,58 | ( )X  |
|  ALP | **1,92** | µkat/l | 0,66 | - | 2,20 | (X)  |
|  LDH | **3,42** | µkat/l |  | < | 4,14 | (X)  |
|  gGT | **0,26** | µkat/l |  | < | 0,92 | (X)  |
|  Glukóza | **3,52** | mmol/l | 3,90 | - | 5,60 | X( )  |
|  Kreatinin | **99,1** | µmol/l | 62,00 | - | 110 | (X)  |
|  Urea | **6,01** | mmol/l | 2,80 | - | 8,00 | (X)  |
|  Kyselina močová | **345,7** | µmol/l | 220 | - | 420 | (X)  |
|  Bílkovina celková | **67,6** | g/l | 66,00 | - | 88,00 | (X)  |
|  CRP | **0,1** | mg/l |  | < | 5,00 | (X)  |`;

describe("R6 — a lone operator cell belongs to the number after it", () => {
  it("THE REGRESSION: CK's interval is `< 2,85`, not `2,85`", () => {
    const { rows } = rowsFromTable(ONE_SIDED_PAGE, 0.99);
    // The sheet's own section heading — `BIOCHEMIE - sérum | Výsledek | …` —
    // is a row here, as it is in the persisted read: this table's header
    // names no analyte column, so rule 3 refuses it and rule 8 keeps it. That
    // is a separate, visible fault (it shows up as an `extra`), not this one.
    expect(rows[0].raw_analyte_name).toBe("BIOCHEMIE - sérum");
    expect(rows.find((r) => r.raw_analyte_name === "CK")).toMatchObject({
      value_raw: "12,54",
      unit_raw: "µkat/l",
      ref_range_raw: "< 2,85",
    });
    // `2,85` is not a weaker spelling of `< 2,85`: parseRange reads the first
    // as descriptive text with neither bound, so the flag the app computes
    // from it is computed from nothing. data/reports spells it `< 2,85`.
    expect(rows.slice(1).map((r) => r.ref_range_raw)).toEqual([
      "2,00 - 21,00",
      "< 2,85",
      "< 0,75",
      "< 0,58",
      "0,66 - 2,20",
      "< 4,14",
      "< 0,92",
      "3,90 - 5,60",
      "62,00 - 110",
      "2,80 - 8,00",
      "220 - 420",
      "66,00 - 88,00",
      "< 5,00",
    ]);
  });

  it("parses in lab-core exactly as the deployed reader's own answer does", () => {
    // The whole point of matching the spelling: a Mistral range and a Claude
    // range must reach `normalizeMeasurement` as the same interval.
    const { rows } = rowsFromTable(ONE_SIDED_PAGE, 0.99);
    const ck = rows.find((r) => r.raw_analyte_name === "CK")!;
    expect(parseRange(ck.ref_range_raw)).toEqual({ low: null, high: 2.85, text: null });
    // …and the flag then follows from the interval, not from the printed glyph.
    expect(computeFlag(12.54, null, 2.85)).toBe("high");
    // tools/pipeline/tests/parity_cases.json fixes this exact pair.
    expect(parseRange("< 5,00")).toEqual({ low: null, high: 5, text: null });
  });

  it("finds the group even where the sheet prints both forms in one table", () => {
    const group = findRangeGroup(splitMarkdownTable(ONE_SIDED_PAGE).slice(1), null);
    expect(group).toEqual({ low: 3, sep: 4, high: 5 });
  });

  it("takes every operator the deployed parser accepts, and folds `<=` to `≤`", () => {
    for (const [printed, joined] of [
      ["<", "< 2,85"],
      [">", "> 2,85"],
      ["≤", "≤ 2,85"],
      ["≥", "≥ 2,85"],
      ["<=", "≤ 2,85"],
      [">=", "≥ 2,85"],
      ["&lt;", "< 2,85"],
      ["&gt;=", "≥ 2,85"],
    ] as const) {
      const t = `| S_ALT | 0,49 | µkat/l |  | ${printed} | 2,85 | (X) |
| S_AST | 0,60 | µkat/l |  | ${printed} | 0,58 | (X) |`;
      expect(rowsFromTable(t, 0.99).rows[0].ref_range_raw).toBe(joined);
      // `UPPER_BOUND`/`LOWER_BOUND` in lab-core accept `<`, `≤`, `>`, `≥` and
      // nothing else — an un-folded `<=` would leave the `=` in the number.
      expect(parseRange(joined).text).toBeNull();
    }
  });

  it("joins through joinRange, and only where the low bound is empty", () => {
    expect(joinRange("", "2,85", "<")).toBe("< 2,85");
    expect(joinRange("", "", "<")).toBe("");
    // Two bounds AND an operator is a contradiction no sheet prints. The
    // bounds win: inventing a one-sided interval would throw a number away.
    expect(joinRange("0,66", "2,20", "<")).toBe("0,66 - 2,20");
    // The two-sided form is untouched.
    expect(joinRange("4,00", "10,00", "-")).toBe("4,00 - 10,00");
    expect(joinRange("4,00", "10,00")).toBe("4,00 - 10,00");
  });

  it("a genuine two-sided range on the same page is unchanged", () => {
    const { rows } = rowsFromTable(SPLIT_RANGE_PAGE, 0.99);
    expect(rows.map((r) => r.ref_range_raw)).toEqual([
      "4,00 - 10,00",
      "1,20 - 4,00",
      "0,10 - 1,40",
      "1,70 - 7,50",
      "0,38 - 0,52",
    ]);
  });

  it("does NOT read `(blank) | - | bound` as an interval", () => {
    // A dash with nothing on its left is not a one-sided interval, and
    // reading one there would be the guess R1 exists to refuse.
    const t = `| S_ALT | 0,49 | µkat/l |  | - | 2,85 | (X) |
| S_AST | 0,60 | µkat/l |  | - | 0,58 | (X) |`;
    expect(findRangeGroup(splitMarkdownTable(t), null)).toBeNull();
  });

  it("a bare marker cell is still decoration, never an operator", () => {
    expect(operatorOf("(X)")).toBeNull();
    expect(operatorOf("*")).toBeNull();
    expect(operatorOf(".")).toBeNull();
    expect(operatorOf("-")).toBeNull();
    expect(operatorOf("< 2,85")).toBeNull(); // a whole cell only
    const { rows } = rowsFromTable(ONE_SIDED_PAGE, 0.99);
    for (const r of rows) {
      expect(r.unit_raw).not.toMatch(/[()[\]*!]/);
      expect(r.ref_range_raw).not.toMatch(/[()[\]*!]/);
    }
  });
});

describe("R7 — the same operator before a value is a censor, never dropped", () => {
  /**
   * A guard, and the tests say so: 77 lone operator cells sit in the stored
   * answers under `results/adapt/mistral*` and every one of them is a range
   * bound (7-cell rows at index 4, 8-cell rows at index 5 — the separator slot
   * of the interval group). No sheet in this corpus prints `| < | 1,0 |` in
   * the value columns. It is written anyway because the failure it prevents —
   * `<1,0` silently becoming `1,0` — is the one `rangeIntegrity` already
   * tracks as `decensored`, and it must not depend on nobody printing it.
   */
  it("joins the censor onto the value, spelled as data/reports spells it", () => {
    const t = `| Analyt | Cens | Výsledek | Jedn. |
| --- | --- | --- | --- |
| S_Troponin | < | 1,0 | µg/l |
| S_hCG | < | 2,0 | IU/l |
| S_PSA | < | 0,1 | µg/l |`;
    const { rows } = rowsFromTable(t, 0.99);
    // No space: the accepted reports carry `<1,0` for a censored VALUE and
    // `< 2,85` for a one-sided RANGE, and both spellings are load-bearing.
    expect(rows.map((r) => r.value_raw)).toEqual(["<1,0", "<2,0", "<0,1"]);
    expect(rows[0].unit_raw).toBe("µg/l");
  });

  it("survives the check that would have caught it being dropped", () => {
    const t = `| S_Troponin | < | 1,0 | µg/l |\n| S_hCG | < | 2,0 | IU/l |`;
    const { rows } = rowsFromTable(t, 0.99);
    const truth: RawMeasurement[] = [
      { raw_analyte_name: "S_Troponin", value_raw: "<1,0" },
      { raw_analyte_name: "S_hCG", value_raw: "<2,0" },
    ];
    expect(rangeIntegrity(truth, rows).decensored).toEqual([]);
    // …and it really is the guard that would have fired.
    const dropped = rows.map((r) => ({ ...r, value_raw: (r.value_raw ?? "").replace(/^</, "") }));
    expect(rangeIntegrity(truth, dropped).decensored).toHaveLength(2);
  });

  it("never claims a cell the range group already owns", () => {
    // ONE_SIDED_PAGE's `<` stands in the interval, two columns right of the
    // value. R6 owns it; R7 must not also read it onto the value.
    const { rows } = rowsFromTable(ONE_SIDED_PAGE, 0.99);
    expect(rows.slice(1).map((r) => r.value_raw)).toEqual([
      "14,86", "12,54", "0,49", "0,60", "1,92", "3,42", "0,26",
      "3,52", "99,1", "6,01", "345,7", "67,6", "0,1",
    ]);
  });

  it("does not fire on a column that is merely blank beside the value", () => {
    const t = `| S_Sodík | | 141 | mmol/l |\n| S_Draslík | | 4,32 | mmol/l |`;
    expect(rowsFromTable(t, 0.99).rows.map((r) => r.value_raw)).toEqual(["141", "4,32"]);
  });
});

/**
 * `results/adapt/mistral_ocr_digital/2023_12_19__p1.json`, verbatim.
 *
 * Five header cells; seven and eight in the rows. `Hodnocení` is printed as a
 * little graphical scale and Mistral returns its segments as separate cells,
 * so `Jednotky` was read at the header's index 3 — which by then held the
 * scale's `*` — and `Ref. interval` fell off the end.
 */
const SPLIT_SCALE_PAGE = `| Vyšetření | Výsledek | Hodnocení | Jednotky | Ref. interval |
| --- | --- | --- | --- | --- |
| **BIOCHEMIE** |
| S_Urea | 4,5 | | * | | mmol/l | (2,8-8,3) |
| S_Kreatinin | 115 ! | | | * | | µmol/l | (62-106) |
| S_AST | 0,87 ! | | | * | | µkat/l | (0,17-0,85) |
| S_GGT | 0,44 | | * | | µkat/l | (0,17-1,19) |`;

describe("R8 — a row wider than its own header had a column split", () => {
  it("THE REGRESSION: the unit was `*` and the range was gone", () => {
    const { rows } = rowsFromTable(SPLIT_SCALE_PAGE, 0.99);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ raw_analyte_name: "S_Urea", value_raw: "4,5", unit_raw: "mmol/l", ref_range_raw: "(2,8-8,3)" });
    expect(rows.map((r) => r.unit_raw)).toEqual(["mmol/l", "µmol/l", "µkat/l", "µkat/l"]);
    expect(rows.map((r) => r.ref_range_raw)).toEqual(["(2,8-8,3)", "(62-106)", "(0,17-0,85)", "(0,17-1,19)"]);
    // The lab's own out-of-range marker rides along on the value, untouched.
    expect(rows[1].value_raw).toBe("115 !");
  });

  it("says it realigned, so a split column is visible and not silent", () => {
    expect(rowsFromTable(SPLIT_SCALE_PAGE, 0.99).droppedColumns.join(" ")).toContain("realigned to the header");
  });

  it("collapses the leftmost blank-or-marker run, and only as far as needed", () => {
    expect(collapseMarkerRuns(["S_Urea", "4,5", "", "*", "", "mmol/l", "(2,8-8,3)"], 5)).toEqual(["S_Urea", "4,5", "*", "mmol/l", "(2,8-8,3)"]);
    expect(collapseMarkerRuns(["S_AST", "0,87 !", "", "", "*", "", "µkat/l", "(0,17-0,85)"], 5)).toEqual(["S_AST", "0,87 !", "*", "µkat/l", "(0,17-0,85)"]);
    // One cell too many, a run of three: only one cell is given up, and the
    // run keeps the shape it still has room for.
    expect(collapseMarkerRuns(["A", "", "*", "", "g/l"], 4)).toEqual(["A", "*", "", "g/l"]);
  });

  it("leaves a row that fits, and a row with nothing to fuse, exactly as it came", () => {
    expect(collapseMarkerRuns(["A", "1", "g/l"], 5)).toEqual(["A", "1", "g/l"]);
    // No run of two adjacent blank-or-marker cells: nothing here could say
    // which of these to fuse, so nothing is fused.
    expect(collapseMarkerRuns(["A", "1", "g/l", "2 - 3"], 3)).toEqual(["A", "1", "g/l", "2 - 3"]);
  });

  it("never realigns a table whose header was not accepted", () => {
    // TIGHT_ROWS has no printed titles at all — row 0 is data, and there is
    // no width to trust. Rule 6 decides, exactly as before.
    const { rows } = rowsFromTable(TIGHT_ROWS, 0.99);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ raw_analyte_name: "S_Sodík", value_raw: "141", ref_range_raw: "137-145" });
  });

  it("a `-` between two bounds is not decoration, so a split range never collapses", () => {
    // MARKER_CELL deliberately excludes a bare `-`; if it did not, R8 would
    // eat the separator R1 depends on.
    expect(collapseMarkerRuns(["WBS", "5,00", "10^9/l", "4,00", "-", "10,00", "(X)"], 5)).toEqual(["WBS", "5,00", "10^9/l", "4,00", "-", "10,00", "(X)"]);
  });
});

/**
 * `results/adapt/mistral_ocr_digital/2022_10_17_krev__p2.json`, verbatim.
 *
 * `Výkon` is empty in every data row. `shareOf` counts only non-empty cells,
 * so that column scored 1.0 on its own header label and was elected the name —
 * which left the real name column unclaimed, and `isUnitCell` took it. Every
 * row came back with the analyte as its own unit: `MCV` in `unit_raw`.
 *
 * One departure from the stored answer, stated because it matters: that page
 * has `Ref.meze` and `Rozměr` fused into one printed cell (`82,0 - 98,0 fl`),
 * which is Mistral's table reconstruction and not something this mapping can
 * undo. They are separated here so the column election is the only thing under
 * test; the fusion is reported as a residual, not fixed.
 */
const EMPTY_LIS_COLUMN_PAGE = `|  A | Výkon | Název metody | Hodnocení | Ref.meze | Rozměr  |
| --- | --- | --- | --- | --- | --- |
|  A |  | MCV | 89,0 | | * |  82,0 - 98,0  | fl |
|  A |  | MCH | 30,9 | | * |  28,0 - 34,0  | pg |
|   |  | Neutrofily-abs | 3,13 | | * |  2,00 - 7,00  | 10^9/l |
|   |  | Lymfocyty-abs | 1,91 | | * |  0,80 - 4,00  | 10^9/l |`;

describe("R9 — a share computed over one cell is not a majority", () => {
  it("THE REGRESSION: MCV came back as the unit of MCV", () => {
    // Row 0 is this table's own header, kept for the same reason as on
    // ONE_SIDED_PAGE: `Hodnocení` is not a value label anywhere in
    // COLUMN_RULES, so rule 3 refuses the header and row 0 is data.
    const rows = rowsFromTable(EMPTY_LIS_COLUMN_PAGE, 0.99).rows.slice(1);
    expect(rows.map((r) => r.raw_analyte_name)).toEqual(["MCV", "MCH", "Neutrofily-abs", "Lymfocyty-abs"]);
    for (const r of rows) expect(r.unit_raw).not.toBe(r.raw_analyte_name);
    expect(rows.map((r) => r.unit_raw)).toEqual(["fl", "pg", "10^9/l", "10^9/l"]);
    expect(rows[0].ref_range_raw).toBe("82,0 - 98,0");
  });

  it("refuses to elect a column whose only non-empty cell is its own label", () => {
    // `Výkon` is empty in all four data rows. Before R9 it scored 1.0 for
    // "mostly words" on that single header cell and was elected the name.
    const grid = splitMarkdownTable(EMPTY_LIS_COLUMN_PAGE);
    expect(grid.map((r) => r[1])).toEqual(["Výkon", "", "", "", ""]);
    expect(rowsFromTable(EMPTY_LIS_COLUMN_PAGE, 0.99).rows[1].raw_analyte_name).toBe("MCV");
  });

  it("still keeps the odd row that prints its name in the code column", () => {
    // `| 81347 | pH | | 5,5 | 4,5 - 5,5 |` among neighbours that print the
    // name one cell further right. The fallback fires only where the name
    // column itself yields nothing, so it can never override a real name.
    // `results/adapt/mistral_ocr_digital/2024_02_02__p2.json`, verbatim.
    const t = `|  A | Výkon | Název metody | Hodnocení | Ref.meze | Rozměr  |
| --- | --- | --- | --- | --- | --- |
|   |  | Neutrofily | 58,6 | 45,0 - 70,0 | %  |
|   |  | Lymfocyty | 26,0 | 20,0 - 45,0 | %  |
|  81347 | pH |  | 5,5 | 4,5 - 5,5 |   |
|   |  | Urobilinogen | 3,2 | 3,2 - 16,0 | µmol/l  |
|   |  | Bakterie | 169 | 0 - 130 | el/µl  |`;
    const m = rowsFromTable(t, 0.99);
    expect(m.droppedColumns.join(" ")).toContain("LIS code column");
    expect(m.rows.slice(1).map((r) => r.raw_analyte_name)).toEqual(["Neutrofily", "Lymfocyty", "pH", "Urobilinogen", "Bakterie"]);
    expect(m.rows.slice(1).map((r) => r.unit_raw)).toEqual(["%", "%", "", "µmol/l", "el/µl"]);
  });

  it("does not disenfranchise a table too short for two rows to mean anything", () => {
    const t = `| S_Sodík | 141 | mmol/l | 137-145 |`;
    expect(rowsFromTable(t, 0.99).rows[0]).toMatchObject({ raw_analyte_name: "S_Sodík", value_raw: "141", unit_raw: "mmol/l" });
  });

  it("refuses a date column as the value, so a signature block is not a table", () => {
    // `results/adapt/mistral_ocr_digital/2022_07_01__p2.json`: the footer
    // Mistral returns beside the results. `01.07.2022` reads as numeric.
    const t = `|  Výsledky uvolnil : | 01.07.2022 | Číslo vzorku: | 01.MM-0035 | RNDr. Rozprimová Ladislava, CSc.  |
| --- | --- | --- | --- | --- |
|   | 01.07.2022 | Číslo vzorku: | 01.BB-0035 | RNDr. Rozprimová Ladislava, CSc.  |
|   | 01.07.2022 | Číslo vzorku: | 01.HH-0035 | RNDr. Rozprimová Ladislava, CSc.  |`;
    expect(rowsFromTable(t, 0.99).rows).toEqual([]);
  });
});

describe("the whole page, re-mapped off the answer Mistral gave", () => {
  it("re-maps 19_06_12 p1 with both interval forms and no bound as a value", () => {
    const page = {
      markdown: "",
      tables: [{ id: "tbl-0.md", content: `${SPLIT_RANGE_PAGE}\n${ONE_SIDED_PAGE.split("\n").slice(2).join("\n")}` }],
      blocks: [],
    } as any;
    const raw = rawAnswerFor(page);
    const rows = remapFromRaw(raw)!;
    expect(rows.map((r) => r.ref_range_raw)).toEqual([
      "4,00 - 10,00",
      "1,20 - 4,00",
      "0,10 - 1,40",
      "1,70 - 7,50",
      "0,38 - 0,52",
      "2,00 - 21,00",
      "< 2,85",
      "< 0,75",
      "< 0,58",
      "0,66 - 2,20",
      "< 4,14",
      "< 0,92",
      "3,90 - 5,60",
      "62,00 - 110",
      "2,80 - 8,00",
      "220 - 420",
      "66,00 - 88,00",
      "< 5,00",
    ]);
    expect(rows.map((r) => r.value_raw)).toEqual([
      "5,00", "1,40", "0,50", "3,10", "0,468",
      "14,86", "12,54", "0,49", "0,60", "1,92", "3,42", "0,26",
      "3,52", "99,1", "6,01", "345,7", "67,6", "0,1",
    ]);
  });
});

/**
 * `results/adapt/mistral_ocr_digital/19_06_12__p2.json`, verbatim.
 *
 * The same lab, the page after `ONE_SIDED_PAGE`, and the interval printed
 * across *two* cells rather than three — the separator and the operator come
 * back against the bound. Neither cell is an interval on its own and there is
 * no separator cell, so R1 and R6 both saw nothing and every reference range
 * on the page came back empty.
 */
const GLUED_RANGE_PAGE = `|  LIPIDY - sérum | Výsledek | Jednotka | Referenční interval |   | Hodnocení  |
| --- | --- | --- | --- | --- | --- |
|  Cholesterol celkový | **3,92** | mmol/l |  | < 5,20 | (X)  |
|  HDL-cholesterol | **1,51** | mmol/l | 1,00 | - 2,10 | (X)  |
|  LDL-cholesterol | **1,93** | mmol/l | 1,20 | - 3,00 | (X)  |
|  Triacylglyceroly | **0,9** | mmol/l |  | < 2,30 | (X)  |`;

describe("R10 — the same interval split across two cells, not three", () => {
  it("THE REGRESSION: the whole reference column came back empty", () => {
    const rows = rowsFromTable(GLUED_RANGE_PAGE, 0.99).rows.slice(1);
    expect(rows.map((r) => r.ref_range_raw)).toEqual(["< 5,20", "1,00 - 2,10", "1,20 - 3,00", "< 2,30"]);
    expect(rows.map((r) => r.value_raw)).toEqual(["3,92", "1,51", "1,93", "0,9"]);
    expect(rows.map((r) => r.unit_raw)).toEqual(["mmol/l", "mmol/l", "mmol/l", "mmol/l"]);
  });

  it("finds the two-column group and joins it in the deployed form", () => {
    expect(findRangeGroup(splitMarkdownTable(GLUED_RANGE_PAGE).slice(1), null)).toEqual({ low: 3, sep: null, high: 4 });
    expect(joinRange("1,00", "- 2,10")).toBe("1,00 - 2,10");
    expect(joinRange("", "< 5,20")).toBe("< 5,20");
    expect(joinRange("", "≤ 5,20")).toBe("≤ 5,20");
    expect(joinRange("", "<5,20")).toBe("< 5,20");
    // A dash with no low bound is not an interval, here as anywhere else.
    expect(joinRange("", "- 2,10")).toBe("");
  });

  it("parses in lab-core as one interval, both ways round", () => {
    const rows = rowsFromTable(GLUED_RANGE_PAGE, 0.99).rows.slice(1);
    expect(parseRange(rows[0].ref_range_raw)).toEqual({ low: null, high: 5.2, text: null });
    expect(parseRange(rows[1].ref_range_raw)).toEqual({ low: 1, high: 2.1, text: null });
  });

  it("does NOT read a negative bound as a separator and a number", () => {
    // `-10,0` is a bound; only `- 10,0` — with the space — is a separator and
    // a bound, and BOUND_CELL already claims the first.
    expect(joinRange("4,00", "-10,0")).toBe("4,00 - -10,0");
    const t = `| S_Base excess | -1,2 | mmol/l | -3,0 | -3,0 |\n| S_Anion gap | 12 | mmol/l | 8 | 16 |`;
    expect(findRangeGroup(splitMarkdownTable(t), null)).toBeNull();
  });

  it("leaves the three-cell form to R1 and R6, which get first refusal", () => {
    expect(findRangeGroup(splitMarkdownTable(SPLIT_RANGE_PAGE).slice(1), null)).toEqual({ low: 3, sep: 4, high: 5 });
    expect(findRangeGroup(splitMarkdownTable(ONE_SIDED_PAGE).slice(1), null)).toEqual({ low: 3, sep: 4, high: 5 });
  });
});

/* ==========================================================================
 * mistral_annot — Mistral fills our schema itself.
 *
 * A different arm in kind: there is no mapping between the API and the score,
 * so nothing above applies to it and the only things worth testing are (a)
 * that the request really carries the deployed schema and the deployed Czech
 * prompt rather than a copy that can drift, (b) that the shape normalisation
 * repairs shape and NEVER text, and (c) that the two arms cannot be confused
 * for each other when a stored answer is re-judged.
 *
 * The fixtures are what the real API returned on 2026-09-08, copied out of
 * `tests/bench/results/adapt/mistral_annot/` (10 public pages, $0.050).
 * ======================================================================== */

/** `mistral_annot/breclav_p121.json`, the first three rows, verbatim. */
const ANNOT_BRECLAV = JSON.stringify({
  report_date: "2024-05-21",
  report_date_raw: "21.05.2024 10:08",
  lab_name: "Nemocnice Břeclav, příspěvková organizace, Oddělení laboratorní biochemie",
  patient_name: null,
  patient_id: null,
  measurements: [
    {
      raw_analyte_name: "urea",
      value_raw: "4,9000",
      unit_raw: "mmol/l",
      ref_range_raw: "( 2,5000 - 6,4000 )",
      source_snippet: "URE | * urea | 4,9000 |  | mmol/l | . | ( 2,5000 - 6,4000 ) | nozic | krutiire",
      confidence: "high",
    },
    {
      raw_analyte_name: "kreatinin",
      value_raw: "86,0000",
      unit_raw: "µmol/l",
      ref_range_raw: "( 49,0000 - 90,0000 )",
      source_snippet: "KRE | * kreatinin | 86,0000 |  | µmol/l | . | ( 49,0000 - 90,0000 ) | nozic | krutiire",
      confidence: "high",
    },
  ],
});

describe("mistral_annot — the schema is the deployed one, not a copy of it", () => {
  it("derives every field from TOOL.input_schema, so the arm cannot drift", () => {
    const schema = toAnnotationSchema(TOOL.input_schema) as any;
    const src = TOOL.input_schema as any;
    expect(Object.keys(schema.properties)).toEqual(Object.keys(src.properties));
    expect(schema.required).toEqual(src.required);
    expect(schema.additionalProperties).toBe(false);
    const item = schema.properties.measurements.items;
    expect(Object.keys(item.properties)).toEqual(Object.keys(src.properties.measurements.items.properties));
    expect(item.required).toEqual(src.properties.measurements.items.required);
    expect(item.additionalProperties).toBe(false);
  });

  it("makes exactly one shape conversion: a type array becomes anyOf", () => {
    const schema = toAnnotationSchema(TOOL.input_schema) as any;
    // The five header fields are `["string","null"]` in the Anthropic tool.
    expect(schema.properties.lab_name).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    // Everything else is copied through, `enum` arrays included — an array
    // that is a *value* must not be mistaken for an array of types.
    expect(schema.properties.measurements.items.properties.confidence).toEqual({
      type: "string",
      enum: ["high", "medium", "low"],
    });
    // And no Czech description is rewritten, dropped or translated: it is part
    // of what every other reader is asked.
    expect(schema.properties.measurements.items.properties.source_snippet.description).toBe(
      (TOOL.input_schema as any).properties.measurements.items.properties.source_snippet.description,
    );
  });

  it("names the format after the deployed tool and asks for strict mode", () => {
    const fmt = annotationFormat();
    expect(fmt.type).toBe("json_schema");
    expect(fmt.jsonSchema?.name).toBe(TOOL.name);
    expect(fmt.jsonSchema?.description).toBe(TOOL.description);
    expect(fmt.jsonSchema?.strict).toBe(true);
  });
});

describe("mistral_annot — the request", () => {
  const annot = mistralRequest({ model: "mistral-ocr-4-1", provider: "mistral" }, { kind: "image_annot", base64: "AAAA", mediaType: "image/png" });

  it("carries the deployed Czech instruction verbatim, never a paraphrase", () => {
    expect(annot.documentAnnotationPrompt).toBe(SYSTEM_EXTRACT_TEXT);
  });

  it("keeps the OCR fields, so the answer the annotation was made from is stored too", () => {
    expect(annot.tableFormat).toBe("markdown");
    expect(annot.includeBlocks).toBe(true);
    expect(annot.confidenceScoresGranularity).toBe("block");
    expect(annot.documentAnnotationFormat?.jsonSchema?.name).toBe(TOOL.name);
  });

  it("asks for no annotation on the arms that map the parse themselves", () => {
    const image = mistralRequest({ model: "m", provider: "mistral" }, { kind: "image", base64: "AAAA", mediaType: "image/png" });
    const pdf = mistralRequest({ model: "m", provider: "mistral" }, { kind: "pdf", base64: "AAAA", page: 1 });
    for (const req of [image, pdf]) {
      expect(req.documentAnnotationFormat).toBeUndefined();
      expect(req.documentAnnotationPrompt).toBeUndefined();
    }
    // And the page selector still belongs to the PDF arm alone.
    expect(pdf.pages).toEqual([0]);
    expect(annot.pages).toBeUndefined();
  });

  it("is billed on the higher tier, and the dry run prints the schema it sent", () => {
    expect(pagePriceUsd({ kind: "image_annot", base64: "", mediaType: "image/png" })).toBe(ANNOT_PAGE_PRICE_USD);
    expect(pagePriceUsd({ kind: "image", base64: "", mediaType: "image/png" })).toBe(PAGE_PRICE_USD);
    expect(ANNOT_PAGE_PRICE_USD).toBeGreaterThan(PAGE_PRICE_USD);
    const shown = JSON.stringify(describeRequest(annot));
    expect(shown).toContain("<base64,");
    expect(shown).not.toContain("AAAA");
    expect(shown).toContain("record_lab_results");
    expect(shown).toContain("Confidence nastav 'low'");
  });
});

describe("mistral_annot — the annotation is normalised in shape, never in text", () => {
  it("copies the printed cells byte for byte, parentheses and spacing included", () => {
    const a = measurementsFromAnnotation(ANNOT_BRECLAV);
    expect(a.notes).toEqual([]);
    // The exact failure the external Haiku mapper committed: it stripped the
    // parentheses off a reference range it was told to copy.
    expect(a.measurements[0].ref_range_raw).toBe("( 2,5000 - 6,4000 )");
    expect(a.measurements[0].value_raw).toBe("4,9000");
    expect(a.measurements[1].unit_raw).toBe("µmol/l");
    expect(a.measurements.map((m) => m.raw_analyte_name)).toEqual(["urea", "kreatinin"]);
    // The header fields are reported as returned — this arm really was asked
    // for them, unlike the parse arm, which nulls them by rule 11.
    expect(a.report_date).toBe("2024-05-21");
    expect(a.lab_name).toContain("Břeclav");
    expect(a.patient_name).toBeNull();
  });

  it("fills a missing or null cell with the empty string, and says so", () => {
    const a = measurementsFromAnnotation(
      JSON.stringify({ measurements: [{ raw_analyte_name: "S_Urea", value_raw: "4,5", ref_range_raw: null }] }),
    );
    expect(a.measurements[0]).toMatchObject({ raw_analyte_name: "S_Urea", value_raw: "4,5", unit_raw: "", ref_range_raw: "", source_snippet: "" });
    expect(a.notes).toContain('measurements[0].unit_raw missing → ""');
    expect(a.notes).toContain('measurements[0].ref_range_raw null → ""');
  });

  it("stringifies a number and records the loss, because 5 is not 5,0", () => {
    const a = measurementsFromAnnotation(JSON.stringify({ measurements: [{ raw_analyte_name: "S_Urea", value_raw: 5 }] }));
    expect(a.measurements[0].value_raw).toBe("5");
    expect(a.notes).toContain("measurements[0].value_raw was number, stringified");
  });

  it("drops a confidence outside the enum rather than inventing one", () => {
    const a = measurementsFromAnnotation(JSON.stringify({ measurements: [{ raw_analyte_name: "x", confidence: "velmi vysoká" }] }));
    expect(a.measurements[0].confidence).toBeUndefined();
    expect(a.notes.some((n) => n.includes("confidence not in enum"))).toBe(true);
  });

  it("returns no rows and a note when there is nothing to read", () => {
    for (const payload of [null, undefined, "", "not json", JSON.stringify([1, 2]), JSON.stringify({ rows: [] })]) {
      const a = measurementsFromAnnotation(payload as any);
      expect(a.measurements).toEqual([]);
      expect(a.notes.length).toBeGreaterThan(0);
    }
  });
});

describe("mistral_annot — a stored answer is re-judged as this arm, not the other", () => {
  const page: any = {
    index: 0,
    markdown: "[tbl-0.md](tbl-0.md)",
    tables: [{ id: "tbl-0.md", content: BRECLAV_RESULTS, format: "markdown" }],
    blocks: [{ type: "table", tableId: "tbl-0.md", confidenceScores: { averageContentConfidenceScore: 0.99 } }],
    confidenceScores: { averagePageConfidenceScore: 0.98 },
  };

  it("prefers the annotation over the OCR page the record also carries", () => {
    const raw: AnnotRawAnswer = { ...rawAnswerFor(page), documentAnnotation: ANNOT_BRECLAV };
    // The same record would map to four rows through `rowsFromOcrPage`; this
    // arm never ran that code, so re-judging it that way would be a fiction.
    expect(rowsFromOcrPage(page).measurements).toHaveLength(4);
    expect(remapFromRaw(raw)!.map((m) => m.raw_analyte_name)).toEqual(["urea", "kreatinin"]);
  });

  it("still re-maps the parse arm off the same field it always did", () => {
    expect(remapFromRaw(rawAnswerFor(page))).toHaveLength(4);
  });

  it("stores the OCR page beside the annotation, which is what makes a dropped row attributable", () => {
    // The real finding this exists for: on `stod_p5` two printed rows were in
    // Mistral's OCR markdown and absent from the annotation, so the loss is
    // provably the schema-filling model's and not the reader's.
    const raw: AnnotRawAnswer = { ...rawAnswerFor(page), documentAnnotation: ANNOT_BRECLAV };
    expect(raw.markdown).toBe(page.markdown);
    expect(raw.tables?.[0].content).toBe(BRECLAV_RESULTS);
    expect(raw.blocks).toEqual([{ tableId: "tbl-0.md", confidence: 0.99 }]);
  });
});

describe("the merged-row guard sees the annotation arm's output too", () => {
  it("reports a fused row the model returned, exactly as it would from the parser", () => {
    const a = measurementsFromAnnotation(
      JSON.stringify({
        measurements: [
          { raw_analyte_name: "Glukóza Cholesterol", value_raw: "5,32", unit_raw: "mmol/l", ref_range_raw: "3,6 - 5,6 2,9 - 5,0", source_snippet: "", confidence: "high" },
        ],
      }),
    );
    const truth = [
      { raw_analyte_name: "Glukóza", value_raw: "5,32" },
      { raw_analyte_name: "Cholesterol", value_raw: "4,80" },
    ];
    expect(mergedRows(a.measurements, truth)[0].reasons.sort()).toEqual(["name", "range"]);
  });

  it("reports nothing on the real answer, which is the arm's actual result", () => {
    expect(mergedRows(measurementsFromAnnotation(ANNOT_BRECLAV).measurements)).toEqual([]);
  });
});
