/**
 * The mapping decisions as the person sees them (lib/decisions.ts): which
 * unrecognised series Trendy may draw — apart from the recognised ones, never
 * among them — which decisions the names screen lists and as whose, and the
 * NČLP name without its system part.
 */
import { describe, expect, it } from "vitest";
import { type LabReport, buildTrends, makeMeasurement, normalizeMeasurement } from "@bw/lab-core";
import type { SavedAlias } from "../src/lib/api";
import { aliasApplies, autoEntriesInUse, byLab, friendlyNclpName, nameDecisions, rowsUnder, specimenCs, unrecognisedOnly, withAlias, withoutAlias } from "../src/lib/decisions";

const m = (name: string, value: string, unit: string, cid: string | null) =>
  normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: "", canonicalId: cid }));

const report = (id: string, lab: string | null, date: string, ms: ReturnType<typeof m>[]): LabReport => ({
  id,
  sourceFile: `${id}.pdf`,
  reportDate: date,
  labName: lab,
  patientName: null,
  patientId: null,
  pages: [],
  measurements: ms,
});

const alias = (a: Partial<SavedAlias> & Pick<SavedAlias, "rawName">): SavedAlias => ({ lab: "", unit: "", canonicalId: null, source: "person", model: null, code: null, mine: false, ...a });

describe("friendlyNclpName", () => {
  it("drops the code table's system part", () => {
    expect(friendlyNclpName("Apolipoprotein AII (S; hmot. konc. [g/l])")).toBe("Apolipoprotein AII");
    expect(friendlyNclpName("eGFR (CKD-EPI cystatin C) (Pt(ledviny); objemový tok [ml/s/1,73 m2] Výpočet)")).toBe("eGFR (CKD-EPI cystatin C)");
  });
  it("keeps a bracket that is part of the name, and a name that is nothing but brackets", () => {
    expect(friendlyNclpName("Leptin (S)")).toBe("Leptin (S)");
    expect(friendlyNclpName("(S; hmot. konc.)")).toBe("(S; hmot. konc.)");
    expect(friendlyNclpName("Estron")).toBe("Estron");
  });
});

describe("specimenCs", () => {
  it("says the NČLP specimen in Czech, and nothing for one it does not know", () => {
    expect(specimenCs("s")).toBe("sérum");
    expect(specimenCs("b")).toBe("krev");
    expect(specimenCs("")).toBeNull();
  });
});

describe("unrecognisedOnly", () => {
  const reports = [
    report("a", "Lab A", "2026-01-01", [m("S_Glukóza", "5,1", "mmol/l", "glukoza"), m("S_Cystatin X", "0,9", "mg/l", null), m("U_Barva", "žlutá", "", null)]),
    report("b", "Lab A", "2026-02-01", [m("S_Glukóza", "5,4", "mmol/l", "glukoza"), m("S_Cystatin X", "1,1", "mg/l", null)]),
    report("c", "Lab B", "2026-03-01", [m("S_Cystatin X", "1,0", "mg/l", null)]),
  ];
  const all = buildTrends(reports, (cid) => cid, () => null, () => null, () => null, { unrecognised: true });

  it("keeps only the unrecognised series, one per lab, and never a recognised one", () => {
    const out = unrecognisedOnly(all, () => true);
    expect([...out.values()].every((t) => t.recognised === false)).toBe(true);
    expect(out.has("glukoza")).toBe(false);
    // Lab A's two readings are one series; Lab B's reading is another.
    const cyst = [...out.values()].filter((t) => t.displayName === "S_Cystatin X");
    expect(cyst.map((t) => t.points.length).sort()).toEqual([1, 2]);
  });

  it("drops a series without a number, and one whose name the caller does not keep", () => {
    expect([...unrecognisedOnly(all, () => true).values()].some((t) => t.displayName === "U_Barva")).toBe(false);
    expect(unrecognisedOnly(all, (n) => n !== "S_Cystatin X").size).toBe(0);
  });
});

describe("rowsUnder and autoEntriesInUse", () => {
  const reports = [
    report("a", "Lab A", "2026-01-01", [m("S_Apo AII", "0,3", "g/l", "nclp_00754")]),
    report("b", "Lab A", "2026-02-01", [m("S_Apo AII", "0,4", "g/l", "nclp_00754")]),
    report("c", "Lab B", "2026-03-01", [m("Apolipoprotein A2", "0,35", "g/l", "nclp_00754")]),
  ];
  it("lists each (lab, name, unit) once", () => {
    expect(rowsUnder(reports, "nclp_00754")).toEqual([
      { rawName: "S_Apo AII", lab: "Lab A", unit: "g/l" },
      { rawName: "Apolipoprotein A2", lab: "Lab B", unit: "g/l" },
    ]);
  });
  it("keeps the auto entries this account's readings are filed under", () => {
    const e = (code: string) => ({ code, nameCs: "x", unit: "", material: "s", rawName: "x", model: null, at: "2026-10-21T00:00:00Z", mine: false });
    expect(autoEntriesInUse([e("00754"), e("01721")], reports).map((x) => x.entry.code)).toEqual(["00754"]);
  });
});

