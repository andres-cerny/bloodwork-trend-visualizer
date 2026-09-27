/**
 * Where a read's printed row is on a photograph — the Ověření highlight for
 * photos (docs/plans/photo-capture.md, Phase E; measured in
 * docs/plans/photo-highlight.md). Pure: OCR lines and reads in, boxes out.
 *
 * A PDF page gets its highlight from pdf.js coordinates. A photo has no text
 * layer, but the local OCR pass (photoOcr.ts) already read it for the
 * identity suggestions. Its words become rows the way pdf.js items do
 * (`ocrPhrases` → `buildRows`), and a read is given the one OCR row that
 * carries **both its name and its value**, else nothing.
 *
 * A wrong frame is worse than none: the person trusts the frame, and a frame
 * on the neighbour row makes a misread look confirmed. So every rule here
 * gives up rather than guesses:
 *   - the value must be on the row exactly (the lab's `!`/`*`/`↑`/`↓` markers
 *     aside), as one token or up to three joined (`< 0,5`);
 *   - the name must be there as whole tokens ("Fe" never inside "Ferritin"),
 *     with OCR typos forgiven up to one edit in five characters;
 *   - exactly one OCR row may qualify, and no other read may claim it;
 *   - **some photos get no highlight at all** (`photoRowGuard`): two sheets in
 *     one frame — found as one page, or filling the frame — whose rows merge
 *     into one OCR row that lands between them; and text read tilted, where
 *     every row box reaches into its neighbour.
 *
 * Measured on 133 simulated photos plus the bad-photo set: 0 wrong boxes
 * (strict rule), about nine rows in ten framed.
 */
import type { Box, Quad } from "./models";
import { buildRows } from "./pdf/rows";
import { ocrPhrases, type OcrLine } from "./photoOcr";
import { applyHomography, type PageQuad, type Point } from "./photoPage";

/** One printed row as OCR read it, in the OCR picture's pixels. */
export interface OcrRow {
  text: string;
  box: Box;
}

/** A frame on the photo: four corners, clockwise from top-left (models.ts `Quad`). */
export type RowQuad = Quad;

/** OCR lines → printed rows, exactly as pdf.js items become rows. */
export function ocrRows(lines: OcrLine[]): OcrRow[] {
  return buildRows(ocrPhrases(lines)).map((r) => ({ text: r.cells.join(" "), box: r.box }));
}

/** A found page wider than tall: two sheets side by side, taken for one. */
export function isTwoSheets(page: PageQuad | null): boolean {
  if (!page) return false;
  const [tl, tr, br, bl] = page.corners;
  const d = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const width = (d(tl, tr) + d(bl, br)) / 2;
  const height = (d(tl, bl) + d(tr, br)) / 2;
  return width > height;
}

/**
 * The name as folded tokens: lowercased, accents folded, split on everything
 * that is not a letter or digit. Split explicitly rather than with `\b`: JS's
 * word boundary knows only ASCII, so it would cut "Železo" at the Ž.
 */
