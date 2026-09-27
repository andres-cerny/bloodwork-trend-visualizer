/**
 * The gate before building the photo highlight: arm T through the REAL app
 * pipeline (docs/plans/photo-highlight.md; photo-capture Phase E).
 *
 * Per photo, what `preparePhoto` (packages/lab-core/src/photo.ts) does, in node:
 * decode capped at PHOTO_MAX_EDGE (tests/bench/photo_corpus.ts `decodeForChecks`,
 * the same decode the photo-capture benches use), `lumaFromRgba` →
 * `flattenPhoto` → `evenLight`; Tesseract (`ces`, 4.0.0_best_int, the
 * traineddata the portal self-hosts) on that picture; the app's own
 * `ocrPhrases` (photoOcr.ts) → `buildRows`; then the highlight rule: a box only
 * when exactly one OCR row carries the reader's name and value (adapter.ts
 * `matchRows`, the rule arm T was scored on).
 *
 * The box is drawn on the picture the app would show: the flattened page when
 * it warped, the photo itself when the page was found square-on. When no page
 * is found with confidence (`flattenPhoto` → found: false), the app shows the
 * original with no highlight: every row of that photo is **uncovered**.
 *
 * Truth: each printed row's glyph band (truth.ts) mapped source PDF → photo
 * (the replayed simulator transform; for the bad-photo set, the page quad the
 * bad simulator records) → decoded pixels → flattened frame (the app's own
 * homography from the found corners). Judged by geometry.ts.
 *
 * Rows located: Sonnet's reads of the photo (sonnet_vision_dF). The bad set has
 * no reads of its own, so it borrows the reads of the same page's `flat` shot —
 * the same printed rows, located on a worse picture.
 *
 *   BW_ROOT=<checkout with data> [HL_NOPAGE=highlight] npx tsx tests/bench/highlight/app_t.ts [workers]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus } from "node:os";
import { dirname, join } from "node:path";

import sharp from "sharp";

import { buildRows } from "@bw/lab-core";
import { evenLight, flattenPhoto, homography, lumaFromRgba, ocrPhrases, applyHomography, type OcrLine, type Point } from "../../../packages/lab-core/src/photo";

import { decodeForChecks } from "../photo_corpus";
import { matchRows, type OcrRow } from "./adapter";
import { BW_ROOT, RESULTS, loadTransforms, readerRows } from "./common";
import { applyH, boxToQuad, judge, type Box, type Quad } from "./geometry";
import type { PhotoTruth } from "./truth";

const nWorkers = Number(process.argv[2] ?? Math.max(1, Math.min(8, cpus().length - 2)));
const OCR_DIR = join(RESULTS, "app", "ocr");
mkdirSync(OCR_DIR, { recursive: true });

interface Item {
  set: "sim" | "bad";
  name: string;
  path: string;
  condition: string;
  source: string;
  pages: number[];
  /** PDF points (top-left origin) -> original photo pixels, per page. */
  toOrig: (page: number, origSize: [number, number], pdfSize: [number, number]) => number[][];
  /** Which photo's reads and readerTruth to use. */
  readsOf: string;
}

const T = loadTransforms();
const truth: Record<string, PhotoTruth> = JSON.parse(readFileSync(join(RESULTS, "truth.json"), "utf8"));

