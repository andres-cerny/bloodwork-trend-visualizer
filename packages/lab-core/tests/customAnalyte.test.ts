/**
 * Parameters the reader founded.
 *
 * Three of these pin failures that are quiet rather than loud, which is why
 * they are here and not left to the screen:
 *
 *   - a founded parameter added to the registry *after* the learned names are
 *     replayed swallows every one of them, because addSynonym is a no-op for
 *     an id the registry does not hold. The parameter then exists with an
 *     empty trend and nothing anywhere says why;
 *   - a name that collides with a known parameter gives one test two trend
 *     lines holding half the history each;
 *   - an interval read off the reader's own report must not be presented as a
 *     curated one. The mapping evidence line spells that difference out, and
 *     it is the only place the app claims a provenance at all.
 */
import { describe, expect, it } from "vitest";
import {
  Registry,
  customAnalyteId,
  defaultParameterName,
  findExistingParameter,
  findUnmapped,
  isCustomAnalyteId,
  makeMeasurement,
  normalizeMeasurement,
  observedStats,
  suggestMappings,
  toAnalyteDef,
  type AnalyteDef,
  type CustomAnalyte,
  type LabReport,
} from "@bw/lab-core";

const m = (name: string, value: string, unit: string, ref: string, cid: string | null = null) =>
  normalizeMeasurement(
    makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: ref, canonicalId: cid }),
  );

