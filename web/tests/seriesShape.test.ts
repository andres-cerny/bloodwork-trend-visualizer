/**
 * The summary compares the last two draws, which is the wrong question for a
 * patient with ten of them: ALT climbing 0,61 → 1,02 over two and a half years
 * is the fact worth saying, and the last pair reports "+5 %".
 *
 * seriesShape is the view that can see the climb. It must never see a reading
 * the app has withheld — a misread decimal that reaches a described trend is
 * the defect this whole codebase is arranged against.
 */
import { describe, expect, it } from "vitest";
import { daysBetween, seriesShape, type Trend, type TrendPoint } from "../src/lib/trends";
import type { Flag } from "../src/lib/models";

const pt = (
  date: string,
  value: number | null,
  flag: Flag = "normal",
  extra: Partial<TrendPoint> = {},
): TrendPoint => ({
  date,
  value,
  unit: "µkat/l",
  flag,
  refLow: 0.17,
  refHigh: 0.78,
  valueRaw: String(value ?? ""),
  reportId: `r-${date}`,
  suspect: null,
  unconfirmed: null,
  ...extra,
});

const trend = (points: TrendPoint[]): Trend => ({
  canonicalId: "alt",
  displayName: "ALT",
  unit: "µkat/l",
  points,
});

describe("seriesShape", () => {
  it("sees a climb the last-two-draws comparison cannot", () => {
    // The real demo shape: a long steady rise whose final step is small.
    const s = seriesShape(
      trend([
        pt("2023-01-01", 0.61),
        pt("2024-01-01", 0.75),
        pt("2025-01-01", 0.97, "high"),
        pt("2025-07-01", 1.02, "high"),
      ]),
    )!;
    expect(s.direction).toBe("rising");
    expect(s.count).toBe(4);
    expect(s.change).toBeCloseTo(0.41, 5);
    expect(s.relChange).toBeCloseTo(0.6721, 3);
    // The last step alone is about +5%; across the series it is about +67%.
    expect(Math.round(s.relChange! * 100)).toBe(67);
    expect(s.monotone).toBe(true);
    expect(s.outStreak).toBe(2);
    expect(s.newlyOut).toBe(true);
  });

  it("refuses to describe a single draw", () => {
    expect(seriesShape(trend([pt("2024-01-01", 0.5)]))).toBeNull();
    expect(seriesShape(trend([]))).toBeNull();
  });

  it("never counts a withheld reading", () => {
    // A misread decimal is held out of the plotted series; it must be held out
    // of the described one too, or the app narrates a value it disbelieves.
    const s = seriesShape(
      trend([
        pt("2023-01-01", 0.6),
        pt("2023-06-01", 44.5, "high", { suspect: "posunutá desetinná čárka" }),
        pt("2024-01-01", 0.7),
      ]),
    )!;
    expect(s.count).toBe(2);
    expect(s.last.value).toBe(0.7);
    expect(s.direction).toBe("rising");
    expect(s.outOfRangeCount).toBe(0);
  });

  it("still counts a reading that is merely unconfirmed", () => {
    // "unconfirmed" means nothing corroborated it, not that it is wrong. Those
    // are plotted, so they are described.
    const s = seriesShape(
      trend([
        pt("2023-01-01", 0.6),
        pt("2024-01-01", 0.9, "high", { unconfirmed: "nejisté čtení" }),
      ]),
    )!;
    expect(s.count).toBe(2);
  });

  it("skips points with no numeric value", () => {
    const s = seriesShape(
      trend([pt("2023-01-01", 0.6), pt("2023-06-01", null), pt("2024-01-01", 0.8)]),
    )!;
    expect(s.count).toBe(2);
  });

  it("calls a move under the noise threshold flat", () => {
    const s = seriesShape(trend([pt("2023-01-01", 5.0), pt("2024-01-01", 5.02)]))!;
    expect(s.direction).toBe("flat");
  });

  it("separates a steady drift from the same change arrived at by bouncing", () => {
    const steady = seriesShape(
      trend([pt("2023-01-01", 1), pt("2023-06-01", 2), pt("2024-01-01", 3)]),
    )!;
    expect(steady.monotone).toBe(true);

    const bouncing = seriesShape(
      trend([pt("2023-01-01", 1), pt("2023-06-01", 9), pt("2024-01-01", 3)]),
    )!;
    expect(bouncing.monotone).toBe(false);
    // Same endpoints, same total change — different clinical fact.
    expect(bouncing.change).toBeCloseTo(steady.change, 5);
  });

  it("does not treat noise-sized wobble as a reversal", () => {
    const s = seriesShape(
      trend([pt("2023-01-01", 5), pt("2023-06-01", 5.01), pt("2024-01-01", 7)]),
    )!;
    expect(s.monotone).toBe(true);
  });

  it("counts only the out-of-range run that reaches the present", () => {
    const s = seriesShape(
      trend([
        pt("2022-01-01", 1.2, "high"),
        pt("2023-01-01", 0.5),
        pt("2024-01-01", 0.9, "high"),
        pt("2025-01-01", 1.0, "high"),
      ]),
    )!;
    expect(s.outOfRangeCount).toBe(3);
    expect(s.outStreak).toBe(2);
    // Out of range at the first draw too, so nothing here is new.
    expect(s.newlyOut).toBe(false);
  });

  it("measures the span the change happened over", () => {
    const s = seriesShape(trend([pt("2023-01-01", 1), pt("2024-01-01", 2)]))!;
    expect(s.spanDays).toBe(365);
  });
});

describe("daysBetween", () => {
  it("counts whole days across a leap day and a year boundary", () => {
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // 2024 is a leap year
    expect(daysBetween("2023-02-28", "2023-03-01")).toBe(1);
    expect(daysBetween("2022-02-08", "2026-04-14")).toBe(1526);
  });

  it("returns 0 rather than NaN for an unparseable date", () => {
    expect(daysBetween("", "2024-01-01")).toBe(0);
    expect(daysBetween("nonsense", "2024-01-01")).toBe(0);
  });
});