describe("aliasApplies", () => {
  const reports = [report("a", "Lab A", "2026-01-01", [m("S_Na", "140", "mmol/l", "sodik")])];
  it("matches lab and unit the way the registry folds them, and treats '' as any", () => {
    expect(aliasApplies(alias({ rawName: "S_Na", lab: "lab  a", unit: "mmol/L" }), reports)).toBe(true);
    expect(aliasApplies(alias({ rawName: "S_Na" }), reports)).toBe(true);
    expect(aliasApplies(alias({ rawName: "S_Na", lab: "Lab B" }), reports)).toBe(false);
    expect(aliasApplies(alias({ rawName: "S_Na", unit: "g/l" }), reports)).toBe(false);
  });
});

describe("nameDecisions", () => {
  const reports = [
    report("a", "Lab A", "2026-01-01", [m("S_Na", "140", "mmol/l", "sodik"), m("S_Kreat", "80", "µmol/l", "kreatinin"), m("S_Moje", "3", "", "custom_moje"), m("Gluk", "5", "mmol/l", "glukoza"), m("B_Leuko", "6", "10^9/l", "leukocyty")]),
  ];
  const out = nameDecisions({
    reports,
    aliases: [
      alias({ rawName: "S_Na", lab: "Lab A", unit: "mmol/l", canonicalId: "sodik", source: "model", model: "claude-haiku-5-5", mine: false }),
      alias({ rawName: "S_X", lab: "Lab Z", canonicalId: "draslik", mine: false }),
      alias({ rawName: "B_Leuko", lab: "Lab A", canonicalId: "leukocyty", mine: false }),
      alias({ rawName: "S_Mine", lab: "Lab Q", canonicalId: null, mine: true }),
    ],
    learned: { kreatinin: ["S_Kreat"], custom_moje: ["S_Moje"], glukoza: ["Gluk"], sodik: ["S_Na"] },
    aiAsked: { Gluk: { decision: "catalog", canonicalId: "glukoza", confidence: "high", reason: "", model: "m", at: "2026-10-01", applied: true } },
    isCustom: (cid) => cid.startsWith("custom_"),
  });
  const by = (n: string) => out.find((d) => d.rawName === n);

  it("lists a shared decision that names a reading, as automatic when the model made it", () => {
    expect(by("S_Na")).toMatchObject({ who: "auto", where: "alias", canonicalId: "sodik" });
  });
  it("shows another account's decision as automatic, not overrulable", () => {
    expect(by("B_Leuko")).toMatchObject({ who: "auto", overrulable: false });
    expect(by("S_Na")).toMatchObject({ overrulable: true });
  });
  it("leaves out someone else's decision that names nothing here, keeps one's own regardless", () => {
    expect(by("S_X")).toBeUndefined();
    expect(by("S_Mine")).toMatchObject({ who: "you", mine: true, canonicalId: null });
  });
  it("adds the account's own filings, the model's as automatic, never twice, never a founded parameter's", () => {
    expect(by("S_Kreat")).toMatchObject({ who: "you", where: "learned", lab: "Lab A", unit: "µmol/l" });
    expect(by("Gluk")).toMatchObject({ who: "auto", where: "ai" });
    expect(by("S_Moje")).toBeUndefined();
    expect(out.filter((d) => d.rawName === "S_Na")).toHaveLength(1);
  });
  it("groups by laboratory, a lab-less group last", () => {
    expect(byLab([{ lab: "" }, { lab: "B" }, { lab: "A" }]).map((g) => g.lab)).toEqual(["A", "B", ""]);
  });
});

describe("withAlias / withoutAlias", () => {
  it("keeps one decision per (lab, name, unit), and withdraws only one's own", () => {
    const a = alias({ rawName: "S_Na", lab: "Lab A", unit: "mmol/l", canonicalId: "sodik", source: "model", mine: false });
    const b = alias({ rawName: "S_Na", lab: "lab a", unit: "mmol/L", canonicalId: null, source: "person", mine: true });
    const both = withAlias([a], b);
    expect(both).toEqual([b]);
    expect(withoutAlias(both, { rawName: "S_Na", lab: "Lab A", unit: "mmol/l" })).toEqual([]);
    expect(withoutAlias([a], { rawName: "S_Na", lab: "Lab A", unit: "mmol/l" })).toEqual([a]);
  });
});
