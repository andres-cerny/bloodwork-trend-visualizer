/**
 * Reconstructing printed rows from PDF text coordinates.
 *
 * Pure functions, deliberately free of any pdf.js dependency so they can be
 * unit-tested directly — they are the part of the text path that decides
 * whether a value is trustworthy.
 */
import type { Box } from "../models";

export interface TextRow {
  /** Cells left-to-right, as printed. */
  cells: string[];
  /** Bbox of each cell, index-aligned with `cells`. */
  cellBoxes: Box[];
  /** Pixel bbox spanning the whole row. */
  box: Box;
}

/**
 * Cluster text items into visual rows, then order each row left to right.
 *
 * This is the step that makes the text layer usable: a raw pdf.js text dump
 * arrives in document order, which for a table is close to meaningless. Two
 * items belong to the same printed row when their vertical centres sit within
 * a fraction of the line height — tolerant enough for the baseline jitter you
 * get when a cell uses a different font size.
 */
export function buildRows(words: Array<{ text: string; box: Box }>): TextRow[] {
  if (words.length === 0) return [];
  const heights = words.map((w) => w.box[3] - w.box[1]).filter((h) => h > 0).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 10;
  const tol = Math.max(medianH * 0.6, 3);

  const centre = (b: Box) => (b[1] + b[3]) / 2;
  const sorted = [...words].sort((a, b) => centre(a.box) - centre(b.box));

  const groups: Array<Array<{ text: string; box: Box }>> = [];
  let current: Array<{ text: string; box: Box }> = [];
  let currentY = -Infinity;
  for (const w of sorted) {
    const y = centre(w.box);
    if (current.length === 0 || Math.abs(y - currentY) <= tol) {
      current.push(w);
      currentY = current.length === 1 ? y : (currentY * (current.length - 1) + y) / current.length;
    } else {
      groups.push(current);
      current = [w];
      currentY = y;
    }
  }
  if (current.length) groups.push(current);

  const rows = groups
    .map((g) => {
      const ordered = [...g].sort((a, b) => a.box[0] - b.box[0]).filter((wd) => wd.text.trim());
      return {
        cells: ordered.map((wd) => wd.text.trim()),
        cellBoxes: ordered.map((wd) => wd.box),
        box: rowBox(ordered.map((wd) => wd.box)),
      };
    })
    .filter((r) => r.cells.length > 0);

  return splitSideBySideTables(rows);
}