const items: Item[] = [];
for (const [name, e] of Object.entries(T)) {
  items.push({
    set: "sim", name, path: join(BW_ROOT, "data/photos-sim", name), condition: e.condition, source: e.source_file, pages: e.pages,
    toOrig: (page) => e.pages_geo.find((g) => g.page === page)!.H, readsOf: name,
  });
}
const badManifest = join(BW_ROOT, "data/photos-bad/manifest.json");
if (existsSync(badManifest)) {
  for (const [name, m] of Object.entries<any>(JSON.parse(readFileSync(badManifest, "utf8")))) {
    const flatShot = Object.keys(T).find((n) => T[n].condition === "flat" && T[n].source_file === m.source_file && T[n].pages[0] === m.pages[0]);
    if (!flatShot || !m.corners || m.pages.length !== 1) continue;
    items.push({
      set: "bad", name, path: join(BW_ROOT, "data/photos-bad", name), condition: m.condition, source: m.source_file, pages: m.pages,
      toOrig: (_page, [W, H], [pw, ph]) => {
        const Hm = homography([[0, 0], [pw, 0], [pw, ph], [0, ph]], (m.corners as number[][]).map(([fx, fy]) => [fx * W, fy * H] as Point));
        return [Hm.slice(0, 3), Hm.slice(3, 6), Hm.slice(6, 9)];
      },
      readsOf: flatShot,
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
  const { createWorker } = await import("tesseract.js");
  const queue = items.filter((it) => !existsSync(join(OCR_DIR, `${key(it)}.json`)));
  console.log(`${items.length} photos, ${queue.length} to OCR`);
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

function score() {
  type Cell = { photos: number; noPage: number; rows: number; right: number; wrong: number; wrongStrict: number; cases: string[] };
  const cells = new Map<string, Cell>();
  const cell = (k: string) => cells.get(k) ?? (cells.set(k, { photos: 0, noPage: 0, rows: 0, right: 0, wrong: 0, wrongStrict: 0, cases: [] }), cells.get(k)!);
  items.forEach((it) => {
    const o: Ocr = JSON.parse(readFileSync(join(OCR_DIR, `${key(it)}.json`), "utf8"));
    const t = truth[it.readsOf];
    const reads = readerRows(it.readsOf);
    const c = cell(`${it.set}|${it.condition}`);
    c.photos++;
    const scored = t.readerTruth.filter(Boolean).length;
    c.rows += scored;
    if (!o.found) {
      c.noPage++;
      // The rule the gate was set with: original shown, no highlight, uncovered.
      // HL_NOPAGE=highlight measures the alternative: highlight on the original
      // anyway (OCR already ran on it, light evened; flatSize == decSize).
      if (process.env.HL_NOPAGE !== "highlight") return;
    }
    // original px -> decoded px -> shown picture px
    const [W, H] = o.origSize;
    const [dw, dh] = o.decSize;
    const [fw, fh] = o.flatSize;
    const toFlat = o.warped ? homography(o.corners!, [[0, 0], [fw, 0], [fw, fh], [0, fh]]) : null;
    const show = (Hpdf: number[][], p: Point): Point => {
      const [x, y] = applyH(Hpdf, p);
      const q: Point = [(x * dw) / W, (y * dh) / H];
      return toFlat ? applyHomography(toFlat, q) : q;
    };
    const quads: Array<{ page: number; row: number; quad: Quad }> = [];
    for (const page of it.pages) {
      const pt = t.pages.find((p) => p.page === page)!;
      const Hpdf = it.toOrig(page, [W, H], pt.pdfSize);
      pt.rows.forEach((r, row) => quads.push({ page, row, quad: boxToQuad(r.box).map((p) => show(Hpdf, p)) as Quad }));
    }
    const rows: OcrRow[] = buildRows(ocrPhrases(o.lines)).map((r) => ({ text: r.cells.join(" "), cells: r.cells, box: r.box as Box }));
    const idx = matchRows(reads, rows);
    t.readerTruth.forEach((tr, i) => {
      if (!tr || idx[i] < 0) return;
      const ti = quads.findIndex((q) => q.page === tr.page && q.row === tr.row);
      const v = judge(rows[idx[i]].box, ti, quads.map((q) => q.quad));
      if (v.rightStrict) c.right++;
      if (!v.right) c.wrong++;
      if (!v.rightStrict) {
        c.wrongStrict++;
        c.cases.push(`${it.name} read#${i}: ${v.why} (ocr row "${rows[idx[i]].text.slice(0, 40)}")`);
      }
    });
  });
  // Oracle-flattened T, from score_arms.ts on the same truth (2026-09-26).
  const ORACLE: Record<string, string> = { flat: "0 · 94.3 %", dark: "0 · 87.6 %", glare: "0 · 82.4 %", crop: "0 · 93.6 %", angle: "0 · 61.1 %", twopage: "0 · 100 %" };
  const lines = ["| set | condition | photos | no page | rows | wrong (plan) | wrong (strict) | coverage | oracle T (wrong · coverage) |", "|---|---|---|---|---|---|---|---|---|"];
  const tot: Record<string, Cell> = {};
  for (const [k, c] of [...cells].sort()) {
    const [set, cond] = k.split("|");
    lines.push(`| ${set} | ${cond} | ${c.photos} | ${c.noPage} | ${c.rows} | ${c.wrong} | ${c.wrongStrict} | ${((100 * c.right) / Math.max(1, c.rows)).toFixed(1)} % | ${set === "sim" ? ORACLE[cond] ?? "" : "—"} |`);
    const s = (tot[set] ??= { photos: 0, noPage: 0, rows: 0, right: 0, wrong: 0, wrongStrict: 0, cases: [] });
    for (const f of ["photos", "noPage", "rows", "right", "wrong", "wrongStrict"] as const) s[f] += c[f];
  }
  for (const [set, c] of Object.entries(tot))
    lines.push(`| **${set}** | **all** | ${c.photos} | ${c.noPage} | ${c.rows} | **${c.wrong}** | **${c.wrongStrict}** | **${((100 * c.right) / c.rows).toFixed(1)} %** | ${set === "sim" ? "0 · 82.1 %" : "—"} |`);
  console.log(lines.join("\n"));
  const cases = Object.fromEntries([...cells].filter(([, c]) => c.cases.length).map(([k, c]) => [k, c.cases]));
  for (const [k, cs] of Object.entries(cases)) console.log(`${k}: ${cs.length} — ${cs.slice(0, 5).join("; ")}`);
  writeFileSync(join(RESULTS, "app", `score${process.env.HL_NOPAGE === "highlight" ? "_nopage-highlight" : ""}.json`), JSON.stringify({ table: lines, cases }, null, 1));
}

await runOcr();
score();
