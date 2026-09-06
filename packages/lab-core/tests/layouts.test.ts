/**
 * Runs the real buildRows against real PDFs through real pdf.js.
 *
 * The fixtures model layout conventions seen in Czech lab output rather than
 * the tidy table the demo generator produces — side-by-side tables, wrapped
 * analyte names, split reference-range columns, landscape pages, and a scan
 * with no text layer. The coordinate handling here mirrors pageAssets() so a
 * regression shows up in the same place the browser would hit it.
 *
 * The second group of fixtures (docs/plans/lab-adaptability.md, Phase A3)
 * models conventions the four-lab corpus did not cover. Where the row builder
 * reads a page back correctly but the parser behind it does not yet understand
 * the convention, the assertion states the printed truth and is marked
 * `it.fails` under a "KNOWN GAP (Phase B)" comment — Phase B flips it by
 * fixing lab-core, not by editing the expectation.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type Box,
  buildRows,
  rowsAsText,
  type TextRow,
  canonicalizeUnit,
  computeFlag,
  materialPrefix,
  normKey,
  parseRange,
  parseValue,
} from "@bw/lab-core";

/**
 * pdf.js returns Greek mu (U+03BC) where the document source used the micro
 * sign (U+00B5) — the very variance canonicalizeUnit folds. Real confirmation
 * that the fold is needed, so assertions compare folded text.
 */
const fold = (s: string) => s.replace(/[μµ]/g, () => canonicalizeUnit("µ") ?? "µ");

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function pageWords(file: string, pageNum = 1) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(join(FIXTURES, file)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });

  const words: Array<{ text: string; box: Box }> = [];
  for (const item of content.items as any[]) {
    const str: string = item.str ?? "";
    if (!str.trim()) continue;
    const [, , , , e, f] = item.transform as number[];
    const h = item.height ?? 10;
    const y0 = viewport.height - f - h;
    words.push({ text: str, box: [e, y0, e + (item.width ?? 0), y0 + h] });
  }
  return words;
}

/** Rows that look like a measurement: a name plus at least a value. */
const dataRows = (rows: TextRow[]) =>
  rows.filter((r) => r.cells.length >= 3 && /^[A-Za-zÀ-ž]/.test(r.cells[0] ?? ""));

describe("standard layout", () => {
  it("recovers each printed row with its cells in order", async () => {
    const rows = buildRows(await pageWords("standard.pdf"));
    const text = rowsAsText(rows);
    expect(text).toContain("S_Glukóza | 5,32 | mmol/l | (4,11-5,60)");
    expect(text).toContain("S_CRP | <1,0 | mg/l | (1,0-5,0)");
  });
});

describe("side-by-side tables", () => {
  it("does not merge a left-table row with the right-table row beside it", async () => {
    const rows = buildRows(await pageWords("two_column.pdf"));
    const merged = rows.filter(
      (r) => r.cells.some((c) => c.startsWith("S_")) && r.cells.some((c) => c.startsWith("B_")),
    );
    expect(merged.map((r) => r.cells.join(" | "))).toEqual([]);
  });

  it("keeps both tables' rows intact", async () => {
    const text = rowsAsText(buildRows(await pageWords("two_column.pdf")));
    expect(text).toContain("S_Sodík | 141 | mmol/l | 137-145");
    expect(text).toContain("B_Hemoglobin | 148 | g/l | (135-175)");
  });
});

describe("wrapped analyte names", () => {
  it("does not attach the continuation line to the next measurement", async () => {
    const rows = buildRows(await pageWords("wrapped_names.pdf"));
    const alt = rows.find((r) => r.cells.some((c) => c.includes("Alaninaminotransfer")));
    expect(alt?.cells.join(" | ")).toContain("0,93");
    // "séru" and "(ALT)" are continuations; neither may carry a stray value.
    const orphan = rows.find((r) => r.cells.length === 1 && r.cells[0] === "séru");
    expect(orphan).toBeDefined();
  });
});

describe("split reference-range columns", () => {
  it("keeps the lab's out-of-range marker attached to the value", async () => {
    const text = rowsAsText(buildRows(await pageWords("split_range.pdf")));
    expect(fold(text)).toContain(fold("S_ALT | 0,93 ! | µkat/l | 0,17 | 0,78"));
    expect(fold(text)).toContain(fold("S_GGT | 1,04 * | µkat/l | 0,14 | 0,84"));
  });
});