function rowBox(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * Undo the merge that happens when a page prints two tables side by side.
 *
 * Clustering by vertical position alone cannot tell "one wide row" from "two
 * rows that happen to share a baseline", and gap width does not separate them
 * either: in a normal table the widest gap sits *inside* a valid row (between
 * the analyte name and its value), and it is routinely wider than the gap
 * between two adjacent tables. Measured on real pdf.js output, a legitimate
 * row showed gaps [154, 60, 59] while a genuine table boundary was only 52.
 *
 * What does separate them is structure. A column boundary leaves a single cell
 * on its left; a table boundary leaves a complete row on each side. And two
 * tables printed side by side are the same template repeated, so their column
 * offsets mirror each other.
 *
 * This is deliberately conservative: when the halves do not mirror, nothing is
 * split. A wrongly split row corrupts good data, whereas leaving a merged row
 * alone only reproduces the previous behaviour.
 */
function splitSideBySideTables(rows: TextRow[]): TextRow[] {
  const wide = rows.filter((r) => r.cells.length >= 6);
  if (wide.length < 2) return rows;

  const spansX = (x: number) => rows.some((r) => r.cellBoxes.some((b) => b[0] < x && x < b[2]));

  const offsets = (boxes: Box[]) => boxes.map((b) => b[0] - boxes[0][0]);
  const mirrors = (a: Box[], b: Box[]) => {
    if (a.length !== b.length) return false;
    const oa = offsets(a);
    const ob = offsets(b);
    const tol = 6;
    return oa.every((v, i) => Math.abs(v - ob[i]) <= tol);
  };

  // Candidate boundaries: gaps that leave a full row on each side.
  const raw: number[] = [];
  for (const r of wide) {
    for (let i = 1; i < r.cells.length; i++) {
      if (i < 3 || r.cells.length - i < 3) continue;
      if (!mirrors(r.cellBoxes.slice(0, i), r.cellBoxes.slice(i))) continue;
      if (r.cellBoxes[i][0] <= r.cellBoxes[i - 1][2]) continue;
      raw.push((r.cellBoxes[i - 1][2] + r.cellBoxes[i][0]) / 2);
    }
  }

  // Cluster nearby candidates. Rows end at different x (a reference range is
  // wider than a bare integer), so each row proposes a slightly different
  // midpoint for the same corridor — without clustering, every candidate
  // would look like it had a support of one.
  const clusters: number[][] = [];
  for (const x of [...raw].sort((a, b) => a - b)) {
    const last = clusters[clusters.length - 1];
    if (last && x - last[last.length - 1] <= 24) last.push(x);
    else clusters.push([x]);
  }
  const ranked: Array<[number, number]> = clusters
    .map((c) => [c.reduce((s, v) => s + v, 0) / c.length, c.length] as [number, number])
    .sort((a, b) => b[1] - a[1]);
  for (const [x, support] of ranked) {
    if (support < 2) continue;
    if (spansX(x)) continue;
    const out: TextRow[] = [];
    for (const r of rows) {
      const li = r.cellBoxes.findIndex((b) => b[0] > x);
      if (li <= 0 || r.cells.length < 6) {
        out.push(r);
        continue;
      }
      const left = { cells: r.cells.slice(0, li), boxes: r.cellBoxes.slice(0, li) };
      const right = { cells: r.cells.slice(li), boxes: r.cellBoxes.slice(li) };
      out.push({ cells: left.cells, cellBoxes: left.boxes, box: rowBox(left.boxes) });
      out.push({ cells: right.cells, cellBoxes: right.boxes, box: rowBox(right.boxes) });
    }
    return out;
  }
  return rows;
}

/**
 * Rows rendered for the model: one printed row per line, cells pipe-separated,
 * each line prefixed with its index and a tab.
 *
 * The index is what the model points back with (`row_index`) instead of
 * echoing the whole row. That costs ~114 input tokens on a dense page and saves
 * far more output than it costs — and output is what the wait is made of.
 */
export function rowsAsText(rows: TextRow[]): string {
  return rows.map((r, i) => `${i}\t${r.cells.join(" | ")}`).join("\n");
}

/**
 * The printed row a `row_index` refers to, for the verification tab.
 *
 * Reconstructed locally rather than transcribed, so the snippet shown beside
 * the page image is the page's own text by construction. An index that points
 * off the end returns "" and the caller falls back to the analyte name.
 */
export function rowTextAt(index: number | undefined, rows: TextRow[]): string {
  if (index === undefined || index < 0 || index >= rows.length) return "";
  return rows[index].cells.join(" ");
}

/**
 * Does this string actually appear on the page?
 *
 * The whole point of the text-layer path is that transcribed characters come
 * from the file, so this is checkable rather than a matter of trust. Anything
 * the model returns that is not printed on the page is a fabrication, and the
 * caller flags it for review instead of letting it reach a trend.
 *
 * Whitespace is normalized because pdf.js splits a printed cell across items
 * at arbitrary points; the comparison is otherwise exact, including the
 * decimal comma.
 */
export function isPrintedOnPage(value: string, rows: TextRow[]): boolean {
  const needle = value.replace(/\s+/g, "");
  if (!needle) return true; // nothing claimed, nothing to verify
  for (const r of rows) {
    if (r.cells.some((c) => c.replace(/\s+/g, "") === needle)) return true;
    // A cell may have been split ("<" + "1,0") or merged with its neighbours.
    if (r.cells.join("").replace(/\s+/g, "").includes(needle)) return true;
  }
  return false;
}

/** Row bbox whose cells contain this analyte name — exact, no text search. */
export function rowBoxFor(rawName: string, rows: TextRow[]): Box | null {
  const needle = rawName.replace(/\s+/g, "").toLowerCase();
  if (!needle) return null;
  for (const r of rows) {
    const joined = r.cells.join("").replace(/\s+/g, "").toLowerCase();
    if (joined.includes(needle) || needle.includes(r.cells[0]?.replace(/\s+/g, "").toLowerCase() ?? "\u0000")) {
      return r.box;
    }
  }
  return null;
}
