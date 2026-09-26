/**
 * Score the page finder on the corpus (docs/plans/photo-capture.md, C1).
 * Free, local.
 *
 *   npx vite-node tests/bench/photo_page.ts [ts|opencv]
 *
 * For every photo with known corners: mean corner error as a percentage of the
 * frame diagonal, whether a page was found, and time. Truth for a photo whose
 * page fills the frame (flat, dark, glare, crop, blur, …) is the frame itself:
 * "not found" is then correct — nothing to warp — and so is a quad within 3 %
 * of the frame. `twopage` has no single truth and is reported, not scored.
 *
 * `opencv` runs the textbook OpenCV.js pipeline (blur, close, Canny, largest
 * 4-point contour) from OPENCV_JS (a path to opencv.js) for the comparison.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findPage, lumaFromRgba, type Point } from "../../packages/lab-core/src/photo";
import { decodeForChecks, loadCorpus, MAIN } from "./photo_corpus";

const arm = process.argv[2] ?? "ts";
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;

type Finder = (rgba: Uint8Array, w: number, h: number) => Promise<{ corners: Point[]; cornerCut?: boolean; confidence?: number } | null>;

async function tsFinder(): Promise<Finder> {
  return async (rgba, w, h) => findPage(lumaFromRgba(rgba, w, h));
}

async function opencvFinder(): Promise<Finder> {
  const path = process.env.OPENCV_JS;
  if (!path) throw new Error("set OPENCV_JS to opencv.js");
  const { createRequire } = await import("node:module");
  const cv: any = createRequire(import.meta.url)(path);
  // The UMD build is a thenable Module; wait for its wasm runtime, never await the object itself.
  await new Promise<void>((res) => {
    const t = setInterval(() => cv.Mat && (clearInterval(t), res()), 20);
  });
  return async (rgba, w, h) => {
    const src = cv.matFromImageData({ data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width: w, height: h });
    const k = 480 / Math.max(w, h);
    const small = new cv.Mat(), grey = new cv.Mat(), closed = new cv.Mat(), edges = new cv.Mat();
    cv.resize(src, small, new cv.Size(Math.round(w * k), Math.round(h * k)), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, grey, cv.COLOR_RGBA2GRAY);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    cv.morphologyEx(grey, closed, cv.MORPH_CLOSE, kernel);
    cv.GaussianBlur(closed, closed, new cv.Size(5, 5), 0);
    cv.Canny(closed, edges, 30, 90);
    cv.dilate(edges, edges, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    const contours = new cv.MatVector(), hier = new cv.Mat();
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    let best: Point[] | null = null, bestA = 0.12 * small.cols * small.rows;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i), approx = new cv.Mat();
      const peri = cv.arcLength(c, true);
      cv.approxPolyDP(c, approx, 0.02 * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const a = cv.contourArea(approx);
        if (a > bestA) {
          bestA = a;
          const pts: Point[] = [];
          for (let j = 0; j < 4; j++) pts.push([approx.data32S[2 * j] / k, approx.data32S[2 * j + 1] / k]);
          best = orderCorners(pts);
        }
      }
      c.delete();
      approx.delete();
    }
    [src, small, grey, closed, edges, kernel, contours, hier].forEach((m) => m.delete());
    return best ? { corners: best } : null;
  };
}

/** Clockwise from top-left: by the sum and difference of coordinates. */
function orderCorners(p: Point[]): Point[] {
  const bySum = [...p].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const byDiff = [...p].sort((a, b) => a[0] - a[1] - (b[0] - b[1]));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]];
}

const finder = arm === "opencv" ? await opencvFinder() : await tsFinder();
const rows: any[] = [];
for (const p of loadCorpus()) {
  if (only && !only.test(p.id)) continue;
  if (p.corners === undefined || p.set === "notlab" || p.set === "public") continue;
  if (p.condition === "black" || p.condition === "wall" || p.condition === "micro") continue;
  const d = await decodeForChecks(p.path);
  const t0 = performance.now();
  const got = await finder(d.rgba, d.width, d.height);
  const ms = performance.now() - t0;
  const diag = Math.hypot(d.width, d.height);
  const full = p.corners && p.corners.every(([x, y], i) => [[0, 0], [1, 0], [1, 1], [0, 1]][i][0] === x && [[0, 0], [1, 0], [1, 1], [0, 1]][i][1] === y);
  let err: number | null = null;
  let correct: boolean | null = null;
  if (p.corners) {
    const truth = p.corners.map(([x, y]) => [x * d.width, y * d.height] as Point);
    if (got) err = truth.reduce((s, t, i) => s + Math.hypot(t[0] - got.corners[i][0], t[1] - got.corners[i][1]), 0) / 4 / diag;
    correct = full ? !got || (err !== null && err < 0.03) : err !== null && err < 0.03;
  }
  rows.push({ id: p.id, condition: p.condition, found: !!got, cornerCut: got?.cornerCut ?? null, confidence: got?.confidence ?? null, err, correct, ms });
}

const dir = join(MAIN, "tests/bench/results");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `photo_page_${arm}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const by = new Map<string, any[]>();
for (const r of rows) by.set(r.condition, [...(by.get(r.condition) ?? []), r]);
console.log(`arm ${arm}\ncondition       n  found  correct  median err%  max err%  cornerCut`);
for (const [c, rs] of by) {
  const errs = rs.map((r) => r.err).filter((e) => e !== null).sort((a, b) => a - b);
  const pct = (e: number | undefined) => (e === undefined ? "   -" : (100 * e).toFixed(1).padStart(5));
  console.log(
    `${c.padEnd(14)} ${String(rs.length).padStart(2)}  ${String(rs.filter((r) => r.found).length).padStart(5)}  ${String(rs.filter((r) => r.correct).length).padStart(7)}  ${pct(errs[errs.length >> 1]).padStart(11)}  ${pct(errs[errs.length - 1]).padStart(8)}  ${rs.filter((r) => r.cornerCut).length}`,
  );
}
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
const scored = rows.filter((r) => r.correct !== null);
console.log(`correct ${scored.filter((r) => r.correct).length}/${scored.length}; time median ${ms[ms.length >> 1].toFixed(0)} ms, p90 ${ms[Math.floor(ms.length * 0.9)].toFixed(0)} ms`);