export function nameTokens(s: string | undefined): string[] {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whitespace squashed and the printed out-of-range markers dropped — the decimal comma survives. */
function valueKey(s: string | undefined): string {
  const squashed = (s ?? "").replace(/\s+/g, "");
  const bare = squashed.replace(/[!*↑↓]/g, "");
  return bare === "" ? squashed : bare;
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/**
 * The read's name is on the row **as whole tokens**: some run of consecutive
 * row tokens, joined, equals the name's tokens joined — allowing one OCR edit
 * in five characters. The run starts and ends on token boundaries, so "Fe"
 * does not match inside "Ferritin" and "S-K" not inside "S-Kreatinin"; joining
 * inside the run forgives a separator OCR dropped or added ("S_Glukóza" read
 * as "SGlukoza").
 */
export function rowHasName(rowText: string, name: string | undefined): boolean {
  const n = nameTokens(name).join("");
  if (!n) return false;
  const toks = nameTokens(rowText);
  const budget = Math.floor(n.length * 0.2);
  for (let i = 0; i < toks.length; i++) {
    let run = "";
    for (let k = i; k < toks.length; k++) {
      run += toks[k];
      if (run.length > n.length + budget) break;
      if (Math.abs(run.length - n.length) <= budget && (run === n || (budget > 0 && editDistance(n, run) <= budget))) return true;
    }
  }
  return false;
}

/** The read's value is on the row exactly: one token, or up to three joined. */
export function rowHasValue(rowText: string, value: string | undefined): boolean {
  const v = valueKey(value);
  if (!v) return false;
  const toks = rowText.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    let s = "";
    for (let k = i; k < Math.min(toks.length, i + 3); k++) {
      s += toks[k];
      if (valueKey(s) === v) return true;
    }
  }
  return false;
}

export interface ReadLike {
  rawAnalyteName?: string;
  valueRaw?: string;
}

/**
 * For each read, the index of the one OCR row carrying its name and value,
 * or -1. Two reads claiming one OCR row both get -1.
 */
export function matchReadRows(reads: ReadLike[], rows: OcrRow[]): number[] {
  const pick = reads.map((r) => {
    const hits: number[] = [];
    rows.forEach((row, i) => {
      if (rowHasValue(row.text, r.valueRaw) && rowHasName(row.text, r.rawAnalyteName)) hits.push(i);
    });
    return hits.length === 1 ? hits[0] : -1;
  });
  const claims = new Map<number, number>();
  for (const p of pick) if (p >= 0) claims.set(p, (claims.get(p) ?? 0) + 1);
  return pick.map((p) => (p >= 0 && claims.get(p) === 1 ? p : -1));
}

/* ------------------------------------------------------------ the guards */

/**
 * The steepest text a photo read on the unflattened picture may have.
 *
 * From the page, not from the bench: a Czech lab sheet prints a row about
 * every 4.5 mm (13 pt) across a table about 160 mm wide. An OCR row's box is
 * axis-aligned; tilted by θ, its far end drifts w·tan θ from its near end,
 * and at half a pitch that box reaches into the neighbour row:
 * atan(2.25/160) = 0.81°. Only reached when the picture was not flattened,
 * which in practice means a sheet filling the frame.
 */
export const MAX_TEXT_SKEW_DEG = 0.8;

/**
 * The text's tilt in degrees, from the OCR itself: along each Tesseract line
 * with three or more words, the least-squares slope of the word-box centres;
 * the median over those lines. null when no line has three words.
 */
export function textSkewDeg(lines: OcrLine[]): number | null {
  const angles: number[] = [];
  for (const l of lines) {
    const pts = l.words.filter((w) => w.text.trim()).map((w) => [(w.box[0] + w.box[2]) / 2, (w.box[1] + w.box[3]) / 2]);
    if (pts.length < 3) continue;
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0;
    let sxy = 0;
    for (const [x, y] of pts) {
      sxx += (x - mx) ** 2;
      sxy += (x - mx) * (y - my);
    }
    if (sxx <= 0) continue;
    angles.push((Math.atan(sxy / sxx) * 180) / Math.PI);
  }
  if (!angles.length) return null;
  angles.sort((a, b) => a - b);
  return angles[angles.length >> 1];
}

/**
 * Two blocks of text with a clear vertical gap through the middle of the
 * picture: two sheets the page finder did not see (they fill the frame, so
 * there is no edge to find). The gap must lie in the middle 30 % of the
 * width, be at least 2 % of it wide, be crossed by no word anywhere, and have
 * at least a quarter of the words on each side, and almost no printed row
 * may cross it.
 */
export function textInTwoBlocks(lines: OcrLine[], width: number): boolean {
  const boxes = lines.flatMap((l) => l.words.filter((w) => w.text.trim()).map((w) => w.box));
  if (boxes.length < 20) return false;
  const lo = width * 0.35;
  const hi = width * 0.65;
  const covered = boxes
    .filter((b) => b[2] > lo && b[0] < hi)
    .map((b) => [Math.max(lo, b[0]), Math.min(hi, b[2])] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const gaps: Array<[number, number]> = [];
  let at = lo;
  for (const [a, b] of covered) {
    if (a > at) gaps.push([at, a]);
    at = Math.max(at, b);
  }
  if (hi > at) gaps.push([at, hi]);
  // A table's own column gutter is also a gap no word crosses — but its rows
  // do: a printed row runs from its name across to its value. Two sheets'
  // rows stop at their own sheet's edge. So a gap counts only if almost no
  // printed row (buildRows over the phrases) spans it.
  const rows = ocrRows(lines);
  return gaps.some(([g0, g1]) => {
    if (g1 - g0 < width * 0.02) return false;
    const left = boxes.filter((b) => b[2] <= g0).length;
    const right = boxes.filter((b) => b[0] >= g1).length;
    if (left < boxes.length / 4 || right < boxes.length / 4) return false;
    const spanning = rows.filter((r) => r.box[0] < g0 && r.box[2] > g1).length;
    return spanning <= rows.length * 0.1;
  });
}

/** Why a photo gets no frames at all, or null when it may have them. */
export type Withhold = "two-sheets" | "skewed" | null;

/**
 * The photo-level guard, from what `preparePhoto` and the OCR pass know:
 *   - a found page wider than tall: two sheets taken for one (`isTwoSheets`);
 *   - no page found — OCR read the photo as it is — and the picture is
 *     landscape or its text sits in two blocks: two sheets filling the frame;
 *   - the picture OCR read was not flattened and its text is tilted past
 *     `MAX_TEXT_SKEW_DEG`: every axis-aligned row box reaches its neighbour.
 */
export function photoRowGuard(page: PageQuad | null, warped: boolean, lines: OcrLine[], width: number, height: number): Withhold {
  if (isTwoSheets(page)) return "two-sheets";
  if (!page && (width > height || textInTwoBlocks(lines, width))) return "two-sheets";
  if (!warped) {
    const skew = textSkewDeg(lines);
    if (skew !== null && Math.abs(skew) > MAX_TEXT_SKEW_DEG) return "skewed";
  }
  return null;
}

/** What the OCR pass leaves for the highlight: rows, the way back, the guard. */
export interface PhotoRowSource {
  /** Printed rows in the OCR picture's pixels. Held in memory only: they are
   *  text read from the unredacted photo and must never be stored or sent. */
  rows: OcrRow[];
  /** OCR picture → photo pixels; null when the OCR picture *is* the photo. */
  toPhoto: number[] | null;
  /** Set: no highlight on this photo at all (`photoRowGuard`). */
  withhold: Withhold;
}

export interface PhotoRowBox {
  /** The row's frame on the photo, to a tenth of a pixel. */
  quad: RowQuad;
  /** The quad's bounding box, for the scroll and the magnified strip. */
  bbox: Box;
}

const tenth = (v: number) => Math.round(v * 10) / 10;

/** A box in the OCR picture as a quad on the photo, to a tenth of a pixel. */
export function toPhotoQuad([x0, y0, x1, y1]: Box, toPhoto: number[] | null): RowQuad {
  const corners: RowQuad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const q = toPhoto ? corners.map((p) => applyHomography(toPhoto, p)) : corners;
  return q.map(([x, y]) => [tenth(x), tenth(y)]) as RowQuad;
}

export function quadBounds(q: RowQuad): Box {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The highlight for each read on a photo, or null where there must be none. */
export function locatePhotoRows(reads: ReadLike[], src: PhotoRowSource | null | undefined): Array<PhotoRowBox | null> {
  if (!src || src.withhold || !src.rows.length) return reads.map(() => null);
  return matchReadRows(reads, src.rows).map((i) => {
    if (i < 0) return null;
    const quad = toPhotoQuad(src.rows[i].box, src.toPhoto);
    return { quad, bbox: quadBounds(quad) };
  });
}
