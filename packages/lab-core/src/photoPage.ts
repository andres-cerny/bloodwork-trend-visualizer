/**
 * Find the sheet in a photo and flatten it (docs/plans/photo-capture.md, C).
 *
 * The readers do not need this — both read every `angle` shot without a value
 * error (photo.ts, "No perspective correction") — but OCR does: a local
 * Tesseract found 8 of 57 identifiers on angled shots against 55 of 57 on flat
 * ones, and only a flat page gives the highlight straight rows to draw on.
 *
 * Pure: a greyscale buffer in, four corners and a warped RGBA buffer out, no
 * DOM. Chosen over OpenCV.js on `tests/bench/photo_page.ts` (2026-09-26, 180
 * scored photos, truth for `angle` = the simulator's own transform):
 *
 *     finder        correct  angle corner error (orig px)  time/photo  download
 *     this file     180/180  median 9.0, max 12.2          67 ms       3.3 kB gz
 *     OpenCV.js     174/180  median 6.6, max 8.2           25 ms       3.7 MB gz
 *
 * OpenCV's textbook contour pipeline misses all six `corner_cut` shots (a
 * sheet running off the frame has no closed contour); 9 px on a 3024 px photo
 * is well inside what OCR needs, and 1,100× smaller is the download a phone
 * makes before it can do anything.
 *
 * ## How
 *
 * 1. Downscale to `FIND_EDGE` and close (max then min filter): print is thin
 *    and dark, so closing erases it — text, table rules, logos — and leaves the
 *    sheet as one bright region against whatever it lies on.
 * 2. Sobel gradient; strong pixels vote in a Hough accumulator, each only near
 *    its own gradient direction (so a pixel votes for one line, not a fan).
 * 3. The strongest lines, split into roughly-horizontal and roughly-vertical,
 *    plus the four frame edges as stand-ins for a side the frame cut off.
 * 4. Every pair × pair is a candidate quadrilateral. Its score is the length of
 *    its sides that real edges support — pixels along the side whose gradient
 *    is strong, perpendicular to the side, and brighter *inside* (paper is
 *    lighter than a desk, a bezel, a book). The best convex candidate wins.
 *
 * `found` needs at least two supported sides and `confidence` (supported
 * length over real-side length) above `MIN_CONFIDENCE`. Below it the photo is
 * left alone: a bad warp is worse than a tilted page (the plan, C2).
 */

import type { Grey } from "./photoQuality";
import { downscaleGrey } from "./photoQuality";

export type Point = [number, number];

export interface PageQuad {
  /** Corners in the input's pixel space, clockwise from top-left. A corner
   *  may lie outside the frame when the sheet runs off it. */
  corners: [Point, Point, Point, Point];
  /** Supported side length over the length of the sides not stood in by the frame. */
  confidence: number;
  /** Which sides (top, right, bottom, left) are the frame's edge, not the sheet's. */
  frameSides: [boolean, boolean, boolean, boolean];
  /** A corner of the sheet lies outside the frame: part of the page is cut off. */
  cornerCut: boolean;
}

/** The long edge the finder works at. */
export const FIND_EDGE = 480;
/** Below this the photo is left as it is. */
export const MIN_CONFIDENCE = 0.8;

const CLOSE_RADIUS = 3;
const THETA_BINS = 180;
const MAX_LINES = 8;
const VOTE_SPREAD = 3; // degrees either side of the gradient direction
/** A pixel is print when the closing lifts it by more than this. */
const INK_LIFT = 40;
/** The most print a candidate sheet may leave outside itself. */
const MAX_INK_OUTSIDE = 0.1;

/* ------------------------------------------------------------ small filters */

function minMax(g: Grey, r: number, max: boolean): Grey {
  const { width: w, height: h } = g;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const pick = max ? Math.max : Math.min;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = g.data[y * w + x];
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, g.data[y * w + k]);
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x];
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[k * w + x]);
      out[y * w + x] = v;
    }
  return { data: out, width: w, height: h };
}

