/**
 * Catching a *misread* value, as distinct from an abnormal one.
 *
 * Two different questions get confused easily, so this file answers only the
 * second:
 *
 *   1. "Is this patient's result abnormal?" — answered by the interval printed
 *      on their own report, in normalize.ts. Clinical, per-lab, per-patient.
 *      Nothing here touches it.
 *
 *   2. "Is this number even a possible measurement?" — a glucose of 53,2
 *      mmol/l is not a very sick patient, it is a decimal point read in the
 *      wrong place. That is an extraction defect, and it is what this file
 *      detects.
 *
 * Conflating them is dangerous in both directions: flagging a genuinely
 * extreme result as a "reading error" would hide a real emergency, so the
 * envelope here is deliberately far wider than any clinical range — it only
 * fires on values that no living patient produces.
 */
import type { Measurement } from "./models";
import { czNum } from "./summary";

export interface Implausible {
  /**
   * "impossible" — outside anything a living patient produces; almost
   * certainly a transcription error.
   * "suspect-decimal" — physiologically possible, but out of the reference
   * range *and* one decimal place away from sitting inside it. Worth a look,
   * not an accusation.
   */
  level: "impossible" | "suspect-decimal";
  reason: string;
  /** Set when the value looks like a decimal point in the wrong place. */
  decimalShift: { suggestion: string; factor: number } | null;
}

/**
 * How far outside the reference interval a value can sit before it is more
 * likely a transcription error than a measurement.
 *
 * Chosen to clear real extremes comfortably: ferritin in haemochromatosis
 * reaches ~40x the upper limit, ALT in acute hepatitis ~50x, CRP ~60x. At
 * 100x a value is not a patient any more.
 */
const IMPOSSIBLE_FACTOR = 100;

/**
 * Decimal slips, by how likely they are.
 *
 * A single misplaced decimal place is the common transcription error. A
 * two-place slip is much rarer, and treating it as evidence produces real
 * false alarms: ALT of 35 in acute hepatitis, CRP of 380 in sepsis and
 * ferritin of 9000 in haemochromatosis all divide by 100 back into their
 * reference intervals, and none of them is a typo.
 *
 * So a two-place shift is only ever offered as an explanation for a value
 * already established as impossible — never as the reason to doubt one.
 */
const SHIFTS_LIKELY = [10, 0.1];
const SHIFTS_RARE = [100, 0.01];

/**
 * Check one measurement against a reference interval.
 *
 * `range` should be the curated interval for the analyte when one exists
 * (consistent, and available before any history), otherwise the interval
 * printed on the report. Returns null when the value is possible, or when
 * there is nothing to check against — silence is correct where we do not know.
 */
export function checkImplausible(
  m: Pick<Measurement, "value" | "valueRaw">,
  range: { low: number; high: number } | null,
): Implausible | null {
  if (m.value === null || !range) return null;
  const { low, high } = range;
  if (!(high > 0)) return null;

  // Does moving the decimal one or two places land the value inside the
  // reference interval? That is the signature of the cardinal transcription
  // error, and it tells the reviewer exactly what to look for on the page.
  const fitShift = (factors: number[]) => {
    for (const factor of factors) {
      const shifted = (m.value as number) * factor;
      if (shifted >= low && shifted <= high) {
        return { factor, suggestion: String(Number(shifted.toPrecision(12))).replace(".", ",") };
      }
    }
    return null;
  };
  const likelyShift = fitShift(SHIFTS_LIKELY);

  const span = high - low || high;
  const ceiling = high + span * IMPOSSIBLE_FACTOR;
  const floor = Math.max(0, low - span * IMPOSSIBLE_FACTOR);
  const impossible = m.value > ceiling || m.value < floor;

  if (impossible) {
    // Already impossible, so a rarer explanation is still worth offering.
    const decimalShift = likelyShift ?? fitShift(SHIFTS_RARE);
    return {
      level: "impossible",
      decimalShift,
      reason: decimalShift
        ? `Hodnota ${m.valueRaw} je mimo fyziologicky možný rozsah. Vypadá to na ` +
          `posunutou desetinnou čárku — očekávali bychom ${decimalShift.suggestion}.`
        : `Hodnota ${m.valueRaw} je mimo fyziologicky možný rozsah pro tento parametr ` +
          `(typicky ${czNum(low)}–${czNum(high)}). Zkontrolujte ji prosím proti dokumentu.`,
    };
  }

  // Possible, but out of range and exactly one decimal place from being in it.
  //
  // A 10x slip does not always leave physiological territory — glucose read as
  // 44,5 instead of 4,45 is still a survivable number — so the impossibility
  // test alone misses the very error this is for. Worded as a question,
  // because a genuinely extreme result can trip it and the reader has the
  // source page right there to settle it.
  const outOfRange = m.value > high || m.value < low;
  if (outOfRange && likelyShift) {
    return {
      level: "suspect-decimal",
      decimalShift: likelyShift,
      reason:
        // "typicky" rather than "obvyklé meze": this interval is the curated
        // one used to spot a misread, not the interval printed on the report,
        // and showing two different-looking ranges on one screen without
        // distinguishing them is what makes a reader doubt both.
        `Hodnota ${m.valueRaw} je mimo typický rozsah pro tento parametr ` +
        `(${czNum(low)}–${czNum(high)}) a liší se přesně o jedno desetinné místo ` +
        `od ${likelyShift.suggestion}. Ověřte prosím proti dokumentu vedle.`,
    };
  }

  return null;
}
