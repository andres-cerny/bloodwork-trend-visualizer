// Scratch: draw the found quad on a photo. npx vite-node tests/bench/photo_page_debug.ts <photo> <out.png>
import sharp from "sharp";
import { findPage, lumaFromRgba } from "../../packages/lab-core/src/photo";
import { decodeForChecks } from "./photo_corpus";

const [path, out] = process.argv.slice(2);
const d = await decodeForChecks(path);
const q = findPage(lumaFromRgba(d.rgba, d.width, d.height));
console.log(JSON.stringify(q && { ...q, corners: q.corners.map(([x, y]) => [Math.round(x / d.width * 100) / 100, Math.round(y / d.height * 100) / 100]) }));
if (q && out) {
  const pts = q.corners.map(([x, y]) => `${x},${y}`).join(" ");
  const svg = `<svg width="${d.width}" height="${d.height}"><polygon points="${pts}" fill="none" stroke="red" stroke-width="12"/></svg>`;
  await sharp(Buffer.from(d.rgba), { raw: { width: d.width, height: d.height, channels: 4 } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer().then((b) => sharp(b).resize(500).toFile(out));
}
