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
  materialsCompatible,
  observedStats,
  signalsOf,
  canApplyUnasked,
  rematchReport,
  scoreCandidate,
  suggestMappings,
  verdictOf,
  makeMeasurement,
  type AnalyteDef,
  type Box,
  type LabReport,
  type TextRow,
  normalizeMeasurement,
  Registry,
} from "@bw/lab-core";

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
    const odd = { rawName: "Zzzz Qqqq", unitRaw: "", occurrences: [], refRange: null, refRangeRaw: "", refRangeFrom: null, material: null, materialSource: null };
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

  // Guard seen failing: with a generic ^[a-z]{1,4}- rule, anti-TPO read as
  // material "anti" and C-peptid as "c" (2026-09-06).
  it("reads slash, hyphen and comma forms only for known material codes", () => {
    expect(materialPrefix("S/Sodík")).toBe("s");
    expect(materialPrefix("S-Na")).toBe("s");
    expect(materialPrefix("S,P-glukóza")).toBe("s,p");
    expect(materialPrefix("U-amyláza")).toBe("u");
    expect(materialPrefix("dU_Kreatinin")).toBe("du");
    expect(materialPrefix("anti-TPO")).toBeNull();
    expect(materialPrefix("C-peptid")).toBeNull();
    expect(materialPrefix("25-OH vitamin D")).toBeNull();
    // "ABBR - full name" is how labs print abbreviations; not a material.
    expect(materialPrefix("S - Na")).toBeNull();
  });

  // Guard seen failing: an exact-string comparison called S,P-glukóza a
  // different material from S_Glukóza (2026-09-06).
  it("s,p is compatible with serum and with plasma, not with urine", () => {
    expect(materialsCompatible("s,p", "s")).toBe(true);
    expect(materialsCompatible("p", "s,p")).toBe(true);
    expect(materialsCompatible("s,p", "u")).toBe(false);
    expect(materialsCompatible("s", "p")).toBe(false);

    const reports = [
      report("r1", "2024-01-01", [
        m("S_Glukóza", "5,10", "mmol/l", "(4,11-5,60)", "glukoza"),
        m("S,P-glukóza", "5,30", "mmol/l", "(4,11-5,60)", null),
      ]),
    ];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, new Registry([def("glukoza", "Glukóza", "mmol/l")]),
      observedStats(reports), 5).find((x) => x.canonicalId === "glukoza");
    expect(c?.materialMatch).toBe(true);
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

// ---------------------------------------------------------------------------
// Phase B2 — material read off the page when the name carries no prefix.
// ---------------------------------------------------------------------------

/** A row from cells alone; the material rules never look at geometry. */
const trow = (cells: string[], y = 0): TextRow => ({
  cells,
  cellBoxes: cells.map((c, i) => [50 + i * 100, y, 50 + i * 100 + c.length * 6, y + 10] as Box),
  box: [50, y, 700, y + 10],
});

/** A measurement that remembers which printed row it came from. */
const mAt = (name: string, value: string, unit: string, ref: string, cid: string | null, rowIndex: number) =>
  normalizeMeasurement(
    makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: ref, canonicalId: cid, rowIndex, sourcePage: 1 }),
  );

/** A one-page report that carries its reconstructed rows, as the upload path builds it. */
const pageReport = (id: string, rows: TextRow[], ms: ReturnType<typeof m>[]): LabReport => ({
  ...report(id, "2024-03-01", ms),
  pages: [{ pageNum: 1, imageUrl: "", imageWidth: 600, imageHeight: 800, rows }],
});

// The mixed_material.pdf shape: the same name twice, only the heading differs.
const MIXED_ROWS = [
  trow(["Sérum"]),
  trow(["Glukóza", "5,4", "mmol/l", "3,9 - 5,6"]),
  trow(["Kreatinin", "84", "µmol/l", "62 - 106"]),
  trow(["Moč"]),
  trow(["Glukóza", "0,3", "mmol/l", "0 - 0,8"]),
  trow(["Kreatinin", "9,8", "mmol/l", "3,5 - 25,0"]),
];

