/**
 * Finding the identity printed on a lab report, so it can be painted out in
 * the browser before a page goes anywhere.
 *
 * Moje krev stores health numbers keyed to an e-mail and nothing else; the
 * name, rodné číslo, birth date and address on a report header must never
 * reach the server. This module is the detection half of that promise —
 * pure functions over the text layer with coordinates, testable against
 * fixtures in plain node. Painting the boxes lives in the pdf subpath,
 * because it needs a canvas.
 *
 * Two passes, and the second one is the point:
 *
 *   1. Label-anchored. "Pacient:", "Rodné číslo:", "Datum narození:",
 *      "Bydliště:" name their value, which is how a header is read. A rodné
 *      číslo is also recognised bare, because its shape is unmistakable — a
 *      nine-or-ten-digit number that decodes to a calendar date is not a lab
 *      value.
 *   2. Sweep. Every string the first pass found is searched for again on
 *      every page, in the spellings a report actually uses — surname first,
 *      the number without its slash, a bare surname — so a name repeated in
 *      a footer or a continuation header without its label is caught too.
 *      The test that pins this was written before the pass existed and
 *      failed, which is the repo's habit for anything called a guard.
 *
 * Detection is deliberately generous: a false positive costs one tap on the
 * review screen, a miss is a name on a server. And the review screen is not
 * optional — nothing here can see a stamp or a signature, and "found
 * nothing" is only reassuring when the page had a text layer to find it in
 * (`canRedact`).
 */
import type { Box } from "./models";
import { buildRows } from "./pdf/rows";
import { parseRodneCislo } from "./rodneCislo";

/** `manual` is a box the reviewer drew — a stamp, a signature, anything detection cannot see. */
export type IdentityKind = "rodne-cislo" | "birth-date" | "name" | "address" | "repeat" | "manual";

export interface IdentityHit {
  pageNum: number;
  /** Pixel box in the page image's own coordinates, like every other Box. */
  box: Box;
  kind: IdentityKind;
  /** The printed text the box covers — what the review screen names. */
  text: string;
}

export interface PageWords {
  pageNum: number;
  words: Array<{ text: string; box: Box }>;
}

export interface IdentityFindings {
  hits: IdentityHit[];
  /**
   * Every identifying string found, in every spelling worth stripping from
   * the text layer. Derived from the hits, so a hit the reviewer dismisses
   * as a false positive can take its string with it (`stringsOf`).
   */
  strings: string[];
}

/**
 * Below this much text on a page, "no identifiers found" means nothing: the
 * search ran over a text layer that barely exists, and a scanned header with
 * the name on it would sail through looking clean. Same threshold and same
 * reasoning as the Python exporter's MIN_TEXT_CHARS.
 */
export const MIN_TEXT_CHARS = 200;

export function canRedact(words: Array<{ text: string }>): boolean {
  return words.reduce((n, w) => n + w.text.trim().length, 0) >= MIN_TEXT_CHARS;
}

/**
 * Fold one UTF-16 unit at a time so an index into the folded string is an
 * index into the original — that is what turns a regex match back into a box.
 */
function foldChar(ch: string): string {
  const f = ch.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return f.length === 0 ? " " : f[0];
}

export function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += foldChar(s[i]);
  return out;
}

/*
 * The labels a Czech report prints before each identifier, matched on folded
 * text. Longer alternatives first inside each group, and the groups ordered so
 * "adresa pacienta" is an address before "pacient" is a name.
 */
