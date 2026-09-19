// @vitest-environment happy-dom
/**
 * „Potvrdit všechny řádky k ověření", driven the way a reader drives it.
 *
 * The rule under test: a batch confirmation is the single confirmation, done
 * for every pending row of the shown report at once — the same stored fact
 * (`confirmed`, with the snapshot that makes it undoable), one change to the
 * report rather than a burst, and one Zpět that puts every row back as it
 * was. Rendered into a real DOM (happy-dom, like aboutParam.test.tsx),
 * because every one of these is a click and what it leaves in the table.
 */
import { act, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LabReport, type Measurement, makeMeasurement, normalizeMeasurement, reviewOf } from "@bw/lab-core";
import VerifyTab, { confirmedRow, confirmedSentence, type RowChange } from "../src/ui/VerifyTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GLUCOSE = { low: 3.9, high: 5.6 };
const curatedRange = () => GLUCOSE;

const m = (name: string, valueRaw: string, over: Partial<Measurement> = {}): Measurement =>
  normalizeMeasurement(
    makeMeasurement({ rawAnalyteName: name, valueRaw, unitRaw: "mmol/l", refRangeRaw: "(3,9-5,6)", ...over }),
  );

/** Three doubted rows of three kinds, one already confirmed, two clean. */
const report = (): LabReport =>
  ({
    id: "r1",
    reportDate: "2026-04-14",
    labName: "Laboratoř",
    sourceFile: "r1.pdf",
    patientName: null,
    patientId: null,
    pages: [],
    measurements: [
      m("S_Glukóza", "5,32"),
      m("S_Urea", "5,1", { disagreement: "dvě nezávislá čtení se liší: 5,1 / 5,7" }),
      m("S_Kreatinin", "4,4", { confidence: "low" }),
      m("S_CRP", "44,5"),
      m("S_Na", "5,0", { disagreement: "druhé čtení se nezdařilo", confirmed: true, original: { valueRaw: "5,0", disagreement: "druhé čtení se nezdařilo", confidence: "high" } }),
      m("S_K", "4,2"),
    ],
  }) as unknown as LabReport;

const other = (): LabReport =>
  ({ ...report(), id: "r2", reportDate: "2025-09-23", measurements: [m("S_Glukóza", "5,0", { confidence: "low" })] }) as unknown as LabReport;

/** What Portal.tsx does with a change: replace the rows, save the report once. */
const saves: LabReport[] = [];
let latest: LabReport[] = [];
function Host({ initial }: { initial: LabReport[] }) {
  const [reports, setReports] = useState(initial);
  latest = reports;
  const onCorrect = (reportId: string, changes: ReadonlyArray<RowChange>) => {
    const byIndex = new Map(changes.map((c) => [c.index, c.next]));
    setReports((prev) =>
      prev.map((r) => {
        if (r.id !== reportId) return r;
        const updated = { ...r, measurements: r.measurements.map((x, i) => byIndex.get(i) ?? x) };
        saves.push(updated);
        return updated;
      }),
    );
  };
  return <VerifyTab reports={reports} onCorrect={onCorrect} displayName={(c) => c} curatedRange={curatedRange} />;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  saves.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui: ReactElement) => act(() => root.render(ui));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const confirmAllBtn = () => buttons().find((b) => b.textContent === "Potvrdit všechny řádky k ověření")!;
const undoBtn = () => buttons().find((b) => b.textContent === "Zpět");
const status = () => document.querySelector<HTMLElement>(".batch-done")?.textContent?.trim() ?? null;
const counter = () => document.querySelector(".switch")!.textContent!.trim();
const alerts = () => document.querySelectorAll("tbody .chip.alert").length;
const rows = () => latest[0].measurements;

