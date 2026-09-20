/**
 * What Přiřazení says about the model's answers, rendered from the account's
 * record alone — no call is made here, and none could be: the tab has no
 * way to ask, only to render what Portal stored and to say "ask again".
 *
 * Pinned: a "medium" answer is a suggestion on the card, not a mapping; a
 * "high" answer the evidence refused is shown with the contradiction; what
 * was filed is listed with a way back; "not blood" is parked and named; the
 * one button asks again and says so; the sentence states what the model
 * does on its own.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type AnalyteDef, type LabReport, Registry, makeMeasurement, normalizeMeasurement } from "@bw/lab-core";
import type { AiAsked } from "../src/lib/api";
import MappingTab from "../src/ui/MappingTab";

const m = (name: string, value: string, unit: string, ref: string, cid: string | null) =>
  normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: ref, canonicalId: cid }));

const report = (ms: ReturnType<typeof m>[]): LabReport => ({
  id: "r1",
  sourceFile: "r1.pdf",
  reportDate: "2026-09-19",
  labName: "Lab",
  patientName: null,
  patientId: null,
  pages: [],
  measurements: ms,
});

const def = (id: string, name: string, unit: string, referenceRange?: [number, number]): AnalyteDef => ({
  canonicalId: id,
  displayNameCs: name,
  synonyms: [],
  canonicalUnit: unit,
  unitConversions: {},
  ...(referenceRange ? { referenceRange } : {}),
});

const registry = () => new Registry([def("sodik", "Sodík", "mmol/l", [137, 145]), def("draslik", "Draslík", "mmol/l", [3.5, 5.1]), def("ft4", "T4 volný (fT4)", "pmol/l", [12, 22])]);

const render = (reports: LabReport[], aiAsked: AiAsked, over: Partial<Parameters<typeof MappingTab>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(MappingTab, {
      reports,
      registry: registry(),
      customAnalytes: [],
      onMap: () => {},
      onUndoMap: () => {},
      onCreateParameter: () => {},
      onDeleteParameter: () => {},
      onShowSource: () => {},
      aiAsked,
      aiError: null,
      onAskAgain: () => {},
      ...over,
    }),
  );

const AT = "2026-09-19";
const entry = (over: Partial<AiAsked[string]>): AiAsked[string] => ({ decision: "catalog", canonicalId: null, confidence: "high", reason: "", model: "haiku", at: AT, ...over });

describe("the model's answers on the mapping tab", () => {
  it("a medium answer is shown under the model's heading with its reason and confidence, and the name still waits", () => {
    const html = render([report([m("S_K", "4,2", "mmol/l", "3,5 - 5,1", null)])], { S_K: entry({ canonicalId: "draslik", confidence: "medium", reason: "K je draslík." }) });
    expect(html).toContain("Návrh modelu");
    expect(html).toContain("podle modelu Draslík — K je draslík. (jistota: střední)");
    expect(html).toContain("1 název čeká");
    expect(html).not.toContain("Model přiřadil");
  });

  it("a high answer the evidence refused is shown contradicted, not filed", () => {
    // Total T4 in nmol/l, named as free T4 (pmol/l): the unit line says why.
    const html = render([report([m("S_T4 celkový", "100", "nmol/l", "66,0 - 181,0", null)])], { "S_T4 celkový": entry({ canonicalId: "ft4", reason: "T4." }) });
    expect(html).toContain("Návrh modelu");
    expect(html).toContain("nedoporučujeme");
    expect(html).toContain("nmol/l vs pmol/l");
    expect(html).not.toContain("Model přiřadil");
  });

  it("what the model filed is listed with a way back, read off the reports", () => {
    const filed = report([m("S_Na", "140", "mmol/l", "134 - 148", "sodik")]);
    const html = render([filed], { S_Na: entry({ canonicalId: "sodik", applied: true, reason: "Na je sodík." }) });
    expect(html).toContain("Model přiřadil 1 název");
    expect(html).toContain("S_Na → <strong>Sodík</strong>");
    expect(html).toContain("Vrátit zpět");
    expect(html).toContain("Všechny názvy jsou přiřazené. Ty, které přiřadil model, jsou níže ke kontrole.");
    // Undone: the name is unmapped again, the record still says applied, the list is empty.
    const undone = render([report([m("S_Na", "140", "mmol/l", "134 - 148", null)])], { S_Na: entry({ canonicalId: "sodik", applied: true, reason: "Na je sodík." }) });
    expect(undone).not.toContain("Model přiřadil");
    expect(undone).toContain("Návrh modelu");
  });

  it("not_blood is parked and named; unknown is said as such; new pre-fills the founding button", () => {
    const html = render(
      [report([m("S_Na", "140", "mmol/l", "134 - 148", null), m("S_K", "4,2", "mmol/l", "3,5 - 5,1", null), m("S_Foo", "1", "g/l", "", null)])],
      {
        S_Na: entry({ decision: "not_blood", canonicalId: null, reason: "Moč." }),
        S_K: entry({ decision: "unknown", canonicalId: null, confidence: "low", reason: "Nejasné." }),
        S_Foo: entry({ decision: "new", canonicalId: null, proposed: { id: "foo", displayNameCs: "Foo", unit: "g/l" }, reason: "Nové." }),
      },
    );
    expect(html).toContain("Model označil jako jiný materiál než krev a ponechal bez přiřazení: S_Na.");
    expect(html).toContain("Ponechané bez přiřazení (1)");
    expect(html).toContain("Model si není jistý. Nejasné. (jistota: nízká)");
    expect(html).toContain("Vyšetření, které aplikace ještě nezná: <strong>Foo</strong>");
    expect(html).toContain("Založit s tímto názvem");
    expect(html).toContain("2 názvy čekají");
  });

  it("the one button asks again, and the sentence says what the model does on its own", () => {
    const html = render([report([m("S_K", "4,2", "mmol/l", "3,5 - 5,1", null)])], {});
    expect(html).toContain(">Zeptat se znovu</button>");
    expect(html).not.toContain("Nechat AI navrhnout");
    expect(html).toContain("Názvy, kterými si je model jistý a u kterých souhlasí jednotka, přiřazuje sám; ostatní čekají tady i s jeho návrhem. Vidí jen názvy, jednotky a rozmezí, nikdy hodnoty.");
    expect(html).not.toMatch(/!/);
  });

  it("a name being asked right now says so, and the button waits", () => {
    const html = render([report([m("S_K", "4,2", "mmol/l", "3,5 - 5,1", null)])], { S_K: entry({ asking: true }) });
    expect(html).toContain("Model název zařazuje…");
    expect(html).toContain("Model zařazuje názvy…");
    expect(html).not.toContain("Návrh modelu");
  });

  it("frozen: the button is disabled and the tab says why; an unreachable model is said in its banner", () => {
    const reports = [report([m("S_K", "4,2", "mmol/l", "3,5 - 5,1", null)])];
    const frozen = render(reports, {}, { frozen: true });
    expect(frozen).toContain("Měsíční limit zpracování je vyčerpán.");
    expect(frozen).toMatch(/<button class="btn" disabled=""[^>]*>Zeptat se znovu<\/button>/);
    const down = render(reports, {}, { aiError: "Model se nepodařilo oslovit. Názvy čekají zde; zkuste to prosím za chvíli znovu." });
    expect(down).toContain('<p class="banner error">Model se nepodařilo oslovit. Názvy čekají zde; zkuste to prosím za chvíli znovu.</p>');
  });
});
