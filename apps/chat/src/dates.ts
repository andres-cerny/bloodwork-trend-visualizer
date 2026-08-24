/**
 * One date formatter, for the whole app.
 *
 * There were three before this file existed, and all three were on screen at
 * once: the registry's raw ISO in a rail title („Odběr 2023-02-14"), the Czech
 * form with spaces in the line under it („· 14. 2. 2023"), and the agent's own
 * unspaced form in the answer body („16.1.2024"). One card stating the same
 * date twice in two conventions is not a rounding error — one of the two is not
 * Czech, and a reader who notices has to decide which of them the app means.
 *
 * Czech sets a day-month-year date with a space after each dot: `14. 2. 2023`.
 * That is the only form this app renders, and `czDate` is the only thing that
 * renders it.
 */

/** `2023-02-14` → `14. 2. 2023`. Anything else is returned untouched. */
export function czDate(value: string): string {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (iso) return `${Number(iso[3])}. ${Number(iso[2])}. ${iso[1]}`;
  const cz = /^\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s*$/.exec(value);
  if (cz) return `${Number(cz[1])}. ${Number(cz[2])}. ${cz[3]}`;
  return value;
}

/**
 * Every `d.M.yyyy` in a run of prose.
 *
 * The character in front is captured rather than looked behind: lookbehind is
 * a parse-time syntax error in Safari before 16.4, and a regex that throws
 * while the module is being evaluated takes the whole bundle with it.
 */
const IN_TEXT = /(^|[^\d.])(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})(?!\d)/g;

/**
 * The same normalisation, applied inside the agent's own prose.
 *
 * The model writes „16.1.2024" as often as „16. 1. 2024", sometimes both in one
 * answer, and the rail beside it is always spaced — so the screen contradicted
 * itself within one glance. Only the spacing between the parts of a date is
 * touched: no digit is added, removed or reordered, and a string that is not a
 * date is not a match.
 */
export function czDatesInText(text: string): string {
  return text.replace(
    IN_TEXT,
    (_m, before: string, d: string, mo: string, y: string) =>
      before + czDate(`${d}.${mo}.${y}`),
  );
}
