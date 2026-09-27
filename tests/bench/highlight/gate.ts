/**
 * The gate for the Ověření highlight on photos (photo-capture Phase E;
 * docs/plans/photo-highlight.md): the FINAL lab-core function, fed exactly
 * what the app feeds it, judged against exact truth. Free, local.
 *
 * Per photo, what `preparePhoto` (packages/lab-core/src/photo.ts) does, in
 * node: decode capped at PHOTO_MAX_EDGE (photo_corpus.ts `decodeForChecks`),
 * `lumaFromRgba` → `flattenPhoto` → `evenLight`, Tesseract (`ces`,
 * 4.0.0_best_int, the traineddata the portal self-hosts) on that picture, and
 * `toPhoto` from the found corners when the page was warped. Then what the app
 * does with it: `ocrRows` → `locatePhotoRows` with `photoRowGuard`. The quad
 * it returns is on the photo — the picture Ověření shows — and is judged there
 * (`judgeQuad`).
 *
 * The policy, decided 2026-09-27: page found and portrait → located on the
 * flattened OCR picture and carried back; no page found → OCR ran on the
 * original and locates there. No highlight on the photo at all for two sheets
 * (a found page wider than tall; or, with no page found, a landscape picture
 * or text in two blocks) and for text read tilted past MAX_TEXT_SKEW_DEG.
 * HL_NO_GUARD=1 turns the photo-level guard off, to show what it prevents.
 *
 * Truth: each printed row's glyph band (truth.ts) mapped source PDF → original
 * photo (the replayed simulator transform; for the bad-photo set, the page
 * corners its simulator records, per page for two-sheet shots) → decoded
 * pixels. The bad-set mapping is checked on ink against the same page's flat
 * shot, the way truth.ts checks the angle shots.
 *
 * Rows located: Sonnet's reads of the photo (sonnet_vision_dF). The bad set has
 * no reads of its own: each page borrows the reads of that page's `flat` shot —
 * the same printed rows, located on a worse picture.
 *
 *   BW_ROOT=<checkout with data> [HL_NO_GUARD=1] npx tsx tests/bench/highlight/gate.ts [workers]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { dirname, join } from "node:path";

import sharp from "sharp";

import {
  evenLight,
  flattenPhoto,
  homography,
  photoRowGuard,
  locatePhotoRows,
  lumaFromRgba,
  ocrRows,
  type OcrLine,
  type PageQuad,
  type Point,
} from "../../../packages/lab-core/src/photo";

import { decodeForChecks } from "../photo_corpus";
import { BW_ROOT, RESULTS, loadTransforms, readerRows, type ReaderRow } from "./common";
import { applyH, boxToQuad, judgeQuad, type Box, type Quad } from "./geometry";
import type { PageTruth, PhotoTruth } from "./truth";

const nWorkers = Number(process.argv[2] ?? Math.max(1, Math.min(8, cpus().length - 2)));
const OCR_DIR = join(RESULTS, "app", "ocr");
mkdirSync(OCR_DIR, { recursive: true });

type H3 = number[][];
const toH3 = (h: number[]): H3 => [h.slice(0, 3), h.slice(3, 6), h.slice(6, 9)];

interface Item {
  set: "sim" | "bad";
  name: string;
  path: string;
  condition: string;
  source: string;
  pages: number[];
  /** PDF points (top-left origin) -> original photo pixels, per page. */
  toOrig: (page: number, origSize: [number, number], pdfSize: [number, number]) => H3;
  /** Reads to locate and, index-aligned, the printed row each belongs to. */
  reads: ReaderRow[];
  readerTruth: Array<{ page: number; row: number } | null>;
  truthPages: PageTruth[];
  /** For the bad set: the sim flat shot of each page, the ink reference. */
  inkRef?: Record<number, string>;
}

const T = loadTransforms();
const truth: Record<string, PhotoTruth> = JSON.parse(readFileSync(join(RESULTS, "truth.json"), "utf8"));

const items: Item[] = [];
for (const [name, e] of Object.entries(T)) {
  items.push({
    set: "sim", name, path: join(BW_ROOT, "data/photos-sim", name), condition: e.condition, source: e.source_file, pages: e.pages,
    toOrig: (page) => e.pages_geo.find((g) => g.page === page)!.H,
    reads: readerRows(name), readerTruth: truth[name].readerTruth, truthPages: truth[name].pages,
  });
}
const flatShotOf = (src: string, page: number) =>
  Object.keys(T).find((n) => T[n].condition === "flat" && T[n].source_file === src && T[n].pages[0] === page);
