/**
 * Deterministic row checks shared by the subagent benchmark's dump and score
 * steps. Kept out of the *.bench.ts files so importing them does not re-run a
 * sweep.
 */
import type { TextRow } from "@bw/lab-core";

export const NUM = /^[<>]?\s*-?\d+(?:[,.]\d+)?$/;
const RANGE = /\d+(?:[,.]\d+)?\s*[-–]\s*\d+(?:[,.]\d+)?/;
export const UNIT =
  /^(?:%|g\/l|mg\/l|µg\/l|μg\/l|ug\/l|ng\/l|ng\/ml|pg\/ml|mmol\/l|µmol\/l|μmol\/l|umol\/l|nmol\/l|pmol\/l|µkat\/l|μkat\/l|ukat\/l|U\/l|IU\/l|kU\/l|mIU\/l|mU\/l|fl|pg|l\/l|10\^\d+\/l|10˄\d+\/l|x10\^\d+\/l|10\*\d+\/l|g\/dl|mg\/dl|mm\/h|s|kPa|ml\/min(?:\/1,73m2)?|ml\/s(?:\/1,73m2)?|arb\.?j\.?|index|ratio|mIU\/ml|IU\/ml|µg\/ml|ug\/ml|mg\/dl|mosm\/kg|mmol\/mol|‰)$/i;
const QUAL = /^(?:negat\.?|negativní|pozit\.?|pozitivní|neg\.?|poz\.?|nelze|málo materiálu|hemol[yý]za|chyl[oó]zn[ií]|ikter|normální|norm\.?|přítomen|nepřítomen|stopy|ojediněle)$/i;
const DATE = /^\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}$/;

export interface Candidate {
  index: number;
  kind: "numeric" | "qualitative";
}

/** A unit printed as several cells: "10 | ˄ | 9/l", "10 | ˄12 | /l". */
const SPLIT_UNIT = /10\s*[˄^]\s*\d*\s*\/?\s*\d*\s*\/l/;
/** A one-sided bound, "< 4,5" or "> 1,00", as a whole cell. */
const BOUND = /^[<>]\s*\d+(?:[,.]\d+)?$/;
/** Qualitative results that print across cells. */
const QUAL_JOINED = /málo materiálu|neprovedeno|negat|pozit|nelze|hemol[yý]z|chyl[oó]z|ikter|přijato|stopy|ojediněle/i;

/**
 * Rows a deterministic completeness check would expect a reader to claim.
 *
 * Conservative on purpose: a row counts only with a name-like cell followed
 * by a numeric value AND either a unit, a range or a bound. Headers, dates and
 * patient lines have no such shape. A numeric lab code before the name
 * ("81383 | LD | 3,33 …") is skipped over, not treated as the name.
 */
export function candidateRows(rows: TextRow[]): Candidate[] {
  const out: Candidate[] = [];
  rows.forEach((r, i) => {
    const cells = r.cells.map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) return;
    // The name is the first cell that starts with a letter; a leading numeric
    // code is allowed before it.
    let nameAt = -1;
    for (let k = 0; k < Math.min(cells.length, 3); k++) {
      // A name has letters in it ("25-OH vitamin D" starts with a digit) and
      // is neither a bare number nor a date.
      if (/[A-Za-zÀ-ž]/.test(cells[k]) && cells[k].length >= 2 && !NUM.test(cells[k]) && !DATE.test(cells[k])) {
        nameAt = k;
        break;
      }
      // Skip a leading accreditation flag ("A") or a numeric lab code.
      if (!/^[A-Za-z]$/.test(cells[k]) && !/^\d{3,6}$/.test(cells[k])) break;
    }
    if (nameAt < 0) return;
    const after = cells.slice(nameAt + 1);
    const joined = cells.join(" ");
    const hasNum = after.some((c) => NUM.test(c));
    const hasUnit = cells.some((c) => UNIT.test(c)) || SPLIT_UNIT.test(joined);
    const hasRange = RANGE.test(joined) || after.some((c) => BOUND.test(c));
    if (hasNum && (hasUnit || hasRange)) {
      out.push({ index: i, kind: "numeric" });
      return;
    }
    if (!hasNum && (after.some((c) => QUAL.test(c)) || QUAL_JOINED.test(after.join(" ")))) {
      out.push({ index: i, kind: "qualitative" });
    }
  });
  return out;
}

