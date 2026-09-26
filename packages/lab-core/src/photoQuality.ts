/**
 * Is this photo worth sending? Pure measurements over a greyscale buffer, and
 * the one rule that turns them into ok / warn / refuse.
 *
 * docs/plans/photo-capture.md, Phase B. The principle is Ondřej's: warn,
 * rarely refuse. A warning costs the person one tap ("Nahrát i tak"); a
 * refusal of a photo the readers could have read costs them the document. So
 * the refuse list is short and physical — too few pixels to hold print, or a
 * frame with nothing in it — and every threshold below is calibrated on the
 * photo corpus so that **no photo from which the readers returned every row is
 * refused** (`tests/bench/photo_checks.ts` prints the table; the measured
 * ranges are recorded next to each constant).
 *
 * Everything runs on an *analysis image*: the luma downscaled to
 * `ANALYSIS_EDGE` by area averaging. That fixes the scale every threshold is
 * expressed in — a 12 MP original and the 2576 px encode measure the same —
 * and keeps the whole assessment to ~20 ms.
 *
 * No DOM. The Czech sentences live in the apps; this file returns codes.
 */

/** One byte of luma per pixel. */
export interface Grey {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The long edge measurements run at. */
export const ANALYSIS_EDGE = 1024;

/** Rec. 601 luma of an RGBA buffer — the same weights as `toGreyscale`. */
export function lumaFromRgba(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Grey {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) {
    // Rounded, as the Uint8ClampedArray `toGreyscale` writes into rounds.
    data[j] = Math.round((rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000);
  }
  return { data, width, height };
}

/**
 * Area-average downscale so the long edge is at most `maxEdge`. Never
 * enlarges. Each output pixel is the mean of the source pixels whose top-left
 * falls in its footprint — what a canvas `drawImage` does closely enough for
 * measurement.
 */
export function downscaleGrey(g: Grey, maxEdge = ANALYSIS_EDGE): Grey {
  const long = Math.max(g.width, g.height);
  if (long <= maxEdge) return g;
  const k = maxEdge / long;
  const w = Math.max(1, Math.round(g.width * k));
  const h = Math.max(1, Math.round(g.height * k));
  const sum = new Float64Array(w * h);
  const cnt = new Uint32Array(w * h);
  const xmap = new Uint32Array(g.width);
  for (let x = 0; x < g.width; x++) xmap[x] = Math.min(w - 1, Math.floor((x * w) / g.width));
  for (let y = 0; y < g.height; y++) {
    const oy = Math.min(h - 1, Math.floor((y * h) / g.height)) * w;
    const row = y * g.width;
    for (let x = 0; x < g.width; x++) {
      const o = oy + xmap[x];
      sum[o] += g.data[row + x];
      cnt[o]++;
    }
  }
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = cnt[i] ? Math.round(sum[i] / cnt[i]) : 0;
  return { data, width: w, height: h };
}

/* ------------------------------------------------------------- measurements */

export interface PhotoMetrics {
  /** Long edge of the decoded photo, before any downscale. */
  longEdge: number;
  /** Luma percentiles over the analysis image. */
  p1: number;
  p50: number;
  p99: number;
  /** Fraction of tiles that carry print (see `inkContrast`). */
  inkTiles: number;
  /**
   * Sharpness: RMS of the second derivative over RMS of the first, on tiles
   * that carry print, along the *worst* of four directions (0°, 45°, 90°,
   * 135°). Both derivatives scale with contrast, so the ratio does not — a dark
   * photo and a bright one of the same page score alike — while defocus pulls
   * every direction down and shake pulls down the one it smeared along, which
   * a direction-averaged measure hides.
   */
  sharpness: number;
  /** The typical paper level: median over print tiles of the tile's brightest
   *  (3×3-smoothed) pixel. */
  paper: number;
  /**
   * The largest 4-connected blob of tiles clipped to white with no print left
   * in them, as a fraction of all tiles. Raw: see `glare` for when it counts.
   */
  highlight: number;
  /**
   * `highlight`, but only when the paper elsewhere has headroom below
   * clipping. A camera exposes for the sheet, so on a real photo only a
   * reflection clips; a picture whose *paper* is already at 255 (a digital
   * render, an over-exposed sim) has blank margins that clip too, and those are
   * not glare. 0 otherwise.
   */
  glare: number;
}

/** Tile edge, in analysis pixels. 16 px at 1024 is ~4.6 mm of an A4 page. */
const TILE = 16;
/**
 * Local contrast (max − min of a tile, after a 3×3 mean) that counts as print,
 * relative to the tile's paper: 48 levels on paper at 225, but 16 on paper at
 * 45. An absolute 48 would see no print at all on a very dark photo and refuse
 * it as blank — a photo the contrast stretch would have made legible. The
 * floor of 16 stays above sensor noise after the 3×3 mean.
 */
function inkContrast(paperLevel: number): number {
  return Math.max(16, Math.min(48, 0.35 * paperLevel));
}
/** A tile is clipped when even its darkest smoothed pixel is at least this. */
const CLIP_LEVEL = 250;
/** Paper at or below this level leaves room for a reflection to stand out. */
const PAPER_HEADROOM = 238;

function percentiles(g: Grey, fractions: number[]): number[] {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.data.length; i++) hist[g.data[i]]++;
  const total = g.data.length;
  return fractions.map((f) => {
    const want = f * total;
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= want) return v;
    }
    return 255;
  });
}

