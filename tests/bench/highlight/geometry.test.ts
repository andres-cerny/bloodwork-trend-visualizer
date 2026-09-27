import { describe, expect, it } from "vitest";

import { applyH, boxToQuad, judge, judgeQuad, mapBox, overlapArea, pointInConvex, type Box, type H3, type Quad } from "./geometry";

/** A table of ten printed rows, 20 px tall on a 30 px pitch, x 100..900. */
const pitch = 30;
const rowBoxes: Box[] = Array.from({ length: 10 }, (_, i) => [100, 100 + i * pitch, 900, 120 + i * pitch]);
const rows: Quad[] = rowBoxes.map(boxToQuad);

describe("judge — the photo-highlight scorer", () => {
  it("counts the true row's own box as right", () => {
    const v = judge(rowBoxes[4], 4, rows);
    expect(v.right).toBe(true);
    expect(v.rightStrict).toBe(true);
  });

  it("counts a box one row off as wrong — the case the whole plan is about", () => {
    const v = judge(rowBoxes[5], 4, rows);
    expect(v.right).toBe(false);
    expect(v.rightStrict).toBe(false);
    expect(v.centreRow).toBe(5);
  });

  it("counts a box one row off upward as wrong too", () => {
    expect(judge(rowBoxes[3], 4, rows).right).toBe(false);
  });

  it("counts a box straddling two rows as wrong", () => {
    // Centre in the gap between rows 4 and 5: on no row.
    const v = judge([100, 110 + 4 * pitch, 900, 140 + 4 * pitch], 4, rows);
    expect(v.right).toBe(false);
    expect(v.centreRow).toBe(-1);
  });

  it("accepts a box that is a little loose around the true row", () => {
    const [x0, y0, x1, y1] = rowBoxes[4];
    expect(judge([x0 - 10, y0 - 5, x1 + 10, y1 + 5], 4, rows).rightStrict).toBe(true);
  });

  it("accepts a box covering only the name-to-value part of the row", () => {
    expect(judge([120, 100 + 4 * pitch, 500, 120 + 4 * pitch], 4, rows).rightStrict).toBe(true);
  });

  it("the strict share rule rejects a tall box framing several rows the plan rule lets through", () => {
    // Centre on row 4, three rows high: each neighbour alone covers under half.
    const v = judge([100, 100 + 3 * pitch, 900, 120 + 5 * pitch], 4, rows);
    expect(v.right).toBe(true);
    expect(v.rightStrict).toBe(false);
  });

  it("counts no row at all as wrong", () => {
    expect(judge([100, 1000, 900, 1020], 4, rows).right).toBe(false);
  });

  it("works on slanted rows mapped through a homography", () => {
    // A mild perspective: rows tilt; the mapped true row is still right, its neighbour still wrong.
    const H: H3 = [
      [1, 0.05, 10],
      [0.08, 1, 5],
      [0.00002, 0, 1],
    ];
    const slanted = rowBoxes.map((b) => mapBox(H, b));
    // The central third of row 4, mapped, as a locator might box it.
    const mid = mapBox(H, [400, 100 + 4 * pitch, 600, 120 + 4 * pitch]);
    const xs = mid.map((p) => p[0]);
    const ys = mid.map((p) => p[1]);
    const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    expect(judge(box, 4, slanted).right).toBe(true);
    expect(judge(box, 5, slanted).right).toBe(false);
  });
});

describe("judgeQuad — the same rules for a quadrilateral", () => {
  const boxes: Box[] = [rowBoxes[4], rowBoxes[5], [100, 110 + 4 * pitch, 900, 140 + 4 * pitch], [100, 100 + 3 * pitch, 900, 120 + 5 * pitch], [120, 100 + 4 * pitch, 500, 120 + 4 * pitch]];
  it("agrees with judge on axis-aligned boxes, one row off included", () => {
    for (const b of boxes) {
      const a = judge(b, 4, rows);
      const q = judgeQuad(boxToQuad(b), 4, rows);
      expect([q.right, q.rightStrict, q.centreRow]).toEqual([a.right, a.rightStrict, a.centreRow]);
      expect(q.share).toBeCloseTo(a.share, 6);
    }
  });

  it("judges a slanted row's own quad right and its neighbour's wrong", () => {
    const H: H3 = [
      [1, 0.05, 10],
      [0.08, 1, 5],
      [0.00002, 0, 1],
    ];
    const slanted = rowBoxes.map((b) => mapBox(H, b));
    expect(judgeQuad(slanted[4], 4, slanted).rightStrict).toBe(true);
    expect(judgeQuad(slanted[5], 4, slanted).right).toBe(false);
  });
});

describe("geometry helpers", () => {
  it("applyH with the identity is the identity", () => {
    expect(applyH([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [3, 4])).toEqual([3, 4]);
  });

  it("pointInConvex holds for either winding", () => {
    const q = boxToQuad([0, 0, 10, 10]);
    expect(pointInConvex([5, 5], q)).toBe(true);
    expect(pointInConvex([5, 5], [...q].reverse())).toBe(true);
    expect(pointInConvex([11, 5], q)).toBe(false);
  });

  it("overlapArea clips a quad to a box", () => {
    expect(overlapArea([0, 0, 10, 10], boxToQuad([5, 5, 20, 20]))).toBeCloseTo(25);
    expect(overlapArea([0, 0, 10, 10], boxToQuad([20, 20, 30, 30]))).toBe(0);
  });
});
