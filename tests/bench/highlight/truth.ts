/**
 * Step 1 of docs/plans/photo-highlight.md: the ground truth.
 *
 * For every photo: the source page's printed rows (pdf.js words through
 * `buildRows`, the PDF upload's path), and for every row the Sonnet reader
 * returned, which printed row it is. The row is found through the accepted
 * report (`loadBaseline()`): reader row -> truth measurement by name and value
 * (the join `valueErrors` uses) -> printed row by name and value (the join
 * `annotateMaterial` uses). A reader row that cannot be tied to exactly one
 * printed row is not scored, and counted.
 *
 * It also checks the mapping it relies on: sampling the photo inside every
 * mapped row, the ink must peak at zero shift. A transform off by part of a
 * row would move the peak.
 *
 *   BW_ROOT=<checkout with data> npx tsx tests/bench/highlight/truth.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { buildRows, type TextRow } from "@bw/lab-core";

import { aliasedNameKey, loadBaseline, nameKey, splitTruth, valKey, type RawMeasurement } from "../score";
import { BW_ROOT, RESULTS, loadTransforms, readerRows, views, type ReaderRow } from "./common";
import { applyH, type Box } from "./geometry";

export interface PageTruth {
  page: number;
  pdfSize: [number, number];
  /** `box` is the scored band (see `bands`); `ink` is the glyphs' own extent. */
  rows: Array<{ box: Box; ink: Box; text: string }>;
}

export interface PhotoTruth {
  photo: string;
  condition: string;
  source: string;
  pages: PageTruth[];
  /** One per reader row, index-aligned with the reader's measurements. null = not scored. */
  readerTruth: Array<{ page: number; row: number } | null>;
  unscored: Record<string, number>;
}

async function pdfRows(path: string): Promise<Map<number, PageTruth>> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const out = new Map<number, PageTruth>();
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const words: Array<{ text: string; box: Box }> = [];
    for (const item of content.items as any[]) {
      const str: string = item.str ?? "";
      if (!str.trim()) continue;
      const [, b, c, , e, f] = item.transform as number[];
      // Rotated text is a side label printed down the margin (a block name
      // like a vertical "ANÉMIE"). Its pdf.js box is not where its ink is, and
      // buildRows would merge it into whichever row shares its baseline,
      // making that truth row tall enough to swallow its neighbour.
      if (Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) continue;
      const h = item.height ?? 10;
      const w = item.width ?? str.length * 5;
      // Same arithmetic as packages/lab-core/src/pdf/pdf.ts, at scale 1 — so
      // rows are grouped exactly as the PDF upload groups them.
      const box: Box = [e, vp.height - f - h, e + w, vp.height - f];
      words.push({ text: str, box });
      // The glyphs' own extent, for the truth box: pdf.js's box is
      // [baseline - size, baseline], which leaves descenders out and sits a
      // quarter of a line above the ink. The font's ascent/descent put it on
      // the ink (what pymupdf's word boxes report too).
      const st = content.styles[item.fontName] ?? {};
      const asc = typeof st.ascent === "number" && st.ascent > 0 ? st.ascent : 0.8;
      const desc = typeof st.descent === "number" && st.descent < 0 ? st.descent : -0.2;
      glyph.set(box, [e, vp.height - f - asc * h, e + w, vp.height - f - desc * h]);
    }
    const rows: TextRow[] = buildRows(words);
    const inked: Box[] = rows.map((r) => {
      const bs = r.cellBoxes.map((b) => glyph.get(b) ?? b);
      return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
    });
    const banded = bands(inked);
    out.set(p, { page: p, pdfSize: [vp.width, vp.height], rows: rows.map((r, i) => ({ box: banded[i], ink: inked[i], text: r.cells.join(" ") })) });
  }
  return out;
}

const glyph = new Map<Box, Box>();

/**
 * Each row widened to a horizontal band: out to the page's text margins, or
 * to the midpoint of the gap to a row printed beside it on the same line (a
 * side-by-side table). The printed line is what the person sees framed; a
 * locator box that covers the whole line, or trailing noise after a short
 * row, is on the right row and must not be scored "centre on no row".
 */
