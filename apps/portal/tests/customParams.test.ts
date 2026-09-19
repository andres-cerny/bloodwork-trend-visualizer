/**
 * Founding a parameter, as the account stores it and as the screen offers it.
 *
 * The two settings fields move together — the parameter and the printed name
 * filed under it — and PUT /api/settings replaces the whole blob, so a
 * half-written pair is a real shape the next load would have to cope with:
 * a parameter with an empty trend, or a synonym for an id the registry does
 * not hold. These pin that neither is reachable, and that deleting a
 * parameter puts its names back where they came from.
 *
 * The rendered assertions are the strings and classes the layout rules key
 * on, in the manner of summaryTab.test.ts: the auditor reads boxes and has
 * never cared what a sentence says.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Registry,
  buildTrends,
  makeMeasurement,
  normalizeMeasurement,
  toAnalyteDef,
  type AnalyteDef,
  type CustomAnalyte,
  type LabReport,
} from "@bw/lab-core";
import { namesUnder, withNewParameter, withoutParameter, type ParamSettings } from "../src/lib/customParams";
import { mergeSettings } from "../src/lib/settings";
import MappingTab from "../src/ui/MappingTab";

const feritin: CustomAnalyte = {
  canonicalId: "custom_feritin",
  displayNameCs: "Feritin",
  canonicalUnit: "µg/l",
  referenceRange: [13, 150],
};

const empty: ParamSettings = { learned: {}, customAnalytes: [] };

describe("founding a parameter, in the account", () => {
  it("stores the parameter and files the printed name under it", () => {
    const s = withNewParameter(empty, feritin, "S_Ferritin");
    expect(s.customAnalytes).toEqual([feritin]);
    expect(s.learned).toEqual({ custom_feritin: ["S_Ferritin"] });
    expect(namesUnder(s, "custom_feritin")).toEqual(["S_Ferritin"]);
  });

  it("keeps other parameters and other learned names untouched", () => {
    const before: ParamSettings = {
      learned: { glukoza: ["S_Glukóza"] },
      customAnalytes: [{ ...feritin, canonicalId: "custom_homocystein", displayNameCs: "Homocystein" }],
    };
    const s = withNewParameter(before, feritin, "S_Ferritin");
    expect(s.learned.glukoza).toEqual(["S_Glukóza"]);
    expect(s.customAnalytes.map((c) => c.canonicalId)).toEqual(["custom_homocystein", "custom_feritin"]);
    expect(before.customAnalytes).toHaveLength(1);
  });

  it("appends a second lab's spelling in acceptance order, without repeating one", () => {
    const one = withNewParameter(empty, feritin, "S_Ferritin");
    const two = withNewParameter(one, feritin, "Ferritin celkový");
    expect(two.learned.custom_feritin).toEqual(["S_Ferritin", "Ferritin celkový"]);
    expect(two.customAnalytes).toHaveLength(1);
    const again = withNewParameter(two, feritin, "S_Ferritin");
    expect(again.learned.custom_feritin).toEqual(["Ferritin celkový", "S_Ferritin"]);
  });

  it("is undone completely by deleting it", () => {
    const s = withNewParameter({ learned: { glukoza: ["S_Glukóza"] }, customAnalytes: [] }, feritin, "S_Ferritin");
    const back = withoutParameter(s, "custom_feritin");
    expect(back.customAnalytes).toEqual([]);
    // The learned entry goes too: its names have nothing left to point at,
    // and the next load would otherwise teach a synonym for a missing id.
    expect("custom_feritin" in back.learned).toBe(false);
    expect(back.learned).toEqual({ glukoza: ["S_Glukóza"] });
  });

  it("survives the blob-replacing save with the other screens' fields intact", () => {
    const aiContext = { sex: "m" as const, ageBand: "30-34" as const };
    const s = withNewParameter(empty, feritin, "S_Ferritin");
    const saved = mergeSettings({ aiContext }, { learned: s.learned, customAnalytes: s.customAnalytes });
    expect(saved.aiContext).toEqual(aiContext);
    expect(saved.customAnalytes).toEqual([feritin]);
    expect(saved.learned).toEqual({ custom_feritin: ["S_Ferritin"] });
  });
});

/* ------------------------------------------------------------------ screen */

const m = (name: string, value: string, unit: string, ref: string, cid: string | null = null) =>
  normalizeMeasurement(
    makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: ref, canonicalId: cid }),
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

const glukoza: AnalyteDef = {
  canonicalId: "glukoza",
  displayNameCs: "Glukóza",
  synonyms: ["S_Glukóza"],
  canonicalUnit: "mmol/l",
  unitConversions: {},
  referenceRange: [3.9, 5.6],
};

const render = (reports: LabReport[], customAnalytes: CustomAnalyte[], registry: Registry) =>
  renderToStaticMarkup(
    createElement(MappingTab, {
      reports,
      registry,
      customAnalytes,
      onMap: () => {},
      onUndoMap: () => {},
      onCreateParameter: () => {},
      onDeleteParameter: () => {},
      onShowSource: () => {},
      aiAsked: {},
      aiError: null,
      onAskAgain: () => {},
    }),
  );

