/**
 * Reading a birth date out of a Czech rodné číslo.
 *
 * The number encodes the date in its first six digits, so a patient's age is
 * already on every report — it just was never decoded. `app.py` knew enough to
 * mask everything after those six digits and nothing more.
 *
 * The rule this file is built around: **derive nothing that is not certainly
 * there.** A wrong birth date printed beside a patient's name is worse than no
 * birth date, because it looks like a fact the app checked. So an unparseable
 * number returns null rather than a best guess, and 30 February is not a date
 * however well-formed the digits around it are.
 *
 * The checksum is reported, not enforced. A failing check means the number is
 * probably mistranscribed — which is worth saying — but the printed date part
 * is still the date part, and refusing to show it would hide the transcription
 * problem rather than surface it.
 */

export type Sex = "male" | "female";

export interface RodneCislo {
  /** ISO YYYY-MM-DD. */
  birthDate: string;
  sex: Sex;
  /**
   * Whether the number is internally consistent.
   *
   * Only defined for the ten-digit form issued since 1954; `null` for the
   * nine-digit form, which carries no check digit at all. `false` means the
   * digits do not agree with each other — most likely a misread.
   */
  checksumOk: boolean | null;
}

/**
 * Month offsets. 1–12 and 51–62 are the original male/female split; 21–32 and
 * 71–82 were added in 2004 for days where a registry office exhausted the
 * ordinary series, and a reader that does not know them rejects perfectly
 * valid numbers issued since.
 */
function monthAndSex(mm: number): { month: number; sex: Sex } | null {
  for (const [base, sex] of [
    [0, "male"],
    [50, "female"],
    [20, "male"],
    [70, "female"],
  ] as Array<[number, Sex]>) {
    const month = mm - base;
    if (month >= 1 && month <= 12) return { month, sex };
  }
  return null;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseRodneCislo(input: string | null | undefined): RodneCislo | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length !== 9 && digits.length !== 10) return null;

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));

  const ms = monthAndSex(mm);
  if (!ms) return null;

  // The nine-digit form stopped being issued in 1954, so it is always 19xx.
  // The ten-digit form runs 1954 onward, which puts 54–99 in the 1900s and
  // 00–53 in the 2000s. There is no third case to guess at.
  const year = digits.length === 9 ? 1900 + yy : yy >= 54 ? 1900 + yy : 2000 + yy;

  if (dd < 1 || dd > daysInMonth(year, ms.month)) return null;

  const checksumOk = digits.length === 10 ? Number(digits) % 11 === 0 : null;

  const iso = `${year}-${String(ms.month).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { birthDate: iso, sex: ms.sex, checksumOk };
}

/** Whole years completed by `on`. Both dates are ISO YYYY-MM-DD. */
export function ageOn(birthDate: string, on: string): number | null {
  const b = birthDate.split("-").map(Number);
  const o = on.split("-").map(Number);
  if (b.length !== 3 || o.length !== 3 || b.some(isNaN) || o.some(isNaN)) return null;
  let age = o[0] - b[0];
  // Not yet had this year's birthday.
  if (o[1] < b[1] || (o[1] === b[1] && o[2] < b[2])) age -= 1;
  return age < 0 ? null : age;
}
