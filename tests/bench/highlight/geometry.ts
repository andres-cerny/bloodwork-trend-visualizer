/**
 * The photo-highlight scorer (docs/plans/photo-highlight.md). Pure functions.
 *
 * Ground truth is one quadrilateral per printed row: the row's box from the
 * source PDF's text layer (`buildRows`), mapped through the simulator's known
 * transform onto the photo. A locator proposes an axis-aligned box for a
 * value's row; this file decides whether that box is right, wrong or absent.
 *
 * Two rules, both stated in the plan and one added here:
 *
 *  - **centre**: the box's centre lies inside the true row's quadrilateral.
 *  - **plan overlap**: no *other* row overlaps the box by more than half the
 *    box's height. "Overlap by a height" is measured as the intersection area
 *    divided by the box's width — the mean vertical overlap across the box.
 *  - **share** (added, `strict`): of all printed-row area inside the box, the
 *    true row holds at least `STRICT_SHARE`. The plan rule alone passes a tall
 *    box that frames four rows as long as each neighbour on its own covers
 *    less than half of it — exactly what an axis-aligned box around a slanted
 *    OCR line looks like. The person would see four rows framed.
 *
 * `wrong` is counted under both rules so the difference stays visible.
 */

export type Box = [number, number, number, number]; // x0, y0, x1, y1
export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt]; // clockwise on screen: tl, tr, br, bl
export type H3 = number[][]; // 3x3 homography, row-major

export const STRICT_SHARE = 2 / 3;

export function applyH(H: H3, [x, y]: Pt): Pt {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

export function boxToQuad(b: Box): Quad {
  return [
    [b[0], b[1]],
    [b[2], b[1]],
    [b[2], b[3]],
    [b[0], b[3]],
  ];
}

export function mapBox(H: H3, b: Box): Quad {
  return boxToQuad(b).map((p) => applyH(H, p)) as Quad;
}

export function quadBounds(q: Pt[]): Box {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Inside (or on the edge of) a convex polygon, either winding. */
export function pointInConvex(p: Pt, poly: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(poly[i], poly[(i + 1) % poly.length], p);
    if (c === 0) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/** Sutherland–Hodgman: the part of `poly` inside the axis-aligned box. */
export function clipToBox(poly: Pt[], b: Box): Pt[] {
  const edges: Array<[(p: Pt) => boolean, (p: Pt, q: Pt) => Pt]> = [
    [(p) => p[0] >= b[0], (p, q) => lerpX(p, q, b[0])],
    [(p) => p[0] <= b[2], (p, q) => lerpX(p, q, b[2])],
    [(p) => p[1] >= b[1], (p, q) => lerpY(p, q, b[1])],
    [(p) => p[1] <= b[3], (p, q) => lerpY(p, q, b[3])],
  ];
  let out = poly;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) return [];
  }
  return out;
}

function lerpX(p: Pt, q: Pt, x: number): Pt {
  const t = (x - p[0]) / (q[0] - p[0]);
  return [x, p[1] + t * (q[1] - p[1])];
}
function lerpY(p: Pt, q: Pt, y: number): Pt {
  const t = (y - p[1]) / (q[1] - p[1]);
  return [p[0] + t * (q[0] - p[0]), y];
}

export function overlapArea(b: Box, q: Pt[]): number {
  return polygonArea(clipToBox(q, b));
}

export interface Verdict {
  /** The plan's rule: centre in the true row, no other row over half the box height. */
  right: boolean;
  /** Plan rule plus the share rule. */
  rightStrict: boolean;
  /** Index of the row whose quad holds the box centre, or -1. */
  centreRow: number;
  /** Share of printed-row area inside the box that belongs to the true row. */
  share: number;
  why: string;
}

/**
 * Judge one predicted box against the rows of its page.
 *
 * `rows` are every printed row's quadrilateral in the same pixel space as the
 * box; `truth` indexes the row the value was printed on.
 */
export function judge(box: Box, truth: number, rows: Quad[]): Verdict {
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  const c: Pt = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  const centreRow = rows.findIndex((q) => pointInConvex(c, q));
  const areas = rows.map((q) => (w > 0 && h > 0 ? overlapArea(box, q) : 0));
  const total = areas.reduce((s, a) => s + a, 0);
  const share = total > 0 ? areas[truth] / total : 0;
  const centreOk = truth >= 0 && truth < rows.length && pointInConvex(c, rows[truth]);
  const worst = areas.reduce((m, a, i) => (i === truth ? m : Math.max(m, a)), 0);
  const overlapOk = w <= 0 || worst / w <= 0.5 * h;
  const right = centreOk && overlapOk;
  const rightStrict = right && share >= STRICT_SHARE;
  const why = !centreOk
    ? centreRow >= 0
      ? `centre on row ${centreRow}`
      : "centre on no row"
    : !overlapOk
      ? "another row covers over half the box"
      : !rightStrict
        ? `true row holds ${(share * 100).toFixed(0)} % of the rows inside`
        : "ok";
  return { right, rightStrict, centreRow, share, why };
}