/** 3×3 box mean; edges replicate. Tames JPEG ringing and sensor noise before
 *  the tile min/max, so a noisy dark photo does not read as print everywhere. */
function box3(g: Grey): Grey {
  const { width: w, height: h, data: s } = g;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w, y1 = y * w, y2 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x2 = Math.min(w - 1, x + 1);
      out[y1 + x] =
        (s[y0 + x0] + s[y0 + x] + s[y0 + x2] + s[y1 + x0] + s[y1 + x] + s[y1 + x2] + s[y2 + x0] + s[y2 + x] + s[y2 + x2]) / 9;
    }
  }
  return { data: out, width: w, height: h };
}

/** Neighbour offsets and their distance, for the four directions. */
const DIRS = [
  [1, 0, 1],
  [0, 1, 1],
  [1, -1, Math.SQRT2],
  [1, 1, Math.SQRT2],
] as const;

/**
 * Every measurement, from the analysis image. `longEdge` is the decoded
 * photo's, which the caller knows and a downscaled buffer no longer does.
 */
export function measurePhoto(input: Grey, longEdge = Math.max(input.width, input.height)): PhotoMetrics {
  const g = downscaleGrey(input);
  const [p1, p50, p99] = percentiles(g, [0.01, 0.5, 0.99]);
  const { width: w, height: h, data: d } = g;
  const sm = box3(g);
  const tw = Math.max(1, Math.floor(w / TILE));
  const th = Math.max(1, Math.floor(h / TILE));
  const clipped = new Uint8Array(tw * th);
  const papers: number[] = [];
  const d1 = new Float64Array(4), d2 = new Float64Array(4);

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let mn = 255, mx = 0;
      for (let y = ty * TILE; y < Math.min(h, (ty + 1) * TILE); y++) {
        for (let x = tx * TILE; x < Math.min(w, (tx + 1) * TILE); x++) {
          const v = sm.data[y * w + x];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      if (mn >= CLIP_LEVEL) clipped[ty * tw + tx] = 1;
      if (mx - mn < inkContrast(mx)) continue;
      papers.push(mx);
      for (let y = Math.max(1, ty * TILE); y < Math.min(h - 1, (ty + 1) * TILE); y++) {
        for (let x = Math.max(1, tx * TILE); x < Math.min(w - 1, (tx + 1) * TILE); x++) {
          const c = d[y * w + x];
          for (let k = 0; k < 4; k++) {
            const [ox, oy, dist] = DIRS[k];
            const a = d[(y + oy) * w + x + ox], b = d[(y - oy) * w + x - ox];
            const first = (a - b) / (2 * dist), second = (a + b - 2 * c) / (dist * dist);
            d1[k] += first * first;
            d2[k] += second * second;
          }
        }
      }
    }
  }

  let sharpness = papers.length ? Infinity : 0;
  for (let k = 0; k < 4; k++) if (d1[k] > 0) sharpness = Math.min(sharpness, Math.sqrt(d2[k] / d1[k]));
  if (!Number.isFinite(sharpness)) sharpness = 0;
  papers.sort((a, b) => a - b);
  const paper = papers.length ? papers[papers.length >> 1] : p99;
  const highlight = largestBlob(clipped, tw, th) / (tw * th);

  return {
    longEdge,
    p1,
    p50,
    p99,
    inkTiles: papers.length / (tw * th),
    sharpness,
    paper,
    highlight,
    glare: paper <= PAPER_HEADROOM ? highlight : 0,
  };
}

