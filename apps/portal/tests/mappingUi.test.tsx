// @vitest-environment happy-dom
/**
 * The three mapping screens, driven the way a reader drives them
 * (docs/plans/model-loop.md, "still to build"):
 *
 *   - Trendy without the unrecognised map is exactly the old tab; with it,
 *     an unrecognised series is its own card, marked „nerozpoznáno", with no
 *     „mimo rozmezí" and a way to a parameter — never a point in a
 *     recognised chart;
 *   - „přidáno automaticky" appears after a name only where Portal provides
 *     the mark, and its sheet explains the NČLP entry and lets the reader
 *     say it is wrong;
 *   - the names screen withdraws one's own decision after a confirmation and
 *     sends an automatic one to the sheet.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LabReport, Registry, buildTrends, makeMeasurement, normalizeMeasurement } from "@bw/lab-core";
import TrendsTab from "../src/ui/TrendsTab";
import { MarkContext } from "../src/ui/Mark";
import AutoMark from "../src/ui/AutoMark";
import NameSheet from "../src/ui/NameSheet";
import NamesCard from "../src/ui/NamesCard";
import { type NameDecision, unrecognisedOnly } from "../src/lib/decisions";
import type { AutoEntry } from "../src/lib/api";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (ui: ReactElement) => act(() => root.render(ui));
const click = (el: Element | null | undefined) => {
  if (!el) throw new Error("nothing to click");
  act(() => (el as HTMLElement).click());
};
const button = (text: string | RegExp) =>
  [...document.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent?.trim() === text : text.test(b.textContent ?? "")));

const m = (name: string, value: string, unit: string, ref: string, cid: string | null) =>
  normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: ref, canonicalId: cid }));
const report = (id: string, date: string, ms: ReturnType<typeof m>[]): LabReport => ({
  id,
  sourceFile: `${id}.pdf`,
  reportDate: date,
  labName: "Laboratoř Vzor",
  patientName: null,
  patientId: null,
  pages: [],
  measurements: ms,
});

const reports = [
  report("a", "2026-01-10", [m("S_Glukóza", "7,1", "mmol/l", "(3,9-5,6)", "glukoza"), m("S_Cystatin X", "1,9", "mg/l", "(0,6-1,0)", null), m("S_Apo AII", "0,31", "g/l", "(0,2-0,5)", "nclp_00754")]),
  report("b", "2026-03-10", [m("S_Glukóza", "6,9", "mmol/l", "(3,9-5,6)", "glukoza"), m("S_Cystatin X", "2,0", "mg/l", "(0,6-1,0)", null), m("S_Apo AII", "0,33", "g/l", "(0,2-0,5)", "nclp_00754")]),
];
const names: Record<string, string> = { glukoza: "Glukóza", nclp_00754: "Apolipoprotein AII" };
const built = buildTrends(reports, (cid) => names[cid] ?? cid, () => null, () => null, () => null, { unrecognised: true });
const recognised = new Map([...built].filter(([, t]) => t.recognised !== false));
const unknown = unrecognisedOnly(built, () => true);

describe("Trendy", () => {
  it("without the unrecognised map is the old tab: the warning, no unrecognised card", () => {
    render(<TrendsTab trends={recognised} unmappedNames={["S_Cystatin X"]} />);
    expect(host.textContent).toContain("nezobrazuje");
    expect(host.textContent).not.toContain("nerozpoznáno");
  });

  it("with it, an unrecognised series is its own card, marked, without a range verdict, with a way to a parameter", () => {
    const onAssign = vi.fn();
    render(<TrendsTab trends={recognised} unmappedNames={["S_Cystatin X"]} unrecognised={unknown} labOf={() => "Laboratoř Vzor"} onAssign={onAssign} />);
    expect(host.textContent).not.toContain("nezobrazuje");
    expect(host.textContent).toContain("Zatím nerozpoznané");
    click(button(/^S_Cystatin X/));
    const card = host.querySelector(".trend-card.unrec");
    expect(card).not.toBeNull();
    expect(card!.querySelector(".chip.unrec")?.textContent).toBe("nerozpoznáno");
    // Out of its printed range, but not a parameter's verdict: no red chip.
    expect(card!.querySelector(".chip.alert")).toBeNull();
    expect(card!.textContent).toContain("Laboratoř Vzor");
    // No verdict in words either — only the lab's range, said to be the lab's.
    expect(card!.textContent).not.toMatch(/v rozmezí|nad rozmezím|pod rozmezím/);
    expect(card!.textContent).toContain("(dle laboratoře)");
    expect(card!.querySelector(".out")).toBeNull();
    click(button("Přiřadit ke známému parametru"));
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ recognised: false, displayName: "S_Cystatin X" }));
  });

  it("keeps the two kinds apart: a recognised card holds no unrecognised reading", () => {
    render(<TrendsTab trends={recognised} unrecognised={unknown} open={{ id: "glukoza", seq: 1 }} />);
    const card = host.querySelector(".trend-card:not(.unrec)");
    expect(card?.textContent).toContain("Glukóza");
    expect([...recognised.values()].every((t) => t.points.every((p) => p.rawName !== "S_Cystatin X"))).toBe(true);
  });

  it("shows the auto mark after a name only where Portal provides it", () => {
    render(<TrendsTab trends={recognised} open={{ id: "nclp_00754", seq: 1 }} />);
    expect(host.querySelector(".auto-mark")).toBeNull();
    const onOpen = vi.fn();
    render(
      <MarkContext.Provider value={(cid) => (cid === "nclp_00754" ? <AutoMark name="Apolipoprotein AII" onOpen={onOpen} /> : null)}>
        <TrendsTab trends={recognised} open={{ id: "nclp_00754", seq: 2 }} />
      </MarkContext.Provider>,
    );
    click(host.querySelector(".auto-mark"));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

const ENTRY: AutoEntry = { code: "00754", nameCs: "Apolipoprotein AII (S; hmot. konc. [g/l])", unit: "g/l", material: "s", rawName: "S_Apo AII", model: "claude-haiku-5-5", at: "2026-10-20T10:00:00Z", mine: false };
const registry = new Registry([
  { canonicalId: "glukoza", displayNameCs: "Glukóza", synonyms: ["S_Glukóza"], canonicalUnit: "mmol/l", unitConversions: {} },
  { canonicalId: "apo_a1", displayNameCs: "Apolipoprotein A1", synonyms: [], canonicalUnit: "g/l", unitConversions: {} },
  { canonicalId: "nclp_00754", displayNameCs: ENTRY.nameCs, synonyms: ["S_Apo AII"], canonicalUnit: "g/l", unitConversions: {} },
]);
const nameOf = (cid: string) => names[cid] ?? registry.displayName(cid);

describe("the sheet about an auto-added parameter", () => {
  it("says what happened in words, with the code, specimen and printed name", () => {
    render(<NameSheet state={{ kind: "auto", code: "00754" }} registry={registry} nameOf={nameOf} reports={reports} autoEntries={[ENTRY]} unrecognisedShown onAssign={() => {}} onLeave={() => {}} onClose={() => {}} />);
    const sheet = document.querySelector(".name-sheet")!;
    expect(sheet.querySelector("h2")?.textContent).toBe("Apolipoprotein AII");
    expect(sheet.textContent).toContain("Národním číselníku laboratorních položek");
    expect(sheet.textContent).toContain("00754");
    expect(sheet.textContent).toContain("sérum");
    expect(sheet.textContent).toContain("S_Apo AII");
  });

  it('„Nechat bez přiřazení“ hands back every printed name filed under it, in its lab and unit', () => {
    const onLeave = vi.fn();
    render(<NameSheet state={{ kind: "auto", code: "00754" }} registry={registry} nameOf={nameOf} reports={reports} autoEntries={[ENTRY]} unrecognisedShown onAssign={() => {}} onLeave={onLeave} onClose={() => {}} />);
    click(button("Nechat bez přiřazení"));
    expect(onLeave).toHaveBeenCalledWith([{ rawName: "S_Apo AII", lab: "Laboratoř Vzor", unit: "g/l" }]);
  });

  it('„Přiřadit jinému parametru“ offers every parameter but this one', () => {
    const onAssign = vi.fn();
    render(<NameSheet state={{ kind: "auto", code: "00754" }} registry={registry} nameOf={nameOf} reports={reports} autoEntries={[ENTRY]} unrecognisedShown onAssign={onAssign} onLeave={() => {}} onClose={() => {}} />);
    click(button("Přiřadit jinému parametru…"));
    const items = [...document.querySelectorAll(".picker-item .picker-name")].map((e) => e.textContent);
    expect(items).not.toContain("Apolipoprotein AII");
    click([...document.querySelectorAll(".picker-item")].find((b) => b.textContent?.includes("Apolipoprotein A1")));
    expect(onAssign).toHaveBeenCalledWith([{ rawName: "S_Apo AII", lab: "Laboratoř Vzor", unit: "g/l" }], "apo_a1");
  });
});

describe("the names screen", () => {
  const mine: NameDecision = { rawName: "S_Kreat", lab: "Laboratoř Vzor", unit: "µmol/l", canonicalId: "glukoza", who: "you", where: "alias", mine: true, overrulable: false, code: null };
  const auto: NameDecision = { rawName: "S_Na", lab: "Laboratoř Vzor", unit: "mmol/l", canonicalId: "glukoza", who: "auto", where: "alias", mine: false, overrulable: true, code: null };
  const shared: NameDecision = { rawName: "S_K", lab: "Jiná laboratoř", unit: "mmol/l", canonicalId: null, who: "auto", where: "alias", mine: false, overrulable: false, code: null };

  it("withdraws one's own decision only after a confirmation; a model's goes to the sheet; another account's reads as automatic, with no button", () => {
    const onWithdraw = vi.fn();
    const onOverrule = vi.fn();
    render(<NamesCard decisions={[mine, auto, shared]} autos={[]} registry={registry} nameOf={nameOf} onWithdraw={onWithdraw} onOverrule={onOverrule} onAutoInfo={() => {}} />);
    for (const d of document.querySelectorAll("details")) (d as HTMLDetailsElement).open = true;
    click(button("Vrátit zpět"));
    expect(onWithdraw).not.toHaveBeenCalled();
    click(button("Vrátit"));
    expect(onWithdraw).toHaveBeenCalledWith(mine);
    click(button("Nesedí"));
    expect(onOverrule).toHaveBeenCalledWith(auto);
    const sharedRow = [...document.querySelectorAll(".names-list li")].find((li) => li.textContent?.includes("S_K"))!;
    expect(sharedRow.querySelector("button")).toBeNull();
    expect(sharedRow.textContent).toContain("žádný parametr");
    // Another account's decision is „automaticky", like the model's: no hint of another user.
    expect(sharedRow.querySelector(".who")?.textContent).toBe("automaticky");
    expect(host.textContent).not.toContain("jiný uživatel");
  });

  it("lists the auto-added parameters in use, opening their sheet", () => {
    const onAutoInfo = vi.fn();
    render(<NamesCard decisions={[]} autos={[{ entry: ENTRY, rows: [{ rawName: "S_Apo AII", lab: "Laboratoř Vzor", unit: "g/l" }] }]} registry={registry} nameOf={nameOf} onWithdraw={() => {}} onOverrule={() => {}} onAutoInfo={onAutoInfo} />);
    expect(host.textContent).toContain("NČLP 00754");
    click(button("Podrobnosti"));
    expect(onAutoInfo).toHaveBeenCalledWith("00754");
  });
});
