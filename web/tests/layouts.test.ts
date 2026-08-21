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
import type { Box } from "../src/lib/models";
import { buildRows, rowsAsText, type TextRow } from "../src/pdf/rows";
import { canonicalizeUnit } from "../src/lib/normalize";

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
