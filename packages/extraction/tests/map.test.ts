/**
 * The mapping fallback's answer, shaped: a made-up id is not a mapping, a
 * name that was not asked is dropped, and a name the model restated is
 * still the name it was asked about.
 */
import { describe, expect, it } from "vitest";
import { SYSTEM_MAP, mapPrompt, resolveAskedName, toSuggestions } from "../src/map";

const names = [
  { rawName: "S_Na", unit: "mmol/l", refRange: "134 - 148", material: "s" },
  { rawName: "S_T4 celkový", unit: "nmol/l", refRange: "66,0 - 181,0", material: "s" },
];
const catalog = [
  { id: "sodik", name: "Sodík", unit: "mmol/l" },
  { id: "ft4", name: "T4 volný (fT4)", unit: "pmol/l" },
];
const row = (over: Record<string, unknown>) => ({
  raw_name: "S_Na", decision: "catalog", canonical_id: "sodik", new_id: null, new_name_cs: null, new_unit: null, reason: "r", confidence: "high", ...over,
});

describe("resolveAskedName", () => {
  // Guard seen failing 2026-09-12: Haiku copied the whole evidence line
  // ("S_Cholesterol celk. | jednotka: mmol/l | …") as raw_name for a batch of
  // thirty, and every one of them was dropped as "not asked".
  it("takes the name back out of a restated line", () => {
    const asked = new Set(["S_Na", "S_T4 celkový"]);
    expect(resolveAskedName("S_Na", asked)).toBe("S_Na");
    expect(resolveAskedName('"S_Na"', asked)).toBe("S_Na");
    expect(resolveAskedName("S_Na | jednotka: mmol/l | rozmezí: 134 - 148 | materiál: s", asked)).toBe("S_Na");
    expect(resolveAskedName('"S_T4 celkový" — jednotka: nmol/l; rozmezí: 66,0 - 181,0', asked)).toBe("S_T4 celkový");
    expect(resolveAskedName("S_Foo", asked)).toBeNull();
    expect(resolveAskedName(42, asked)).toBeNull();
  });
});

describe("toSuggestions", () => {
  it("refuses an id the catalog does not hold, keeps a valid new proposal, drops the unasked", () => {
    const out = toSuggestions(
      {
        suggestions: [
          row({}),
          row({ raw_name: "S_T4 celkový", decision: "catalog", canonical_id: "tt4" }),
          row({ raw_name: "S_Never" }),
        ],
      },
      names,
      catalog,
    );
    expect(out.map((s) => [s.rawName, s.decision, s.canonicalId])).toEqual([
      ["S_Na", "catalog", "sodik"],
      ["S_T4 celkový", "unknown", null],
    ]);
  });

  it("a new proposal needs an id shaped like a catalog key and a name; an id already taken is not new", () => {
    const out = toSuggestions(
      {
        suggestions: [
          row({ raw_name: "S_T4 celkový", decision: "new", canonical_id: null, new_id: "t4_celkovy", new_name_cs: "T4 celkový", new_unit: "nmol/l" }),
          row({ raw_name: "S_Na", decision: "new", canonical_id: null, new_id: "sodik", new_name_cs: "Sodík" }),
        ],
      },
      names,
      catalog,
    );
    expect(out[0].proposed).toEqual({ id: "t4_celkovy", displayNameCs: "T4 celkový", unit: "nmol/l" });
    expect(out[1].decision).toBe("unknown");
  });

  it("answers each name once", () => {
    const out = toSuggestions({ suggestions: [row({}), row({ canonical_id: "ft4" })] }, names, catalog);
    expect(out).toHaveLength(1);
    expect(out[0].canonicalId).toBe("sodik");
  });
});

describe("mapPrompt", () => {
  it("shows names, units and intervals — the shape the model copies from", () => {
    const p = mapPrompt(names, catalog);
    expect(p).toContain('název: "S_Na" — jednotka: mmol/l; rozmezí: 134 - 148; materiál: s');
    expect(p).toContain("sodik | Sodík | mmol/l");
  });
});

describe("SYSTEM_MAP", () => {
  // The mapping runs on its own since 2026-09-19 (docs/plans/multi-user.md,
  // Goal 1) and "high" is what gets applied without a click, so the prompt
  // has to say what "high" costs and when to answer "unknown" instead. The
  // exact sentences, because a paraphrase that drops one of the three cases
  // is the regression this pins.
  it("tells the model what high means and the three cases that must be unknown", () => {
    expect(SYSTEM_MAP).toContain(
      'Když si nejsi jistý, odpověz "unknown", nebo použij confidence "low" či "medium". "high" znamená, že bys na to vsadil klinické rozhodnutí.',
    );
    expect(SYSTEM_MAP).toContain("Tři případy, kdy je odpověď vždy \"unknown\":");
    expect(SYSTEM_MAP).toContain("- název, který může být dvěma položkami katalogu;");
    expect(SYSTEM_MAP).toContain(
      "- jednotka, kterou nedokážeš sladit s jednotkou položky (mg/dl a mmol/l je JINÁ jednotka, ne totéž vyšetření; nepřepočítávej);",
    );
    expect(SYSTEM_MAP).toContain("- název, který vůbec nepoznáváš.");
  });

  it("stays Czech and asks for names, units and intervals only — never values", () => {
    expect(SYSTEM_MAP).toContain("Jsi klinický biochemik.");
    expect(SYSTEM_MAP).not.toMatch(/naměřen|\bhodnot[ay]\b/);
  });
});
