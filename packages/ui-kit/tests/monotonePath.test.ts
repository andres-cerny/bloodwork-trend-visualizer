/**
 * The smoothed trend line must never draw a value that was not measured.
 *
 * A Catmull-Rom curve overshoots: between two in-range points it can dip
 * below a reference limit, drawing an excursion that never happened —
 * disqualifying in a chart whose whole claim is "computed, checkable".
 * Fritsch–Carlson tangents keep every segment inside its endpoints' value
 * interval; these tests sample the emitted cubics and pin that.
 */
import { describe, expect, it } from "vitest";
import { monotonePath } from "../src/TrendChart";

interface Segment {
  y0: number;
  c1y: number;
  c2y: number;
  y1: number;
}

function segmentsOf(d: string): Segment[] {
  const move = /^M(-?[\d.]+),(-?[\d.]+)/.exec(d);
  if (!move) throw new Error(`not a path: ${d}`);
  let y0 = Number(move[2]);
  const out: Segment[] = [];
  const seg = /C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = seg.exec(d))) {
    out.push({ y0, c1y: Number(m[2]), c2y: Number(m[4]), y1: Number(m[6]) });
    y0 = Number(m[6]);
  }
  return out;
}

function sample(s: Segment, steps = 64): number[] {
  const ys: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    ys.push(u * u * u * s.y0 + 3 * u * u * t * s.c1y + 3 * u * t * t * s.c2y + t * t * t * s.y1);
  }
  return ys;
}

const EPS = 1e-6;

describe("monotonePath", () => {
  it("stays inside each segment's value interval — no overshoot", () => {
    const pts: Array<[number, number]> = [
      [0, 100],
      [50, 20],
      [100, 24],
      [150, 180],
      [200, 60],
      [250, 61],
    ];
    for (const s of segmentsOf(monotonePath(pts))) {
      const lo = Math.min(s.y0, s.y1) - EPS;
      const hi = Math.max(s.y0, s.y1) + EPS;
      for (const v of sample(s)) {
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("keeps monotone data monotone", () => {
    const segs = segmentsOf(
      monotonePath([
        [0, 10],
        [40, 40],
        [90, 45],
        [200, 190],
      ]),
    );
    const ys = segs.flatMap((s) => sample(s));
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] - EPS);
  });

  it("draws a flat series as a flat line", () => {
    const segs = segmentsOf(
      monotonePath([
        [0, 30],
        [100, 30],
        [200, 30],
      ]),
    );
    for (const s of segs) for (const v of sample(s)) expect(v).toBeCloseTo(30, 6);
  });

  it("handles the degenerate sizes", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([[5, 7]])).toBe("M5,7");
    expect(monotonePath([[0, 0], [10, 10]])).toMatch(/^M0,0C/);
  });
});
