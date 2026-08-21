/**
 * The registry is mutable at runtime: accepting a mapping teaches it a
 * synonym, and undoing one has to take that back exactly. Getting the undo
 * wrong is worse than having no undo, because it leaves the app claiming a
 * mapping was withdrawn while the name still resolves.
 */
import { describe, expect, it } from "vitest";
import { Registry } from "../src/lib/registry";
import type { AnalyteDef } from "../src/lib/models";

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
