/**
 * One parameter in two units. The defect this pins: a creatinine of 0,9 mg/dl
 * from a foreign lab plotted beside 80 µmol/l on one axis, under one label —
 * a 99 % drop that never happened.
 */
import { describe, expect, it } from "vitest";
import { buildTrends, inCanonicalUnit, latestTwo, unitFactor, type LabReport, type UnitDef } from "../src";

const KREATININ: UnitDef = { canonicalUnit: "µmol/l", unitConversions: { "mg/dl": 88.42 } };

const rep = (id: string, date: string, value: number, unit: string, low: number, high: number): LabReport =>
  ({
    id,
    reportDate: date,
    sourceFile: "x",
    labName: null,
    patientName: null,
    patientId: null,
    pages: [],
    measurements: [
      { canonicalId: "kreatinin", rawAnalyteName: "Kreatinin", value, valueRaw: String(value).replace(".", ","), unit, unitRaw: unit, refRangeLow: low, refRangeHigh: high, flag: "normal" },
    ],
  }) as unknown as LabReport;

describe("the factor to the canonical unit", () => {
  it("is 1 for the canonical unit in any case, the declared factor for a known one, null for the rest", () => {
    expect(unitFactor(KREATININ, "µmol/l")).toBe(1);
    expect(unitFactor(KREATININ, "mg/dL")).toBe(88.42);
    expect(unitFactor(KREATININ, "mmol/l")).toBeNull();
    // A cell with no unit: the lab printed it once in the column header.
    expect(unitFactor(KREATININ, "")).toBe(1);
  });

  it("converts the value and the range, and says from what", () => {
    const c = inCanonicalUnit({ value: 0.9, unit: "mg/dl", refRangeLow: 0.6, refRangeHigh: 1.2 }, KREATININ)!;
    expect(c.value).toBe(79.58);
    expect(c.refLow).toBe(53.05);
    expect(c.refHigh).toBe(106.1);
    expect(c.from).toEqual({ value: 0.9, unit: "mg/dl" });
  });
});

describe("a trend across two units", () => {
  it("puts every reading in the canonical unit, and the change is the real one", () => {
    const t = buildTrends([rep("a", "2026-01-10", 80, "µmol/l", 44, 104), rep("b", "2026-04-10", 0.9, "mg/dl", 0.6, 1.2)], undefined, undefined, undefined, () => KREATININ).get("kreatinin")!;
    expect(t.unit).toBe("µmol/l");
    expect(t.points.map((p) => p.value)).toEqual([80, 79.58]);
    const [a, b] = latestTwo(t);
    expect(Math.abs((b!.value! - a!.value!) / a!.value!)).toBeLessThan(0.01);
    // Every screen prints valueRaw as the value: it is the converted one, and the print is kept.
    expect(t.points[1].valueRaw).toBe("79,58");
    expect(t.points[1].convertedFrom).toEqual({ value: 0.9, unit: "mg/dl" });
  });

  it("leaves a reading in a unit nothing converts out of the series, and counts it", () => {
    const t = buildTrends([rep("a", "2026-01-10", 80, "µmol/l", 44, 104), rep("b", "2026-04-10", 0.08, "mmol/l", 0.05, 0.1)], undefined, undefined, undefined, () => KREATININ).get("kreatinin")!;
    expect(t.points).toHaveLength(1);
    expect(t.otherUnits).toEqual({ "mmol/l": 1 });
  });

  it("without a catalog entry keeps the unit most readings carry, never both on one axis", () => {
    const t = buildTrends([rep("a", "2026-01-10", 80, "µmol/l", 44, 104), rep("b", "2026-02-10", 82, "µmol/l", 44, 104), rep("c", "2026-04-10", 0.9, "mg/dl", 0.6, 1.2)]).get("kreatinin")!;
    expect(t.unit).toBe("µmol/l");
    expect(t.points.map((p) => p.value)).toEqual([80, 82]);
    expect(t.otherUnits).toEqual({ "mg/dl": 1 });
  });
});

describe("a newest result printed as a bound", () => {
  it("is flagged high when the bound is past the range, and is the trend's latest out-of-range result", async () => {
    const { normalizeMeasurement, makeMeasurement, latestCensoredOut } = await import("../src");
    const crp = (id: string, date: string, raw: string) =>
      ({
        id,
        reportDate: date,
        measurements: [{ ...normalizeMeasurement(makeMeasurement({ rawAnalyteName: "CRP", valueRaw: raw, unitRaw: "mg/l", refRangeRaw: "0 - 5" })), canonicalId: "crp" }],
      }) as unknown as LabReport;
    const t = buildTrends([crp("a", "2026-01-10", "3,1"), crp("b", "2026-04-10", ">200")]).get("crp")!;
    expect(t.points[1].flag).toBe("high");
    expect(latestCensoredOut(t)?.valueRaw).toBe(">200");
    // A "<" bound says nothing about low: a low CRP is a good result.
    const u = buildTrends([crp("a", "2026-01-10", "3,1"), crp("b", "2026-04-10", "<0,5")]).get("crp")!;
    expect(u.points[1].flag).toBe("unknown");
    expect(latestCensoredOut(u)).toBeNull();
  });
});