const LABEL_RE = new RegExp(
  String.raw`(?<![a-z0-9])(?:` +
    String.raw`(?<birth>datum narozeni|datum nar\.?|dat\. ?nar\.?|narozena|narozen|nar\.)|` +
    String.raw`(?<rc>rodne cislo|rod\.? ?cislo|rod\. ?c\.|r\. ?c\.|rc|cislo pojistence|c\. ?pojistence|c\. ?poj\.|identifikace pacienta|id pacienta|id(?=\s*:))|` +
    String.raw`(?<addr>trvale bydliste|trvaly pobyt|bydliste|adresa pacienta|adresa|ulice)|` +
    String.raw`(?<name>jmeno a prijmeni|prijmeni a jmeno|jmeno pacienta|pacient/ka|pacientka|pacient|prijmeni|jmeno|nemocny|klient)` +
    String.raw`)(?![a-z0-9])\s*:?\s*`,
  "g",
);

/** The same labels, anchored and without the global flag — for asking
 *  whether the *next* item is a label rather than the rest of a value. */
const STARTS_WITH_LABEL = new RegExp(`^${LABEL_RE.source.replace(/^\(\?<!\[a-z0-9\]\)/, "")}`);

/** Any "Something:" at the start of a cell — a label that is not ours, and
 *  therefore where a value we are reading stops. "Datum odběru:" is the one
 *  that matters: it sits right after the name on many headers. */
const OTHER_LABEL_RE = /^[^\d:]{2,40}:/;

/** Rodné číslo as printed: six digits, an optional slash, three or four
 *  more — and one lab prints it as spaced digits, "9 9 0 8 0 3 1 2 3 4",
 *  which the compact pattern walked straight past. */
const RC_RE = /\d(?:\s?\d){5}\s?\/?\s?\d(?:\s?\d){2,3}/g;
const DATE_RE = /\d{1,2}\.\s?\d{1,2}\.\s?(?:\d{4}|\d{2})(?!\d)|\d{4}-\d{2}-\d{2}/;

const kindOf = (m: RegExpMatchArray): IdentityKind => {
  const g = m.groups ?? {};
  if (g.birth) return "birth-date";
  if (g.rc) return "rodne-cislo";
  if (g.addr) return "address";
  return "name";
};

/*
 * Relative glyph widths, so a slice of an item lands where its characters
 * are. pdf.js reports one width per item, and dividing it equally put the
 * box for "Rodné číslo: 800101/0006" one glyph to the right — a label of
 * narrow letters followed by wide digits — leaving the first digit readable.
 * These are the proportions of a typical sans (DejaVu, Arial, Helvetica are
 * within a few percent of each other), scaled to the item's measured width,
 * and the bleed on each side covers what remains.
 */