function blur3(g: Grey): Grey {
  const { width: w, height: h, data: s } = g;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += s[yy * w + xx];
          n++;
        }
      out[y * w + x] = sum / n;
    }
  return { data: out, width: w, height: h };
}

/* ------------------------------------------------------------------- lines */

/** A line in normal form: x·cosθ + y·sinθ = ρ, θ in [0, π). */
interface Line {
  theta: number;
  rho: number;
  votes: number;
  frame?: boolean;
}

function intersect(a: Line, b: Line): Point | null {
  const c1 = Math.cos(a.theta), s1 = Math.sin(a.theta), c2 = Math.cos(b.theta), s2 = Math.sin(b.theta);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return [(a.rho * s2 - b.rho * s1) / det, (b.rho * c1 - a.rho * c2) / det];
}

interface Gradient {
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
  strong: number;
  width: number;
  height: number;
}

function sobel(g: Grey): Gradient {
  const { width: w, height: h, data: d } = g;
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = d[i - w - 1], b = d[i - w], c = d[i - w + 1], l = d[i - 1], r = d[i + 1], e = d[i + w - 1], f = d[i + w], k = d[i + w + 1];
      gx[i] = c + 2 * r + k - a - 2 * l - e;
      gy[i] = e + 2 * f + k - a - 2 * b - c;
      mag[i] = Math.hypot(gx[i], gy[i]);
    }
  // "Strong": the 92nd percentile of non-zero magnitudes, but never below a
  // floor that a soft shadow ramp stays under.
  const nz = Array.from(mag).filter((m) => m > 0).sort((p, q) => p - q);
  const strong = Math.max(60, nz.length ? nz[Math.floor(nz.length * 0.92)] : 60);
  return { gx, gy, mag, strong, width: w, height: h };
}

function houghLines(G: Gradient): Line[] {
  const { width: w, height: h } = G;
  const diag = Math.ceil(Math.hypot(w, h));
  const nRho = 2 * diag + 1;
  const acc = new Float32Array(THETA_BINS * nRho);
  const cos = new Float32Array(THETA_BINS), sin = new Float32Array(THETA_BINS);
  for (let t = 0; t < THETA_BINS; t++) {
    cos[t] = Math.cos((t * Math.PI) / THETA_BINS);
    sin[t] = Math.sin((t * Math.PI) / THETA_BINS);
  }
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (G.mag[i] < G.strong) continue;
      let deg = Math.round((Math.atan2(G.gy[i], G.gx[i]) * 180) / Math.PI);
      deg = ((deg % 180) + 180) % 180;
      for (let dt = -VOTE_SPREAD; dt <= VOTE_SPREAD; dt++) {
        const t = (deg + dt + THETA_BINS) % THETA_BINS;
        const rho = Math.round(x * cos[t] + y * sin[t]) + diag;
        acc[t * nRho + rho] += G.mag[i];
      }
    }
  // Peaks with non-maximum suppression in a (±4°, ±6 px) window.
  const peaks: Line[] = [];
  const minVotes = G.strong * Math.min(w, h) * 0.12;
  for (let t = 0; t < THETA_BINS; t++)
    for (let r = 0; r < nRho; r++) {
      const v = acc[t * nRho + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -4; dt <= 4 && isMax; dt++)
        for (let dr = -6; dr <= 6; dr++) {
          const tt = (t + dt + THETA_BINS) % THETA_BINS;
          // Wrapping θ past 180° flips the sign of ρ.
          const rr = t + dt < 0 || t + dt >= THETA_BINS ? 2 * diag - r + dr : r + dr;
          if (rr < 0 || rr >= nRho || (dt === 0 && dr === 0)) continue;
          if (acc[tt * nRho + rr] > v) {
            isMax = false;
            break;
          }
        }
      if (isMax) peaks.push({ theta: (t * Math.PI) / THETA_BINS, rho: r - diag, votes: v });
    }
  peaks.sort((a, b) => b.votes - a.votes);
  return peaks.slice(0, 3 * MAX_LINES);
}

/* -------------------------------------------------------------- candidates */