const report = (id: string, date: string | null, ms: ReturnType<typeof m>[]): LabReport => ({
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

const custom = (over: Partial<CustomAnalyte> = {}): CustomAnalyte => ({
  canonicalId: "custom_feritin",
  displayNameCs: "Feritin",
  canonicalUnit: "µg/l",
  referenceRange: [13, 150],
  ...over,
});

describe("the name offered for a printed one", () => {
  it("takes the material prefix off and leaves the case alone", () => {
    expect(defaultParameterName("S_Feritin")).toBe("Feritin");
    expect(defaultParameterName("dU_Kortizol")).toBe("Kortizol");
    expect(defaultParameterName("  S-Feritin ")).toBe("Feritin");
  });

  it("keeps a name whose prefix is part of the analyte", () => {
    // The allowlist in normalize.ts exists for exactly these: stripping a
    // generic `[a-z]{1,4}-` would turn anti-TPO into TPO.
    expect(defaultParameterName("anti-TPO")).toBe("anti-TPO");
    expect(defaultParameterName("C-peptid")).toBe("C-peptid");
  });
});

describe("the id a founded parameter gets", () => {
  const free = () => false;

  it("is prefixed, diacritic-free and recognisable as the reader's own", () => {
    expect(customAnalyteId("Feritin", free)).toBe("custom_feritin");
    expect(customAnalyteId("Kyselina močová", free)).toBe("custom_kyselina_mocova");
    expect(isCustomAnalyteId("custom_feritin")).toBe(true);
    expect(isCustomAnalyteId("glukoza")).toBe(false);
  });

  it("suffixes rather than overwrites when the id is taken", () => {
    const taken = new Set(["custom_feritin", "custom_feritin_2"]);
    expect(customAnalyteId("Feritin", (id) => taken.has(id))).toBe("custom_feritin_3");
  });

  it("still yields an id for a name that normalises to nothing", () => {
    expect(customAnalyteId("###", free)).toBe("custom_parametr");
  });
});

describe("the duplicate guard", () => {
  const defs = [def("glukoza", "Glukóza", "mmol/l", ["S_Glukóza"]), def("feritin", "Feritin", "µg/l")];

  it("catches a collision through case, diacritics and punctuation", () => {
    for (const name of ["Feritin", "feritin", "  FERITÍN  "]) {
      expect(findExistingParameter(defs, name)?.canonicalId).toBe("feritin");
    }
  });

  it("catches a collision with a synonym, not just the shown name", () => {
    expect(findExistingParameter(defs, "S_Glukóza")?.canonicalId).toBe("glukoza");
  });

  it("passes a genuinely new name, and a name that is no name", () => {
    expect(findExistingParameter(defs, "Homocystein")).toBeNull();
    expect(findExistingParameter(defs, "   ")).toBeNull();
  });
});

describe("a founded parameter in the registry", () => {
  it("matches its printed name, and learns the material from it", () => {
    const reg = new Registry([def("glukoza", "Glukóza", "mmol/l", ["S_Glukóza"])]);
    reg.addAnalyte(toAnalyteDef(custom()));
    reg.addSynonym("custom_feritin", "S_Feritin");

    expect(reg.match("S_Feritin")).toBe("custom_feritin");
    // The prefix taught it serum, so a urine row of the same name is refused
    // and stays a decision rather than joining the serum trend.
    expect(reg.get("custom_feritin")?.material).toBe("s");
    expect(reg.match("U_Feritin")).toBeNull();
    // Its own Czech name resolves too: a lab printing it bare needs no click.
    expect(reg.match("Feritin")).toBe("custom_feritin");
  });

  it("is deaf to its printed names if it is added after them", () => {
    // The ordering constraint Portal's load path has to respect. Not a
    // preference: addSynonym returns early for an unknown id, so a name
    // replayed before the parameter exists is simply gone.
    //
    // The printed name here is the English spelling, which is the case
    // founding a parameter is usually reached from and the one that shows the
    // bug: "S_Feritin" would mask it, since the material prefix comes off and
    // what is left is the parameter's own name, matched without any synonym.
    const wrong = new Registry([]);
    wrong.addSynonym("custom_feritin", "S_Ferritin");
    wrong.addAnalyte(toAnalyteDef(custom()));
    expect(wrong.match("S_Ferritin")).toBeNull();
    // And with no synonym it never learned the material either, so a urine
    // row of the same name would join the serum trend unchallenged.
    expect(wrong.get("custom_feritin")?.material).toBeNull();

    const right = new Registry([]);
    right.addAnalyte(toAnalyteDef(custom()));
    right.addSynonym("custom_feritin", "S_Ferritin");
    expect(right.match("S_Ferritin")).toBe("custom_feritin");
    expect(right.get("custom_feritin")?.material).toBe("s");
  });

  it("can be removed again, taking its keys and leaving the shipped ones", () => {
    const reg = new Registry([def("glukoza", "Glukóza", "mmol/l", ["S_Glukóza"])]);
    reg.addAnalyte(toAnalyteDef(custom()));
    reg.addSynonym("custom_feritin", "S_Feritin");

    expect(reg.removeAnalyte("custom_feritin")).toBe(true);
    expect(reg.get("custom_feritin")).toBeUndefined();
    expect(reg.match("S_Feritin")).toBeNull();
    expect(reg.match("Feritin")).toBeNull();
    expect(reg.match("S_Glukóza")).toBe("glukoza");
    expect(reg.removeAnalyte("custom_feritin")).toBe(false);
  });

  it("hands a shadowed key back rather than deleting it outright", () => {
    // Belt and braces: the screen refuses a colliding name, so nothing should
    // ever shadow a shipped key. A remove that corrupted the index when it
    // did would be a worse method than one that does not.
    const reg = new Registry([def("feritin", "Feritin", "µg/l")]);
    reg.addAnalyte(toAnalyteDef(custom()));
    expect(reg.match("Feritin")).toBe("custom_feritin");
    reg.removeAnalyte("custom_feritin");
    expect(reg.match("Feritin")).toBe("feritin");
  });

  it("declares no unit conversions, so nothing is silently rescaled", () => {
    expect(toAnalyteDef(custom()).unitConversions).toEqual({});
    expect(toAnalyteDef(custom()).synonyms).toEqual([]);
  });
});

describe("where a founded parameter's interval came from", () => {
  it("is reported as the documents, never as the curated table", () => {
    const d = toAnalyteDef(custom());
    expect(d.referenceRange).toEqual([13, 150]);
    expect(d.rangeFromDocument).toBe(true);

    const reg = new Registry([d]);
    reg.addSynonym("custom_feritin", "S_Feritin");
    const reports = [report("r1", "2026-03-04", [m("S_Feritin", "48", "µg/l", "13-150", "custom_feritin")])];
    const incoming = findUnmapped([
      report("r2", "2026-06-01", [m("Ferritin", "52", "µg/l", "13-150")]),
    ])[0];

    const cand = suggestMappings(incoming, reg, observedStats(reports)).find(
      (c) => c.canonicalId === "custom_feritin",
    );
    expect(cand?.rangeSource).toBe("documents");
  });

  it("stays curated for a shipped parameter", () => {
    const shipped: AnalyteDef = { ...def("feritin", "Feritin", "µg/l"), referenceRange: [13, 150] };
    const reg = new Registry([shipped]);
    const incoming = findUnmapped([
      report("r2", "2026-06-01", [m("Ferritin", "52", "µg/l", "13-150")]),
    ])[0];
    const cand = suggestMappings(incoming, reg, observedStats([])).find(
      (c) => c.canonicalId === "feritin",
    );
    expect(cand?.rangeSource).toBe("curated");
  });

  it("is absent when the parameter carries no interval at all", () => {
    expect(toAnalyteDef(custom({ referenceRange: null })).rangeFromDocument).toBe(false);
  });
});

describe("which document the offered interval was read from", () => {
  it("names the report, so the form can say where the interval came from", () => {
    const [a] = findUnmapped([
      report("r1", "2026-01-20", [m("S_Feritin", "48", "µg/l", "")]),
      report("r2", "2026-03-04", [m("S_Feritin", "52", "µg/l", "13-150")]),
    ]);
    expect(a.refRange).toEqual({ low: 13, high: 150 });
    expect(a.refRangeFrom).toEqual({ reportId: "r2", date: "2026-03-04" });
  });

  it("stays null when no lab printed one", () => {
    const [a] = findUnmapped([report("r1", "2026-01-20", [m("S_Feritin", "48", "µg/l", "")])]);
    expect(a.refRange).toBeNull();
    expect(a.refRangeFrom).toBeNull();
  });
});
