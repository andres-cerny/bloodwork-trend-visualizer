/**
 * C4, step 1: the 133 simulated photos as the readers would see them if the
 * portal sent the flattened picture (docs/plans/photo-capture.md, C4). Free.
 *
 *   BW_MAIN=<checkout with data> npx vite-node tests/bench/photo_dump.ts [variant]
 *
 * `variant` is `flatlit` (default): `flattenPhoto` then `evenLight` — the same
 * picture the OCR pass reads, which is the decision on record ("same picture
 * for OCR, readers and the highlight"). JPEG at PHOTO_JPEG_QUALITY.
 *
 * Writes a class beside the existing `photo` one, in the shape
 * `subagent_score_images.bench.ts` reads, under THIS checkout's git-ignored
 * results (a subagent in a worktree writes there, not into the main checkout):
 *
 *   tests/bench/results/subagent/photo_<variant>/
 *     pages/<slug>.jpg            the picture
 *     prompts/system_vision.txt   SYSTEM_EXTRACT, imported, verbatim
 *     prompts/tool_vision.json    TOOL, imported, verbatim
 *     index.json                  the `photo` class's entries — same slugs, same
 *                                 truth — with `image` pointing at the new page
 *     out/                        answers: sonnet_<variant>/ from subagents,
 *                                 gemini_<variant>/ from photo_flat_gemini.ts;
 *                                 and the unflattened baselines linked in
 *                                 (orig_sonnet_vision_dF, orig_gemini38_ultra)
 */
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

import { SYSTEM_EXTRACT, TOOL } from "@bw/extraction";
import { enhanceRgba, evenLight, flattenPhoto, lumaFromRgba, PHOTO_JPEG_QUALITY } from "../../packages/lab-core/src/photo";
import { decodeForChecks, MAIN } from "./photo_corpus";

const variant = process.argv[2] ?? "flatlit";
if (!["flatlit", "flat"].includes(variant)) throw new Error("usage: photo_dump.ts [flatlit|flat]");

const SRC = join(MAIN, "tests/bench/results/subagent/photo");
const OUT = resolve("tests/bench/results/subagent", `photo_${variant}`);
for (const d of ["pages", "prompts", "out"]) mkdirSync(join(OUT, d), { recursive: true });
writeFileSync(join(OUT, "prompts", "system_vision.txt"), SYSTEM_EXTRACT);
writeFileSync(join(OUT, "prompts", "tool_vision.json"), JSON.stringify(TOOL, null, 1));

// The unflattened reads, for the before/after table: linked, never copied.
for (const [name, from] of [["orig_sonnet_vision_dF", "sonnet_vision_dF"], ["orig_gemini38_ultra", "gemini38_ultra"]]) {
  const link = join(OUT, "out", name);
  if (!existsSync(link) && existsSync(join(SRC, "out", from))) symlinkSync(join(SRC, "out", from), link);
}

const index = JSON.parse(readFileSync(join(SRC, "index.json"), "utf8")) as any[];
const out: any[] = [];
for (const p of index) {
  const photo = join(MAIN, "data/photos-sim", `${p.slug.replace(/^sim__/, "")}.jpg`);
  const image = join(OUT, "pages", `${p.slug}.jpg`);
  let flat = { found: false, warped: false };
  if (!existsSync(image)) {
    const d = await decodeForChecks(photo);
    const f = flattenPhoto(lumaFromRgba(d.rgba, d.width, d.height), d.rgba, d.width, d.height);
    flat = { found: f.found, warped: f.warped };
    let buf: Uint8ClampedArray;
    if (variant === "flatlit") buf = evenLight(f.rgba, f.width, f.height);
    else {
      buf = new Uint8ClampedArray(f.rgba);
      enhanceRgba(buf);
    }
    await sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.length), { raw: { width: f.width, height: f.height, channels: 4 } })
      .jpeg({ quality: Math.round(PHOTO_JPEG_QUALITY * 100) })
      .toFile(image);
  }
  out.push({ ...p, image, meta: { ...p.meta, variant, ...flat } });
}
writeFileSync(join(OUT, "index.json"), JSON.stringify(out, null, 1));
console.log(`${out.length} pages -> ${OUT}`);