export function bands(boxes: Box[]): Box[] {
  if (!boxes.length) return [];
  const minX = Math.min(...boxes.map((b) => b[0]));
  const maxX = Math.max(...boxes.map((b) => b[2]));
  const sameLine = (a: Box, b: Box) => Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5 * Math.min(a[3] - a[1], b[3] - b[1]);
  return boxes.map((b, i) => {
    let x0 = minX;
    let x1 = maxX;
    boxes.forEach((o, j) => {
      if (j === i || !sameLine(b, o)) return;
      if (o[2] <= b[0]) x0 = Math.max(x0, (o[2] + b[0]) / 2);
      if (o[0] >= b[2]) x1 = Math.min(x1, (b[2] + o[0]) / 2);
    });
    return [x0, b[1], x1, b[3]];
  });
}

/** Printed row index for each truth measurement, or -1. Consumed in order, like annotateMaterial. */
function locateTruth(truth: RawMeasurement[], rows: PageTruth["rows"]): number[] {
  const used = new Set<number>();
  return truth.map((t) => {
    const k = nameKey(t.raw_analyte_name);
    const v = valKey(t.value_raw);
    const hits: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (used.has(i)) continue;
      if (k && !nameKey(rows[i].text).includes(k)) continue;
      if (v && !valKey(rows[i].text).includes(v)) continue;
      hits.push(i);
    }
    if (!hits.length) return -1;
    // Prefer the row whose text is the report's snippet; else the first unused (printed order).
    const snip = (t.source_snippet ?? "").replace(/\s+/g, " ").trim();
    const exact = hits.find((i) => rows[i].text.replace(/\s+/g, " ").trim() === snip);
    const pick = exact ?? hits[0];
    used.add(pick);
    return pick;
  });
}

