/**
 * Validating a hand-corrected value.
 *
 * The app deliberately accepts non-numeric results — "negativní", "stopy",
 * "neprovedeno" are real printed values and must survive verbatim — so this
 * cannot simply demand a number. What it can do is catch a typo that would
 * otherwise be stored as a blood result, and warn about a value that is
 * numerically impossible.
 */
import { parseValue } from "./normalize";

export type Severity = "ok" | "warn" | "reject";

export interface Check {
  severity: Severity;
  message: string | null;
}

/** Printed non-numeric results a Czech lab actually uses. */
const QUALITATIVE = [
  "negativní", "pozitivní", "stopy", "neprovedeno", "nevyšetřeno",
  "nehodnoceno", "hemolýza", "chylózní", "ikterické", "nedodáno",
];

const CENSORED = /^[<>]\s*\d/;

export function checkCorrection(valueRaw: string, unit: string): Check {
  const s = valueRaw.trim();
  if (!s) return { severity: "reject", message: "Hodnota nemůže být prázdná." };

  if (CENSORED.test(s.replace(/\s+/g, " "))) return { severity: "ok", message: null };

  const lower = s.toLowerCase();
  if (QUALITATIVE.some((q) => lower.includes(q))) return { severity: "ok", message: null };

  // Negatives are handled before parseValue, which cannot represent them:
  // its number pattern allows a leading "+" but not "-", matching
  // src/normalize.py. That is right for lab results, which are essentially
  // always positive — but it means a negative would otherwise be reported as
  // unparseable rather than as what it is.
  const negative = /^-\s*\d/.test(s);
  if (negative) {
    const magnitude = parseValue(s.replace(/^-\s*/, ""));
    if (magnitude !== null) {
      return {
        severity: "warn",
        message:
          "Záporná hodnota se uloží tak, jak ji zadáte, ale nezobrazí se v grafu " +
          "— trend počítáme jen z kladných výsledků. Zkontrolujte prosím znaménko.",
      };
    }
  }

  const n = parseValue(s);
  if (n === null) {
    return {
      severity: "reject",
      message:
        `„${s}“ není číslo ani známý slovní výsledek. Zadejte hodnotu tak, ` +
        `jak je vytištěná (např. 5,32 nebo <1,0), nebo slovní výsledek ` +
        `(např. negativní).`,
    };
  }

  return { severity: "ok", message: null };
}
