/**
 * Finding the sheet and flattening it (docs/plans/photo-capture.md, C).
 *
 * Synthetic scenes only: a bright quadrilateral with rows of dark "print" on a
 * darker desk, rendered here. The finder's real scores are corpus numbers
 * (`tests/bench/photo_page.ts`); these tests pin the behaviour those numbers
 * rest on — corners found, a full-frame page left alone, a sheet off the frame
 * reported, the warp's geometry, even light.
 */
import { describe, expect, it } from "vitest";
import {
  A4,
  applyHomography,
  evenLight,
  findPage,
  flatSize,
  flattenPhoto,
  homography,
  type Point,
} from "../src/photoPage";
import { lumaFromRgba } from "../src/photoQuality";

/** A W×H RGBA scene: desk, a sheet at `quad` (clockwise from top-left), print rows on it. */
function scene(W: number, H: number, quad: Point[], light: (x: number, y: number) => number = () => 1) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  // page space (0..1) -> image
  const toImg = homography([[0, 0], [1, 0], [1, 1], [0, 1]], quad);
  const toPage = homography(quad, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [u, v] = applyHomography(toPage, [x + 0.5, y + 0.5]);
      let g = 70 + ((x * 7 + y * 13) % 11); // desk, a little texture
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        g = 235;
        // Print: rows of short words inside a margin.
        const row = (v - 0.08) / 0.035;
        const inRow = v > 0.08 && v < 0.92 && row - Math.floor(row) < 0.35;
        const word = (u * 40) % 4;
        if (inRow && u > 0.08 && u < 0.92 && word < 2.6) g = 40;
      }
      g *= light(x / W, y / H);
      const o = (y * W + x) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
      rgba[o + 3] = 255;
    }
  void toImg;
  return rgba;
}

const meanCornerError = (a: Point[], b: Point[]) => a.reduce((s, p, i) => s + Math.hypot(p[0] - b[i][0], p[1] - b[i][1]), 0) / 4;

describe("homography", () => {
  it("takes each corner to its target and back", () => {
    const from: Point[] = [[0, 0], [100, 0], [100, 140], [0, 140]];
    const to: Point[] = [[12, 8], [95, 20], [90, 150], [5, 138]];
    const H = homography(from, to);
    const back = homography(to, from);
    from.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q[0]).toBeCloseTo(to[i][0], 6);
      expect(q[1]).toBeCloseTo(to[i][1], 6);
      const r = applyHomography(back, q);
      expect(r[0]).toBeCloseTo(p[0], 6);
    });
  });
});

describe("findPage", () => {
  it("finds an angled sheet on a desk", () => {
    const W = 600, H = 800;
    const quad: Point[] = [[40, 30], [540, 80], [560, 760], [30, 740]];
    const got = findPage(lumaFromRgba(scene(W, H, quad), W, H));
    expect(got).not.toBeNull();
    expect(meanCornerError(got!.corners, quad)).toBeLessThan(0.01 * Math.hypot(W, H));
    expect(got!.cornerCut).toBe(false);
    expect(got!.confidence).toBeGreaterThan(0.8);
  });

  it("leaves a page that fills the frame alone — there is no edge to trust", () => {
    const W = 600, H = 800;
    const got = findPage(lumaFromRgba(scene(W, H, [[-5, -5], [W + 5, -5], [W + 5, H + 5], [-5, H + 5]]), W, H));
    expect(got).toBeNull();
  });

  it("reports a corner the frame cut off", () => {
    const W = 600, H = 800;
    const quad: Point[] = [[60, 50], [680, 70], [560, 760], [40, 740]]; // top-right beyond the frame
    const got = findPage(lumaFromRgba(scene(W, H, quad), W, H));
    expect(got).not.toBeNull();
    expect(got!.cornerCut).toBe(true);
  });
});

describe("flatSize and flattenPhoto", () => {
  it("snaps a near-A4 quad to A4", () => {
    const s = flatSize([[0, 0], [100, 0], [100, 150], [0, 150]], 1000);
    expect(s.height / s.width).toBeCloseTo(A4, 1);
  });

  it("warps an angled sheet to an upright A4 page", () => {
    const W = 600, H = 800;
    const quad: Point[] = [[40, 30], [540, 80], [560, 760], [30, 740]];
    const rgba = scene(W, H, quad);
    const f = flattenPhoto(lumaFromRgba(rgba, W, H), rgba, W, H);
    expect(f.warped).toBe(true);
    expect(f.height / f.width).toBeCloseTo(A4, 1);
    // The flattened page is paper to its edges: no desk left in the corners.
    const at = (x: number, y: number) => f.rgba[(Math.round(y) * f.width + Math.round(x)) * 4];
    for (const [x, y] of [[4, 4], [f.width - 5, 4], [f.width - 5, f.height - 5], [4, f.height - 5]]) expect(at(x, y)).toBeGreaterThan(180);
  });

  it("gives back the input untouched when no page is found", () => {
    const W = 200, H = 260;
    const rgba = new Uint8ClampedArray(W * H * 4).fill(128);
    const f = flattenPhoto(lumaFromRgba(rgba, W, H), rgba, W, H);
    expect(f.found).toBe(false);
    expect(f.warped).toBe(false);
    expect(f.rgba).toBe(rgba);
  });
});

describe("evenLight", () => {
  it("lifts a shadowed half of the paper to the lit half, and keeps the print dark", () => {
    const W = 400, H = 560;
    const quad: Point[] = [[0, 0], [W, 0], [W, H], [0, H]];
    // The simulator's angle shadow: brightness falling to 0.58 across the page.
    const rgba = scene(W, H, quad, (x) => 1 - 0.42 * x);
    const out = evenLight(rgba, W, H);
    // Paper samples in a gap between print rows, left (lit) and right (shaded).
    const paper = (x: number) => out[(Math.round(0.06 * H) * W + Math.round(x * W)) * 4];
    const before = (x: number) => rgba[(Math.round(0.06 * H) * W + Math.round(x * W)) * 4];
    expect(before(0.05) - before(0.95)).toBeGreaterThan(80);
    expect(Math.abs(paper(0.05) - paper(0.95))).toBeLessThan(12);
    // Print on the shaded side stays far darker than paper.
    let ink = 255;
    for (let y = Math.round(0.08 * H); y < 0.2 * H; y++) ink = Math.min(ink, out[(y * W + Math.round(0.85 * W)) * 4]);
    expect(paper(0.95) - ink).toBeGreaterThan(100);
  });
});