/** Fraction of a side's in-frame length where the edge supports it. */
function support(G: Gradient, p: Point, q: Point, inward: Point): { supported: number; inFrame: number } {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(8, Math.round(len / 2));
  let inFrame = 0, supported = 0;
  for (let k = 0; k <= n; k++) {
    const x = p[0] + ((q[0] - p[0]) * k) / n, y = p[1] + ((q[1] - p[1]) * k) / n;
    if (x < 2 || y < 2 || x >= G.width - 2 || y >= G.height - 2) continue;
    inFrame++;
    // Best pixel within ±2 px across the side.
    let ok = false;
    for (let s = -2; s <= 2 && !ok; s++) {
      const xx = Math.round(x + inward[0] * s), yy = Math.round(y + inward[1] * s);
      const i = yy * G.width + xx;
      const m = G.mag[i];
      if (m < G.strong * 0.5) continue;
      // Perpendicular to the side and pointing inward: brighter inside.
      const along = (G.gx[i] * inward[0] + G.gy[i] * inward[1]) / m;
      if (along > 0.85) ok = true;
    }
    if (ok) supported++;
  }
  return { supported: (supported / (n + 1)) * len, inFrame: (inFrame / (n + 1)) * len };
}

/** Share of the print points outside a convex quad (corners clockwise in
 *  image space, i.e. y down). Sampled to at most ~4,000 points. */
function inkOutside(ink: Point[], c: Point[]): number {
  if (!ink.length) return 0;
  const step = Math.max(1, Math.floor(ink.length / 4000));
  let out = 0, n = 0;
  for (let i = 0; i < ink.length; i += step) {
    const [x, y] = ink[i];
    n++;
    for (let e = 0; e < 4; e++) {
      const [ax, ay] = c[e], [bx, by] = c[(e + 1) % 4];
      if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) {
        out++;
        break;
      }
    }
  }
  return out / n;
}

