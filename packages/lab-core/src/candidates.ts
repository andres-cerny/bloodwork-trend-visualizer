/**
 * Deterministic checks over a page's printed rows, for the text path.
 *
 * Measured on the real corpus (docs/extraction-speed.md, 2026-09-02): a single
 * Haiku read returns zero fabricated values on born-digital pages, and every
 * row it fails to return is one of two shapes this file can find without a
 * model — a qualitative result ("málo materiálu", "negat.") or, rarely, a
 * numeric row it skipped. The second reader used to be the completeness
 * check; these rules are cheaper, faster and catch strictly more.
 *
 * Three things, all pure:
 *   - `candidateRows`: rows that look like a measurement, so the caller can
 *     see which ones no returned measurement points at;
 *   - `repairRowIndex`: a `row_index` whose row does not carry the value is
 *     re-pointed at the neighbour that does (Haiku once numbered a whole
 *     page one too high);
 *   - `nameFromRow` / `nameOnRow`: a returned name that is not printed on its
 *     row (a typo) is replaced by the row's own text.
 */
import { materialWord, type TextRow } from "./pdf/rows";

export const NUMERIC_CELL = /^[<>]?\s*-?\d+(?:[,.]\d+)?$/;
const RANGE = /\d+(?:[,.]\d+)?\s*[-–]\s*\d+(?:[,.]\d+)?/;
const BOUND = /^[<>]\s*\d+(?:[,.]\d+)?$/;
const DATE = /^\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}$/;
const LAB_CODE = /^\d{3,6}$/;
const FLAG_CELL = /^[A-Za-z]$/;
/**
 * A lab's out-of-range marker in its own column — "( * )", "(*)", "* ( )",
 * "( ) *" — or the lone dot some LIS print in an empty text-result column.
 * Decoration: it says nothing about what the row is, and it is not a name.
 */
const MARKER_CELL = /^(?:[()\s*]+|\.)$/;
/**
 * An abbreviation column: "URE | urea", "KM | kyselina močová". All caps,
 * two to six characters, and the *next* cell begins lowercase — that is the
 * name. "LD | 3,33" keeps LD: nothing lowercase follows it.
 */
const ABBREVIATION = /^[A-ZÀ-Ž0-9]{2,6}$/;
/** A unit as one cell. Deliberately a list, not "anything with a slash". */
const UNIT =
  /^(?:%|‰|g\/l|mg\/l|µg\/l|μg\/l|ug\/l|ng\/l|ng\/ml|pg\/ml|mmol\/l|µmol\/l|μmol\/l|umol\/l|nmol\/l|pmol\/l|µkat\/l|μkat\/l|ukat\/l|U\/l|IU\/l|kU\/l|mIU\/l|mU\/l|fl|pg|l\/l|10\^\d+\/l|10˄\d+\/l|x10\^\d+\/l|10\*\d+\/l|g\/dl|mg\/dl|mm\/h|mm|s|kPa|ml\/min(?:\/1[.,]73m\^?2)?|ml\/s(?:\/1[.,]73m\^?2)?|arb\.?j\.?|index|ratio|mIU\/ml|IU\/ml|µg\/ml|ug\/ml|mosm\/kg|mmol\/kg|mmol\/mol|bezrozm\.?)$/i;
/** A unit printed as several cells: "10 | ˄ | 9/l", "10 | ˄12 | /l". */
const SPLIT_UNIT = /10\s*[˄^]\s*\d*\s*\/?\s*\d*\s*\/l/;
/** Qualitative results, whole cell or spread over cells. */
const QUALITATIVE =
  /málo materiálu|nedostatok materiálu|neprovedeno|nevykonan|negat|pozit|nelze|hemol[yý]z|chyl[oó]z|ikter|přijato|stopy|ojediněle|normální|přítomen|nepřítomen/i;
/** A criteria bound printed before the word: "<1,0 negatívne". */
const LEADING_BOUND = /^[<>]?\s*-?\d+(?:[,.]\d+)?\s+/;

export interface CandidateRow {
  index: number;
  kind: "numeric" | "qualitative";
  /** The row's name, as `nameFromRow` reads it. */
  name: string;
  /** For a qualitative row: the printed result, e.g. "málo materiálu". */
  result: string;
}

const clean = (row: TextRow) => row.cells.map((c) => c.trim()).filter(Boolean);
const squash = (s: string) => s.replace(/\s+/g, "");
/** Lab markers stripped the way normalize() strips them. */
const valueKey = (s: string | undefined) => squash(s ?? "").replace(/[!*]/g, "");

/** Where the analyte name starts: after an accreditation flag or a lab code. */
function nameStart(cells: string[]): number {
  for (let k = 0; k < Math.min(cells.length, 3); k++) {
    const c = cells[k];
    if (/[A-Za-zÀ-ž]/.test(c) && c.length >= 2 && !NUMERIC_CELL.test(c) && !DATE.test(c)) return k;
    if (!FLAG_CELL.test(c) && !LAB_CODE.test(c)) return -1;
  }
  return -1;
}

/**
 * The name printed on a row, read off the cells.
 *
 * Anchored on the value when the caller has one: the name is whatever stands
 * before the value cell once the flag, the code, a "#" marker, an ALL-CAPS
 * section label and a unit printed before the value are dropped. Without the
 * anchor, "S_IGF | 1 | 245" cannot tell name from number, so the first
 * numeric cell ends the name instead.
 */
