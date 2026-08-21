/**
 * Detecting a misread value, not an abnormal one.
 *
 * The distinction is the whole point: a genuinely extreme result must pass
 * through untouched, because labelling a real emergency a "reading error"
 * would be far worse than missing a typo.
 */
import { describe, expect, it } from "vitest";
import { checkImplausible } from "../src/lib/implausible";

const GLUCOSE = { low: 3.9, high: 5.6 };
const ALT = { low: 0.17, high: 0.78 };
const CRP = { low: 0, high: 5 };
const FERRITIN = { low: 30, high: 400 };

const v = (value: number | null, valueRaw = String(value)) => ({ value, valueRaw });

describe("normal and abnormal values pass through", () => {
  it("says nothing about a normal result", () => {
    expect(checkImplausible(v(5.32), GLUCOSE)).toBeNull();
  });

  it("says nothing about a clinically abnormal result", () => {
    // Diabetic ketoacidosis: high, real, and must not be called a typo.
    // 28/10 = 2,8 falls below the interval, so no decimal story fits either.
    expect(checkImplausible(v(28), GLUCOSE)).toBeNull();
  });

  it("lets a genuine extreme through — acute hepatitis ALT", () => {
    expect(checkImplausible(v(35), ALT)).toBeNull();
  });

  it("lets severe sepsis CRP through", () => {
    expect(checkImplausible(v(380), CRP)).toBeNull();
  });

  it("lets haemochromatosis ferritin through", () => {
    expect(checkImplausible(v(9000), FERRITIN)).toBeNull();
  });
});

describe("misread values are caught", () => {
  it("catches a 10x slip that is still physiologically possible", () => {
    // 4,45 printed, transcribed as 44,5. Around 44 mmol/l is survivable in a
    // hyperosmolar state, so the impossibility test alone would miss exactly
    // the error this exists for.
    const r = checkImplausible(v(44.5, "44,5"), GLUCOSE);
    expect(r).not.toBeNull();
    expect(r!.level).toBe("suspect-decimal");
    expect(r!.decimalShift?.suggestion).toBe("4,45");
    expect(r!.reason).toContain("Ověřte");
  });

  it("phrases a possible-but-suspect value as a question, not an accusation", () => {
    const r = checkImplausible(v(44.5, "44,5"), GLUCOSE)!;
    expect(r.reason).not.toContain("nemožná");
    expect(r.reason).not.toContain("chyba");
  });

  it("catches a decimal point read one place out", () => {
    // 5,32 printed, transcribed as 53,2.
    const r = checkImplausible(v(532, "532"), GLUCOSE);
    expect(r).not.toBeNull();
    expect(r!.level).toBe("impossible");
    expect(r!.decimalShift?.suggestion).toBe("5,32");
    expect(r!.reason).toContain("desetinnou čárku");
  });

  it("catches a value that is impossible without a decimal explanation", () => {
    const r = checkImplausible(v(99999, "99999"), GLUCOSE);
    expect(r).not.toBeNull();
    expect(r!.decimalShift).toBeNull();
    expect(r!.level).toBe("impossible");
    expect(r!.reason).toContain("fyziologicky možný rozsah");
  });

  it("names the value it is complaining about", () => {
    expect(checkImplausible(v(532, "532"), GLUCOSE)!.reason).toContain("532");
  });
});

describe("stays silent when it cannot know", () => {
  it("says nothing without a value", () => {
    expect(checkImplausible(v(null, "<1,0"), CRP)).toBeNull();
  });

  it("says nothing without a reference interval", () => {
    expect(checkImplausible(v(53.2), null)).toBeNull();
  });

  it("says nothing for a degenerate interval", () => {
    expect(checkImplausible(v(53.2), { low: 0, high: 0 })).toBeNull();
  });
});