function isConvex(c: Point[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4], [cx, cy] = c[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (z === 0) return false;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

function area(c: Point[]): number {
  let s = 0;
  for (let i = 0; i < 4; i++) s += c[i][0] * c[(i + 1) % 4][1] - c[(i + 1) % 4][0] * c[i][1];
  return Math.abs(s) / 2;
}

/**
 * The sheet's four corners, or null when no candidate is supported well
 * enough to act on. Works on any size; corners come back in `g`'s pixels.
 */
export function findPage(input: Grey): PageQuad | null {
  const small = downscaleGrey(input, FIND_EDGE);
  const k = input.width / small.width;
  const shut = minMax(minMax(small, CLOSE_RADIUS, true), CLOSE_RADIUS, false);
  const closed = blur3(shut);
  const G = sobel(closed);
  // Print: pixels the closing lifted by more than INK_LIFT — thin dark detail.
  const ink: Point[] = [];
  for (let y = 0; y < small.height; y++)
    for (let x = 0; x < small.width; x++) {
      const i = y * small.width + x;
      if (shut.data[i] - small.data[i] > INK_LIFT) ink.push([x, y]);
    }
  const lines = houghLines(G);
  const { width: w, height: h } = small;

  const horiz = lines.filter((l) => Math.abs(l.theta - Math.PI / 2) < (35 * Math.PI) / 180).slice(0, MAX_LINES);
  const vert = lines.filter((l) => l.theta < (35 * Math.PI) / 180 || l.theta > (145 * Math.PI) / 180).slice(0, MAX_LINES);
  const top: Line = { theta: Math.PI / 2, rho: 0, votes: 0, frame: true };
  const bottom: Line = { theta: Math.PI / 2, rho: h - 1, votes: 0, frame: true };
  const left: Line = { theta: 0, rho: 0, votes: 0, frame: true };
  const right: Line = { theta: 0, rho: w - 1, votes: 0, frame: true };
  const H = [...horiz, top, bottom];
  const V = [...vert, left, right];

  type Candidate = { score: number; corners: Point[]; conf: number; frame: boolean[] };
  const candidates: Candidate[] = [];
  for (let a = 0; a < H.length; a++)
    for (let b = 0; b < H.length; b++) {
      if (a === b) continue;
      for (let c = 0; c < V.length; c++)
        for (let d = 0; d < V.length; d++) {
          if (c === d) continue;
          const [T, B, L, R] = [H[a], H[b], V[c], V[d]];
          const tl = intersect(T, L), tr = intersect(T, R), br = intersect(B, R), bl = intersect(B, L);
          if (!tl || !tr || !br || !bl) continue;
          // Order: top above bottom, left of right (checked at the centre line).
          if (tl[1] + tr[1] >= bl[1] + br[1] || tl[0] + bl[0] >= tr[0] + br[0]) continue;
          const corners = [tl, tr, br, bl];
          if (!isConvex(corners)) continue;
          if (corners.some(([x, y]) => x < -0.25 * w || x > 1.25 * w || y < -0.25 * h || y > 1.25 * h)) continue;
          const A = area(corners);
          if (A < 0.12 * w * h) continue;
          // Inward normals: rotate each side direction by 90° toward the centre.
          const cx = (tl[0] + tr[0] + br[0] + bl[0]) / 4, cy = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
          const sides: [Point, Point, Line][] = [[tl, tr, T], [tr, br, R], [br, bl, B], [bl, tl, L]];
          let score = 0, realLen = 0, realSides = 0;
          const frame: boolean[] = [];
          for (const [p, q, line] of sides) {
            frame.push(!!line.frame);
            if (line.frame) continue;
            const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
            let nx = -dy / len, ny = dx / len;
            const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
            if ((cx - mx) * nx + (cy - my) * ny < 0) (nx = -nx), (ny = -ny);
            const s = support(G, p, q, [nx, ny]);
            score += s.supported;
            realLen += s.inFrame;
            if (s.supported > 0.4 * s.inFrame && s.inFrame > 0.15 * Math.min(w, h)) realSides++;
          }
          if (realSides < 2 || realLen === 0) continue;
          const conf = score / realLen;
          // Supported length first; a tie goes to the larger sheet.
          const total = score * conf + A * 1e-6;
          if (conf >= MIN_CONFIDENCE) candidates.push({ score: total, corners, conf, frame });
        }
    }
  // A sheet holds its print. Of the best-scoring candidates, the first that
  // leaves at most MAX_INK_OUTSIDE of the print outside it wins — which is what
  // rejects a shaded table block or a coloured side bar inside the page.
  candidates.sort((p, q) => q.score - p.score);
  const best = candidates.slice(0, 24).find((c) => inkOutside(ink, c.corners) <= MAX_INK_OUTSIDE);
  if (!best) return null;
  const margin = 0.01 * Math.max(w, h);
  const cornerCut = best.corners.some(([x, y]) => x < -margin || y < -margin || x > w - 1 + margin || y > h - 1 + margin);
  return {
    corners: best.corners.map(([x, y]) => [x * k, y * k]) as PageQuad["corners"],
    confidence: best.conf,
    frameSides: best.frame as PageQuad["frameSides"],
    cornerCut,
  };
}

/* ------------------------------------------------------------------ warping */

/** The 3×3 homography (row-major, h33 = 1) taking `from[i]` to `to[i]`. */
export function homography(from: Point[], to: Point[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row, i) => row[8] / row[i]), 1];
}

