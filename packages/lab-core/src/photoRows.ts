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
 *   - the name may carry OCR typos, up to one edit in five characters, but
 *     must be there;
 *   - exactly one OCR row may qualify, and no other read may claim it;
 *   - **two sheets in one frame get no highlight at all.** The page finder
 *     then takes the whole spread as one page, rows of the left and right
 *     sheet merge into one OCR row, and its box lands between them. A found
 *     page wider than tall is that case (a single A4 sheet is portrait).
 *
 * Measured on 133 simulated photos plus the bad-photo set: 0 wrong boxes
 * (strict rule), about nine rows in ten framed.
 */
import type { Box } from "./models";
import { buildRows } from "./pdf/rows";
import { ocrPhrases, type OcrLine } from "./photoOcr";
import { applyHomography, type PageQuad, type Point } from "./photoPage";

/** One printed row as OCR read it, in the OCR picture's pixels. */
export interface OcrRow {
  text: string;
  box: Box;
}

/** A frame on the photo: four corners, clockwise from top-left. */
export type RowQuad = [Point, Point, Point, Point];

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

/** Letters and digits only, lowercased, accents folded — as the bench's `nameKey`. */
function nameKey(s: string | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
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

/** The read's name is on the row, allowing one OCR edit in five characters. */
export function rowHasName(rowText: string, name: string | undefined): boolean {
  const n = nameKey(name);
  if (!n) return false;
  const r = nameKey(rowText);
  if (r.includes(n)) return true;
  const budget = Math.floor(n.length * 0.2);
  if (budget === 0) return false;
  for (let len = n.length - budget; len <= n.length + budget; len++) {
    for (let i = 0; i + len <= r.length; i++) if (editDistance(n, r.slice(i, i + len)) <= budget) return true;
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

/** What the OCR pass leaves for the highlight: rows, the way back, the guard. */
export interface PhotoRowSource {
  /** Printed rows in the OCR picture's pixels. Held in memory only: they are
   *  text read from the unredacted photo and must never be stored or sent. */
  rows: OcrRow[];
  /** OCR picture → photo pixels; null when the OCR picture *is* the photo. */
  toPhoto: number[] | null;
  /** Two sheets in one frame: no highlight on this photo. */
  twoSheets: boolean;
}

export interface PhotoRowBox {
  /** The row's frame on the photo. */
  quad: RowQuad;
  /** The quad's bounding box, for the scroll and the magnified strip. */
  bbox: Box;
}

/** A box in the OCR picture as a quad on the photo. */
export function toPhotoQuad([x0, y0, x1, y1]: Box, toPhoto: number[] | null): RowQuad {
  const corners: RowQuad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return toPhoto ? (corners.map((p) => applyHomography(toPhoto, p)) as RowQuad) : corners;
}

export function quadBounds(q: RowQuad): Box {
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** The highlight for each read on a photo, or null where there must be none. */
export function locatePhotoRows(reads: ReadLike[], src: PhotoRowSource | null | undefined): Array<PhotoRowBox | null> {
  if (!src || src.twoSheets || !src.rows.length) return reads.map(() => null);
  return matchReadRows(reads, src.rows).map((i) => {
    if (i < 0) return null;
    const quad = toPhotoQuad(src.rows[i].box, src.toPhoto);
    return { quad, bbox: quadBounds(quad) };
  });
}