describe("landscape page with sections", () => {
  it("recovers rows and keeps section headings on their own line", async () => {
    const rows = buildRows(await pageWords("landscape_sections.pdf"));
    const text = rowsAsText(rows);
    expect(fold(text)).toContain(fold("S_Kreatinin | 89 | µmol/l | (62,00 - 110)"));
    expect(rows.some((r) => r.cells.length === 1 && r.cells[0] === "HEMATOLOGIE")).toBe(true);
  });
});

describe("scanned page", () => {
  it("yields no usable text layer, so the vision path is used", async () => {
    const words = await pageWords("scanned.pdf");
    expect(words.length).toBeLessThan(20);
    expect(dataRows(buildRows(words)).length).toBe(0);
  });
});

describe("tight line spacing", () => {
  it("keeps rows 11pt apart separate rather than merging them", async () => {
    const rows = buildRows(await pageWords("tight_rows.pdf"));
    const text = rowsAsText(rows);
    for (const name of ["S_Sodík", "S_Draslík", "S_Chloridy", "S_Vápník"]) {
      // Lines now carry a "<index>\t" prefix, so the analyte starts the first
      // *cell* rather than the line.
      const line = text.split("\n").find((l) => l.slice(l.indexOf("\t") + 1).startsWith(name));
      expect(line, `${name} should be on its own line`).toBeDefined();
      expect(line!.slice(line!.indexOf("\t") + 1).split(" | ")).toHaveLength(4);
    }
  });
});

describe("unit printed inside the value cell", () => {
  it("keeps the value and its unit together as one cell", async () => {
    const text = fold(rowsAsText(buildRows(await pageWords("unit_in_value.pdf"))));
    expect(text).toContain("S_Glukóza | 5,32 mmol/l | 4,11 - 5,60");
    expect(text).toContain("S_CRP | <1,0 mg/l | 1,0 - 5,0");
  });
});

describe("multi-page report", () => {
  it("reads each page independently, header and all", async () => {
    const p1 = rowsAsText(buildRows(await pageWords("multipage.pdf", 1)));
    const p2 = rowsAsText(buildRows(await pageWords("multipage.pdf", 2)));
    expect(p1).toContain("S_Urea | 5,62 | mmol/l | (2,80-8,00)");
    expect(p1).not.toContain("B_Erytrocyty");
    expect(p2).toContain("B_Hemoglobin | 149 | g/l | (135-175)");
  });
});

