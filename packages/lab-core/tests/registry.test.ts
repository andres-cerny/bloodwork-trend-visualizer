/**
 * The registry is mutable at runtime: accepting a mapping teaches it a
 * synonym, and undoing one has to take that back exactly. Getting the undo
 * wrong is worse than having no undo, because it leaves the app claiming a
 * mapping was withdrawn while the name still resolves.
 */
import { describe, expect, it } from "vitest";
import { type Box, Registry, type AnalyteDef, type TextRow } from "@bw/lab-core";

const def = (id: string, name: string, syn: string[] = []): AnalyteDef => ({
  canonicalId: id,
  displayNameCs: name,
  synonyms: syn,
  canonicalUnit: "mmol/l",
  unitConversions: {},
});

describe("normKey", () => {
  it("resolves a taught synonym through the same normalization as a printed name", () => {
    const r = new Registry([def("glukoza", "Glukóza")]);
    expect(r.match("S_Glukosa")).toBeNull();
    r.addSynonym("glukoza", "S_Glukosa");
    expect(r.match("S_Glukosa")).toBe("glukoza");
    // Material prefix and diacritics are stripped, so the variants agree.
    expect(r.match("Glukosa")).toBe("glukoza");
  });

  // Guard seen failing: with a generic hyphen rule, "anti-TPO" resolved to a
  // "TPO" analyte because "anti-" was stripped as a material (2026-09-06).
  it("strips slash and hyphen material codes but never a name's own prefix", () => {
    const r = new Registry([def("glukoza", "Glukóza"), def("tpo", "TPO")]);
    expect(r.match("S/Glukóza")).toBe("glukoza");
    expect(r.match("S-Glukóza")).toBe("glukoza");
    expect(r.match("S,P-Glukóza")).toBe("glukoza");
    expect(r.match("anti-TPO")).toBeNull();
  });
});

describe("a trailing [ABBR] is a second key", () => {
  // Guard seen failing 2026-09-12: BioLAB prints "B_Střed.obj.erytr. [MCV]"
  // where the seed knows "B_Střední objem ery [MCV]" and bare "MCV"; the full
  // key met nothing and the row stayed unmapped.
  it("finds the bare abbreviation when the long form is unknown", () => {
    const r = new Registry([def("mcv", "MCV", ["B_MCV", "MCV"])]);
    expect(r.match("B_Střed.obj.erytr. [MCV]")).toBe("mcv");
    expect(r.match("B-Tromb.křivka [PDW]")).toBeNull();
  });

  it("tries the full key first, so a bracket the catalog does not know loses nothing", () => {
    const r = new Registry([def("trombokrit", "Trombokrit", ["B_Trombokrit"]), def("x", "X", ["B_Trombocyty hematokrit [PCT]"])]);
    expect(r.match("B_Trombocyty hematokrit [PCT]")).toBe("x");
    // The seed synonym's own bracket taught the bare code to "x" — the
    // first claimant keeps it, a later entry does not silently take it over.
    expect(r.match("Trombocyty [PCT]")).toBe("x");
  });

  it("a bracket mid-name is not an abbreviation", () => {
    const r = new Registry([def("igg", "IgG", ["IgG"])]);
    expect(r.match("Anti-HSV [IgG] test")).toBeNull();
  });
});

describe("withdrawing a mapping", () => {
  it("stops the name resolving again", () => {
    const r = new Registry([def("glukoza", "Glukóza")]);
    r.addSynonym("glukoza", "S_Glukosa");
    expect(r.removeSynonym("glukoza", "S_Glukosa")).toBe(true);
    expect(r.match("S_Glukosa")).toBeNull();
    expect(r.get("glukoza")!.synonyms).not.toContain("S_Glukosa");
  });

  it("refuses to unlearn a name that came with the shipped table", () => {
    // Undo must not be able to delete curated knowledge. Dropping a shipped
    // synonym would silently change how every future report parses, and
    // nothing in the UI would say so.
    const r = new Registry([def("glukoza", "Glukóza", ["S_Glukosa"])]);
    expect(r.removeSynonym("glukoza", "S_Glukosa")).toBe(false);
    expect(r.match("S_Glukosa")).toBe("glukoza");
  });

  it("keeps the canonical name resolving after its synonym is withdrawn", () => {
    const r = new Registry([def("glukoza", "Glukóza")]);
    r.addSynonym("glukoza", "S_Glukosa");
    r.removeSynonym("glukoza", "S_Glukosa");
    expect(r.match("Glukóza")).toBe("glukoza");
    expect(r.match("S_Glukóza")).toBe("glukoza");
  });

  it("is a no-op for a name that was never taught", () => {
    const r = new Registry([def("glukoza", "Glukóza")]);
    expect(r.removeSynonym("glukoza", "Nikdy")).toBe(false);
    expect(r.removeSynonym("neznamy", "S_Glukosa")).toBe(false);
  });
});

