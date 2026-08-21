/**
 * Axis ticks. A clinician reads the axis as a scale, so the labels have to be
 * numbers a person would write — deriving them from the data range gives
 * things like "0,056", which reads as a measurement.
 */
import { describe, expect, it } from "vitest";
import { niceTicks } from "../src/ui/Chart";
import { czNum } from "../src/lib/summary";

describe("niceTicks", () => {
  it("produces round values inside the range", () => {
    const ticks = niceTicks(0.056, 1.04);
    expect(ticks.every((t) => t >= 0.056 && t <= 1.04)).toBe(true);
    // Quarter steps are a legitimate "nice" choice for a range just under 1.
    expect(ticks.map(czNum)).toEqual(["0,25", "0,5", "0,75", "1"]);
  });

  it("scales to large values", () => {
    expect(niceTicks(120, 480).map(czNum)).toEqual(["200", "300", "400"]);
  });

  it("scales to very small values without float noise in the label", () => {
    for (const t of niceTicks(0.001, 0.009)) {
      expect(czNum(t)).not.toMatch(/\d{6,}/);
    }
  });

  it("survives a flat series where every value is identical", () => {
    expect(() => niceTicks(5, 5)).not.toThrow();
    expect(niceTicks(5, 5).length).toBeLessThan(20);
  });
});