const badManifest = join(BW_ROOT, "data/photos-bad/manifest.json");
if (existsSync(badManifest)) {
  for (const [name, m] of Object.entries<any>(JSON.parse(readFileSync(badManifest, "utf8")))) {
    if (!m.source_file) continue; // the blanks carry no report
    const quads: number[][][] | undefined = m.page_corners ?? (m.corners ? [m.corners] : undefined);
    const shots = (m.pages as number[]).map((p) => flatShotOf(m.source_file, p));
    if (!quads || shots.some((s) => !s)) continue;
    const reads: ReaderRow[] = [];
    const readerTruth: Item["readerTruth"] = [];
    const truthPages: PageTruth[] = [];
    const inkRef: Record<number, string> = {};
    (m.pages as number[]).forEach((p, i) => {
      const shot = shots[i]!;
      reads.push(...readerRows(shot));
      readerTruth.push(...truth[shot].readerTruth);
      truthPages.push(truth[shot].pages.find((q) => q.page === p)!);
      inkRef[p] = shot;
    });
    items.push({
      set: "bad", name, path: join(BW_ROOT, "data/photos-bad", name), condition: m.condition, source: m.source_file, pages: m.pages,
      toOrig: (page, [W, H], [pw, ph]) => {
        const q = quads[(m.pages as number[]).indexOf(page)];
        return toH3(homography([[0, 0], [pw, 0], [pw, ph], [0, ph]], q.map(([fx, fy]) => [fx * W, fy * H] as Point)));
      },
      reads, readerTruth, truthPages, inkRef,
    });
  }
}

interface Ocr {
  found: boolean;
  warped: boolean;
  confidence: number | null;
  corners: Point[] | null;
  origSize: [number, number];
  decSize: [number, number];
  flatSize: [number, number];
  ms: number;
  lines: OcrLine[];
}

const key = (it: Item) => `${it.set}_${it.name.replace(/\.jpg$/, "")}`;

async function runOcr() {
  const require = createRequire(import.meta.url);
  const langPath = join(dirname(require.resolve("@tesseract.js-data/ces/package.json")), "4.0.0_best_int");
  const queue = items.filter((it) => !existsSync(join(OCR_DIR, `${key(it)}.json`)));
  console.log(`${items.length} photos, ${queue.length} to OCR`);
  if (!queue.length) return;
  const { createWorker } = await import("tesseract.js");
  async function worker() {
    const w = await createWorker("ces", 1, { langPath, cachePath: join(RESULTS, "app", "cache"), gzip: true });
    while (queue.length) {
      const it = queue.shift()!;
      const meta = await sharp(it.path).metadata();
      const d = await decodeForChecks(it.path);
      const flat = flattenPhoto(lumaFromRgba(d.rgba, d.width, d.height), d.rgba, d.width, d.height);
      const pic = evenLight(flat.rgba, flat.width, flat.height);
      const png = await sharp(Buffer.from(pic.buffer), { raw: { width: flat.width, height: flat.height, channels: 4 } }).png().toBuffer();
      const t0 = performance.now();
      const { data } = await w.recognize(png, {}, { blocks: true });
      const ms = performance.now() - t0;
      const lines: OcrLine[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines)
        lines.push({ words: l.words.map((wd: any) => ({ text: wd.text, conf: wd.confidence, box: [wd.bbox.x0, wd.bbox.y0, wd.bbox.x1, wd.bbox.y1] as Box })) });
      const out: Ocr = {
        found: flat.found, warped: flat.warped, confidence: flat.page?.confidence ?? null, corners: flat.page?.corners ?? null,
        origSize: [meta.width!, meta.height!], decSize: [d.width, d.height], flatSize: [flat.width, flat.height], ms, lines,
      };
      writeFileSync(join(OCR_DIR, `${key(it)}.json`), JSON.stringify(out));
    }
    await w.terminate();
  }
  await Promise.all(Array.from({ length: nWorkers }, worker));
}