export function applyHomography(H: number[], [x, y]: Point): Point {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

/** A4, portrait: height over width. */
export const A4 = Math.SQRT2;

/**
 * The output size for a quad: its mean side lengths, with the aspect snapped
 * to A4 (portrait or landscape) when within 15 % of it — a lab sheet is A4,
 * and a perspective quad's measured aspect is biased by the foreshortening
 * the warp is there to undo.
 */
export function flatSize(c: Point[], maxEdge: number): { width: number; height: number } {
  const d = (p: Point, q: Point) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  let w = Math.max(d(c[0], c[1]), d(c[3], c[2]));
  let h = Math.max(d(c[1], c[2]), d(c[0], c[3]));
  const r = h / w;
  if (Math.abs(r - A4) / A4 < 0.15) w = h / A4;
  else if (Math.abs(1 / r - A4) / A4 < 0.15) h = w / A4;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/**
 * Warp the quad `corners` of an RGBA image onto a `width`×`height` rectangle,
 * bilinear. Pixels that map outside the source (a corner the frame cut off)
 * are painted white, as paper.
 */
export function warpRgba(
  src: Uint8Array | Uint8ClampedArray,
  sw: number,
  sh: number,
  corners: Point[],
  width: number,
  height: number,
): Uint8ClampedArray {
  const H = homography([[0, 0], [width, 0], [width, height], [0, height]], corners);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [u, v] = applyHomography(H, [x + 0.5, y + 0.5]);
      const fx = u - 0.5, fy = v - 0.5;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const o = (y * width + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= sw || y0 + 1 >= sh) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
        continue;
      }
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = src[i00 + ch] * (1 - ax) + src[i10 + ch] * ax;
        const bot = src[i01 + ch] * (1 - ax) + src[i11 + ch] * ax;
        out[o + ch] = top * (1 - ay) + bot * ay;
      }
      out[o + 3] = 255;
    }
  return out;
}

export interface Flattened {
  /** A page was found with enough confidence to act on. */
  found: boolean;
  page: PageQuad | null;
  /** The picture was actually warped (found, and not already square-on). */
  warped: boolean;
  rgba: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/**
 * Find the page and, when it is found and not already filling the frame
 * square-on, warp it flat. Otherwise the input comes back untouched.
 */
export function flattenPhoto(
  grey: Grey,
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  maxEdge = Math.max(width, height),
): Flattened {
  const page = findPage(grey);
  if (!page) return { found: false, page: null, warped: false, rgba, width, height };
  // Already square-on: every corner within 1.5 % of the frame's own.
  const frame: Point[] = [[0, 0], [width, 0], [width, height], [0, height]];
  const tol = 0.015 * Math.hypot(width, height);
  if (page.corners.every((c, i) => Math.hypot(c[0] - frame[i][0], c[1] - frame[i][1]) < tol)) {
    return { found: true, page, warped: false, rgba, width, height };
  }
  const size = flatSize(page.corners, maxEdge);
  return { found: true, page, warped: true, rgba: warpRgba(rgba, width, height, page.corners, size.width, size.height), ...size };
}

/* ------------------------------------------------------------- even light */

/** The paper's own brightness is estimated at this long edge. */
const LIGHT_EDGE = 160;
/** Closing radius at LIGHT_EDGE, in px: wider than any printed stroke there. */
const LIGHT_RADIUS = 4;

/**
 * Divide out uneven light, for OCR (not for the readers).
 *
 * A shadow across half the sheet — the simulator's `angle` shots all have one,
 * down to 58 % brightness — survives flattening and a global contrast stretch:
 * the stretch picks one black point and one white point for the whole page,
 * and the shaded half's paper ends up the grey of the lit half's print.
 *
 * The paper's brightness is estimated where print cannot reach it: a small
 * copy, closed (max then min) so dark strokes vanish, blurred, and read back
 * bilinearly. Each pixel is divided by it and stretched so paper is white.
 * Returns a new greyscale RGBA buffer; the input is not touched.
 */
export function evenLight(src: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const grey = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) grey[j] = (src[i] * 299 + src[i + 1] * 587 + src[i + 2] * 114) / 1000;
  const small = downscaleGrey({ data: grey, width, height }, LIGHT_EDGE);
  const bg = blur3(blur3(minMax(minMax(small, LIGHT_RADIUS, true), LIGHT_RADIUS, false)));
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = bg.width / width, sy = bg.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(bg.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(bg.height - 1, y0 + 1), ay = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(bg.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(bg.width - 1, x0 + 1), ax = fx - x0;
      const b =
        (bg.data[y0 * bg.width + x0] * (1 - ax) + bg.data[y0 * bg.width + x1] * ax) * (1 - ay) +
        (bg.data[y1 * bg.width + x0] * (1 - ax) + bg.data[y1 * bg.width + x1] * ax) * ay;
      const v = Math.min(255, (grey[y * width + x] * 255) / Math.max(24, b));
      const o = (y * width + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}