// A urine Glukóza is not a serum Glukóza, whatever the names do. The mapping
// suggester knew that (mapping.ts, materialsCompatible); the automatic match
// did not, so on a prefix-free page the urine row auto-mapped to the serum
// glukoza and never reached the suggester. The registry now records each
// canonical's material — read off its prefixed synonyms, `S_Glukóza` → s —
// and refuses a row whose stated material contradicts it. Unknown on either
// side is compatible, so a page that says nothing maps exactly as before.
//
// Guard seen failing 2026-09-06: with the name-only match every assertion
// below that expects null returned "glukoza", and `material` was undefined.
describe("material", () => {
  const trow = (cells: string[]): TextRow => ({
    cells,
    cellBoxes: cells.map(() => [0, 0, 0, 0] as Box),
    box: [0, 0, 0, 0],
  });

  it("records the material a canonical's prefixed synonyms announce", () => {
    const r = new Registry([
      def("glukoza", "Glukóza", ["S_Glukóza", "Glukóza"]),
      def("hemoglobin", "Hemoglobin", ["B_Hemoglobin"]),
      def("egfr", "eGFR", ["xxx_eGF (CKD-EPI)"]),
      def("crp", "CRP"),
    ]);
    expect(r.get("glukoza")!.material).toBe("s");
    expect(r.get("hemoglobin")!.material).toBe("b");
    // An underscore prefix that is not a material code says nothing.
    expect(r.get("egfr")!.material).toBeNull();
    expect(r.get("crp")!.material).toBeNull();
  });

  it("refuses a canonical whose material the page contradicts", () => {
    const r = new Registry([def("glukoza", "Glukóza", ["S_Glukóza"])]);
    expect(r.match("Glukóza", "u")).toBeNull();
    expect(r.match("Glukóza", "s")).toBe("glukoza");
    // "S,P-" is serum or plasma, so it agrees with a serum canonical.
    expect(r.match("Glukóza", "s,p")).toBe("glukoza");
    expect(r.match("Glukóza")).toBe("glukoza");
    expect(r.match("Glukóza", null)).toBe("glukoza");
  });

  it("reads the name's own prefix as the closest evidence", () => {
    const r = new Registry([def("glukoza", "Glukóza", ["S_Glukóza"])]);
    expect(r.match("U_Glukóza")).toBeNull();
    // The prefix wins over what the page says about the row.
    expect(r.match("U_Glukóza", "s")).toBeNull();
    expect(r.match("S_Glukóza", "u")).toBe("glukoza");
    // An unknown code is not evidence of a material.
    expect(r.match("xxx_Glukóza")).toBe("glukoza");
  });

  it("is as permissive as before when either side is unknown", () => {
    const r = new Registry([def("glukoza", "Glukóza", ["Glukosa"])]);
    expect(r.match("Glukóza", "u")).toBe("glukoza");
    expect(r.match("U_Glukóza")).toBe("glukoza");
  });

  it("treats serum, plasma and whole blood as one compartment for the automatic match", () => {
    // Guard seen failing 2026-09-06: with plain materialsCompatible every lab
    // that prints P_Glukóza fell to the mapping tab.
    const r = new Registry([def("glukoza", "Glukóza", ["S_Glukóza"])]);
    expect(r.match("P_Glukóza")).toBe("glukoza");
    expect(r.match("B_Glukóza")).toBe("glukoza");
    expect(r.match("Glukóza", "p")).toBe("glukoza");
    expect(r.match("U_Glukóza")).toBeNull();
    expect(r.match("dU_Glukóza")).toBeNull();
  });

  it("learns a material from an accepted mapping, and forgets it with the undo", () => {
    // A urine analyte that a lab prints from serum is refused once; accepting
    // the mapping teaches the registry the code, so the next report needs no click.
    const r = new Registry([def("glukoza_u", "Glukóza v moči", ["U_Glukóza"])]);
    expect(r.match("S_Glukóza")).toBeNull();
    r.addSynonym("glukoza_u", "S_Glukóza");
    expect(r.get("glukoza_u")!.material).toBe("u,s");
    expect(r.match("S_Glukóza")).toBe("glukoza_u");
    r.removeSynonym("glukoza_u", "S_Glukóza");
    expect(r.get("glukoza_u")!.material).toBe("u");
    expect(r.match("S_Glukóza")).toBeNull();
  });

  it("keeps non_hdl's non_ — a canonical id is not a printed name", () => {
    // Guard seen failing 2026-09-06: normKey stripped "non_" as a material
    // prefix, so the bare "hdl" key pointed at whichever of the two was added last.
    const r = new Registry([
      def("hdl", "HDL cholesterol", ["S_HDL cholesterol"]),
      def("non_hdl", "Non-HDL cholesterol", ["S_Výpočet non-HDL"]),
    ]);
    expect(r.match("HDL cholesterol")).toBe("hdl");
    expect(r.match("hdl")).toBe("hdl");
    expect(r.match("S_Výpočet non-HDL")).toBe("non_hdl");
  });

  it("matchRow reads the row's Materiál column or the heading above it", () => {
    const r = new Registry([def("glukoza", "Glukóza", ["S_Glukóza"])]);
    const rows = [
      trow(["Sérum"]),
      trow(["Glukóza", "5,4", "mmol/l"]),
      trow(["Moč"]),
      trow(["Glukóza", "0,3", "mmol/l"]),
      trow(["Glukóza", "5,1", "mmol/l", "sérum"]),
    ];
    expect(r.matchRow("Glukóza", rows, 1)).toBe("glukoza");
    expect(r.matchRow("Glukóza", rows, 3)).toBeNull();
    // The column is closer than the heading.
    expect(r.matchRow("Glukóza", rows, 4)).toBe("glukoza");
  });

  it("still auto-maps a prefix-less page with no headings, as before", () => {
    const r = new Registry([def("glukoza", "Glukóza", ["S_Glukóza"]), def("kreatinin", "Kreatinin", ["S_Kreatinin"])]);
    const rows = [
      trow(["Název", "Výsledek", "Jednotka"]),
      trow(["Glukóza", "5,4", "mmol/l"]),
      trow(["Kreatinin", "84", "µmol/l"]),
    ];
    expect(r.matchRow("Glukóza", rows, 1)).toBe("glukoza");
    expect(r.matchRow("Kreatinin", rows, 2)).toBe("kreatinin");
    // No index (the model sent none), and no rows at all (a scan).
    expect(r.matchRow("Kreatinin", rows, undefined)).toBe("kreatinin");
    expect(r.matchRow("Kreatinin", [], 2)).toBe("kreatinin");
  });
});

describe("about", () => {
  // The "i" in Trendy and Souhrn reads `about` off the registry entry. The
  // Registry rewrites `material` on every entry it holds and must leave the
  // texts alone — and an entry without them is the ordinary case for a
  // founded parameter and for one the texts have not reached.
  it("passes an entry's about texts through untouched, and an entry without them is fine", () => {
    const about = { what: "Cukr v krvi.", usedFor: "Sleduje se při cukrovce." };
    const r = new Registry([{ ...def("glukoza", "Glukóza"), about }, def("urea", "Urea")]);
    expect(r.get("glukoza")?.about).toEqual(about);
    expect(r.get("urea")?.about).toBeUndefined();
    r.addSynonym("glukoza", "S_Glukosa");
    r.removeSynonym("glukoza", "S_Glukosa");
    expect(r.get("glukoza")?.about).toEqual(about);
  });
});
