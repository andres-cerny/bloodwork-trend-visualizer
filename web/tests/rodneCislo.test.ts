/**
 * The birth date is printed on every report already, inside the rodné číslo.
 * Decoding it is only worth doing if it is never wrong: a wrong birth date
 * beside a patient's name reads as a fact the app verified.
 */
import { describe, expect, it } from "vitest";
import { ageOn, parseRodneCislo } from "../src/lib/rodneCislo";

const date = (s: string) => parseRodneCislo(s)?.birthDate ?? null;

describe("parseRodneCislo", () => {
  it("reads the shipped demo patient", () => {
    // scripts/make_demo_data.py. Synthetic, but deliberately mod-11 valid so
    // the demo does not display its own transcription warning.
    expect(parseRodneCislo("800101/0006")).toEqual({
      birthDate: "1980-01-01",
      sex: "male",
      checksumOk: true,
    });
  });

  it("accepts the number with or without its slash", () => {
    expect(date("8001010006")).toBe("1980-01-01");
    expect(date("800101 / 0006")).toBe("1980-01-01");
  });

  it("reads a woman's number, where the month carries +50", () => {
    const r = parseRodneCislo("8551010007");
    expect(r?.birthDate).toBe("1985-01-01");
    expect(r?.sex).toBe("female");
  });

  it("knows the +20 and +70 series added in 2004", () => {
    // A registry office that exhausted a day's ordinary series uses these. A
    // reader that does not know them rejects valid numbers issued since.
    expect(parseRodneCislo("0621010000")?.birthDate).toBe("2006-01-01");
    expect(parseRodneCislo("0621010000")?.sex).toBe("male");
    expect(parseRodneCislo("0671010000")?.birthDate).toBe("2006-01-01");
    expect(parseRodneCislo("0671010000")?.sex).toBe("female");
  });

  it("puts a ten-digit number in the right century", () => {
    // The ten-digit form began in 1954, so 54-99 is the 1900s and 00-53 the
    // 2000s. There is no third case to guess at.
    expect(date("5401010000")).toBe("1954-01-01");
    expect(date("9901010000")).toBe("1999-01-01");
    expect(date("0101010000")).toBe("2001-01-01");
    expect(date("5301010000")).toBe("2053-01-01");
  });

  it("treats the nine-digit form as pre-1954, with no checksum to report", () => {
    const r = parseRodneCislo("480101123");
    expect(r?.birthDate).toBe("1948-01-01");
    expect(r?.checksumOk).toBeNull();
  });

  it("reports a valid mod-11 check", () => {
    expect(parseRodneCislo("8001010006")?.checksumOk).toBe(true);
    expect(parseRodneCislo("8001010011")?.checksumOk).toBe(false);
  });

  it("refuses a date that does not exist", () => {
    expect(parseRodneCislo("810231/0000")).toBeNull(); // 31 February
    expect(parseRodneCislo("810431/0000")).toBeNull(); // 31 April
    expect(parseRodneCislo("810100/0000")).toBeNull(); // day zero
    expect(parseRodneCislo("811301/0000")).toBeNull(); // month 13
    expect(parseRodneCislo("810001/0000")).toBeNull(); // month zero
  });

  it("gets February right in leap and common years", () => {
    expect(date("0002290000")).toBe("2000-02-29"); // 2000 is a leap year
    expect(date("9602290008")).toBe("1996-02-29");
    expect(parseRodneCislo("9902290000")).toBeNull(); // 1999 is not
    // 1900 is divisible by 100 but not 400 — not a leap year. Nine digits, so
    // it is unambiguously 1900.
    expect(parseRodneCislo("000229123")).toBeNull();
  });

  it("refuses anything that is not a rodné číslo", () => {
    for (const junk of ["", "   ", "abc", "12345678", "12345678901", "800101"]) {
      expect(parseRodneCislo(junk), junk).toBeNull();
    }
    expect(parseRodneCislo(null)).toBeNull();
    expect(parseRodneCislo(undefined)).toBeNull();
  });
});

describe("ageOn", () => {
  it("counts whole years completed", () => {
    expect(ageOn("1980-01-01", "2026-08-22")).toBe(46);
    expect(ageOn("1980-12-31", "2026-08-22")).toBe(45);
  });

  it("turns over on the birthday, not before it", () => {
    expect(ageOn("1980-06-15", "2026-06-14")).toBe(45);
    expect(ageOn("1980-06-15", "2026-06-15")).toBe(46);
  });

  it("returns null rather than a negative age", () => {
    expect(ageOn("2030-01-01", "2026-01-01")).toBeNull();
    expect(ageOn("nonsense", "2026-01-01")).toBeNull();
  });
});
