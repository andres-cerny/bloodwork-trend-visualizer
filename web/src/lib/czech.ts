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