// Guard seen failing 2026-09-06: before findUnmapped read the page rows the
// urine Glukóza had material null, materialMatch null, and the glukoza
// candidate came back "recommended" with no material line at all.
describe("material from the heading a row sits under", () => {
  const glukoza = new Registry([def("glukoza", "Glukóza", "mmol/l", ["glukosa"])]);

  it("attributes an unprefixed name to the heading above its row", () => {
    const reports = [pageReport("r1", MIXED_ROWS, [
      mAt("Glukóza", "5,4", "mmol/l", "3,9 - 5,6", "glukoza", 1),
      mAt("Glukóza", "0,3", "mmol/l", "0 - 0,8", null, 4),
    ])];
    const [u] = findUnmapped(reports);
    expect(u.rawName).toBe("Glukóza");
    expect(u.material).toBe("u");
    expect(u.materialSource).toBe("heading");
  });

  it("lets a printed prefix win over the heading", () => {
    const rows = [trow(["Sérum"]), trow(["U_Bílkovina", "0,15", "g/l", "0 - 0,15"])];
    const [u] = findUnmapped([pageReport("r1", rows, [mAt("U_Bílkovina", "0,15", "g/l", "0 - 0,15", null, 1)])]);
    expect(u.material).toBe("u");
    expect(u.materialSource).toBe("prefix");
  });

  it("reads a Materiál column before the heading, and says so", () => {
    const rows = [
      trow(["Základná hematológia - Krvný obraz"]),
      trow(["Metabolity"]),
      trow(["Glukóza", "5,10", "3,90–5,60", "mmol/l", "sérum"]),
    ];
    const [u] = findUnmapped([pageReport("r1", rows, [mAt("Glukóza", "5,10", "mmol/l", "3,90–5,60", null, 2)])]);
    expect(u.material).toBe("s");
    expect(u.materialSource).toBe("column");
  });

  it("has no material when the report carries no rows (a scan, or the demo data)", () => {
    const [u] = findUnmapped([report("r1", "2024-03-01", [m("Glukóza", "0,3", "mmol/l", "0 - 0,8", null)])]);
    expect(u.material).toBeNull();
    expect(u.materialSource).toBeNull();
  });

  it("counts the heading material of a mapped row towards the candidate's materials", () => {
    const reports = [pageReport("r1", MIXED_ROWS, [
      mAt("Glukóza", "5,4", "mmol/l", "3,9 - 5,6", "glukoza", 1),
      mAt("Glukóza", "0,3", "mmol/l", "0 - 0,8", null, 4),
    ])];
    expect(observedStats(reports).get("glukoza")!.materials).toEqual(["s"]);
  });

  it("does not offer the serum glukoza silently for the urine Glukóza", () => {
    const reports = [pageReport("r1", MIXED_ROWS, [
      mAt("Glukóza", "5,4", "mmol/l", "3,9 - 5,6", "glukoza", 1),
      mAt("Glukóza", "0,3", "mmol/l", "0 - 0,8", null, 4),
    ])];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, glukoza, observedStats(reports), 5).find((x) => x.canonicalId === "glukoza")!;
    expect(c.materialMatch).toBe(false);
    expect(verdictOf(c)).toBe("contradicted");
    const sig = signalsOf(c, u).find((s) => s.key === "material")!;
    expect(sig.state).toBe("bad");
    // The reader must be able to tell this came from the heading, not the name.
    expect(sig.detail).toContain("moč (podle nadpisu)");
    expect(sig.detail).toContain("sérum");
  });

  it("agrees when the heading and the candidate's material match", () => {
    const rows = [trow(["Sérum"]), trow(["S_Glukóza", "5,4", "mmol/l", "3,9 - 5,6"]), trow(["Glukosa", "5,3", "mmol/l", "3,9 - 5,6"])];
    const reports = [pageReport("r1", rows, [
      mAt("S_Glukóza", "5,4", "mmol/l", "3,9 - 5,6", "glukoza", 1),
      mAt("Glukosa", "5,3", "mmol/l", "3,9 - 5,6", null, 2),
    ])];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, glukoza, observedStats(reports), 5)[0];
    expect(c.materialMatch).toBe(true);
    const sig = signalsOf(c, u).find((s) => s.key === "material")!;
    expect(sig.state).toBe("ok");
    expect(sig.detail).toContain("podle nadpisu");
  });

  it("words a column-derived material as coming from the column", () => {
    const rows = [trow(["Metabolity"]), trow(["Glukosa", "5,3", "3,90–5,60", "mmol/l", "moč"])];
    const reports = [pageReport("r1", rows, [mAt("Glukosa", "5,3", "mmol/l", "3,90–5,60", null, 1)])];
    const [u] = findUnmapped(reports);
    const c = suggestMappings(u, glukoza, observedStats(reports), 5)[0];
    const sig = signalsOf(c, u).find((s) => s.key === "material")!;
    expect(sig.state).toBe("unknown");
    expect(sig.detail).toContain("moč (podle sloupce)");
  });
});

