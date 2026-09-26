/**
 * Dump photos exactly as the app would send them to a reader, for a subagent
 * to read (tier 1, free — docs/plans/lab-adaptability.md, "Where Claude runs
 * during testing").
 *
 *   npx vite-node tests/bench/photo_dump.ts <outDir> <id-regex> [--flatten]
 *
 * For each corpus photo whose id matches: decode (EXIF-rotated, long edge
 * ≤ 2576), optionally find the page and flatten it, then `enhanceRgba` and
 * JPEG 85 — `encodePhoto` step for step. Writes `<outDir>/pages/<slug>.jpg`,
 * `<outDir>/prompts/system_vision.txt` and `tool_vision.json` (the deployed
 * prompt and schema, imported, verbatim) and `<outDir>/index.json` with each
 * slug's truth rows from the accepted reports.
 *
 * Everything written derives from git-ignored photos; point outDir at a
 * git-ignored place (tests/bench/results/… or a scratchpad).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import { SYSTEM_EXTRACT, TOOL } from "@bw/extraction";
import * as photo from "../../packages/lab-core/src/photo";
const { enhanceRgba, lumaFromRgba, PHOTO_JPEG_QUALITY } = photo;
import { loadBaseline } from "./score";
import { decodeForChecks, loadCorpus } from "./photo_corpus";

const [outDir, pattern = ".", ...flags] = process.argv.slice(2);
if (!outDir) throw new Error("usage: photo_dump.ts <outDir> <id-regex> [--flatten]");
const flatten = flags.includes("--flatten");
const re = new RegExp(pattern);

mkdirSync(join(outDir, "pages"), { recursive: true });
mkdirSync(join(outDir, "prompts"), { recursive: true });
writeFileSync(join(outDir, "prompts", "system_vision.txt"), SYSTEM_EXTRACT);
writeFileSync(join(outDir, "prompts", "tool_vision.json"), JSON.stringify(TOOL, null, 1));

const baseline = loadBaseline();
const index: any[] = [];
for (const p of loadCorpus().filter((p) => re.test(p.id))) {
  const d = await decodeForChecks(p.path);
  let { rgba, width, height } = d;
  let flat: any = null;
  if (flatten) {
    const f = (photo as any).flattenPhoto(lumaFromRgba(rgba, width, height), rgba, width, height);
    flat = { found: f.found, confidence: f.page?.confidence ?? 0, warped: f.warped };
    if (f.warped) ({ rgba, width, height } = f);
  }
  const buf = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
  enhanceRgba(buf);
  const slug = p.id.replace(/[/.]/g, "_").replace(/_jpg$|_png$/, "");
  const image = join(outDir, "pages", `${slug}.jpg`);
  await sharp(Buffer.from(buf.buffer, buf.byteOffset, buf.length), { raw: { width, height, channels: 4 } })
    .jpeg({ quality: Math.round(PHOTO_JPEG_QUALITY * 100) })
    .toFile(image);
  const truth = (p.pages ?? []).flatMap((n) => baseline.get(`${p.source_file}#${n}`) ?? []);
  index.push({ slug, id: p.id, condition: p.condition, expected: p.expected, image, width, height, flat, truthRows: truth.length, truth });
}
writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log(`${index.length} pages -> ${outDir}`);