describe("Potvrdit všechny řádky k ověření", () => {
  it("is disabled when nothing is pending, enabled when something is", () => {
    render(<Host key="pending" initial={[other()]} />);
    expect(confirmAllBtn().disabled).toBe(false);
    // A fresh host, not a re-render: `initial` is read once.
    render(<Host key="clean" initial={[{ ...other(), measurements: [m("S_Glukóza", "5,0")] } as LabReport]} />);
    expect(confirmAllBtn().disabled).toBe(true);
  });

  it("confirms every pending row of the shown report, in one change", () => {
    render(<Host initial={[report(), other()]} />);
    expect(counter()).toBe("jen řádky k ověření (3)");
    expect(alerts()).toBe(3);

    click(confirmAllBtn());

    // The three doubted rows — disagreement, low confidence, probable misread
    // — are confirmed with the value the table showed, and nothing else moved.
    const before = report().measurements;
    for (const i of [1, 2, 3]) {
      expect(rows()[i]).toEqual(confirmedRow(before[i]));
      expect(reviewOf(rows()[i], curatedRange).level).toBe("ok");
    }
    for (const i of [0, 4, 5]) expect(rows()[i]).toEqual(before[i]);
    // The other report is not touched.
    expect(latest[1]).toEqual(other());

    // Every doubt channel reads the same fact: the chips are gone, the
    // worklist is empty, the button has nothing left to do.
    expect(alerts()).toBe(0);
    expect(counter()).toBe("jen řádky k ověření (0)");
    expect(confirmAllBtn().disabled).toBe(true);
    expect(status()).toBe("Potvrzeny 3 hodnoty. Zpět");

    // One save, holding all three — not three saves racing each other.
    expect(saves).toHaveLength(1);
    expect(saves[0].measurements.filter((x) => x.confirmed)).toHaveLength(4);
  });

  it("stores exactly what a single Potvrdit stores", () => {
    // Confirm one row by hand, the rest by the button, and compare.
    render(<Host initial={[report()]} />);
    click(document.querySelectorAll("tbody tr")[1]);
    click(buttons().find((b) => b.textContent === "Potvrdit")!);
    const byHand = rows()[1];
    click(confirmAllBtn());
    expect(rows()[1]).toEqual(byHand);
    expect(rows()[2]).toEqual(confirmedRow(report().measurements[2]));
    expect(status()).toBe("Potvrzeny 2 hodnoty. Zpět");
  });

  it("puts every row back with one Zpět, and says so no longer", () => {
    render(<Host initial={[report()]} />);
    click(confirmAllBtn());
    click(undoBtn()!);

    expect(rows()).toEqual(report().measurements);
    expect(alerts()).toBe(3);
    expect(counter()).toBe("jen řádky k ověření (3)");
    expect(status()).toBeNull();
    expect(confirmAllBtn().disabled).toBe(false);
    // The undo is a save too, the same way a single "Zrušit potvrzení" is.
    expect(saves).toHaveLength(2);
    expect(saves[1].measurements).toEqual(report().measurements);
  });

  it("withdraws Zpět once the reader changes a row by hand", () => {
    // Zpět restores the batch's rows as they were; after a hand edit that
    // would overwrite the edit, so the offer ends.
    render(<Host initial={[report()]} />);
    click(confirmAllBtn());
    click(document.querySelectorAll("tbody tr")[1]);
    click(buttons().find((b) => b.textContent === "Zrušit potvrzení")!);
    expect(undoBtn()).toBeUndefined();
    expect(status()).toBeNull();
    expect(rows()[1].confirmed).toBe(false);
    expect(rows()[2].confirmed).toBe(true);
  });

  it("withdraws Zpět on switching reports", () => {
    render(<Host initial={[report(), other()]} />);
    click(confirmAllBtn());
    const select = document.querySelector<HTMLSelectElement>("select#report")!;
    act(() => {
      select.value = "r2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(undoBtn()).toBeUndefined();
    expect(counter()).toBe("jen řádky k ověření (1)");
    expect(confirmAllBtn().disabled).toBe(false);
  });
});

describe("the sentence afterwards", () => {
  it("agrees with the count in Czech", () => {
    expect(confirmedSentence(1)).toBe("Potvrzena 1 hodnota.");
    expect(confirmedSentence(3)).toBe("Potvrzeny 3 hodnoty.");
    expect(confirmedSentence(5)).toBe("Potvrzeno 5 hodnot.");
    expect(confirmedSentence(22)).toBe("Potvrzeno 22 hodnot.");
  });
});
