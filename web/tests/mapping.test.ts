/**
 * Mapping evidence. The ranking matters less than the evidence behind it: a
 * doctor accepts a mapping by judging whether the data already held under a
 * heading is the same measurement, so provenance and observed stats have to
 * be right even when the score is close.
 */
import { describe, expect, it } from "vitest";
import {
  findUnmapped,
  isImplausible,
  materialPrefix,
  observedStats,
  signalsOf,
  suggestMappings,
  verdictOf,
} from "../src/lib/mapping";
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

const def = (
  id: string,
  name: string,
  unit: string,
  syn: string[] = [],
  referenceRange?: [number, number],
): AnalyteDef => ({
  canonicalId: id,
  displayNameCs: name,
  synonyms: syn,
  canonicalUnit: unit,
  unitConversions: {},
  ...(referenceRange ? { referenceRange } : {}),
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

  it("keeps a contradicted candidate visible so the reason can be shown", () => {
    // Silently dropping it leaves the doctor with "no similar analyte found",
    // which is less useful than "this looks similar, and here is why it is
    // wrong".
    const withData = suggestMappings(
      findUnmapped(REPORTS)[0],
      new Registry([def("glukoza", "Glukóza", "mmol/l", ["Homocystein tot."])]),
      stats,
    );
    expect(withData.length).toBeGreaterThan(0);
    expect(withData[0].rangeMatch).toBe(false);
  });

  it("returns nothing for a name that resembles no analyte", () => {
    const odd = { rawName: "Zzzz Qqqq", unitRaw: "", occurrences: [], refRange: null };
    expect(suggestMappings(odd, registry, stats)).toEqual([]);
  });

  it("rejects a candidate whose recorded values are orders of magnitude away", () => {
    // The bug this pins: homocysteine reads 11-14 µmol/l, uric acid is
    // recorded at 331-392 µmol/l. The old additive slack widened the accepted
    // window to roughly -61..784, so this passed as plausible and the UI put a
    // green tick on merging two unrelated tests.
    const withUricAcid = [
      report("r1", "2024-02-14", [
        m("S_Kyselina močová", "331", "µmol/l", "(202-417)", "kyselina_mocova"),
        m("S_Homocystein tot.", "11,2", "µmol/l", "(5,0-15,0)", null),
      ]),
      report("r2", "2025-08-13", [
        m("S_Kyselina močová", "392", "µmol/l", "(202-417)", "kyselina_mocova"),
        m("S_Homocystein tot.", "14,0", "µmol/l", "(5,0-15,0)", null),
      ]),
    ];
    const [unmappedHcy] = findUnmapped(withUricAcid);
    const cands = suggestMappings(unmappedHcy, registry, observedStats(withUricAcid), 5);
    const uric = cands.find((c) => c.canonicalId === "kyselina_mocova");
    if (uric) {
      expect(uric.valueOk).toBe(false);
      // The UI needs both ranges to explain itself.
      expect(uric.incomingRange).toEqual([11.2, 14]);
    }
  });

  it("accepts values within the same order of magnitude", () => {
    // A spelling variant, which is what fuzzy matching is for. A genuine
    // different-root synonym like "Glykémie" shares almost no characters with
    // "Glukóza" and is handled by the registry's synonym list instead, where
    // it matches exactly and never reaches this ranking at all.
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Glukóza", "5,10", "mmol/l", "(4,11-5,60)", "glukoza"),
        m("Glukosa", "5,60", "mmol/l", "(4,11-5,60)", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("glukoza", "Glukóza", "mmol/l")]),
      observedStats(reports), 5).find((x) => x.canonicalId === "glukoza");
    expect(c?.valueOk).toBe(true);
  });

  it("flags a different material — urine is not serum", () => {
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Celková bílkovina", "72", "g/l", "(64-83)", "bilkovina"),
        m("U_Bílkovina", "0,15", "g/l", "(0-0,15)", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("bilkovina", "Celková bílkovina", "g/l")]),
      observedStats(reports), 5).find((x) => x.canonicalId === "bilkovina");
    expect(c?.materialMatch).toBe(false);
    // Urine protein 0–0,15 g/l against serum protein 64–83 g/l: the printed
    // intervals do not overlap, which is the clearest evidence available.
    expect(c?.rangeMatch).toBe(false);
  });

  it("does not flag material when both come from the same one", () => {
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Glukóza", "5,10", "mmol/l", "(4,11-5,60)", "glukoza"),
        m("S_Glukosa", "5,30", "mmol/l", "(4,11-5,60)", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("glukoza", "Glukóza", "mmol/l")]),
      observedStats(reports), 5).find((x) => x.canonicalId === "glukoza");
    expect(c?.materialMatch).toBe(true);
  });
});

