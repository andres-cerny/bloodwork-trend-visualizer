/**
 * Catalog splits (round 7 of docs/plans/model-loop.md) reach stored reports
 * without losing a reading or merging two measurements: a row moves from the
 * old entry to the split-out one only when its printed name now resolves
 * there, and a name the account filed itself stays where it was filed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Registry, buildTrends, makeMeasurement, normalizeMeasurement, rematchReport, type LabReport } from "@bw/lab-core";

const defs = JSON.parse(readFileSync(join(import.meta.dirname, "../../../apps/portal/public/registry.json"), "utf8"));
const row = (name: string, value: string, unit: string, canonicalId: string) => ({
  ...normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: "", sourceSnippet: "", confidence: "high", extractedBy: "t" })),
  canonicalId,
});
/** Two stored reports from before the split: every row under the entry it had then. */
const stored = (): LabReport[] =>
  ["2026-01-10", "2026-06-10"].map((date, i) => ({
    id: `r${i}`,
    sourceFile: `r${i}.pdf`,
    reportDate: date,
    labName: "Lab",
    patientName: null,
    patientId: null,
    pages: [],
    measurements: [
      row("LDL cholesterol (Friedewald)", "3,1", "mmol/l", "ldl"),
      row("S_LDL cholesterol", "3,0", "mmol/l", "ldl"),
      row("Granulocyty", "61", "%", "neutrofily"),
      row("B_Neutrofily", "58", "%", "neutrofily"),
      row("Gra granulocyty", "4,1", "10^9/l", "neutrofily_abs"),
      row("PTH 1-84", "3,2", "pmol/l", "parathormon"),
      row("S_PTH", "4,4", "pmol/l", "parathormon"),
      row("D-dimery (DDU)", "180", "µg/l DDU", "d_dimery"),
      row("P_D-dimery", "350", "µg/l", "d_dimery"),
      row("V_Ca ionizované - výpočet", "1,21", "mmol/l", "vapnik_ionizovany"),
      row("Anti-HAV celkové", "0,2", "arb.j.", "anti_hav_igg"),
      row("S_Glukóza", "5,1", "mmol/l", "glukoza"),
    ],
  })) as unknown as LabReport[];

const MOVED: Record<string, string> = {
  "LDL cholesterol (Friedewald)": "ldl_vypocet",
  Granulocyty: "granulocyty",
  "Gra granulocyty": "granulocyty_abs",
  "PTH 1-84": "parathormon_1_84",
  "D-dimery (DDU)": "d_dimery_ddu",
  "V_Ca ionizované - výpočet": "vapnik_ionizovany_vypocet",
  "Anti-HAV celkové": "anti_hav_celkove",
};

describe("catalog splits reach stored reports", () => {
  it("moves exactly the split names, to exactly their new entries", () => {
    const reg = new Registry(JSON.parse(JSON.stringify(defs)));
    for (const r of stored()) {
      const next = rematchReport(r, reg)!;
      for (const [i, m] of next.measurements.entries()) {
        expect(m.canonicalId, m.rawAnalyteName).toBe(MOVED[m.rawAnalyteName] ?? r.measurements[i].canonicalId);
      }
      // Idempotent: a second pass changes nothing.
      expect(rematchReport(next, reg)).toBeNull();
    }
  });

  it("loses no reading and merges no two measurements", () => {
    const reg = new Registry(JSON.parse(JSON.stringify(defs)));
    const before = buildTrends(stored());
    const after = buildTrends(stored().map((r) => rematchReport(r, reg) ?? r));
    const count = (t: Map<string, { points: unknown[] }>) => [...t.values()].reduce((n, x) => n + x.points.length, 0);
    expect(count(after)).toBe(count(before));
    // Every series after the split holds the readings of one printed meaning only.
    for (const t of after.values()) {
      const names = new Set(t.points.map((p) => p.rawName));
      for (const n of names) expect(MOVED[n] ?? stored()[0].measurements.find((m) => m.rawAnalyteName === n)!.canonicalId).toBe(t.canonicalId);
    }
  });

  it("a name the account filed under the old entry itself stays there", () => {
    const reg = new Registry(JSON.parse(JSON.stringify(defs)));
    reg.addSynonym("ldl", "LDL cholesterol (Friedewald)");
    const next = rematchReport(stored()[0], reg);
    expect(next?.measurements.find((m) => m.rawAnalyteName === "LDL cholesterol (Friedewald)")?.canonicalId).toBe("ldl");
  });

  it("the DDU names left the FEU entry, and so did their 1:1 conversion", () => {
    const reg = new Registry(JSON.parse(JSON.stringify(defs)));
    expect(reg.get("d_dimery")!.unitConversions["µg/l DDU"]).toBeUndefined();
    expect(reg.match("D-dimery (DDU)")).toBe("d_dimery_ddu");
    expect(reg.match("P_D-dimery")).toBe("d_dimery");
  });
});
