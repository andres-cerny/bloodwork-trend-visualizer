import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LabCodes, nameKeys, unitProps, type LabCodeTable } from "../src/labCodes";
import type { AnalyteDef } from "../src/models";

const table = JSON.parse(
  readFileSync(new URL("../codes/lab-codes.json", import.meta.url), "utf-8"),
) as LabCodeTable;
const registry = JSON.parse(
  readFileSync(new URL("../../../apps/portal/public/registry.json", import.meta.url), "utf-8"),
) as AnalyteDef[];
const curation = JSON.parse(
  readFileSync(new URL("../codes/curation.json", import.meta.url), "utf-8"),
) as { catalog: Record<string, { nclp: string[] }>; loinc: Record<string, string[]> };

const codes = new LabCodes(table);
const top = (name: string, unit?: string, material?: string) => codes.lookup(name, unit, material)[0]?.row.id;

describe("the table", () => {
  it("has unique codes, a known material and both languages on every row", () => {
    const ids = new Set<string>();
    for (const r of table.rows) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      expect(["s", "p", "b", "u", "du"]).toContain(r.mat);
      expect(r.names.cs.name.length).toBeGreaterThan(0);
      expect(r.names.en).toBeDefined();
    }
    expect(table.rows.length).toBeGreaterThan(3000);
    expect(table.rows.length).toBeLessThan(6000);
  });

  it("links only catalog ids that exist, to codes that exist", () => {
    const known = new Set(registry.map((a) => a.canonicalId));
    for (const [cid, link] of Object.entries(curation.catalog)) {
      expect(known.has(cid), cid).toBe(true);
      for (const code of link.nclp) expect(codes.byId(code), `${cid} → ${code}`).toBeDefined();
    }
    for (const r of table.rows) for (const c of r.catalog ?? []) expect(known.has(c), c).toBe(true);
  });

  it("writes LOINC codes in their check-digit form", () => {
    for (const r of table.rows) for (const l of r.loinc ?? []) expect(l).toMatch(/^\d{1,7}-\d$/);
  });
});

describe("lookup", () => {
  it("reads the LIS convention prefix_component", () => {
    expect(top("S_Na", "mmol/l")).toBe("02503");
    expect(top("P_Na", "mmol/l")).toBe("02500");
    expect(top("U_Na", "mmol/l")).toBe("02508");
  });

  it("tells a differential's fraction from its count by the unit", () => {
    expect(top("B_Neutrofily", "%")).toBe("03620");
    expect(top("B_Neutrofily", "10^9/l")).toBe("03616");
  });

  it("never offers urine for a blood name, nor blood for a urine one", () => {
    for (const h of codes.lookup("S_Na", "mmol/l")) expect(["s", "p", "b"]).toContain(h.row.mat);
    for (const h of codes.lookup("U_Na", "mmol/l")) expect(["u", "du"]).toContain(h.row.mat);
  });

  it("splits the forms labs glue together", () => {
    expect(nameKeys("NA (Sodium)")).toEqual(expect.arrayContaining(["na sodium", "na", "sodium"]));
    expect(nameKeys("ALP - alkalická fosfatasa")).toEqual(expect.arrayContaining(["alp", "alkalicka fosfatasa"]));
    expect(nameKeys("B_Střed.obj.erytr. [MCV]")).toContain("mcv");
  });

  it("resolves a method-specific DASTA key to its generic row", () => {
    expect(codes.byId("02504")?.id).toBe("02503");
  });
});

describe("shortlist", () => {
  it("is n long, specimen-safe, and holds the exact hit first", () => {
    const s = codes.shortlist("S_Na", "mmol/l", null, 20);
    expect(s).toHaveLength(20);
    expect(s[0].row.id).toBe("02503");
    for (const h of s) expect(["s", "p", "b"]).toContain(h.row.mat);
  });

  it("finds a misspelt name by its letters", () => {
    const ids = codes.shortlist("S_Kreatinín", "µmol/l", null, 20).map((h) => h.row.id);
    expect(ids).toContain(top("S_Kreatinin", "µmol/l"));
  });
});

describe("units", () => {
  it("reads giga-per-litre as a count, not grams", () => {
    expect(unitProps("G/l")).toEqual(["NCnc"]);
    expect(unitProps("g/l")).toEqual(["MCnc"]);
  });
});
