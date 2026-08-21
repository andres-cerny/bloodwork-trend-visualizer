/**
 * Mapping evidence. The ranking matters less than the evidence behind it: a
 * doctor accepts a mapping by judging whether the data already held under a
 * heading is the same measurement, so provenance and observed stats have to
 * be right even when the score is close.
 */
import { describe, expect, it } from "vitest";
import { findUnmapped, observedStats, suggestMappings } from "../src/lib/mapping";
import { makeMeasurement, type AnalyteDef, type LabReport } from "../src/lib/models";
import { normalizeMeasurement } from "../src/lib/normalize";
import { Registry } from "../src/lib/registry";

const m = (name: string, value: string, unit: string, ref: string, cid: string | null) =>
  normalizeMeasurement(
    makeMeasurement({
      rawAnalyteName: name,
      valueRaw: value,
      unitRaw: unit,
      refRangeRaw: ref,
      canonicalId: cid,
    }),
  );

const report = (id: string, date: string, ms: ReturnType<typeof m>[]): LabReport => ({
  id,
  sourceFile: `${id}.pdf`,
  reportDate: date,
  labName: "Lab",
  patientName: null,
  patientId: null,
  pages: [],
  measurements: ms,
});

const def = (id: string, name: string, unit: string, syn: string[] = []): AnalyteDef => ({
  canonicalId: id,
  displayNameCs: name,
  synonyms: syn,
  canonicalUnit: unit,
  unitConversions: {},
});

const REPORTS = [
  report("r1", "2024-02-14", [
    m("S_Glukóza", "5,10", "mmol/l", "(4,11-5,60)", "glukoza"),
    m("S_Homocystein tot.", "11,2", "µmol/l", "(5,0-15,0)", null),
  ]),
  report("r2", "2025-08-13", [
    m("S_Glukóza", "5,32", "mmol/l", "(4,11-5,60)", "glukoza"),
    m("S_Homocystein tot.", "14,0", "µmol/l", "(5,0-15,0)", null),
  ]),
];

describe("findUnmapped", () => {
  it("collects every occurrence with its document and value", () => {
    const [u] = findUnmapped(REPORTS);
    expect(u.rawName).toBe("S_Homocystein tot.");
    expect(u.occurrences).toHaveLength(2);
    expect(u.occurrences.map((o) => o.date)).toEqual(["2024-02-14", "2025-08-13"]);
    expect(u.occurrences.map((o) => o.valueRaw)).toEqual(["11,2", "14,0"]);
  });

  it("orders occurrences oldest first, so a trend reads left to right", () => {
    const [u] = findUnmapped([REPORTS[1], REPORTS[0]]);
    expect(u.occurrences.map((o) => o.date)).toEqual(["2024-02-14", "2025-08-13"]);
  });

  it("ignores analytes that are already mapped", () => {
    expect(findUnmapped(REPORTS).map((u) => u.rawName)).toEqual(["S_Homocystein tot."]);
  });
});

describe("observedStats", () => {
  it("summarises what is already held under a canonical id", () => {
    const o = observedStats(REPORTS).get("glukoza")!;
    expect(o.count).toBe(2);
    expect(o.unit).toBe("mmol/l");
    expect(o.min).toBe(5.1);
    expect(o.max).toBe(5.32);
    expect(o.firstDate).toBe("2024-02-14");
    expect(o.lastDate).toBe("2025-08-13");
  });

  it("does not count a censored value as a measurement", () => {
    const reports = [report("r1", "2024-01-01", [m("S_CRP", "<1,0", "mg/l", "(1,0-5,0)", "crp")])];
    const o = observedStats(reports).get("crp")!;
    expect(o.count).toBe(0);
    expect(o.mean).toBeNull();
  });
});

describe("suggestMappings", () => {
  const registry = new Registry([
    def("homocystein", "Homocystein", "µmol/l"),
    def("kyselina_mocova", "Kyselina močová", "µmol/l"),
    def("glukoza", "Glukóza", "mmol/l"),
  ]);
  const [unmapped] = findUnmapped(REPORTS);
  const stats = observedStats(REPORTS);

  it("ranks the right analyte first", () => {
    const [best] = suggestMappings(unmapped, registry, stats);
    expect(best.canonicalId).toBe("homocystein");
  });

  it("reports unit compatibility as evidence", () => {
    const [best] = suggestMappings(unmapped, registry, stats);
    expect(best.unitMatch).toBe(true);
  });

  it("penalises a candidate whose unit cannot match", () => {
    const cands = suggestMappings(unmapped, registry, stats);
    const glucose = cands.find((c) => c.canonicalId === "glukoza");
    // mmol/l vs µmol/l — if glucose survives at all it must be marked wrong.
    if (glucose) expect(glucose.unitMatch).toBe(false);
  });

  it("carries the candidate's existing data so the choice can be judged", () => {
    const withData = suggestMappings(
      findUnmapped(REPORTS)[0],
      new Registry([def("glukoza", "Glukóza", "mmol/l", ["Homocystein tot."])]),
      stats,
    );
    expect(withData[0].observed?.count).toBe(2);
    expect(withData[0].observed?.dates).toEqual(["2024-02-14", "2025-08-13"]);
  });

  it("returns nothing for a name that resembles no analyte", () => {
    const odd = { rawName: "Zzzz Qqqq", unitRaw: "", occurrences: [] };
    expect(suggestMappings(odd, registry, stats)).toEqual([]);
  });
});
