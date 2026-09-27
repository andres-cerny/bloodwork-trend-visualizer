/**
 * Tesseract over the photo corpus, as the portal would run it
 * (docs/plans/photo-capture.md, C3 and D). Free, local.
 *
 *   BW_MAIN=<checkout with data> npx vite-node tests/bench/photo_ocr.ts <orig|flat> [id-regex] [workers]
 *
 * Input is what the browser has in hand: decoded, EXIF-rotated, long edge
 * capped at PHOTO_MAX_EDGE, then (`flat`) `flattenPhoto`, then `enhanceRgba`.
 * `flat` skips photos the finder leaves alone — their flattened image *is* the
 * original, so the `orig` result stands for both (the scorer falls back).
 *
 * Settings from the identity experiment: tesseract.js 7, LSTM, `ces` alone,
 * 4.0.0_best_int — the traineddata the portal self-hosts.
 *
 * Writes $BW_MAIN/tests/bench/results/photo_ocr/<variant>/<slug>.json
 * (git-ignored — OCR text of patient photos): { ms, width, height, corners,
 * lines: [{ words: [{ text, conf, box }] }] }. Answered photos are skipped.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";

import { enhanceRgba, evenLight, flattenPhoto, lumaFromRgba } from "../../packages/lab-core/src/photo";
import { decodeForChecks, loadCorpus, MAIN } from "./photo_corpus";

const [variant = "orig", pattern = ".", workersArg] = process.argv.slice(2);
const VARIANTS = ["orig", "flat", "lit", "flatlit"];
if (!VARIANTS.includes(variant)) throw new Error(`usage: photo_ocr.ts <${VARIANTS.join("|")}> [id-regex] [workers]`);
const flatten = variant.startsWith("flat");
const lit = variant.endsWith("lit");
const re = new RegExp(pattern);
const nWorkers = Number(workersArg ?? Math.max(1, Math.min(6, cpus().length - 2)));
const dir = join(MAIN, "tests/bench/results/photo_ocr", variant);
mkdirSync(dir, { recursive: true });

export const slugOf = (id: string) => id.replace(/[/.]/g, "_");

const require = createRequire(import.meta.url);
const langPath = join(dirname(require.resolve("@tesseract.js-data/ces/package.json")), "4.0.0_best_int");
const { createWorker } = await import("tesseract.js");

const queue = loadCorpus().filter((p) => re.test(p.id) && !existsSync(join(dir, `${slugOf(p.id)}.json`)));
console.log(`${queue.length} photos to OCR (${variant}), ${nWorkers} workers`);

async function run(id: number) {
  const w = await createWorker("ces", 1, { langPath, cachePath: join(MAIN, "tests/bench/results/photo_ocr/cache"), gzip: true });
  while (queue.length) {
    const p = queue.shift()!;
    const d = await decodeForChecks(p.path);
    let { rgba, width, height } = d;
    let corners: number[][] | null = null;
    if (flatten) {
      const f = flattenPhoto(lumaFromRgba(rgba, width, height), rgba, width, height);
      if (!f.warped && !lit) continue;
      ({ width, height } = f);
      rgba = f.rgba as Uint8Array;
      corners = f.page?.corners ?? null;
    }
    let buf: Uint8ClampedArray;
    if (lit) buf = evenLight(rgba, width, height);
    else {
      buf = new Uint8ClampedArray(rgba);
      enhanceRgba(buf);
    }
    const png = await sharp(Buffer.from(buf.buffer), { raw: { width, height, channels: 4 } }).png().toBuffer();
    const t0 = performance.now();
    const { data } = await w.recognize(png, {}, { blocks: true });
    const ms = performance.now() - t0;
    const lines: any[] = [];
    for (const b of data.blocks ?? []) for (const para of b.paragraphs) for (const l of para.lines)
      lines.push({ words: l.words.map((wd: any) => ({ text: wd.text, conf: wd.confidence, box: [wd.bbox.x0, wd.bbox.y0, wd.bbox.x1, wd.bbox.y1] })) });
    writeFileSync(join(dir, `${slugOf(p.id)}.json`), JSON.stringify({ id: p.id, ms, width, height, corners, lines }));
    console.log(`w${id} ${p.id} ${Math.round(ms)} ms (${queue.length} left)`);
  }
  await w.terminate();
}
await Promise.all(Array.from({ length: nWorkers }, (_, i) => run(i)));