export function nameFromRow(rows: TextRow[], index: number | undefined, valueRaw?: string, endCell?: number): string {
  if (index === undefined || index < 0 || index >= rows.length) return "";
  const cells = clean(rows[index]);
  const v = valueKey(valueRaw);
  let end = endCell ?? -1;
  if (end < 0 && v) end = cells.findIndex((c) => valueKey(c) === v);
  // A lab code in the first two cells is numeric too, and is not the value.
  if (end < 0) end = cells.findIndex((c, i) => NUMERIC_CELL.test(c) && !(i <= 1 && LAB_CODE.test(c)));
  if (end < 0) end = cells.length;
  const head = cells.slice(0, end);
  const parts: string[] = [];
  head.forEach((c, i) => {
    if ((i === 0 && FLAG_CELL.test(c)) || (i <= 1 && LAB_CODE.test(c)) || c === "#") return;
    if (UNIT.test(c) && i === head.length - 1 && i > 0) return;
    const sectionLabel = /^[A-ZÀ-Ž]{4,}$/.test(c) && head.slice(i + 1).some((x) => /[A-Za-zÀ-ž]{2}/.test(x));
    if (sectionLabel) return;
    const abbreviation = ABBREVIATION.test(c) && /^[a-zà-ž]/.test(head[i + 1] ?? "");
    if (abbreviation) return;
    if (QUALITATIVE.test(c) || /^[|*!]+$/.test(c) || MARKER_CELL.test(c)) return;
    // A lone H or L right before the value is the lab's flag, not the name's
    // last word. Other single letters stay: "Vitamin | D" is a name.
    if (/^[HL]$/.test(c) && i === head.length - 1 && i > 0) return;
    parts.push(c);
  });
  return parts.join(" ");
}

const nameKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Is this name printed on that row? Loose: accents and punctuation ignored. */
export function nameOnRow(rawName: string, rows: TextRow[], index: number | undefined): boolean {
  if (index === undefined || index < 0 || index >= rows.length) return false;
  const k = nameKey(rawName);
  return !!k && nameKey(rows[index].cells.join(" ")).includes(k);
}

/**
 * Rows a reader should have returned.
 *
 * Conservative on purpose: numeric needs a name-like cell followed by a
 * number AND a unit, a range or a bound; qualitative needs the name and a
 * known non-numeric result. Headers, dates and patient lines have neither.
 * Measured against 878 accepted rows: 873 found, the rest panel headers.
 */
export function candidateRows(rows: TextRow[]): CandidateRow[] {
  const out: CandidateRow[] = [];
  rows.forEach((row, index) => {
    const cells = clean(row);
    if (cells.length < 2) return;
    const start = nameStart(cells);
    if (start < 0) return;
    // Markers and flag letters are decoration; the shape is decided without them.
    const after = cells.slice(start + 1).filter((c) => !MARKER_CELL.test(c) && !FLAG_CELL.test(c));
    if (after.length === 0) return;
    const joined = cells.join(" ");
    const hasNum = after.some((c) => NUMERIC_CELL.test(c));
    const hasUnit = cells.some((c) => UNIT.test(c)) || SPLIT_UNIT.test(joined);
    const hasRange = RANGE.test(joined) || after.some((c) => BOUND.test(c));
    if (hasNum && (hasUnit || hasRange)) {
      out.push({ index, kind: "numeric", name: nameFromRow(rows, index), result: "" });
      return;
    }
    if (hasNum) return;
    // The result starts at the first cell from which the tail reads as a
    // qualitative result, e.g. "málo | materiálu"; the name is what precedes
    // it. A criteria bound may lead the word ("<1,0 negatívne") and is part
    // of the result. The result ends where the row moves on to a unit, a
    // criteria cell with digits or the Materiál column.
    for (let j = start + 1; j < cells.length; j++) {
      const tail = [cells[j].replace(LEADING_BOUND, ""), ...cells.slice(j + 1)].join(" ");
      if (QUALITATIVE.exec(tail)?.index === 0) {
        let k = j + 1;
        while (k < cells.length && !/\d/.test(cells[k]) && !UNIT.test(cells[k]) && !materialWord(cells[k])) k++;
        const result = cells.slice(j, k).join(" ");
        out.push({ index, kind: "qualitative", name: nameFromRow(rows, index, undefined, j) || cells[start], result });
        return;
      }
    }
  });
  return out;
}

export interface RepairedIndex {
  index: number | undefined;
  /** The index was moved to a neighbouring row that carries the value. */
  repaired: boolean;
  /** No row within reach carries the value; the index is not to be trusted. */
  broken: boolean;
}

/**
 * Check a returned `row_index` against the value it claims to come from, and
 * move it to the neighbour that actually carries the value when the row it
 * names does not. Reach is three rows either way — enough for the off-by-one
 * drift seen in practice, small enough not to jump to a different analyte:
 * the neighbour must also carry the name.
 */
export function repairRowIndex(
  valueRaw: string,
  rawName: string,
  index: number | undefined,
  rows: TextRow[],
): RepairedIndex {
  if (index === undefined) return { index: undefined, repaired: false, broken: false };
  const v = valueKey(valueRaw);
  const carries = (i: number) => i >= 0 && i < rows.length && (!v || squash(rows[i].cells.join(" ")).includes(v));
  if (carries(index)) return { index, repaired: false, broken: false };
  for (const d of [1, -1, 2, -2, 3, -3]) {
    const j = index + d;
    if (carries(j) && nameOnRow(rawName, rows, j)) return { index: j, repaired: true, broken: false };
  }
  return { index, repaired: false, broken: true };
}

/** Candidate rows no returned measurement points at, by kind. */
export function unclaimedRows(rows: TextRow[], claimed: Iterable<number | undefined>): CandidateRow[] {
  const taken = new Set<number>();
  for (const i of claimed) if (typeof i === "number") taken.add(i);
  return candidateRows(rows).filter((c) => !taken.has(c.index));
}