/** Size, in tiles, of the largest 4-connected blob of set cells. */
function largestBlob(cells: Uint8Array, tw: number, th: number): number {
  let best = 0;
  const seen = new Uint8Array(cells.length);
  const stack: number[] = [];
  for (let t = 0; t < cells.length; t++) {
    if (!cells[t] || seen[t]) continue;
    let n = 0;
    stack.push(t);
    seen[t] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      n++;
      const cx = c % tw, cy = (c - cx) / tw;
      if (cx > 0 && cells[c - 1] && !seen[c - 1]) (seen[c - 1] = 1), stack.push(c - 1);
      if (cx < tw - 1 && cells[c + 1] && !seen[c + 1]) (seen[c + 1] = 1), stack.push(c + 1);
      if (cy > 0 && cells[c - tw] && !seen[c - tw]) (seen[c - tw] = 1), stack.push(c - tw);
      if (cy < th - 1 && cells[c + tw] && !seen[c + tw]) (seen[c + tw] = 1), stack.push(c + tw);
    }
    if (n > best) best = n;
  }
  return best;
}

/* ------------------------------------------------------------------ verdict */

export type PhotoOutcome = "ok" | "warn" | "refuse";

/** Why. The apps map each code to one Czech sentence. */
export type PhotoReason =
  | "too_small" // refuse: too few pixels to hold any print
  | "blank" // refuse: nearly uniform — lens cap, a wall, an empty frame
  | "small" // warn: few pixels; small print may be lost
  | "blurred" // warn: defocus or shake
  | "dark" // warn: underexposed
  | "glare"; // warn: a reflection has wiped out part of the print

export interface PhotoVerdict {
  outcome: PhotoOutcome;
  reasons: PhotoReason[];
}

/**
 * The thresholds, each with what the corpus measured on either side of it
 * (tests/bench/photo_checks.ts, 2026-09-26: 133 simulated photos all read in
 * full by both readers, 56 bad ones, public sheet renders, not-lab images).
 */
export const QUALITY = {
  /** Refuse below this long edge. `micro` (200 px) is refused; a subagent
   *  reader given it returned no row. `tiny` (600) only warns. */
  refuseEdge: 320,
  /** Warn below this long edge: `tiny` (600) warns, nothing read in full is
   *  under 1,600. */
  warnEdge: 1000,
  /** Refuse when the frame is this flat (p99 − p1) …  black 12, wall 21;
   *  the flattest page read in full: 110. */
  blankSpread: 32,
  /** … or carries print on fewer tiles than this. Blanks: 0; the sparsest
   *  page read in full: 0.08. */
  blankInk: 0.005,
  /** Warn below this sharpness. blur 0.33–0.37, motion 0.95–1.05; the
   *  softest read in full (sim glare, blurred 1.2 px): 1.27. */
  blurSharpness: 1.15,
  /** Warn when typical paper is darker than this. Sim `dark` (read in full):
   *  paper ≥ 110 after the camera's gain; nothing in the corpus is darker, so
   *  this is a floor for a photo taken in a dark room, not a tuned value. */
  darkPaper: 60,
  /** Warn when a glare blob covers this share of the frame. blown
   *  0.17–0.24; read in full: angle ≤ 0.13 (the lit half's blank margin
   *  clips while the shadow gives the paper headroom), glare ≤ 0.03. The gap
   *  is narrow and simulated — recalibrate on Ondřej's real shots (A3). */
  glare: 0.15,
};

export function assessPhoto(m: PhotoMetrics, t = QUALITY): PhotoVerdict {
  const refuse: PhotoReason[] = [];
  if (m.longEdge < t.refuseEdge) refuse.push("too_small");
  if (m.p99 - m.p1 < t.blankSpread || m.inkTiles < t.blankInk) refuse.push("blank");
  if (refuse.length) return { outcome: "refuse", reasons: refuse };
  const warn: PhotoReason[] = [];
  if (m.longEdge < t.warnEdge) warn.push("small");
  if (m.sharpness < t.blurSharpness) warn.push("blurred");
  if (m.paper < t.darkPaper) warn.push("dark");
  if (m.glare >= t.glare) warn.push("glare");
  return { outcome: warn.length ? "warn" : "ok", reasons: warn };
}
