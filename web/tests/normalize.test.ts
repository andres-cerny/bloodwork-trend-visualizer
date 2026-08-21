/**
 * Parity tests for the TypeScript port of src/normalize.py.
 *
 * These are the same assertions tests/test_normalize.py makes, case for case —
 * that is the point. A misread decimal is the cardinal bug, and the port is
 * only trustworthy if it agrees with the Python on every tricky Czech case.
 */
import { describe, expect, it } from "vitest";
import { makeMeasurement } from "../src/lib/models";
import {
  canonicalizeUnit,
  computeFlag,
  normalizeMeasurement,
  parseCzechNumber,
  parseRange,
  parseValue,
} from "../src/lib/normalize";

describe("numbers", () => {
  it("decimal comma", () => {
    expect(parseCzechNumber("5,4")).toBe(5.4);
    expect(parseCzechNumber("0,443")).toBe(0.443);
    expect(parseCzechNumber("1,97")).toBe(1.97);
  });

  it("integer", () => {
    expect(parseCzechNumber("114")).toBe(114);
    expect(parseCzechNumber("140")).toBe(140);
  });

  it("thousands separator: plain space", () => {
    expect(parseCzechNumber("1 234,5")).toBe(1234.5);
    expect(parseCzechNumber("2131")).toBe(2131);
    expect(parseCzechNumber("1 187")).toBe(1187);
  });

  it("thousands separator: NBSP and narrow NBSP", () => {
    expect(parseCzechNumber("1 234,5")).toBe(1234.5);
    expect(parseCzechNumber("1 234,5")).toBe(1234.5);
  });

  it("dot thousands with comma decimal", () => {
    expect(parseCzechNumber("1.234,5")).toBe(1234.5);
  });

  it("non-numbers are null", () => {
    expect(parseCzechNumber("neprovedeno")).toBeNull();
    expect(parseCzechNumber("")).toBeNull();
    expect(parseCzechNumber(null)).toBeNull();
    expect(parseCzechNumber("negativní")).toBeNull();
  });
});

describe("values", () => {
  it("plain", () => {
    expect(parseValue("5,4")).toBe(5.4);
    expect(parseValue("114")).toBe(114);
  });

  it("censored is null — never invent a number for a trend", () => {
    expect(parseValue("<1,0")).toBeNull();
    expect(parseValue(">10")).toBeNull();
    expect(parseValue("< 0,1")).toBeNull();
  });

  it("qualitative is null", () => {
    expect(parseValue("neprovedeno")).toBeNull();
    expect(parseValue("negativní")).toBeNull();
  });

  it("strips the lab's out-of-range marker", () => {
    expect(parseValue("1,97 !")).toBe(1.97);
    expect(parseValue("114 !")).toBe(114);
    expect(parseValue("13,80 !")).toBe(13.8);
    expect(parseValue("29,30 *")).toBe(29.3);
  });
});

describe("units", () => {
  it("folds micro-sign variants", () => {
    expect(canonicalizeUnit("µmol/l")).toBe(canonicalizeUnit("μmol/l"));
    expect(canonicalizeUnit("µkat/l")).toBe("µkat/l");
  });

  it("normalizes litre case but keeps unit letters", () => {
    expect(canonicalizeUnit("mmol/L")).toBe("mmol/l");
    expect(canonicalizeUnit("mmol/l")).toBe("mmol/l");
    expect(canonicalizeUnit("U/l")).toBe("U/l");
  });

  it("folds the exponent glyph", () => {
    expect(canonicalizeUnit("10˄9/l")).toBe(canonicalizeUnit("10^9/l"));
  });

  it("dimensionless", () => {
    expect(canonicalizeUnit("-")).toBe("");
    expect(canonicalizeUnit("")).toBe("");
  });
});

describe("reference ranges", () => {
  it("inline, parenthesised", () => {
    expect(parseRange("(4,11-5,60)")).toEqual({ low: 4.11, high: 5.6, text: null });
    expect(parseRange("4,11-5,60")).toEqual({ low: 4.11, high: 5.6, text: null });
  });

  it("spaced column", () => {
    expect(parseRange("62,00 - 110")).toEqual({ low: 62, high: 110, text: null });
    expect(parseRange("137-145")).toEqual({ low: 137, high: 145, text: null });
  });

  it("open ended", () => {
    expect(parseRange("< 5,00")).toEqual({ low: null, high: 5, text: null });
    expect(parseRange("<2,85")).toEqual({ low: null, high: 2.85, text: null });
    expect(parseRange("> 0,5")).toEqual({ low: 0.5, high: null, text: null });
  });

  it("en dash", () => {
    expect(parseRange("0,400–0,500")).toEqual({ low: 0.4, high: 0.5, text: null });
  });

  it("non-numeric degrades to text", () => {
    expect(parseRange("negativní")).toEqual({ low: null, high: null, text: "negativní" });
  });
});

describe("flags", () => {
  it("normal / low / high", () => {
    expect(computeFlag(5.0, 4.11, 5.6)).toBe("normal");
    expect(computeFlag(1.97, 4.11, 5.6)).toBe("low");
    expect(computeFlag(6.0, 4.11, 5.6)).toBe("high");
  });

  it("open-ended ranges", () => {
    expect(computeFlag(3.0, null, 2.85)).toBe("high");
    expect(computeFlag(2.0, null, 2.85)).toBe("normal");
    expect(computeFlag(0.2, 0.5, null)).toBe("low");
  });

  it("unknown without a value or a range", () => {
    expect(computeFlag(null, 1.0, 2.0)).toBe("unknown");
    expect(computeFlag(5.0, null, null)).toBe("unknown");
  });
});

describe("normalizeMeasurement end-to-end", () => {
  it("a SPADIA glucose row", () => {
    const m = normalizeMeasurement(
      makeMeasurement({
        rawAnalyteName: "S_Glukóza",
        valueRaw: "1,97",
        unitRaw: "mmol/l",
        refRangeRaw: "(4,11-5,60)",
        sourcePage: 1,
      }),
    );
    expect(m.value).toBe(1.97);
    expect(m.unit).toBe("mmol/l");
    expect([m.refRangeLow, m.refRangeHigh]).toEqual([4.11, 5.6]);
    expect(m.flag).toBe("low");
  });

  it("censored CRP keeps no invented number and stays high-confidence", () => {
    const m = normalizeMeasurement(
      makeMeasurement({
        rawAnalyteName: "S_CRP",
        valueRaw: "<1,0",
        unitRaw: "mg/l",
        refRangeRaw: "(1,0-5,0)",
      }),
    );
    expect(m.value).toBeNull();
    expect(m.flag).toBe("unknown");
    expect(m.confidence).toBe("high"); // censored is expected, not a parse failure
  });

  it("a numeric-looking value that fails to parse is downgraded for review", () => {
    const m = normalizeMeasurement(
      makeMeasurement({ rawAnalyteName: "X", valueRaw: "5..4", unitRaw: "mmol/l", refRangeRaw: "" }),
    );
    expect(m.value).toBeNull();
    expect(m.confidence).toBe("low");
  });
});