describe("what Přiřazení offers for an unknown name", () => {
  const unknown = [report("r1", "2026-03-04", [m("S_Ferritin", "48", "µg/l", "13-150")])];

  it("offers founding a parameter beside mapping and deferring", () => {
    const html = render(unknown, [], new Registry([glukoza]));
    expect(html).toContain("Založit nový parametr");
    expect(html).toContain("Vybrat jiný parametr");
    expect(html).toContain("Nechat nepřiřazené");
  });

  it("says so in the copy where no candidate survived the evidence", () => {
    const html = render(unknown, [], new Registry([glukoza]));
    expect(html).toContain("Vyberte parametr ručně, založte nový, nebo nechte název nepřiřazený.");
  });

  it("does not list founded parameters before there are any", () => {
    expect(render(unknown, [], new Registry([glukoza]))).not.toContain("Vlastní parametry");
  });
});

describe("the list of founded parameters", () => {
  it("names each one with its unit and the printed names filed under it", () => {
    const registry = new Registry([glukoza, toAnalyteDef(feritin)]);
    registry.addSynonym("custom_feritin", "S_Ferritin");
    const reports = [
      report("r1", "2026-03-04", [
        m("S_Ferritin", "48", "µg/l", "13-150", "custom_feritin"),
        m("S_Homocystein", "11,2", "µmol/l", "5,0-15,0"),
      ]),
    ];
    const html = render(reports, [feritin], registry);
    expect(html).toContain("Vlastní parametry (1)");
    expect(html).toContain("Feritin");
    expect(html).toContain("S_Ferritin");
    // The delete has to say what it costs, because nothing else on the screen
    // does: the names go back to unmapped, the values stay.
    expect(html).toContain("vrátí");
    expect(html).toContain("naměřené hodnoty zůstanou");
  });
});

/* ------------------------------------------------- the report after next */

/**
 * The promise the form makes in so many words — "příští report ho už pozná
 * sám" — and the one thing about founding a parameter that cannot be seen by
 * looking at the screen it happens on.
 *
 * `interpretPage` gives every freshly extracted row its canonicalId through
 * one callback, `(raw, mat) => registry.match(raw, mat)` (lib/upload.ts), so
 * a registry rebuilt from the account that answers that call is the whole of
 * automatic matching. These rebuild it exactly as Portal's load path does and
 * ask it.
 */
const afterReload = (s: ParamSettings, defs: AnalyteDef[] = [glukoza]) => {
  const reg = new Registry(defs);
  // Founded parameters before the learned names — Portal.tsx says why.
  for (const c of s.customAnalytes) reg.addAnalyte(toAnalyteDef(c));
  for (const [cid, names] of Object.entries(s.learned)) {
    for (const n of names) reg.addSynonym(cid, n);
  }
  return reg;
};

describe("a later report carrying a founded parameter's printed name", () => {
  const founded = withNewParameter(empty, feritin, "S_Ferritin");

  it("is matched on upload with no second visit to Přiřazení", () => {
    expect(afterReload(founded).match("S_Ferritin")).toBe("custom_feritin");
  });

  it("is matched however that lab cases or accents it", () => {
    const reg = afterReload(founded);
    for (const printed of ["s_ferritin", "S_FERRITIN", "S_Ferritín", "S-Ferritin"]) {
      expect(reg.match(printed)).toBe("custom_feritin");
    }
  });

  it("lands in the founded parameter's own trend, under its own name", () => {
    const reg = afterReload(founded);
    // What interpretPage does to an arriving row, at the one point it decides.
    const arriving = m("S_Ferritin", "61", "µg/l", "13-150", reg.match("S_Ferritin"));
    const trends = buildTrends([report("r9", "2026-09-01", [arriving])], (cid) => reg.displayName(cid));
    expect(trends.get("custom_feritin")?.displayName).toBe("Feritin");
    expect(trends.get("custom_feritin")?.points).toHaveLength(1);
  });

  it("is still refused when the page says a different material", () => {
    // The founding name carried S_, so the parameter is serum. A urine row of
    // the same name is a different test and stays a decision.
    const reg = afterReload(founded);
    expect(reg.match("U_Ferritin")).toBeNull();
    expect(reg.match("Ferritin", "u")).toBeNull();
  });

  it("needs one click for a spelling it has never seen — and then remembers it", () => {
    const reg = afterReload(founded);
    // Nothing can guess this from "S_Ferritin", and guessing is what the
    // whole screen exists not to do.
    expect(reg.match("Ferritin celkový")).toBeNull();

    // Accepting it is the ordinary mapping path: the name joins the learned
    // list under the founded id, which is why that path needed no new code.
    const also: ParamSettings = {
      ...founded,
      learned: { custom_feritin: [...namesUnder(founded, "custom_feritin"), "Ferritin celkový"] },
    };
    const reg2 = afterReload(also);
    expect(reg2.match("Ferritin celkový")).toBe("custom_feritin");
    expect(reg2.match("S_Ferritin")).toBe("custom_feritin");
  });

  it("forgets it again when the parameter is deleted", () => {
    const gone = withoutParameter(founded, "custom_feritin");
    expect(afterReload(gone).match("S_Ferritin")).toBeNull();
  });
});
