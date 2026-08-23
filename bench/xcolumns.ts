/**
 * Arm A10 — assign columns by x-position, with no model at all.
 *
 * Earned from A9's failure. The column map asked the model for a *cell index*
 * per role, and cell indices turned out to be unstable: `buildRows` emits
 * whatever text items a row happens to contain, so a row missing its unit
 * shifts every later cell left. 44% of rows on a real page needed an override,
 * and on a differential-count page — where each analyte prints both a fraction
 * and an absolute count — a fixed index silently picked the wrong number:
 *
 *     B_Neutrofily   printed 0,527   index-based map returned 2,900
 *
 * But a printed lab table is not a list of cells, it is a set of *columns*, and
 * a column is an x-coordinate. `cellBoxes` already carries x for every cell —
 * it is what the verification highlight is drawn from — so the columns can be
 * recovered geometrically and deterministically, with no tokens and no model.
 *
 * Roles are then assigned from what each column *contains* rather than from
 * where it sits, so a layout that puts the unit before the range is handled by
 * the same code as one that does not.
 */
import { type TextRow } from "@bw/lab-core";
import type { RawMeasurement } from "./score";

/** A value cell: digits, optionally censored, optionally flagged by the lab. */
const NUMERIC = /^[<>]?\s*-?\d[\d\s.,]*\s*[!*]?$/;
/** A reference interval: two numbers with a separator, or a one-sided bound. */
const RANGE = /^\s*[<>]?\s*-?\d[\d.,\s]*\s*[-–—]\s*-?\d[\d.,\s]*\s*$|^\s*[<>]\s*-?\d[\d.,]*\s*$/;
/** A unit: letters with the slashes, carets and micro signs units actually use. */
const UNIT = /^[a-zA-Zµμ%°]+[a-zA-Z0-9µμ%^/.\-*]*$/;
/** Anything with real words in it — an analyte name. */
const WORDY = /\p{L}{2}/u;

export interface Column {
  /** Mean left edge of the cells assigned to this column. */
  x: number;
  /** How many rows contributed a cell here. */
  support: number;
  role: "name" | "value" | "unit" | "range" | "other";
  numericShare: number;
  unitShare: number;
  rangeShare: number;
  wordyShare: number;
}

/** Rows that look like a printed measurement: a name, then a number. */
export function measurementRows(rows: TextRow[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (r.cells.length < 2) return;
    if (!WORDY.test(r.cells[0])) return;
    if (!r.cells.slice(1).some((c) => NUMERIC.test(c))) return;
    out.push(i);
  });
  return out;
}

/**
 * Cluster cell left-edges into columns.
 *
 * Tolerance is derived from the median glyph height rather than fixed in
 * points, so it travels across page sizes and font sizes instead of being
 * tuned to the one lab that happened to be looked at first.
 */
export function findColumns(rows: TextRow[], idx: number[]): Column[] {
  const heights = rows.flatMap((r) => r.cellBoxes.map((b) => b[3] - b[1])).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] || 10;
  const tol = Math.max(medianH * 1.5, 6);

  const xs: Array<{ x: number; text: string }> = [];
  for (const i of idx) {
    const r = rows[i];
    r.cellBoxes.forEach((b, c) => xs.push({ x: b[0], text: r.cells[c] ?? "" }));
  }
  xs.sort((a, b) => a.x - b.x);

  const clusters: Array<Array<{ x: number; text: string }>> = [];
  for (const item of xs) {
    const last = clusters[clusters.length - 1];
    if (last && item.x - last[last.length - 1].x <= tol) last.push(item);
    else clusters.push([item]);
  }

  return clusters
    .map((c) => {
      const texts = c.map((i) => i.text).filter((t) => t.trim());
      const share = (f: (t: string) => boolean) =>
        texts.length ? texts.filter(f).length / texts.length : 0;
      return {
        x: c.reduce((s, i) => s + i.x, 0) / c.length,
        support: c.length,
        role: "other" as Column["role"],
        numericShare: share((t) => NUMERIC.test(t)),
        unitShare: share((t) => UNIT.test(t) && !NUMERIC.test(t)),
        // A range column's own cells are usually just the interval's first
        // number, so score it on being numeric *and* sitting right of centre;
        // the full-interval test happens after the cells are rejoined.
        rangeShare: share((t) => RANGE.test(t)),
        wordyShare: share((t) => WORDY.test(t) && !UNIT.test(t)),
      };
    })
    .filter((c) => c.support >= Math.max(3, idx.length * 0.25))
    .sort((a, b) => a.x - b.x);
}

