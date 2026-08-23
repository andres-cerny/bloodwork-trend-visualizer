/**
 * The x axis must be time.
 *
 * Equal spacing by index rewrites the patient's history: draws in January,
 * February and then three years later would render identically to three evenly
 * spaced draws, turning a steep rise and a plateau into a gentle slope.
 */
import { describe, expect, it } from "vitest";

/** Mirrors the positioning in Chart.tsx. */
function positions(dates: string[], innerW = 580, padLeft = 46): number[] {
  const times = dates.map((d) => Date.parse(d));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = t1 - t0;
  return dates.map((_, i) =>
    dates.length === 1 || span <= 0 ? padLeft + innerW / 2 : padLeft + ((times[i] - t0) / span) * innerW,
  );
}

describe("time axis", () => {
  it("spaces evenly-dated draws evenly", () => {
    const xs = positions(["2024-01-01", "2024-07-01", "2025-01-01"]);
    const g1 = xs[1] - xs[0];
    const g2 = xs[2] - xs[1];
    // Not exactly equal, and correctly so: Jan->Jul is 182 days, Jul->Jan is
    // 184. Spacing follows real elapsed time, not the calendar's idea of
    // "half a year".
    expect(Math.abs(g1 - g2)).toBeLessThan(6);
  });

  it("puts a three-year gap far wider than a one-month gap", () => {
    const xs = positions(["2024-01-01", "2024-02-01", "2027-02-01"]);
    const shortGap = xs[1] - xs[0];
    const longGap = xs[2] - xs[1];
    expect(longGap).toBeGreaterThan(shortGap * 20);
  });

  it("centres a single point instead of dividing by zero", () => {
    expect(positions(["2024-01-01"])).toEqual([336]);
  });

  it("centres points that all share one date", () => {
    const xs = positions(["2024-01-01", "2024-01-01"]);
    expect(xs[0]).toBe(xs[1]);
    expect(Number.isFinite(xs[0])).toBe(true);
  });
});
