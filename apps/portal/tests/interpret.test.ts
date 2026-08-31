/**
 * The page interpretation, with fake reads over a page shaped like the one
 * this was first wrong on.
 */
import { describe, expect, it } from "vitest";
import { type Box, type TextRow } from "@bw/lab-core";
import { interpretPage } from "../src/lib/interpret";

const row = (cells: string[], y: number): TextRow => ({
  cells,
  cellBoxes: cells.map((c, i) => [50 + i * 120, y, 50 + i * 120 + c.length * 6, y + 10] as Box),
  box: [50, y, 500, y + 10],
});
const rows = [
  row(["S_Bilirubin", "celkový", "8,8", "µmol/l", "(3,0-24,0)"], 120),
  row(["S_Bilirubin", "konjugovaný", "3,9", "µmol/l", "(1,5-5,0)"], 140),
  row(["S_Kreatinkináza", "13,80", "µkat/l", "(0,50-3,00)"], 160),
];
const read = (model: string, ms: Array<{ n: string; v: string; i?: number }>) => ({
  model,
  report_date: "2025-08-15",
  lab_name: "SPADIA LAB, a.s.",
  measurements: ms.map((m) => ({ raw_analyte_name: m.n, value_raw: m.v, unit_raw: "µmol/l", ref_range_raw: "", row_index: m.i, confidence: "high" as const })),
});
const match = (raw: string) => (raw.includes("Bilirubin") ? "bilirubin" : null);

describe("interpretPage", () => {
  it("highlights the row the model pointed at, not the first row that shares a word", () => {
    const out = interpretPage([read("a", [{ n: "S_Bilirubin konjugovaný", v: "3,9", i: 1 }])], rows, 1, false, match);
    expect(out.measurements[0].bbox).toEqual(rows[1].box);
    expect(out.measurements[0].sourceSnippet).toBe("S_Bilirubin konjugovaný 3,9 µmol/l (1,5-5,0)");
  });

  it("falls back to a name search when a read carried no index — and searches whole names first", () => {
    const out = interpretPage([read("a", [{ n: "S_Bilirubin konjugovaný", v: "3,9" }])], rows, 1, false, match);
    expect(out.measurements[0].bbox).toEqual(rows[1].box);
  });

  it("flags a value that is not printed on the page instead of trusting it", () => {
    const out = interpretPage([read("a", [{ n: "S_Kreatinkináza", v: "1,38", i: 2 }])], rows, 1, false, match);
    expect(out.unverified).toBe(1);
    expect(out.measurements[0].confidence).toBe("low");
    expect(out.measurements[0].disagreement).toContain("není na stránce vytištěna");
  });

  it("marks a disagreement between two readers, and keeps the printed one checkable", () => {
    const out = interpretPage(
      [read("a", [{ n: "S_Bilirubin celkový", v: "8,8", i: 0 }]), read("b", [{ n: "S_Bilirubin celkový", v: "88", i: 0 }])],
      rows, 1, false, match,
    );
    expect(out.measurements).toHaveLength(1);
    expect(out.measurements[0].disagreement).toContain("8,8 / 88");
  });

  it("on a scan keeps the model's snippet, draws no highlight and checks nothing", () => {
    const out = interpretPage([read("a", [{ n: "S_Bilirubin celkový", v: "9,9" }])], [], 3, true, match);
    expect(out.measurements[0].bbox).toBeNull();
    expect(out.measurements[0].sourcePage).toBe(3);
    expect(out.unverified).toBe(0);
  });

  it("carries the report date and lab name from the first read that has them", () => {
    const out = interpretPage([read("a", [])], rows, 1, false, match);
    expect(out.reportDate).toBe("2025-08-15");
    expect(out.labName).toBe("SPADIA LAB, a.s.");
  });
});