/** Original photo px -> decoded px, the frame the app shows and the quad is in. */
function decodedTruth(it: Item, o: Ocr): Array<{ page: number; row: number; quad: Quad; ink: Quad }> {
  const [W, H] = o.origSize;
  const [dw, dh] = o.decSize;
  const out: Array<{ page: number; row: number; quad: Quad; ink: Quad }> = [];
  for (const page of it.pages) {
    const pt = it.truthPages.find((p) => p.page === page)!;
    const Hpdf = it.toOrig(page, [W, H], pt.pdfSize);
    const map = (b: Box) => boxToQuad(b).map((p) => {
      const [x, y] = applyH(Hpdf, p);
      return [(x * dw) / W, (y * dh) / H] as [number, number];
    }) as Quad;
    pt.rows.forEach((r, row) => out.push({ page, row, quad: map(r.box), ink: map(r.ink) }));
  }
  return out;
}

/**
 * The bad-set mapping check. The vertical shift (in row heights) at which the
 * high-passed ink along the mapped glyph boxes peaks is a property of the page
 * (truth.ts); a bad shot must peak where the same page's flat shot peaks. A
 * wrong quad moves it.
 */
async function inkPeak(path: string, quads: Quad[], decSize: [number, number]): Promise<number> {
  const img = sharp(path).rotate().resize({ width: decSize[0], height: decSize[1], fit: "fill" }).greyscale();
  const g = await img.clone().raw().toBuffer();
  const bl = await img.clone().blur(12).raw().toBuffer();
  const [w, h] = decSize;
  const at = (x: number, y: number) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return null;
    return Math.max(0, bl[iy * w + ix] - g[iy * w + ix]);
  };
  let best = 0;
  let bestInk = -1;
  for (let s = -0.6; s <= 0.61; s += 0.1) {
    let sum = 0;
    let n = 0;
    for (const q of quads) {
      const [tl, tr, br, bl2] = q;
      for (let fy = 0.2; fy <= 0.81; fy += 0.2)
        for (let fx = 0; fx <= 1; fx += 0.01) {
          const lx = tl[0] + (tr[0] - tl[0]) * fx, ly = tl[1] + (tr[1] - tl[1]) * fx;
          const bx = bl2[0] + (br[0] - bl2[0]) * fx, by = bl2[1] + (br[1] - bl2[1]) * fx;
          const t = fy + s;
          const v = at(lx + (bx - lx) * t, ly + (by - ly) * t);
          if (v !== null) (sum += v), n++;
        }
    }
    const ink = n ? sum / n : 0;
    if (ink > bestInk) [best, bestInk] = [s, ink];
  }
  return best;
}

/**
 * A quarter of a row height: the grid steps a tenth, and a quad off by a row
 * moves the peak by a whole one. Blur, motion, tiny and micro shots are left
 * out of the check: their smeared ink has no sharp peak to find, and on them
 * the arm draws no box (0 % coverage), so their truth cannot hide a wrong one.
 */
const INK_TOL = 0.25;
const NO_INK = new Set(["blur", "motion", "tiny", "micro"]);
/** HL_NO_GUARD=1: the same run with the two-sheet guard off, to show what it prevents. */
const noGuard = process.env.HL_NO_GUARD === "1";