function glyphWidth(ch: string): number {
  if (/[ .,:;'|!()\[\]\/\\-]/.test(ch)) return 0.3;
  if (/[ijlt]/.test(ch)) return 0.28;
  if (/[fr]/.test(ch)) return 0.36;
  if (/[mwMW]/.test(ch)) return 0.85;
  if (/[A-Z0-9ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(ch)) return 0.62;
  return 0.52;
}

/** The box of characters [a, b) inside an item, with one glyph of bleed. */
function subBox(box: Box, text: string, a: number, b: number): Box {
  const widths = Array.from(text, glyphWidth);
  const total = widths.reduce((s, w) => s + w, 0);
  if (total <= 0) return box;
  const scale = (box[2] - box[0]) / total;
  const before = widths.slice(0, a).reduce((s, w) => s + w, 0) * scale;
  const span = widths.slice(a, b).reduce((s, w) => s + w, 0) * scale;
  const bleed = 0.7 * scale;
  return [box[0] + before - bleed, box[1], box[0] + before + span + bleed, box[3]];
}

function union(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/**
 * The spellings of one identifier worth searching for.
 *
 * A rodné číslo is printed with and without its slash; a name appears as
 * "Jan Novák" in the header and "NOVÁK Jan" in the footer; a birth date
 * gains or loses the spaces after its dots. Single words of three or more
 * characters are included, so a surname alone is caught — which over-reaches
 * for a surname that is also a word (Vzorek), and that is the right side to
 * err on.
 */
export function identityVariants(value: string): string[] {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) return [];
  const out = new Set<string>([v, v.replace(/\//g, ""), v.replace(/\s*\/\s*/g, " / ")]);
  out.add(v.replace(/\.\s+/g, "."));
  out.add(v.replace(/\.(?=\d)/g, ". "));
  // A number: its digits alone, and with the slash where a rodné číslo has
  // one — whatever spacing the page used.
  if (/^[\d\s/]+$/.test(v)) {
    const d = v.replace(/\D/g, "");
    if (d.length >= 6) {
      out.add(d);
      out.add(`${d.slice(0, 6)}/${d.slice(6)}`);
    }
  }
  const parts = v.split(" ").filter(Boolean);
  if (parts.length > 1) {
    out.add([...parts].reverse().join(" "));
    for (const p of parts) out.add(p.replace(/[,;.]+$/, ""));
  }
  return [...out].filter((s) => s.length >= 3);
}

/** The strings a set of hits implies — what to strip from the text layer. */
export function stringsOf(hits: IdentityHit[]): string[] {
  const out = new Set<string>();
  for (const h of hits) for (const v of identityVariants(h.text)) out.add(v);
  return [...out];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function validValue(kind: IdentityKind, value: string): string | null {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v) return null;
  switch (kind) {
    case "rodne-cislo": {
      const m = v.match(RC_RE);
      // A labelled identifier that is not shaped like a rodné číslo — a
      // foreign insurance number — is still an identifier.
      return m ? m[0] : v;
    }
    case "birth-date": {
      const m = v.match(DATE_RE);
      return m ? m[0] : null;
    }
    default:
      // A name or address that is only digits or a date is a misread label.
      return /[a-záčďéěíňóřšťúůýž]/i.test(v) && v.length >= 2 ? v : null;
  }
}

/**
 * Find every printed identifier on every page.
 *
 * Works on rows rather than raw items, because pdf.js splits "Pacient:" and
 * its value into separate items at arbitrary points and a row is the unit a
 * header is actually printed in.
 */
export function findIdentity(pages: PageWords[]): IdentityFindings {
  const hits: IdentityHit[] = [];
  const push = (h: IdentityHit) => {
    if (!hits.some((x) => x.pageNum === h.pageNum && boxesOverlap(x.box, h.box))) hits.push(h);
  };

  for (const page of pages) {
    for (const row of buildRows(page.words)) {
      const cells = row.cells;
      for (let ci = 0; ci < cells.length; ci++) {
        const cell = cells[ci];
        const box = row.cellBoxes[ci];
        const folded = fold(cell);
        const matches = [...folded.matchAll(LABEL_RE)];

        for (let k = 0; k < matches.length; k++) {
          const m = matches[k];
          const kind = kindOf(m);
          const start = m.index! + m[0].length;
          const end = k + 1 < matches.length ? matches[k + 1].index! : cell.length;
          let value = cell.slice(start, end);
          const boxes: Box[] = [];

          // The value sits in the same item as its label. Box only the
          // value: painting over "Pacient:" too would hide from the review
          // screen what the box is for.
          const inCell = validValue(kind, value);
          if (inCell) {
            const at = value.indexOf(inCell);
            const a = start + (at >= 0 ? at : 0);
            const b = at >= 0 ? a + inCell.length : end;
            push({ pageNum: page.pageNum, box: subBox(box, cell, a, b), kind, text: inCell });
            continue;
          }

          // Nothing usable in the item itself: the label ends it, or what is
          // left is punctuation — "Narozen(a):", "RČ# :" — which used to be
          // taken for the value and, found wanting, ended the search. Six
          // reports leaked a birth date that way. The value is the next item
          // or items on the row, up to the next label of any kind.
          if (k + 1 < matches.length) continue;
          value = /[a-z0-9]/.test(fold(value)) ? value : "";
          for (let cj = ci + 1; cj < cells.length; cj++) {
            const next = cells[cj];
            if (OTHER_LABEL_RE.test(fold(next)) || STARTS_WITH_LABEL.test(fold(next))) break;
            value += (value ? " " : "") + next;
            boxes.push(row.cellBoxes[cj]);
            // One number or one date is the whole value; a name may run on.
            if (kind !== "name" && kind !== "address" && validValue(kind, value)) break;
          }
          const raw = validValue(kind, value);
          if (raw && boxes.length) push({ pageNum: page.pageNum, box: union(boxes), kind, text: raw });
        }

        // A bare rodné číslo, wherever it is printed. Must decode to a date:
        // that is what separates it from a sample number.
        for (const m of cell.matchAll(RC_RE)) {
          if (!parseRodneCislo(m[0])) continue;
          // Nine digits in groups of three is how a phone number is printed,
          // and enough of them decode to a pre-1954 date to box the lab's
          // switchboard on every report. A nine-digit number is taken bare
          // only when it is printed as one word; with a label it is always
          // taken.
          const digits = m[0].replace(/\D/g, "");
          if (digits.length === 9 && !m[0].includes("/") && /\s/.test(m[0])) continue;
          push({
            pageNum: page.pageNum,
            box: subBox(box, cell, m.index!, m.index! + m[0].length),
            kind: "rodne-cislo",
            text: m[0],
          });
        }
      }
    }
  }

  const all = sweepRepeats(pages, hits);
  return { hits: all, strings: stringsOf(all) };
}

/**
 * Second pass: every spelling of every identifier found, on every page.
 *
 * This is what catches the name in a footer, the rodné číslo repeated in a
 * continuation header, the surname alone under a signature line — none of
 * which carry the label the first pass keys on.
 */
export function sweepRepeats(pages: PageWords[], hits: IdentityHit[]): IdentityHit[] {
  const out = [...hits];
  const push = (h: IdentityHit) => {
    if (!out.some((x) => x.pageNum === h.pageNum && boxesOverlap(x.box, h.box))) out.push(h);
  };
  const needles = stringsOf(hits).map((s) => ({
    text: s,
    re: new RegExp(String.raw`(?<![a-z0-9])${escapeRe(fold(s))}(?![a-z0-9])`, "g"),
  }));
  if (needles.length === 0) return out;

  for (const page of pages) {
    for (const row of buildRows(page.words)) {
      row.cells.forEach((cell, ci) => {
        const folded = fold(cell);
        for (const n of needles) {
          for (const m of folded.matchAll(n.re)) {
            push({
              pageNum: page.pageNum,
              box: subBox(row.cellBoxes[ci], cell, m.index!, m.index! + m[0].length),
              kind: "repeat",
              text: cell.slice(m.index!, m.index! + m[0].length),
            });
          }
        }
      });
    }
  }
  return out;
}

/**
 * The text layer with the identity removed: every item under a box, and every
 * item that still spells an identifier, is dropped. What remains is what the
 * extractor may see and what the verification view may show.
 */
export function stripIdentity(
  words: Array<{ text: string; box: Box }>,
  hits: Array<{ box: Box }>,
  strings: string[],
): Array<{ text: string; box: Box }> {
  const needles = strings.map((s) => new RegExp(String.raw`(?<![a-z0-9])${escapeRe(fold(s))}(?![a-z0-9])`));
  return words.filter((w) => {
    if (hits.some((h) => boxesOverlap(h.box, w.box))) return false;
    const f = fold(w.text);
    return !needles.some((re) => re.test(f));
  });
}

/**
 * Which identifiers can still be read from these words. Meaningful only on a
 * page that `canRedact` — on a scan it finds nothing because there is
 * nothing to search, which is a different thing from being clean.
 */
export function survivingIdentity(words: Array<{ text: string }>, strings: string[]): string[] {
  const text = fold(words.map((w) => w.text).join(" "));
  return strings.filter((s) => new RegExp(String.raw`(?<![a-z0-9])${escapeRe(fold(s))}(?![a-z0-9])`).test(text));
}
