/**
 * Czech plural agreement.
 *
 * Czech takes three forms by count — 1, 2–4, and 5+ — and "5 stran" vs
 * "2 strany" is the kind of thing a native reader notices immediately. Getting
 * it wrong in an app shown to a doctor reads as carelessness.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  if (abs >= 2 && abs <= 4) return few;
  return many;
}

/** "3 strany", "1 strana", "12 stran". */
export function count(n: number, one: string, few: string, many: string): string {
  return `${n} ${plural(n, one, few, many)}`;
}

/**
 * ISO date as a Czech reader writes it: "14. 2. 2024".
 *
 * The app was showing three formats at once — 2024-02-14 in the picker,
 * 24/02 on the chart axis, 14.2.2024 on the scanned page — and "24/02" in
 * particular reads to a Czech eye as the 24th of February, not February 2024.
 */
export function czDate(iso: string | null | undefined): string {
  if (!iso) return "bez data";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
}

/** Short month/year for a chart axis: "2/24". Never "24/02". */
export function czMonthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[2])}/${m[1].slice(2)}`;
}
