/**
 * The watch list: what heads the overview, and the facts beside it. The
 * properties that matter are the exclusions — a withheld reading never leads,
 * and a parameter last measured long ago is not "out of range now".
 */
import { describe, expect, it } from "vitest";
import { beyondLimit, type Trend, type TrendPoint, watchList } from "@bw/lab-core";

const pt = (date: string, value: number | null, refLow: number, refHigh: number, extra: Partial<TrendPoint> = {}): TrendPoint => ({
  date,
  value,
  unit: "µkat/l",
  flag: value === null ? "unknown" : value > refHigh ? "high" : value < refLow ? "low" : "normal",
  refLow,
  refHigh,
  valueRaw: value === null ? "" : String(value).replace(".", ","),
  reportId: `r-${date}`,
  suspect: null,
  unconfirmed: null,
  ...extra,
});

const trend = (id: string, points: TrendPoint[], unit = "µkat/l"): Trend => ({
  canonicalId: id,
  displayName: id.toUpperCase(),
  unit,
  points,
});

const trends = (...ts: Trend[]) => new Map(ts.map((t) => [t.canonicalId, t]));

describe("watchList", () => {
  it("lists what is out of range at the latest draw, furthest past its limit first", () => {
    const list = watchList(
      trends(
        trend("alt", [pt("2022-06-03", 0.61, 0.17, 0.78), pt("2024-02-02", 0.95, 0.17, 0.78), pt("2025-08-15", 1.12, 0.17, 0.78)]),
        trend("ggt", [pt("2025-08-15", 0.9, 0.14, 0.84)]),
        trend("crp", [pt("2025-08-15", 2, 0, 5)]),
      ),
    );
    expect(list.map((w) => w.canonicalId)).toEqual(["alt", "ggt"]);
    expect(list[0].beyond).toBeCloseTo((1.12 - 0.78) / 0.78, 6);
    expect(list[0].outStreak).toBe(2);
    expect(list[0].facts).toEqual([
      "44 % nad horní mezí 0,78 µkat/l",
      "2 odběry po sobě mimo rozmezí",
      "nárůst o 84 % od 6/22 (0,61 → 1,12)",
    ]);
    // A first-ever out-of-range reading with history behind it says so.
    expect(list[1].facts[0]).toBe("7 % nad horní mezí 0,84 µkat/l");
  });

  it("does not call a parameter measured only at an earlier draw 'out of range now'", () => {
    const list = watchList(
      trends(
        trend("vitd", [pt("2022-01-10", 20, 50, 125)]),
        trend("alt", [pt("2025-08-15", 0.5, 0.17, 0.78)]),
      ),
    );
    expect(list).toEqual([]);
  });

  it("never lets a withheld reading lead the list", () => {
    const list = watchList(
      trends(trend("gluk", [pt("2025-01-01", 5.1, 3.9, 5.6), pt("2025-08-15", 44.5, 3.9, 5.6, { suspect: "ověřit desetinnou čárku" })])),
    );
    expect(list).toEqual([]);
  });

  it("says 'pod dolní mezí' for a low value, with the streak counted from the end", () => {
    const list = watchList(
      trends(trend("hb", [pt("2024-01-01", 140, 135, 175), pt("2025-01-01", 130, 135, 175), pt("2025-08-15", 120, 135, 175)], "g/l")),
    );
    expect(list[0].flag).toBe("low");
    expect(list[0].facts[0]).toBe("11 % pod dolní mezí 135 g/l");
    expect(list[0].facts[1]).toBe("2 odběry po sobě mimo rozmezí");
    expect(list[0].facts[2]).toBe("pokles o 14 % od 1/24 (140 → 120)");
  });
});

describe("beyondLimit", () => {
  it("is a fraction of the crossed limit, and null without one", () => {
    expect(beyondLimit(pt("2025-01-01", 1.56, 0.17, 0.78))).toBeCloseTo(1, 6);
    expect(beyondLimit(pt("2025-01-01", 0.5, 0.17, 0.78))).toBeNull();
    expect(beyondLimit({ ...pt("2025-01-01", 9, 0, 5), refHigh: null, flag: "high" })).toBeNull();
  });
});