describe("the unit a lab prints", () => {
  // Guard seen failing 2026-09-12: BioLAB prints Greek mu (μmol/l, U+03BC)
  // and every correct candidate was "contradicted" by "μmol/l vs µmol/l".
  it("Greek mu is the catalog's micro sign, not a different unit", () => {
    const reports = [report("r1", "2024-01-01", [m("S_Kreatinin (enzymat.)", "70", "\u03bcmol/l", "49,0 - 90,0", null)])];
    const [u] = findUnmapped(reports);
    const [c] = suggestMappings(u, new Registry([def("kreatinin", "Kreatinin", "\u00b5mol/l", ["S_Kreatinin"], [62, 110])]), observedStats(reports), 5);
    expect(c.unitMatch).toBe(true);
    expect(verdictOf(c)).toBe("recommended");
  });

  it("a printed dimensionless marker agrees with a dimensionless entry and contradicts g/l", () => {
    const reports = [report("r1", "2024-01-01", [m("V_Aterogenní index (CHOL/HDL)", "3,1", "1", "0,00 - 5,00", null)])];
    const [u] = findUnmapped(reports);
    const reg = new Registry([def("index_aterogenity", "Index aterogenity", "", ["Index aterogenity"]), def("albumin", "Albumin", "g/l", ["Aterogenní albumin"])]);
    const cands = suggestMappings(u, reg, observedStats(reports), 5);
    expect(cands.find((c) => c.canonicalId === "index_aterogenity")?.unitMatch).toBe(true);
    expect(cands.find((c) => c.canonicalId === "albumin")?.unitMatch).toBe(false);
  });
});

describe("rematchReport", () => {
  // Guard for docs/plans/lab-mapping.md Phase 3: a catalog that grew after
  // the upload has to reach the report, or a deployed synonym fixes nobody.
  it("fills only the null rows a grown catalog now knows, and says nothing when none changed", () => {
    const r = report("r1", "2024-01-01", [
      m("S_Na", "140", "mmol/l", "134 - 148", null),
      m("S_Foo", "1", "x", "", null),
      m("S_K", "4,2", "mmol/l", "3,5 - 5,1", "by_hand"),
    ]);
    const reg = new Registry([def("sodik", "Sodík", "mmol/l", ["S_Na"]), def("draslik", "Draslík", "mmol/l", ["S_K"])]);
    const next = rematchReport(r, reg)!;
    expect(next.measurements.map((x) => x.canonicalId)).toEqual(["sodik", null, "by_hand"]);
    expect(r.measurements[0].canonicalId, "the input is not mutated").toBeNull();
    expect(rematchReport(next, reg)).toBeNull();
  });

  it("still refuses a urine row the name alone would map", () => {
    const r = report("r1", "2024-01-01", [m("U_Glukóza", "0", "mmol/l", "", null)]);
    const reg = new Registry([def("glukoza", "Glukóza", "mmol/l", ["S_Glukóza"])]);
    expect(rematchReport(r, reg)).toBeNull();
  });
});

describe("a candidate the model named", () => {
  // Guard seen failing 2026-09-12 (portal audit): "S_Na" → sodik has bigram
  // similarity 0, so verdictOf called it contradicted and the mapping model's
  // headline case was never applied — and on screen it wore "nedoporučujeme"
  // for the one thing the model knows better than a bigram.
  it("is judged on unit, interval, material and magnitude — not on name similarity", () => {
    const reports = [report("r1", "2024-01-01", [m("S_Na", "140", "mmol/l", "134 - 148", null)])];
    const [u] = findUnmapped(reports);
    const sodik = def("sodik", "Sodík", "mmol/l", ["S_Sodík"], [137, 145]);
    const c = scoreCandidate(u, sodik, observedStats(reports))!;
    expect(c.nameWeak).toBe(true);
    expect(verdictOf(c)).toBe("contradicted");
    expect(verdictOf(c, { nameByModel: true })).toBe("recommended");
    expect(canApplyUnasked(c)).toBe(true);
    expect(signalsOf(c, u, { nameByModel: "Na je sodík." }).find((s) => s.key === "name")).toMatchObject({ state: "ok", detail: "podle AI Sodík — Na je sodík." });
  });

  it("is still refused when the unit disagrees, is unknown, or the interval contradicts", () => {
    const reports = [report("r1", "2024-01-01", [
      m("S_T4 celkový", "100", "nmol/l", "66,0 - 181,0", null),
      m("S_Foo", "1", "", "", null),
      m("S_Bar", "5", "µmol/l", "5 - 15", null),
    ])];
    const [t4, foo, bar] = findUnmapped(reports);
    const stats = observedStats(reports);
    const ft4 = scoreCandidate(t4, def("ft4", "T4 volný", "pmol/l", ["S_T4 volný"], [12, 22]), stats)!;
    expect(ft4.unitMatch).toBe(false);
    expect(canApplyUnasked(ft4)).toBe(false);
    const unknownUnit = scoreCandidate(foo, def("x", "X", "g/l"), stats)!;
    expect(unknownUnit.unitMatch).toBeNull();
    expect(canApplyUnasked(unknownUnit)).toBe(false);
    const uric = scoreCandidate(bar, def("kyselina_mocova", "Kyselina močová", "µmol/l", [], [202, 417]), stats)!;
    expect(uric.unitMatch).toBe(true);
    expect(uric.rangeMatch).toBe(false);
    expect(canApplyUnasked(uric)).toBe(false);
  });
});
