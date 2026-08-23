/**
 * PDFs → per-page rows, exactly as the browser builds them.
 *
 * The browser scales text coordinates into rendered-image pixel space before
 * clustering (web/src/pdf/pdf.ts). `buildRows` groups by vertical distance
 * with a tolerance proportional to the median glyph height, so a *uniform*
 * scale cannot change which items land in which row, nor their left-to-right
 * order. Reconstructing in PDF units here therefore yields byte-identical
 * `rowsAsText` without needing a canvas in Node — which is the only reason
 * this benchmark can run outside a browser at all.
 *
 * `hasTextLayer` mirrors the browser's probe test verbatim. If it drifts, the
 * benchmark starts measuring a path the demo would not have taken.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { buildRows, type TextRow, type Box } from "@bw/lab-core";

export interface BenchPage {
  file: string;
  pageNum: number;
  rows: TextRow[];
  hasTextLayer: boolean;
  /** Characters of printed text — a rough proxy for how dense the page is. */
  textLength: number;
  /**
   * Does the page paint a bitmap?
   *
   * This is what separates a scanned results page from a blank trailing one.
   * Both have almost no text items, so text alone cannot tell them apart — a
   * triage rule built on text counts alone classified a real scan as "skip".
   * A scan is a full-page image; a footer page is not.
   */
  hasImage: boolean;
}

export interface BenchDoc {
  file: string;
  pages: BenchPage[];
}

/** Timings for the parts that cost no API call, so the model can be judged
 *  against the floor rather than against zero. */
export interface ParseTiming {
  file: string;
  loadMs: number;
  pagesMs: number;
  pageCount: number;
}

export async function parsePdf(path: string): Promise<{ doc: BenchDoc; timing: ParseTiming }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const t0 = performance.now();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(path)),
    verbosity: 0,
  }).promise;
  const loadMs = performance.now() - t0;

  const t1 = performance.now();
  const pages: BenchPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const words: Array<{ text: string; box: Box }> = [];
    let textLength = 0;
    for (const item of content.items as any[]) {
      const str: string = item.str ?? "";
      if (!str.trim()) continue;
      textLength += str.length;
      // pdf.js transform is [a,b,c,d,e,f]; e/f are the text origin in PDF
      // units, measured from the bottom — hence the y flip.
      const [, , , , e, f] = item.transform as number[];
      const h = item.height ?? 10;
      const w = item.width ?? str.length * 5;
      words.push({ text: str, box: [e, -f - h, e + w, -f] as Box });
    }

    // Read the operator list rather than rasterising: this asks *whether* the
    // page paints an image without paying to render one.
    let hasImage = false;
    try {
      const ops = await page.getOperatorList();
      const OPS = (pdfjs as any).OPS ?? {};
      const imageOps = new Set(
        [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]
          .filter((v) => v !== undefined),
      );
      hasImage = ops.fnArray.some((fn: number) => imageOps.has(fn));
    } catch {
      // A page whose operators cannot be read is treated as possibly-inked,
      // because the failure mode of guessing "blank" is dropping real results.
      hasImage = true;
    }

    const rows = buildRows(words);
    pages.push({
      file: basename(path),
      pageNum: p,
      rows,
      // Same test as web/src/pdf/pdf.ts — kept identical on purpose.
      hasTextLayer: words.length >= 20 && rows.length >= 5,
      textLength,
      hasImage,
    });
  }
  const pagesMs = performance.now() - t1;

  return {
    doc: { file: basename(path), pages },
    timing: { file: basename(path), loadMs, pagesMs, pageCount: doc.numPages },
  };
}

/** Every real lab PDF, sorted. Gitignored medical data — never leaves the machine. */
export function realSamples(): string[] {
  return readdirSync("samples")
    .filter((f) => f.endsWith(".pdf"))
    .sort()
    .map((f) => join("samples", f));
}

/**
 * The Stage 1 screening subset: four files spread across the corpus.
 *
 * Chosen by *position* in the sorted list rather than by name. Sample
 * filenames encode blood-draw dates — which is why `samples/` is gitignored —
 * so naming them here would put personal data into a committed file. Picking
 * by position also makes the harness run against any corpus rather than only
 * this one.
 *
 * Sorted order is chronological for these filenames, so evenly spaced indices
 * span the oldest and newest lab layouts, which is what the subset is for: an
 * arm that only works on one lab fails here rather than surviving to the full
 * run.
 */
export function screenSamples(): string[] {
  const all = realSamples();
  if (all.length <= 4) return all;
  const step = (all.length - 1) / 3;
  return [0, 1, 2, 3].map((i) => all[Math.round(i * step)]);
}