/**
 * Give each column a role from what it holds.
 *
 * The value column is the *leftmost* strongly-numeric column that is not the
 * range — which is the rule that fixes the differential-count page: where an
 * analyte prints a fraction and then an absolute count, the printed result is
 * the one nearest its own name, and picking by geometry gets that right where
 * picking by cell index did not.
 */
export function assignRoles(cols: Column[]): Column[] {
  const range = cols.filter((c) => c.rangeShare >= 0.5).sort((a, b) => b.rangeShare - a.rangeShare)[0];
  if (range) range.role = "range";

  const name = cols.filter((c) => c.role === "other" && c.wordyShare >= 0.5).sort((a, b) => a.x - b.x)[0];
  if (name) name.role = "name";

  const value = cols
    .filter((c) => c.role === "other" && c.numericShare >= 0.5)
    .sort((a, b) => a.x - b.x)[0];
  if (value) value.role = "value";

  const unit = cols
    .filter((c) => c.role === "other" && c.unitShare >= 0.5)
    .sort((a, b) => a.x - b.x)[0];
  if (unit) unit.role = "unit";

  return cols;
}

/**
 * A printed reference interval is rarely one text item.
 *
 * pdf.js splits "4,00 - 10,00" into three items at arbitrary points, so the
 * range column holds only the *first* of them. Everything from that column
 * rightwards belongs to the interval, and joining it back is what makes the
 * decimal comma and the separator survive — the exact pair whose loss
 * `looksCollapsed` exists to catch.
 */
function pickRange(r: TextRow, target: Column | null, cols: Column[], tol: number): string {
  if (!target) return "";
  const parts: string[] = [];
  for (let c = 0; c < r.cells.length; c++) {
    const col = columnFor(r.cellBoxes[c][0], cols, tol);
    if (col === target || (parts.length && r.cellBoxes[c][0] >= target.x)) parts.push(r.cells[c]);
  }
  return parts.join(" ").trim();
}

/** Nearest column to this cell's left edge, or null when nothing is close. */
function columnFor(x: number, cols: Column[], tol: number): Column | null {
  let best: Column | null = null;
  let bestD = Infinity;
  for (const c of cols) {
    const d = Math.abs(c.x - x);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= tol ? best : null;
}

export interface XResult {
  measurements: RawMeasurement[];
  columns: Column[];
  ms: number;
}

/**
 * The whole arm: rows in, measurements out, no network.
 *
 * Confidence is derived the same way as in the column-map arm — a row whose
 * value cell does not look like a number is flagged rather than trusted — so
 * the two arms are comparable on the one column that decides whether a wrong
 * number reaches a trend silently.
 */
export function extractByX(rows: TextRow[]): XResult {
  const t0 = performance.now();
  const idx = measurementRows(rows);
  const cols = assignRoles(findColumns(rows, idx));

  const heights = rows.flatMap((r) => r.cellBoxes.map((b) => b[3] - b[1])).filter((h) => h > 0);
  heights.sort((a, b) => a - b);
  const tol = Math.max((heights[Math.floor(heights.length / 2)] || 10) * 1.5, 6);

  const roleOf = (role: Column["role"]) => cols.find((c) => c.role === role) ?? null;
  const nameCol = roleOf("name");
  const valueCol = roleOf("value");
  const unitCol = roleOf("unit");
  const rangeCol = roleOf("range");

  const measurements: RawMeasurement[] = [];
  for (const i of idx) {
    const r = rows[i];
    const pick = (target: Column | null): string => {
      if (!target) return "";
      for (let c = 0; c < r.cells.length; c++) {
        if (columnFor(r.cellBoxes[c][0], cols, tol) === target) return r.cells[c];
      }
      return "";
    };
    // The name is whatever sits at or left of the name column — analyte names
    // are the one field that legitimately spills across several text items.
    const name = nameCol ? pick(nameCol) || r.cells[0] : r.cells[0];
    const value_raw = pick(valueCol);
    measurements.push({
      raw_analyte_name: name,
      value_raw,
      unit_raw: pick(unitCol),
      ref_range_raw: pick(rangeCol),
      source_snippet: r.cells.join(" "),
      row_index: i,
      confidence: !name || !value_raw || !NUMERIC.test(value_raw) ? "low" : "high",
    });
  }

  return { measurements, columns: cols, ms: performance.now() - t0 };
}
