/**
 * Reconstructing printed rows from PDF text coordinates.
 *
 * Pure functions, deliberately free of any pdf.js dependency so they can be
 * unit-tested directly — they are the part of the text path that decides
 * whether a value is trustworthy.
 */
import type { Box } from "../lib/models";

export interface TextRow {
  /** Cells left-to-right, as printed. */
  cells: string[];
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

  return groups.map((g) => {
    const ordered = [...g].sort((a, b) => a.box[0] - b.box[0]);
    return {
      cells: ordered.map((w) => w.text.trim()).filter(Boolean),
      box: [
        Math.min(...ordered.map((w) => w.box[0])),
        Math.min(...ordered.map((w) => w.box[1])),
        Math.max(...ordered.map((w) => w.box[2])),
        Math.max(...ordered.map((w) => w.box[3])),
      ] as Box,
    };
  }).filter((r) => r.cells.length > 0);
}

/** Rows rendered for the model: one printed row per line, cells pipe-separated. */
export function rowsAsText(rows: TextRow[]): string {
  return rows.map((r) => r.cells.join(" | ")).join("\n");
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
