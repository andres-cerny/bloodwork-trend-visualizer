// @vitest-environment happy-dom
/**
 * A selected row belongs to the report it was picked in.
 *
 * The defect: opening another report from the Reporty list (a jump with no
 * row), or deleting the report on screen, left row i selected — now row i of
 * a different report — with the old report's value still typed in, and
 * „Opravit" one click from writing it there.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type LabReport, type Measurement, makeMeasurement, normalizeMeasurement } from "@bw/lab-core";
import VerifyTab from "../src/ui/VerifyTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = (name: string, valueRaw: string): Measurement =>
  normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw, unitRaw: "mmol/l", refRangeRaw: "(3,9-5,6)" }));

const rep = (id: string, rows: Measurement[]): LabReport =>
  ({ id, reportDate: "2026-04-14", labName: "Lab", sourceFile: `${id}.pdf`, patientName: null, patientId: null, pages: [], measurements: rows }) as unknown as LabReport;

const A = rep("r1", [m("S_Glukóza", "5,32"), m("S_Urea", "7,77")]);
const B = rep("r2", [m("S_Kreatinin", "80"), m("S_CRP", "3,1")]);

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

const draw = (reports: LabReport[], focus: { reportId: string; rawName: string; seq: number }) =>
  act(() => root.render(<VerifyTab reports={reports} onCorrect={() => undefined} focus={focus} displayName={(c) => c} curatedRange={() => null} />));

const selected = () => host.querySelectorAll('[aria-selected="true"]').length;
const draftShown = (v: string) => [...host.querySelectorAll("input")].some((i) => (i as HTMLInputElement).value === v);

it("drops the selection when another report is opened without a row", () => {
  draw([A, B], { reportId: "r1", rawName: "S_Urea", seq: 1 });
  expect(selected()).toBe(1);
  expect(draftShown("7,77")).toBe(true);
  draw([A, B], { reportId: "r2", rawName: "", seq: 2 });
  expect(selected()).toBe(0);
  expect(draftShown("7,77")).toBe(false);
});

it("drops the selection when the report on screen is deleted", () => {
  draw([A, B], { reportId: "r1", rawName: "S_Urea", seq: 1 });
  expect(selected()).toBe(1);
  draw([B], { reportId: "r1", rawName: "S_Urea", seq: 1 });
  expect(selected()).toBe(0);
  expect(draftShown("7,77")).toBe(false);
});

describe("the report's date in Ověření", () => {
  const dateless = { ...A, id: "r3", reportDate: null } as unknown as LabReport;
  it("asks for a missing date and hands the one typed to the parent; a date nobody doubts gets no field", () => {
    const set: Array<[string, string]> = [];
    act(() =>
      root.render(<VerifyTab reports={[dateless, B]} onCorrect={() => undefined} onSetDate={(id, d) => set.push([id, d])} focus={{ reportId: "r3", rawName: "", seq: 1 }} displayName={(c) => c} curatedRange={() => null} />),
    );
    const form = host.querySelector("form.date-field")!;
    expect(form.textContent).toMatch(/nenašlo/);
    const input = form.querySelector<HTMLInputElement>("input[type=date]")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "2026-04-14");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(set).toEqual([["r3", "2026-04-14"]]);
    act(() =>
      root.render(<VerifyTab reports={[dateless, B]} onCorrect={() => undefined} onSetDate={() => undefined} focus={{ reportId: "r2", rawName: "", seq: 2 }} displayName={(c) => c} curatedRange={() => null} />),
    );
    expect(host.querySelector("form.date-field")).toBeNull();
  });
});