async function score() {
  type Cell = { photos: number; noPage: number; twoSheets: number; skewed: number; rows: number; right: number; wrong: number; wrongStrict: number; cases: string[] };
  const cells = new Map<string, Cell>();
  const cell = (k: string) => cells.get(k) ?? (cells.set(k, { photos: 0, noPage: 0, twoSheets: 0, skewed: 0, rows: 0, right: 0, wrong: 0, wrongStrict: 0, cases: [] }), cells.get(k)!);
  const inkOff: string[] = [];
  const ocrOf = (it: Item): Ocr => JSON.parse(readFileSync(join(OCR_DIR, `${key(it)}.json`), "utf8"));
  const simByName = new Map(items.filter((i) => i.set === "sim").map((i) => [i.name, i]));

  for (const it of items) {
    const o = ocrOf(it);
    const c = cell(`${it.set}|${it.condition}`);
    c.photos++;
    c.rows += it.readerTruth.filter(Boolean).length;
    const rowsTruth = decodedTruth(it, o);

    if (it.set === "bad" && it.inkRef && !NO_INK.has(it.condition)) {
      for (const page of it.pages) {
        const ref = simByName.get(it.inkRef[page])!;
        const ro = ocrOf(ref);
        const refPeak = await inkPeak(ref.path, decodedTruth(ref, ro).map((r) => r.ink), ro.decSize);
        const peak = await inkPeak(it.path, rowsTruth.filter((r) => r.page === page).map((r) => r.ink), o.decSize);
        if (Math.abs(peak - refPeak) > INK_TOL) inkOff.push(`${it.name} p${page}: ${peak.toFixed(1)} vs flat ${refPeak.toFixed(1)}`);
      }
    }

    // Exactly the app's inputs to locatePhotoRows.
    const page = o.corners ? ({ corners: o.corners } as unknown as PageQuad) : null;
    const [fw, fh] = o.flatSize;
    const toPhoto = o.warped && o.corners ? homography([[0, 0], [fw, 0], [fw, fh], [0, fh]], o.corners) : null;
    const guard = photoRowGuard(page, o.warped, o.lines, fw, fh);
    const withhold = noGuard ? null : guard;
    if (!o.found) c.noPage++;
    if (withhold === "two-sheets") c.twoSheets++;
    if (withhold === "skewed") c.skewed++;
    const reads = it.reads.map((r) => ({ rawAnalyteName: r.raw_analyte_name, valueRaw: r.value_raw }));
    const boxes = locatePhotoRows(reads, { rows: ocrRows(o.lines), toPhoto, withhold });

    it.readerTruth.forEach((tr, i) => {
      const b = boxes[i];
      if (!tr || !b) return;
      const ti = rowsTruth.findIndex((q) => q.page === tr.page && q.row === tr.row);
      const v = judgeQuad(b.quad as Quad, ti, rowsTruth.map((q) => q.quad));
      if (v.rightStrict) c.right++;
      if (!v.right) c.wrong++;
      if (!v.rightStrict) {
        c.wrongStrict++;
        c.cases.push(`${it.name} read#${i}: ${v.why}`);
      }
    });
  }

  const ORACLE: Record<string, string> = { flat: "0 · 94.3 %", dark: "0 · 87.6 %", glare: "0 · 82.4 %", crop: "0 · 93.6 %", angle: "0 · 61.1 %", twopage: "0 · 100 %" };
  const lines = ["| set | condition | photos | no page | two sheets | skewed | rows | wrong (plan) | wrong (strict) | coverage | oracle T |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  const tot: Record<string, Cell> = {};
  for (const [k, c] of [...cells].sort()) {
    const [set, cond] = k.split("|");
    lines.push(`| ${set} | ${cond} | ${c.photos} | ${c.noPage} | ${c.twoSheets} | ${c.skewed} | ${c.rows} | ${c.wrong} | ${c.wrongStrict} | ${((100 * c.right) / Math.max(1, c.rows)).toFixed(1)} % | ${set === "sim" ? ORACLE[cond] ?? "" : "—"} |`);
    const s = (tot[set] ??= { photos: 0, noPage: 0, twoSheets: 0, skewed: 0, rows: 0, right: 0, wrong: 0, wrongStrict: 0, cases: [] });
    for (const f of ["photos", "noPage", "twoSheets", "skewed", "rows", "right", "wrong", "wrongStrict"] as const) s[f] += c[f];
  }
  for (const [set, c] of Object.entries(tot))
    lines.push(`| **${set}** | **all** | ${c.photos} | ${c.noPage} | ${c.twoSheets} | ${c.skewed} | ${c.rows} | **${c.wrong}** | **${c.wrongStrict}** | **${((100 * c.right) / c.rows).toFixed(1)} %** | ${set === "sim" ? "0 · 82.1 %" : "—"} |`);
  console.log(lines.join("\n"));
  console.log(`bad-set ink check: ${inkOff.length ? "peak moved on " + inkOff.join(", ") : "every page peaks where its flat shot does"}`);
  const cases = Object.fromEntries([...cells].filter(([, c]) => c.cases.length).map(([k, c]) => [k, c.cases]));
  for (const [k, cs] of Object.entries(cases)) console.log(`${k}: ${cs.length} — ${cs.slice(0, 5).join("; ")}`);
  writeFileSync(join(RESULTS, "app", noGuard ? "gate_noguard.json" : "gate.json"), JSON.stringify({ table: lines, inkOff, cases }, null, 1));
  const wrong = Object.values(tot).reduce((s, c) => s + c.wrongStrict, 0);
  if (wrong || inkOff.length) process.exitCode = 1;
}

await runOcr();
await score();
