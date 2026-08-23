/**
 * Runs the real buildRows against real PDFs through real pdf.js.
 *
 * The fixtures model layout conventions seen in Czech lab output rather than
 * the tidy table the demo generator produces — side-by-side tables, wrapped
 * analyte names, split reference-range columns, landscape pages, and a scan
 * with no text layer. The coordinate handling here mirrors pageAssets() so a
 * regression shows up in the same place the browser would hit it.
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
  parseRange,
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
