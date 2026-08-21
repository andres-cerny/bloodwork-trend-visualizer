/**
 * Correction validation. The app must keep accepting printed non-numeric
 * results verbatim — "negativní" and "stopy" are real values — so this cannot
 * just demand a number. What it must stop is a typo being stored as a blood
 * result.
 */
import { describe, expect, it } from "vitest";
import { checkCorrection } from "../src/lib/correction";

describe("checkCorrection", () => {
  it("accepts a Czech-formatted number", () => {
    expect(checkCorrection("5,32", "mmol/l").severity).toBe("ok");
    expect(checkCorrection("114", "g/l").severity).toBe("ok");
  });

  it("accepts a censored value", () => {
    expect(checkCorrection("<1,0", "mg/l").severity).toBe("ok");
    expect(checkCorrection("> 10", "mg/l").severity).toBe("ok");
  });

  it("accepts a printed qualitative result", () => {
    for (const v of ["negativní", "stopy", "neprovedeno", "Pozitivní"]) {
      expect(checkCorrection(v, "-").severity, v).toBe("ok");
    }
  });

  it("rejects free text that is neither — the 'abc' case", () => {
    const r = checkCorrection("abc", "µkat/l");
    expect(r.severity).toBe("reject");
    expect(r.message).toContain("není číslo");
  });

  it("rejects an empty value", () => {
    expect(checkCorrection("   ", "mmol/l").severity).toBe("reject");
  });

  it("warns on a negative rather than calling it unparseable", () => {
    // parseValue cannot represent negatives at all — its number pattern
    // allows a leading "+" but not "-", matching src/normalize.py. Without
    // handling it first, "-5" would be reported as if it were gibberish.
    const r = checkCorrection("-5", "µkat/l");
    expect(r.severity).toBe("warn");
    expect(r.message).toContain("nezobrazí se v grafu");
  });

  it("says plainly that a negative will not be plotted", () => {
    expect(checkCorrection("-2,4", "mmol/l").severity).toBe("warn");
  });

  it("still rejects a lone minus sign", () => {
    expect(checkCorrection("-", "mmol/l").severity).toBe("reject");
  });
});