describe("the font the fixtures are rendered with", () => {
  it("does not lose the hyphen from a reference range", async () => {
    // The failure this pins: text drawn with plain Arial loses its hyphen when
    // read back through pdf.js, so a range printed "4,11-5,60" extracts as
    // "4,115,60" — which parses to a plausible wrong number instead of
    // failing. The fixtures are rendered with a bundled DejaVu for exactly
    // this reason; if someone repoints scripts/_fonts.py at a system font,
    // this is what catches it.
    const text = rowsAsText(buildRows(await pageWords("standard.pdf")));
    expect(text).toContain("(4,11-5,60)");
    expect(text, "hyphen lost — check the font in scripts/_fonts.py").not.toContain("4,115,60");
  });

  it("keeps every printed reference range parseable", async () => {
    const rows = buildRows(await pageWords("standard.pdf"));
    const ranges = rows
      .flatMap((r) => r.cells)
      .filter((c) => /^\(?\d[\d\s.,]*\s*-\s*\d/.test(c));
    expect(ranges.length, "no ranges found — the fixture changed shape").toBeGreaterThan(0);
    for (const raw of ranges) {
      const parsed = parseRange(raw);
      expect(parsed.low, `"${raw}" did not parse to an interval`).not.toBeNull();
      expect(parsed.high, `"${raw}" did not parse to an interval`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase A3 — the conventions the four-lab corpus did not cover.
// ---------------------------------------------------------------------------

/**
 * pageAssets() decides the vision route with exactly this rule; restated here
 * rather than imported because pageAssets needs a live pdf.js document.
 */
const hasTextLayer = (words: Array<{ text: string; box: Box }>) =>
  words.length >= 20 && buildRows(words).length >= 5;

/** Rows whose first cell is exactly `name`, in page order. */
const rowsNamed = (rows: TextRow[], name: string) => rows.filter((r) => r.cells[0] === name);

describe("slash material prefix with a separate Hodnocení column", () => {
  it("reads every printed row back, unit last, marker as its own cell", async () => {
    const rows = buildRows(await pageWords("slash_prefix.pdf"));
    const text = fold(rowsAsText(rows));
    expect(text).toContain("Název metody | Výsledek | Hodnocení | Ref. meze | Jednotka");
    expect(text).toContain("S/Sodík | 141 | 137 - 145 | mmol/l");
    expect(text).toContain("S/Draslík | 5,45 | ( * ) | 3,80 - 5,20 | mmol/l");
    expect(text).toContain("S/Chloridy | 104 | 97 - 108 | mmol/l");
    expect(text).toContain("S/Glukóza | 5,32 | (*) | 4,11 - 5,60 | mmol/l");
    expect(text).toContain(fold("S/Kreatinin | 89 | 62 - 110 | µmol/l"));
    expect(text).toContain("B/Hemoglobin | 148 | 135 - 175 | g/l");
    expect(text).toContain("B/Leukocyty | 11,20 | ( * ) | 4,00 - 10,00 | 10^9/l");
    expect(text).toContain("B/Trombocyty | 243 | 150 - 400 | 10^9/l");
  });

  it("keeps the section names and the material legend as single cells", async () => {
    const rows = buildRows(await pageWords("slash_prefix.pdf"));
    const singles = rows.filter((r) => r.cells.length === 1).map((r) => r.cells[0]);
    expect(singles).toContain("Biochemie");
    expect(singles).toContain("Krevní obraz");
    expect(singles).toContain(
      "Označení vyšetřovaného materiálu: S=sérum, P=plazma, B=plná krev, U=moč",
    );
  });

  it("leaves the '( * )' marker out of the value, so the value still parses", async () => {
    const rows = buildRows(await pageWords("slash_prefix.pdf"));
    const draslik = rowsNamed(rows, "S/Draslík")[0];
    expect(draslik.cells[1]).toBe("5,45");
    expect(draslik.cells[2]).toBe("( * )");
    const { low, high } = parseRange(draslik.cells[3]);
    expect(computeFlag(parseValue(draslik.cells[1]), low, high)).toBe("high");
  });

  // Phase B's prefix rule (normalize.ts, mirrored in normalize.py) reads the
  // slash form; these pin it. "S/Sodík" is the same serum sodium as "S_Sodík".
  it("recognises the slash as a material prefix", () => {
    expect(materialPrefix("S/Sodík")).toBe("s");
    expect(materialPrefix("B/Hemoglobin")).toBe("b");
  });
  it("drops the slash prefix from the registry key", () => {
    expect(normKey("S/Sodík")).toBe(normKey("S_Sodík"));
    expect(normKey("B/Hemoglobin")).toBe("hemoglobin");
  });
});

describe("hyphen, comma and underscore prefixes on one page", () => {
  it("reads every printed row back, hyphenated names intact", async () => {
    const text = fold(rowsAsText(buildRows(await pageWords("hyphen_comma_prefix.pdf"))));
    expect(text).toContain("S-Na | 141 | mmol/l | (137 - 145)");
    expect(text).toContain("S-K | 4,32 | mmol/l | (3,80 - 5,20)");
    expect(text).toContain("S,P-glukóza | 5,32 | mmol/l | (4,11 - 5,60)");
    expect(text).toContain(fold("U-amyláza | 3,15 | µkat/l | (0,00 - 7,50)"));
    expect(text).toContain(fold("P_Amoniak | 32 | µmol/l | (11 - 51)"));
    expect(text).toContain("dU_Kreatinin | 12,4 | mmol/d | (7,0 - 17,7)");
    expect(text).toContain("anti-TPO | 18,5 | kIU/l | (0,0 - 34,0)");
    expect(text).toContain("25-OH vitamin D | 62 | nmol/l | (75 - 250)");
  });

  it("does not mistake a hyphen inside a name for a material prefix", () => {
    // These must stay null after Phase B widens the prefix rule: "anti" and
    // "25" are not materials, and the hyphen belongs to the name.
    expect(materialPrefix("anti-TPO")).toBeNull();
    expect(materialPrefix("25-OH vitamin D")).toBeNull();
    expect(normKey("anti-TPO")).toBe("anti tpo");
    expect(normKey("25-OH vitamin D")).toBe("25 oh vitamin d");
  });

  it("still reads the underscore forms", () => {
    expect(materialPrefix("P_Amoniak")).toBe("p");
    expect(materialPrefix("dU_Kreatinin")).toBe("du");
    expect(normKey("P_Amoniak")).toBe("amoniak");
  });

  // Phase B's prefix rule reads the hyphen and comma forms; "S,P-" is one
  // code ("s,p": serum or plasma, the lab did not say which).
  it("recognises the hyphen form as a material prefix", () => {
    expect(materialPrefix("S-Na")).toBe("s");
    expect(materialPrefix("U-amyláza")).toBe("u");
  });
  it("recognises the comma form as one material code", () => {
    expect(materialPrefix("S,P-glukóza")).toBe("s,p");
  });
  it("drops the hyphen and comma prefixes from the registry key", () => {
    expect(normKey("S-Na")).toBe("na");
    expect(normKey("S,P-glukóza")).toBe("glukoza");
    expect(normKey("U-amyláza")).toBe(normKey("U_amyláza"));
  });
});

describe("abbreviation column, four-decimal values, a flag column, signature cells", () => {
  it("reads every printed row back with the abbreviation as its own first cell", async () => {
    const text = fold(rowsAsText(buildRows(await pageWords("zkr_column.pdf"))));
    expect(text).toContain(
      "Zkr. | Vyšetření | Výsl. | Text.výsl. | Jedn. | Referenční hodnoty | Kontrola I.stupně | Uvolnil",
    );
    expect(text).toContain("URE | urea | 4,9000 | mmol/l | ( 2,5000 - 6,4000 ) | kontr1 | uvoln1");
    expect(text).toContain(fold("KREA | kreatinin | 78,0000 | µmol/l | ( 44,0000 - 80,0000 ) | kontr1 | uvoln1"));
    expect(text).toContain(fold("KM | kyselina močová | 396,0000 | H | µmol/l | ( 150,0000 - 350,0000 ) | kontr1 | uvoln1"));
    expect(text).toContain("GLU | glukóza | 5,1000 | mmol/l | ( 3,9000 - 5,6000 ) | kontr1 | uvoln1");
    expect(text).toContain("CHOL | cholesterol | 4,8000 | mmol/l | ( 2,9000 - 5,0000 ) | kontr1 | uvoln1");
  });

  it("does not split an eight-cell row as if it were two side-by-side tables", async () => {
    const rows = buildRows(await pageWords("zkr_column.pdf"));
    const km = rows.find((r) => r.cells[0] === "KM");
    expect(km?.cells).toHaveLength(8);
    expect(km?.cells[3]).toBe("H");
    // Only the out-of-range row carries the flag cell.
    expect(rows.filter((r) => r.cells.includes("H"))).toHaveLength(1);
  });

  it("parses the four-decimal value and the spaced range, and flags from them", async () => {
    const rows = buildRows(await pageWords("zkr_column.pdf"));
    const km = rows.find((r) => r.cells[0] === "KM")!;
    const ure = rows.find((r) => r.cells[0] === "URE")!;
    expect(parseValue(km.cells[2])).toBe(396);
    expect(parseRange(km.cells[5])).toEqual({ low: 150, high: 350, text: null });
    expect(computeFlag(parseValue(km.cells[2]), 150, 350)).toBe("high");
    expect(parseValue(ure.cells[2])).toBe(4.9);
    expect(parseRange(ure.cells[4])).toEqual({ low: 2.5, high: 6.4, text: null });
  });
});

describe("Slovak sheet with group headings and a Materiál column", () => {
  it("reads every printed row back, en-dash ranges and Materiál intact", async () => {
    const text = fold(rowsAsText(buildRows(await pageWords("slovak_grouped.pdf"))));
    expect(text).toContain("Test | Výsledok | Hodnotiace kritériá | Jednotky | Materiál | Schválil");
    expect(text).toContain("Leukocyty [WBC] | 6,90 | 3,80–10,70 | 10^9/l | krv EDTA");
    expect(text).toContain("Erytrocyty [RBC] | 4,85 | 4,20–5,80 | 10^12/l | krv EDTA");
    expect(text).toContain("Hemoglobín [HGB] | 151 | 135–175 | g/l | krv EDTA");
    expect(text).toContain("Trombocyty [PLT] | 238 | 150–400 | 10^9/l | krv EDTA");
    expect(text).toContain("Glukóza | 5,10 | 3,90–5,60 | mmol/l | sérum");
    expect(text).toContain(fold("Kreatinín | 82 | 62–106 | µmol/l | sérum"));
    expect(text).toContain(fold("Kyselina močová | 430 | 202–417 | µmol/l | sérum"));
    expect(text).toContain("TSH | 2,15 | 0,27–4,20 | mIU/l | sérum");
    expect(text).toContain("fT4 | 16,2 | 12,0–22,0 | pmol/l | sérum");
    expect(text).toContain(
      "Anti CMV IgM (skríning) | <1,0 negatívne | <1,0 negatívne, >=1,0 pozitívne | index | sérum",
    );
  });

  it("keeps the group headings as single cells", async () => {
    const rows = buildRows(await pageWords("slovak_grouped.pdf"));
    const singles = rows.filter((r) => r.cells.length === 1).map((r) => r.cells[0]);
    expect(singles).toContain("Základná hematológia - Krvný obraz");
    expect(singles).toContain("Metabolity");
    expect(singles).toContain("Štítna žľaza");
  });

  it("parses the en-dash range and flags the urate from it", async () => {
    const rows = buildRows(await pageWords("slovak_grouped.pdf"));
    const km = rows.find((r) => r.cells[0] === "Kyselina močová")!;
    expect(parseRange(km.cells[2])).toEqual({ low: 202, high: 417, text: null });
    expect(computeFlag(parseValue(km.cells[1]), 202, 417)).toBe("high");
  });

  it("never turns the qualitative row into a number", async () => {
    const rows = buildRows(await pageWords("slovak_grouped.pdf"));
    const cmv = rows.find((r) => r.cells[0] === "Anti CMV IgM (skríning)")!;
    expect(parseValue(cmv.cells[1])).toBeNull();
    const range = parseRange(cmv.cells[2]);
    expect(range.low).toBeNull();
    expect(range.high).toBeNull();
    expect(computeFlag(null, range.low, range.high)).toBe("unknown");
  });

  // KNOWN GAP (Phase B): the material is a column here, not a prefix, and
  // nothing in lab-core reads it. materialPrefix() is the only material
  // signal and it sees a bare name.
  it.fails("KNOWN GAP (Phase B): takes the material from the Materiál column", async () => {
    const rows = buildRows(await pageWords("slovak_grouped.pdf"));
    const glu = rows.find((r) => r.cells[0] === "Glukóza")!;
    expect(glu.cells[4]).toBe("sérum");
    expect(materialPrefix(glu.cells[0])).toBe("s");
  });
});

describe("prefix-free urine rows under a heading", () => {
  it("reads the serum block and the urine block back as printed", async () => {
    const text = fold(rowsAsText(buildRows(await pageWords("urine_no_prefix.pdf"))));
    expect(text).toContain("Glukóza | 5,4 | mmol/l | 3,9 - 5,6");
    expect(text).toContain("Urea | 5,1 | mmol/l | 2,8 - 8,1");
    expect(text).toContain(fold("Kreatinin | 84 | µmol/l | 62 - 106"));
    expect(text).toContain("Glukóza | 0,3 | mmol/l | 0 - 0,8");
    expect(text).toContain("Bílkovina | 0,10 | g/l | 0 - 0,15");
    // No unit printed: three cells, and the range must not slide into the unit slot.
    expect(text).toContain("pH | 6,0 | 5,0 - 7,0");
    expect(text).toContain("Hustota | 1,015 | 1,003 - 1,030");
    expect(text).toContain("Močový sediment | negativní");
  });

  it("keeps both Glukóza rows, in page order, under their own headings", async () => {
    const rows = buildRows(await pageWords("urine_no_prefix.pdf"));
    const glu = rowsNamed(rows, "Glukóza");
    expect(glu.map((r) => r.cells[1])).toEqual(["5,4", "0,3"]);
    const idx = (name: string) => rows.findIndex((r) => r.cells.length === 1 && r.cells[0] === name);
    expect(idx("Biochemie")).toBeGreaterThan(-1);
    expect(idx("Moč chemicky")).toBeGreaterThan(idx("Biochemie"));
    expect(rows.indexOf(glu[0])).toBeGreaterThan(idx("Biochemie"));
    expect(rows.indexOf(glu[0])).toBeLessThan(idx("Moč chemicky"));
    expect(rows.indexOf(glu[1])).toBeGreaterThan(idx("Moč chemicky"));
  });

  it("parses the urine values with their overlapping ranges", async () => {
    const rows = buildRows(await pageWords("urine_no_prefix.pdf"));
    const urine = rowsNamed(rows, "Glukóza")[1];
    expect(parseValue(urine.cells[1])).toBe(0.3);
    expect(parseRange(urine.cells[3])).toEqual({ low: 0, high: 0.8, text: null });
    const ph = rowsNamed(rows, "pH")[0];
    expect(parseValue(ph.cells[1])).toBe(6);
    expect(parseRange(ph.cells[2])).toEqual({ low: 5, high: 7, text: null });
    const sed = rowsNamed(rows, "Močový sediment")[0];
    expect(parseValue(sed.cells[1])).toBeNull();
  });

  // KNOWN GAP (Phase B): the page says which block is urine and nothing in
  // lab-core carries that down to the row. A serum glucose of 0,3 would be a
  // hypoglycaemic emergency; the same number under "Moč chemicky" is normal.
  it.fails("KNOWN GAP (Phase B): attributes the urine Glukóza to material U from its heading", async () => {
    const rows = buildRows(await pageWords("urine_no_prefix.pdf"));
    const urine = rowsNamed(rows, "Glukóza")[1];
    expect(materialPrefix(urine.cells[0])).toBe("u");
  });
});

describe("the same analyte under Sérum and under Moč", () => {
  it("reads all four rows back with their own values", async () => {
    const text = fold(rowsAsText(buildRows(await pageWords("mixed_material.pdf"))));
    expect(text).toContain("Glukóza | 5,4 | mmol/l | 3,9 - 5,6");
    expect(text).toContain(fold("Kreatinin | 84 | µmol/l | 62 - 106"));
    expect(text).toContain("Glukóza | 0,3 | mmol/l | 0 - 0,8");
    expect(text).toContain("Kreatinin | 9,8 | mmol/l | 3,5 - 25,0");
  });

  it("keeps both headings as single cells with the right rows between them", async () => {
    const rows = buildRows(await pageWords("mixed_material.pdf"));
    const idx = (name: string) => rows.findIndex((r) => r.cells.length === 1 && r.cells[0] === name);
    const serum = idx("Sérum");
    const urine = idx("Moč");
    expect(serum).toBeGreaterThan(-1);
    expect(urine).toBeGreaterThan(serum);
    const glu = rowsNamed(rows, "Glukóza").map((r) => rows.indexOf(r));
    expect(glu).toHaveLength(2);
    expect(glu[0]).toBeGreaterThan(serum);
    expect(glu[0]).toBeLessThan(urine);
    expect(glu[1]).toBeGreaterThan(urine);
  });

  it("has nothing in the cells themselves that tells the two apart", async () => {
    // This is the whole point of the fixture: name, unit and column shape are
    // identical, so whatever Phase B does, it has to come from the heading.
    const rows = buildRows(await pageWords("mixed_material.pdf"));
    const [serum, urine] = rowsNamed(rows, "Glukóza");
    expect(serum.cells[0]).toBe(urine.cells[0]);
    expect(serum.cells[2]).toBe(urine.cells[2]);
    expect(materialPrefix(serum.cells[0])).toBeNull();
    expect(materialPrefix(urine.cells[0])).toBeNull();
  });

  // KNOWN GAP (Phase B): see urine_no_prefix — the heading is the only
  // material signal on this page and nothing reads it yet.
  it.fails("KNOWN GAP (Phase B): tells the urine Glukóza from the serum one by its heading", async () => {
    const rows = buildRows(await pageWords("mixed_material.pdf"));
    const [serum, urine] = rowsNamed(rows, "Glukóza");
    expect(materialPrefix(serum.cells[0])).toBe("s");
    expect(materialPrefix(urine.cells[0])).toBe("u");
  });
});

describe("photo-like scan: rotated, low contrast, no text layer", () => {
  it("has no text layer, so the vision path is used", async () => {
    const words = await pageWords("scanned_photo_like.pdf");
    expect(words).toHaveLength(0);
    expect(hasTextLayer(words)).toBe(false);
    expect(dataRows(buildRows(words)).length).toBe(0);
  });

  it("is the same routing decision the plain scan gets, and a text page does not", async () => {
    expect(hasTextLayer(await pageWords("scanned.pdf"))).toBe(false);
    // identity.pdf: eight rows plus a header, comfortably over the threshold.
    expect(hasTextLayer(await pageWords("identity.pdf"))).toBe(true);
  });
});
