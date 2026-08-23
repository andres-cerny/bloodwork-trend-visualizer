/**
 * What the chat model is allowed to see.
 *
 * Every number here has already been through the deterministic layer, which
 * is the whole reason context is injected rather than fetched through tools:
 * the model has nothing left to compute. These tests pin that the context
 * carries the flags and dates it needs and nothing it should not.
 */
import { describe, expect, it } from "vitest";
import { buildChatContext } from "@bw/lab-core";
import {
  makeMeasurement,
  type LabReport,
  normalizeMeasurement,
  buildTrends,
} from "@bw/lab-core";

const m = (name: string, value: string, cid: string, unit = "mmol/l") =>
  normalizeMeasurement(
    makeMeasurement({
      rawAnalyteName: name,
      valueRaw: value,
      unitRaw: unit,
      refRangeRaw: "(4,11-5,60)",
      canonicalId: cid,
    }),
  );

const reports: LabReport[] = [
  {
    id: "r1", sourceFile: "a.pdf", reportDate: "2024-02-14", labName: "Lab",
    patientName: "Jan Ukázka", patientId: "800101/0011", pages: [],
    measurements: [m("S_Glukóza", "3,80", "glukoza"), m("S_CRP", "<1,0", "crp", "mg/l")],
  },
  {
    id: "r2", sourceFile: "b.pdf", reportDate: "2025-08-13", labName: "Lab",
    patientName: "Jan Ukázka", patientId: "800101/0011", pages: [],
    measurements: [m("S_Glukóza", "5,32", "glukoza")],
  },
];

const ctx = () => buildChatContext(reports, buildTrends(reports, (c) => c));

describe("buildChatContext", () => {
  it("states how many reports and on which dates", () => {
    const c = ctx();
    expect(c).toContain("Počet reportů: 2");
    expect(c).toContain("2024-02-14");
    expect(c).toContain("2025-08-13");
  });

  it("carries each value with its date and computed flag", () => {
    const c = ctx();
    expect(c).toContain("2024-02-14: 3,8 (low)");
    expect(c).toContain("2025-08-13: 5,32 (normal)");
  });

  it("includes the reference range so the model need not infer it", () => {
    expect(ctx()).toContain("4,11–5,6");
  });

  it("omits an analyte with no numeric points rather than sending an empty row", () => {
    // CRP is censored in the only report that has it.
    expect(ctx()).not.toContain("crp");
  });

  it("does not carry the patient's identity", () => {
    const c = ctx();
    expect(c).not.toContain("800101");
    expect(c).not.toContain("Ukázka");
  });
});