describe("materialPrefix", () => {
  it("reads the material a Czech lab prints before the name", () => {
    expect(materialPrefix("S_Glukóza")).toBe("s");
    expect(materialPrefix("U_Bílkovina")).toBe("u");
    expect(materialPrefix("B_Hemoglobin")).toBe("b");
  });

  it("returns null when no material is printed", () => {
    expect(materialPrefix("Glukóza")).toBeNull();
    expect(materialPrefix("")).toBeNull();
  });
});

describe("name similarity is a necessary condition", () => {
  it("marks a same-unit, overlapping-range candidate with an unrelated name", () => {
    // Homocysteine 5–15 µmol/l vs total bilirubin 3–21 µmol/l: same unit,
    // ranges overlap. Without a name floor those two signals outvote the name
    // and bilirubin is offered as a clean suggestion for homocysteine.
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Bilirubin celkový", "12", "µmol/l", "(3-21)", "bilirubin_celkovy"),
        m("S_Homocystein tot.", "11,2", "µmol/l", "(5,0-15,0)", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const cands = suggestMappings(
      u,
      new Registry([def("bilirubin_celkovy", "Bilirubin celkový", "µmol/l")]),
      observedStats(reports),
      5,
    );
    const bili = cands.find((c) => c.canonicalId === "bilirubin_celkovy");
    if (bili) {
      expect(bili.nameWeak).toBe(true);
      expect(bili.unitMatch).toBe(true); // the signals that misled it
      expect(bili.rangeMatch).toBe(true);
    }
  });

  it("does not mark a genuine synonym as weak", () => {
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Glukóza", "5,10", "mmol/l", "(4,11-5,60)", "glukoza"),
        m("S_Glukosa", "5,30", "mmol/l", "(4,11-5,60)", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("glukoza", "Glukóza", "mmol/l")]),
      observedStats(reports), 5).find((x) => x.canonicalId === "glukoza");
    expect(c?.nameWeak).toBe(false);
  });
});