async function main() {
  const t = loadTransforms();
  process.chdir(BW_ROOT); // loadBaseline() reads data/reports relative to the cwd
  const baseline = loadBaseline();
  const bySource = new Map<string, Map<number, PageTruth>>();
  const out: Record<string, PhotoTruth> = {};
  const totals = { readerRows: 0, scored: 0 };
  const why: Record<string, number> = {};

  for (const [photo, e] of Object.entries(t)) {
    if (!bySource.has(e.source_file)) bySource.set(e.source_file, await pdfRows(join(BW_ROOT, "samples", e.source_file)));
    const pdf = bySource.get(e.source_file)!;
    const pages = e.pages.map((p) => pdf.get(p)!);
    const pageKey = e.pages.map((p) => `${e.source_file}#${p}`).join("+");
    const key = aliasedNameKey({ pageKey });

    // Truth measurements with their printed row.
    const truth: Array<RawMeasurement & { _page: number; _row: number }> = [];
    for (const pg of pages) {
      const all = baseline.get(`${e.source_file}#${pg.page}`) ?? [];
      const ms = splitTruth(all, key).measurements;
      const idx = locateTruth(ms, pg.rows);
      ms.forEach((m, i) => truth.push({ ...m, _page: pg.page, _row: idx[i] }));
    }

    const reads: ReaderRow[] = readerRows(photo);
    const free = [...truth];
    const unscored: Record<string, number> = {};
    const readerTruth = reads.map((r) => {
      const k = key(r.raw_analyte_name);
      const same = free.filter((m) => key(m.raw_analyte_name) === k);
      const pick = same.find((m) => valKey(m.value_raw) === valKey(r.value_raw));
      if (!pick) {
        const w = same.length ? "value differs from truth" : "no truth row by name";
        unscored[w] = (unscored[w] ?? 0) + 1;
        return null;
      }
      free.splice(free.indexOf(pick), 1);
      if (pick._row < 0) {
        unscored["truth row not found in text layer"] = (unscored["truth row not found in text layer"] ?? 0) + 1;
        return null;
      }
      return { page: pick._page, row: pick._row };
    });
    totals.readerRows += reads.length;
    totals.scored += readerTruth.filter(Boolean).length;
    for (const [k, v] of Object.entries(unscored)) why[k] = (why[k] ?? 0) + v;
    out[photo] = { photo, condition: e.condition, source: e.source_file, pages, readerTruth, unscored };
  }

  // The mapping check samples the photo's ink along every mapped row. "Ink" is
  // how much darker a pixel is than its blurred surroundings, so row shading,
  // shadows and glare — which vary slowly — drop out and glyph strokes stay.
  const viewList = views(t);
  const images = new Map<string, { data: Buffer; w: number; h: number }>();
  const img = async (path: string) => {
    if (!images.has(path)) {
      const g = await sharp(path).greyscale().raw().toBuffer({ resolveWithObject: true });
      const bl = await sharp(path).greyscale().blur(12).raw().toBuffer();
      const data = Buffer.alloc(g.data.length);
      for (let i = 0; i < data.length; i++) data[i] = 255 - Math.max(0, bl[i] - g.data[i]);
      images.set(path, { data, w: g.info.width, h: g.info.height });
    }
    return images.get(path)!;
  };
  const inkAt = async (v: (typeof viewList)[number], dy: number) => {
    const { data, w, h } = await img(v.path);
    let s = 0;
    let n = 0;
    for (const vp of v.pages) {
      const pt = out[v.photo].pages.find((p) => p.page === vp.page)!;
      for (const r of pt.rows) {
        const [x0, y0, x1, y1] = r.ink;
        for (let fy = 0.2; fy <= 0.81; fy += 0.2) for (let x = x0; x <= x1; x += 1.5) {
          const [px, py] = applyH(vp.H, [x, y0 + (y1 - y0) * fy + dy]);
          const ix = Math.round(px);
          const iy = Math.round(py);
          if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
          s += 1 - data[iy * w + ix] / 255;
          n++;
        }
      }
    }
    return n ? s / n : 0;
  };
  const peak = async (v: (typeof viewList)[number], grid: number[]) => {
    let best = grid[0];
    let bestInk = -1;
    for (const d of grid) {
      const k = await inkAt(v, d);
      if (k > bestInk) [best, bestInk] = [d, k];
    }
    return best;
  };
  writeFileSync(join(RESULTS, "truth.json"), JSON.stringify(out));
  console.log(`reader rows ${totals.readerRows}, scored ${totals.scored}; not scored: ${JSON.stringify(why)}`);

  // The mapping check. What could be wrong is the transform, so it tests that
  // and nothing else. The shift at which the sampled (high-passed) ink peaks is
  // partly a property of the page: one layout prints the analyte name half a
  // line above its value, so its rows' ink peaks 3 pt low on every shot of it.
  // So each angle/twopage view — and its oracle flattening — must peak where
  // the same page's flat shot peaks (a plain scale, nothing to get wrong),
  // within TOL. Rows are 12-15 pt apart; a transform error that matters moves
  // the peak by several points.
  const TOL = 1;
  const grid = Array.from({ length: 17 }, (_, i) => -4 + i * 0.5);
  const refDy = new Map<string, number>();
  for (const v of viewList) {
    if (v.variant !== "orig" || out[v.photo].condition !== "flat") continue;
    refDy.set(`${out[v.photo].source}#${v.pages[0].page}`, await peak(v, grid));
  }
  const moved = viewList.filter((v) => ["angle", "twopage"].includes(out[v.photo].condition));
  const offPeak: string[] = [];
  let n = 0;
  for (const v of moved) {
    for (const vp of v.pages) {
      const ref = refDy.get(`${out[v.photo].source}#${vp.page}`);
      if (ref === undefined) continue;
      const dy = await peak({ ...v, pages: [vp] }, grid);
      n++;
      if (Math.abs(dy - ref) > TOL) offPeak.push(`${v.id} ${v.variant} p${vp.page}: ${dy} vs flat ${ref}`);
    }
  }
  console.log(`mapping check: ${n} angle/twopage view-pages against ${refDy.size} flat references; peak moved more than ${TOL} pt on: ${offPeak.length ? offPeak.join(", ") : "none"}`);
  if (offPeak.length) process.exitCode = 1;
}

await main();
