/**
 * OCR words from a photographed page, in the shape `findIdentity` reads
 * (docs/plans/photo-capture.md, D2 and D4).
 *
 * Pure: Tesseract's lines in, phrases out. The browser half (the worker, the
 * traineddata) lives in the app; this is what a test can hold still.
 *
 * ## Why an adapter at all
 *
 * `findIdentity` works on rows built by `buildRows`, and treats every item as
 * a cell — which is right for pdf.js, whose items are phrases. Tesseract's are
 * words, so "Rodné číslo:" arrives as two cells and the label is lost. The
 * 2026-09-26 experiment (241 identity items over 133 photos) measured each step
 * below: raw words 109, phrases 164, phrases on one line-y plus the stray-glyph
 * cleanup 183.
 *
 * 1. **Phrases.** Neighbouring words on one OCR line whose gap is under
 *    `PHRASE_GAP` × the line's median word height become one item. A column
 *    gap in a table is wider than that; a space between words is not.
 * 2. **One y per line.** Every phrase on a line takes the line's median top
 *    and bottom. A descender or an accent otherwise gives one phrase a box
 *    taller than its neighbour's, and `buildRows` splits the row there.
 * 3. **Border glyphs.** A table rule or the page edge is read as a leading
 *    `i`, `l`, `|`, `!` or bracket glued to the first word. Dropped only when a
 *    capitalised word follows, so a real word is never cut.
 */
import type { Box } from "./models";

export interface OcrWord {
  text: string;
  /** Tesseract's 0–100 confidence; carried, not used for filtering. */
  conf?: number;
  box: Box;
}

export interface OcrLine {
  words: OcrWord[];
}

export interface OcrPhrase {
  text: string;
  box: Box;
}

/** Merge words whose gap is under this many word heights. */
export const PHRASE_GAP = 1.2;

const UPPER = "A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ";
const LOWER = "a-záčďéěíňóřšťúůýž";
const STRAY = new RegExp(`^[iIl|!\\[\\]]+(?=[${UPPER}][${LOWER}])`);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** Tesseract's lines as phrases with boxes, ready for `findIdentity`. */
export function ocrPhrases(lines: OcrLine[]): OcrPhrase[] {
  const out: OcrPhrase[] = [];
  for (const line of lines) {
    const words = line.words
      .map((w) => ({ ...w, text: w.text.trim().replace(STRAY, "") }))
      .filter((w) => w.text);
    if (!words.length) continue;
    const h = median(words.map((w) => w.box[3] - w.box[1])) || 20;
    const top = median(words.map((w) => w.box[1]));
    const bottom = median(words.map((w) => w.box[3]));
    let cur = [words[0]];
    const flush = () => {
      out.push({
        text: cur.map((w) => w.text).join(" "),
        box: [Math.min(...cur.map((w) => w.box[0])), top, Math.max(...cur.map((w) => w.box[2])), bottom],
      });
    };
    for (let i = 1; i < words.length; i++) {
      if (words[i].box[0] - words[i - 1].box[2] < PHRASE_GAP * h) cur.push(words[i]);
      else {
        flush();
        cur = [words[i]];
      }
    }
    flush();
  }
  return out;
}

/* ------------------------------------------------------ is this a lab sheet */

export interface LabSheetScore {
  /** Distinct lab units printed (mmol/l, g/l, ×10^9/l …). */
  units: number;
  /** Reference-range shapes (`3,5–5,1`, `( 2,50 - 6,40 )`, `< 5,0`). */
  ranges: number;
  /** Table header words (Výsledek, Jednotka, Ref. meze, Výsledok …). */
  headers: number;
  /** Lines holding a word of three or more letters and a decimal number —
   *  a whole number alone is too common in OCR noise off a photo of anything. */
  valueRows: number;
  /** One number: the sum above, weighted, capped per signal. */
  score: number;
  lab: boolean;
}

/**
 * Below this a photo is probably not a lab sheet and the person is told so —
 * never refused (the plan's "warn, rarely refuse"). Calibrated with
 * `tests/bench/photo_ocr_score.ts` on the `flatlit` OCR (2026-09-26): all
 * 8 non-lab pictures and the blank sheet score 2.5 or less; of the 162
 * readable lab photos (simulated, public, bad-but-ok) 156 score 5.5 or more.
 * The six below are four shots of one continuation page carrying two rows
 * and two moiré screen shots — a warning there costs one tap.
 */
export const LAB_SHEET_MIN = 5;

const UNIT_RE =
  /(?:[mµμnp]?mol|[mµμnpk]?g|[mµμ]?kat|[mµμ]?IU|[mµμ]?U|j|IU)\s*\/\s*(?:[mdµμ]?l|24\s*h|kg)\b|×?\s*10\s*[\^˄*]?\s*(?:9|12|6)\s*\/\s*l\b|\bfl\b|\bpg\b/gi;
const RANGE_RE = /\d+[,.]?\d*\s*[-–—]\s*\d+[,.]?\d*|[<>≤≥]\s*\d+[,.]?\d*/g;
const HEADER_RE = /\b(v[ýy]sledek|v[ýy]sledok|jednotk[ay]|ref(?:\.|erenční|erenčn[ée])?\s*(?:meze|rozmez[íi]|hodnot[ay]|interval)|norma|vy[šs]etřen[íi]|biochemie|hematologie|materi[áa]l)\b/gi;

/** How much a page's OCR text looks like a lab sheet. Word boxes are not used. */
export function labSheetScore(lines: string[]): LabSheetScore {
  const units = new Set<string>();
  let ranges = 0, headers = 0, valueRows = 0;
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    for (const m of line.matchAll(UNIT_RE)) units.add(m[0].toLowerCase().replace(/\s+/g, ""));
    ranges += [...line.matchAll(RANGE_RE)].length;
    headers += [...line.matchAll(HEADER_RE)].length;
    if (/\p{L}{3,}/u.test(line) && /\d+[,.]\d+/.test(line)) valueRows++;
  }
  const score = Math.min(units.size, 6) * 1.5 + Math.min(ranges, 10) * 0.5 + Math.min(headers, 4) + Math.min(valueRows, 20) * 0.25;
  return { units: units.size, ranges, headers, valueRows, score, lab: score >= LAB_SHEET_MIN };
}
