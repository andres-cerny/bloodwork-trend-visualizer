/**
 * A value is never lost while its parameter waits for a catalog entry —
 * opt-in, docs/plans/model-loop.md "Mapping design". Default unchanged.
 */
import { describe, expect, it } from "vitest";
import { buildTrends, makeMeasurement, normalizeMeasurement, unrecognisedKey, type LabReport } from "@bw/lab-core";

const report = (id: string, date: string, lab: string | null, rows: Array<[string, string, string, string | null]>): LabReport =>
  ({
    id,
    reportDate: date,
    labName: lab,
    measurements: rows.map(([name, value, unit, cid]) => ({ ...normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: "", sourceSnippet: "", confidence: "high", extractedBy: "t" })), canonicalId: cid })),
  }) as unknown as LabReport;

const reports = [
  report("a", "2026-01-10", "BioLAB", [["S_Glukóza", "5,1", "mmol/l", "glukoza"], ["S_Cystatin C", "0,91", "mg/l", null]]),
  report("b", "2026-04-10", "BioLAB", [["S_Cystatin C", "0,97", "mg/l", null], ["S_Cystatin C", "88", "nmol/l", null]]),
  report("c", "2026-05-10", "Unilabs", [["S-Cystatin C", "0,95", "mg/l", null]]),
];

describe("unrecognised parameters", () => {
  it("default: left out of every trend, exactly as before", () => {
    const t = buildTrends(reports);
    expect([...t.keys()]).toEqual(["glukoza"]);
  });

  it("opted in: one series per lab + printed name + unit, marked unrecognised", () => {
    const t = buildTrends(reports, undefined, undefined, undefined, undefined, { unrecognised: true });
    const key = unrecognisedKey("BioLAB", "S_Cystatin C", "mg/l");
    expect(t.get(key)?.points.map((p) => p.valueRaw)).toEqual(["0,91", "0,97"]);
    expect(t.get(key)?.recognised).toBe(false);
    expect(t.get(key)?.displayName).toBe("S_Cystatin C");
    // Another unit, another lab: their own series — only a catalog entry may merge them.
    expect(t.has(unrecognisedKey("BioLAB", "S_Cystatin C", "nmol/l"))).toBe(true);
    expect(t.has(unrecognisedKey("Unilabs", "S-Cystatin C", "mg/l"))).toBe(true);
    expect(t.get("glukoza")?.recognised).toBeUndefined();
  });

  it("the key never looks like a catalog id", () => {
    expect(unrecognisedKey(null, "X", "")).toMatch(/^unrecognised:/);
  });
});
