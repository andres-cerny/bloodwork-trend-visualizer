/**
 * Czech takes three plural forms — 1, 2–4, and 5+. "5 strany" instead of
 * "5 stran" is immediately visible to a native reader, and this app is shown
 * to Czech doctors.
 */
import { describe, expect, it } from "vitest";
import { count, czDate, czMonthYear, plural } from "../src/lib/czech";

describe("plural", () => {
  it("uses the singular for one", () => {
    expect(plural(1, "strana", "strany", "stran")).toBe("strana");
  });

  it("uses the 2–4 form", () => {
    for (const n of [2, 3, 4]) expect(plural(n, "strana", "strany", "stran")).toBe("strany");
  });

  it("uses the 5+ form", () => {
    for (const n of [5, 11, 12, 100]) expect(plural(n, "strana", "strany", "stran")).toBe("stran");
  });

  it("uses the 5+ form for zero", () => {
    expect(plural(0, "strana", "strany", "stran")).toBe("stran");
  });
});

describe("count", () => {
  it("renders the number with the right form", () => {
    expect(count(1, "hodnota", "hodnoty", "hodnot")).toBe("1 hodnota");
    expect(count(3, "hodnota", "hodnoty", "hodnot")).toBe("3 hodnoty");
    expect(count(12, "hodnota", "hodnoty", "hodnot")).toBe("12 hodnot");
  });
});

describe("czDate", () => {
  it("writes a date the Czech way", () => {
    expect(czDate("2024-02-14")).toBe("14. 2. 2024");
  });

  it("handles a missing date without printing an empty gap", () => {
    expect(czDate(null)).toBe("bez data");
  });
});

describe("czMonthYear", () => {
  it("puts the month first, so it cannot be read as a day", () => {
    // "24/02" reads to a Czech eye as the 24th of February.
    expect(czMonthYear("2024-02-14")).toBe("2/24");
    expect(czMonthYear("2025-11-01")).toBe("11/25");
  });
});
