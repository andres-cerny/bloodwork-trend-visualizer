/**
 * Saved decisions scoped to (lab, printed name, unit), and the weak list
 * matches a second opinion is for. docs/plans/model-loop.md, round 4.
 */
import { describe, expect, it } from "vitest";
import { Registry, aliasKey, findWeakMatches, makeMeasurement, normalizeMeasurement, rematchReport, weakMatchReason, type LabReport } from "@bw/lab-core";

const def = (canonicalId: string, synonyms: string[], unit: string, conv: Record<string, number> = {}) =>
  ({ canonicalId, displayNameCs: synonyms[0], synonyms, canonicalUnit: unit, unitConversions: conv }) as any;
const registry = () =>
  new Registry([
    def("quick", ["Protrombinový test", "P_Protrombinový test"], "%"),
    def("pt_cas", ["Protrombinový čas"], "s"),
    def("hba1c", ["HbA1c", "B-HbA1c"], "mmol/mol"),
    def("glukoza", ["Glukóza", "S_Glukóza"], "mmol/l"),
    def("leukocyty", ["Leukocyty"], "10^9/l"),
    def("egfr", ["eGFR", "xxx_eGF (CKD-EPI)"], "ml/s/1,73 m2"),
  ]);
const report = (lab: string | null, rows: Array<[string, string, string, string | null]>): LabReport =>
  ({
    id: "r1",
    reportDate: "2026-03-01",
    labName: lab,
    measurements: rows.map(([n, v, u, cid]) => ({ ...normalizeMeasurement(makeMeasurement({ rawAnalyteName: n, valueRaw: v, unitRaw: u, refRangeRaw: "", sourceSnippet: "", confidence: "high", extractedBy: "t" })), canonicalId: cid })),
  }) as unknown as LabReport;

describe("scoped aliases", () => {
  it("win over the global list for their lab and unit only", () => {
    const reg = registry();
    reg.addScopedAlias({ lab: "Nemocnice Stod", unit: "s" }, "P_Protrombinový test", "pt_cas");
    expect(reg.match("P_Protrombinový test", null, { lab: "Nemocnice Stod", unit: "s" })).toBe("pt_cas");
    expect(reg.match("P_Protrombinový test", null, { lab: "Nemocnice Stod", unit: "%" })).toBe("quick");
    expect(reg.match("P_Protrombinový test", null, { lab: "Jiná laboratoř", unit: "s" })).toBe("quick");
    expect(reg.match("P_Protrombinový test")).toBe("quick");
  });

  it("can say 'no entry' for a scope", () => {
    const reg = registry();
    reg.addScopedAlias({ lab: "Stod", unit: "arb.j." }, "Glukóza", null);
    expect(reg.match("Glukóza", null, { lab: "Stod", unit: "arb.j." })).toBeNull();
    expect(reg.match("Glukóza", null, { lab: "Stod", unit: "mmol/l" })).toBe("glukoza");
  });

  it("is withdrawn cleanly, and refuses an id the catalog does not hold", () => {
    const reg = registry();
    reg.addScopedAlias({ lab: "L", unit: "s" }, "X", "nonexistent");
    expect(reg.scopedMatch("X", { lab: "L", unit: "s" })).toBeUndefined();
    reg.addScopedAlias({ lab: "L", unit: "s" }, "P_Protrombinový test", "pt_cas");
    expect(reg.removeScopedAlias({ lab: "L", unit: "s" }, "P_Protrombinový test")).toBe(true);
    expect(reg.match("P_Protrombinový test", null, { lab: "L", unit: "s" })).toBe("quick");
  });

  it("folds unit spellings and name keys like the rest of the registry", () => {
    expect(aliasKey("Stod ", "S_Glukóza", "mmol/l")).toBe(aliasKey("stod", "Glukóza", "mmol/L"));
  });

  it("reach reports already stored, mapped rows included", () => {
    const reg = registry();
    const r = report("Stod", [["P_Protrombinový test", "11,8", "s", "quick"], ["S_Glukóza", "5,1", "mmol/l", "glukoza"]]);
    reg.addScopedAlias({ lab: "Stod", unit: "s" }, "P_Protrombinový test", "pt_cas");
    const next = rematchReport(r, reg)!;
    expect(next.measurements.map((m) => m.canonicalId)).toEqual(["pt_cas", "glukoza"]);
  });
});

describe("weak list matches", () => {
  const reg = registry();
  it.each([
    ["P_Protrombinový test", "s", "quick", "unit"],
    ["B-HbA1c", "%", "hba1c", "unit"],
    ["Glukóza", "arb.j.", "glukoza", "unit"],
    ["Leukocyty", "G/l", "leukocyty", null], // giga per litre is 10^9/l
    ["Q_Glukóza", "mmol/l", "glukoza", "material"],
    ["S_Glukóza", "mmol/l", "glukoza", null],
    ["S_Glukóza", "", "glukoza", null],
    ["xxx_eGF (CKD-EPI)", "ml/s/1,73 m2", "egfr", null],
  ])("%s [%s] → %s: %s", (name, unit, id, why) => {
    expect(weakMatchReason(unit, name, reg.get(id)!)).toBe(why);
  });

  it("are found once per lab, name and unit, and not after a decision was saved", () => {
    const reg2 = registry();
    const rs = [
      report("Stod", [["P_Protrombinový test", "11,8", "s", "quick"], ["S_Glukóza", "5,1", "mmol/l", "glukoza"]]),
      report("Stod", [["P_Protrombinový test", "12,1", "s", "quick"]]),
    ];
    const w = findWeakMatches(rs, reg2);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ listId: "quick", lab: "Stod", why: "unit" });
    expect(w[0].analyte.occurrences).toHaveLength(2);
    reg2.addScopedAlias({ lab: "Stod", unit: "s" }, "P_Protrombinový test", "pt_cas");
    expect(findWeakMatches(rs, reg2)).toHaveLength(0);
  });
});
