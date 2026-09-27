/**
 * Tesseract over every view the highlight bench scores (docs/plans/photo-highlight.md, arm T).
 *
 * Settings from the 2026-09-26 identity experiment (photo-capture.md): tesseract.js 7,
 * LSTM, `ces` alone (it scored within 2 % of `ces+eng`), raw pixels (greyscale,
 * normalise and threshold gained nothing or lost the dark set). Local traineddata:
 * set TESSDATA to a directory holding `ces.traineddata.gz`.
 *
 * tesseract.js is not a repo dependency; the bench is run with it installed
 * without saving (`npm i --no-save tesseract.js`).
 *
 *   BW_ROOT=<checkout with data> TESSDATA=<dir> npx tsx tests/bench/highlight/ocr.ts [workers]
 *
 * Writes $RESULTS/ocr/<view id>.json: { ms, width, height, words: [{ text, conf, box }] }.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import { RESULTS, loadTransforms, views } from "./common";

const TESSDATA = process.env.TESSDATA;
if (!TESSDATA) throw new Error("set TESSDATA to a directory with ces.traineddata.gz");
const nWorkers = Number(process.argv[2] ?? Math.max(1, Math.min(6, cpus().length - 2)));
const dir = join(RESULTS, "ocr");
mkdirSync(dir, { recursive: true });

const unique = new Map<string, string>(); // id -> path
for (const v of views(loadTransforms())) unique.set(v.id, v.path);
const queue = [...unique].filter(([id]) => !existsSync(join(dir, `${id}.json`)));
console.log(`${unique.size} images, ${queue.length} to OCR, ${nWorkers} workers`);

const { createWorker } = await import("tesseract.js");

async function run(id: number) {
  const w = await createWorker("ces", 1, { langPath: TESSDATA, cachePath: join(RESULTS, "ocr-cache"), gzip: true });
  while (queue.length) {
    const [vid, path] = queue.shift()!;
    const img = readFileSync(path);
    const meta = await sharp(img).metadata();
    const t0 = performance.now();
    const { data } = await w.recognize(img, {}, { blocks: true });
    const ms = performance.now() - t0;
    const words: Array<{ text: string; conf: number; box: number[]; line: number }> = [];
    let line = 0;
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      for (const wd of l.words) words.push({ text: wd.text, conf: wd.confidence, box: [wd.bbox.x0, wd.bbox.y0, wd.bbox.x1, wd.bbox.y1], line });
      line++;
    }
    writeFileSync(join(dir, `${vid}.json`), JSON.stringify({ ms, width: meta.width, height: meta.height, words }));
    console.log(`w${id} ${Math.round(ms)} ms (${queue.length} left)`);
  }
  await w.terminate();
}
await Promise.all(Array.from({ length: nWorkers }, (_, i) => run(i)));