describe("the verdict a candidate is presented under", () => {
  /** The one place a wrong mapping gets made is the promoted recommendation. */
  const candidateFor = (reports: LabReport[], defs: AnalyteDef[], cid: string) => {
    const [u] = findUnmapped(reports);
    const cands = suggestMappings(u, new Registry(defs), observedStats(reports), 5);
    return { u, c: cands.find((x) => x.canonicalId === cid)! };
  };

  it("calls a candidate contradicted when the reference intervals disagree", () => {
    // This is the regression that mattered: rangeMatch carries the largest
    // weight in the scorer (-0.6) and was the one signal isImplausible did
    // not consult, so a candidate the algorithm had all but rejected could
    // still be promoted as the clean best match with no warning on it.
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Celková bílkovina", "72", "g/l", "(64-83)", "bilkovina"),
        m("U_Bílkovina", "0,15", "g/l", "(0-0,15)", null),
      ]),
    ];
    const { c } = candidateFor(reports, [def("bilkovina", "Celková bílkovina", "g/l")], "bilkovina");
    expect(c.rangeMatch).toBe(false);
    expect(isImplausible(c)).toBe(true);
    expect(verdictOf(c)).toBe("contradicted");
  });

  it("lets the reference interval alone contradict a candidate", () => {
    // The case the old test could not see: total and conjugated bilirubin
    // share a unit, a material and most of a name, and there is no history
    // under the candidate to compare magnitudes against. Every other signal
    // is agreeing or silent. Only the printed intervals — 3–21 against 0–5 —
    // say these are different tests, and before rangeMatch was consulted
    // this candidate was promoted as the clean best match.
    const reports = [
      report("r1", "2024-01-01", [m("S_Bilirubin celkový", "12", "µmol/l", "(3-21)", null)]),
    ];
    const { c } = candidateFor(
      reports,
      [def("bilirubin_konjugovany", "Bilirubin konjugovaný", "µmol/l", [], [0, 5])],
      "bilirubin_konjugovany",
    );
    expect(c.nameWeak, "the names are close enough to look right").toBe(false);
    expect(c.unitMatch, "the units agree").toBe(true);
    expect(c.valueOk, "no history to compare magnitudes against").toBeNull();
    expect(c.materialMatch, "no material recorded for the candidate").toBeNull();
    expect(c.rangeMatch, "the intervals are the only objection").toBe(false);

    expect(isImplausible(c)).toBe(true);
    expect(verdictOf(c)).toBe("contradicted");
  });

  it("recommends only when something actually corroborates", () => {
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Glukóza", "5,10", "mmol/l", "(4,11-5,60)", "glukoza"),
        m("S_Glukosa", "5,30", "mmol/l", "(4,11-5,60)", null),
      ]),
    ];
    const { c } = candidateFor(reports, [def("glukoza", "Glukóza", "mmol/l")], "glukoza");
    expect(verdictOf(c)).toBe("recommended");
  });

  it("separates 'nothing known' from 'checked and agrees'", () => {
    // No unit printed, no interval printed, no history under the candidate:
    // nothing contradicts it and nothing supports it either. Offering that
    // under the same word as a corroborated match is how a guess gets
    // accepted as a finding.
    const reports = [
      report("r1", "2024-01-01", [m("Glukosa", "5,30", "", "", null)]),
    ];
    const { c } = candidateFor(reports, [def("glukoza", "Glukóza", "")], "glukoza");
    expect(c.unitMatch).toBeNull();
    expect(c.rangeMatch).toBeNull();
    expect(c.valueOk).toBeNull();
    expect(verdictOf(c)).toBe("possible");
  });
});

describe("the evidence the screen renders", () => {
  it("always carries the reference interval, the strongest signal", () => {
    // It was computed, weighted and unit-tested, and never shown: the doctor
    // saw name, unit, material and magnitude but not the one comparison the
    // ranking leaned on hardest.
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Glukóza", "5,10", "mmol/l", "(4,11-5,60)", "glukoza"),
        m("S_Glukosa", "5,30", "mmol/l", "(4,11-5,60)", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("glukoza", "Glukóza", "mmol/l")]),
      observedStats(reports), 5)[0];
    const sig = signalsOf(c, u).find((s) => s.key === "range");
    expect(sig).toBeDefined();
    expect(sig!.state).toBe("ok");
    expect(sig!.detail).toContain("4,11–5,6");
  });

  it("names the material even when there is nothing to compare it against", () => {
    // A urine reading mapped onto a serum analyte is a different test. When
    // the candidate has no history yet the comparison is impossible — but
    // staying silent hid the fact that the reading came from urine at all.
    const reports = [report("r1", "2024-01-01", [m("U_Bílkovina", "0,15", "g/l", "(0-0,15)", null)])];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("bilkovina", "Celková bílkovina", "g/l")]),
      observedStats(reports), 5)[0];
    const sig = signalsOf(c, u).find((s) => s.key === "material");
    expect(sig, "no material line at all").toBeDefined();
    expect(sig!.state).toBe("unknown");
    expect(sig!.detail).toContain("moč");
  });

  it("says which side a mismatched unit came from", () => {
    const reports = [
      report("r1", "2024-01-01", [
        m("S_Celková bílkovina", "72", "g/l", "(64-83)", "bilkovina"),
        m("U_Bílkovina", "negativní", "-", "", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("bilkovina", "Celková bílkovina", "g/l")]),
      observedStats(reports), 5)[0];
    const sig = signalsOf(c, u).find((s) => s.key === "unit")!;
    expect(sig.state).toBe("bad");
    expect(sig.detail).toContain("g/l");
  });
});
