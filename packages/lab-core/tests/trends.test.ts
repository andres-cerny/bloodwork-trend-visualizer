/**
 * Trend assembly. The rules that matter are exclusions: an undated report and
 * an unmapped measurement must not silently contribute a point, because a
 * trend line implies a comparison that would not be justified.
 */
import { describe, expect, it } from "vitest";
import {
  buildTrends,
  latestTwo,
  numericPoints,
  suspectPoints,
  makeMeasurement,
  type LabReport,
  normalizeMeasurement,
} from "@bw/lab-core";

const m = (name: string, value: string, cid: string | null, unit = "mmol/l") =>
  normalizeMeasurement(
    makeMeasurement({
      rawAnalyteName: name,
      valueRaw: value,
      unitRaw: unit,
      refRangeRaw: "(4,11-5,60)",
      canonicalId: cid,
    }),
  );

const report = (id: string, date: string | null, ms: ReturnType<typeof m>[]): LabReport => ({
  id,
  sourceFile: `${id}.pdf`,
  reportDate: date,
  labName: null,
  patientName: null,
  patientId: null,
  pages: [],
  measurements: ms,
});

describe("buildTrends", () => {
  it("groups by canonical id and orders points oldest first", () => {
    const trends = buildTrends([
      report("b", "2025-01-01", [m("S_Glukóza", "5,32", "glukoza")]),
      report("a", "2024-01-01", [m("S_Glukóza", "5,10", "glukoza")]),
    ]);
    expect(trends.get("glukoza")!.points.map((p) => p.date)).toEqual(["2024-01-01", "2025-01-01"]);
  });

  it("excludes an undated report — there is nothing to plot it against", () => {
    const trends = buildTrends([report("a", null, [m("S_Glukóza", "5,10", "glukoza")])]);
    expect(trends.size).toBe(0);
  });

  it("excludes unmapped measurements rather than trending them alone", () => {
    const trends = buildTrends([
      report("a", "2024-01-01", [m("S_Glukóza", "5,10", "glukoza"), m("S_Neznámý", "1,0", null)]),
    ]);
    expect([...trends.keys()]).toEqual(["glukoza"]);
  });

  it("keeps a censored point in the series but not as a number", () => {
    const trends = buildTrends([
      report("a", "2024-01-01", [m("S_CRP", "<1,0", "crp", "mg/l")]),
      report("b", "2025-01-01", [m("S_CRP", "2,4", "crp", "mg/l")]),
    ]);
    const t = trends.get("crp")!;
    expect(t.points).toHaveLength(2);
    expect(numericPoints(t)).toHaveLength(1);
    expect(t.points[0].valueRaw).toBe("<1,0");
  });

  it("resolves the display name through the registry", () => {
    const trends = buildTrends(
      [report("a", "2024-01-01", [m("S_Glukóza", "5,10", "glukoza")])],
      (cid) => (cid === "glukoza" ? "Glukóza" : cid),
    );
    expect(trends.get("glukoza")!.displayName).toBe("Glukóza");
  });

  it("takes the unit from the first point that has one", () => {
    const trends = buildTrends([
      report("a", "2024-01-01", [m("S_Glukóza", "5,10", "glukoza", "")]),
      report("b", "2025-01-01", [m("S_Glukóza", "5,32", "glukoza", "mmol/l")]),
    ]);
    expect(trends.get("glukoza")!.unit).toBe("mmol/l");
  });
});

describe("latestTwo", () => {
  it("returns the two most recent numeric points as [older, newer]", () => {
    const trends = buildTrends([
      report("a", "2024-01-01", [m("S_Glukóza", "5,10", "glukoza")]),
      report("b", "2025-01-01", [m("S_Glukóza", "5,32", "glukoza")]),
      report("c", "2025-06-01", [m("S_Glukóza", "5,60", "glukoza")]),
    ]);
    const [older, newer] = latestTwo(trends.get("glukoza")!);
    expect(older!.value).toBe(5.32);
    expect(newer!.value).toBe(5.6);
  });

  it("skips over a censored point when finding the pair to compare", () => {
    const trends = buildTrends([
      report("a", "2024-01-01", [m("S_CRP", "1,5", "crp", "mg/l")]),
      report("b", "2025-01-01", [m("S_CRP", "2,4", "crp", "mg/l")]),
      report("c", "2025-06-01", [m("S_CRP", "<1,0", "crp", "mg/l")]),
    ]);
    const [older, newer] = latestTwo(trends.get("crp")!);
    expect([older!.value, newer!.value]).toEqual([1.5, 2.4]);
  });

  it("returns nulls for an empty series", () => {
    expect(latestTwo({ canonicalId: "x", displayName: "x", unit: "", points: [] })).toEqual([null, null]);
  });
});

describe("readings flagged as misread", () => {
  const withSuspect = () =>
    buildTrends(
      [
        report("a", "2024-01-01", [m("S_Glukóza", "5,10", "glukoza")]),
        report("b", "2024-08-01", [m("S_Glukóza", "44,5", "glukoza")]),
        report("c", "2025-01-01", [m("S_Glukóza", "5,32", "glukoza")]),
      ],
      (cid) => cid,
      (mm) => (mm.valueRaw === "44,5" ? "vypadá to na posunutou desetinnou čárku" : null),
    );

  it("keeps a flagged reading out of the plotted series", () => {
    // Drawing it would put a value the app has already identified as a typo
    // onto the screen a patient is shown, flattening the real series beneath.
    const t = withSuspect().get("glukoza")!;
    expect(numericPoints(t).map((p) => p.value)).toEqual([5.1, 5.32]);
  });

  it("does not discard it — it stays listed so it can be surfaced", () => {
    const t = withSuspect().get("glukoza")!;
    expect(t.points).toHaveLength(3);
    expect(suspectPoints(t).map((p) => p.valueRaw)).toEqual(["44,5"]);
  });

  it("keeps it out of the two-point comparison the summary uses", () => {
    const [older, newer] = latestTwo(withSuspect().get("glukoza")!);
    expect([older!.value, newer!.value]).toEqual([5.1, 5.32]);
  });

  it("draws every point when nothing is flagged", () => {
    const t = buildTrends(
      [
        report("a", "2024-01-01", [m("S_Glukóza", "5,10", "glukoza")]),
        report("b", "2025-01-01", [m("S_Glukóza", "5,32", "glukoza")]),
      ],
      (cid) => cid,
    ).get("glukoza")!;
    expect(numericPoints(t)).toHaveLength(2);
    expect(suspectPoints(t)).toHaveLength(0);
  });
});
