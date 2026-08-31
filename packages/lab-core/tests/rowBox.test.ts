/**
 * Which printed row a transcribed value is shown against. The verification
 * pane draws its highlight from this, so a wrong answer frames the wrong
 * number — which is worse than no highlight, because it looks checked.
 */
import { describe, expect, it } from "vitest";
import { type Box, rowBoxAt, rowBoxFor, type TextRow } from "@bw/lab-core";

const row = (cells: string[], y: number): TextRow => ({
  cells,
  cellBoxes: cells.map((c, i) => [50 + i * 120, y, 50 + i * 120 + c.length * 6, y + 10] as Box),
  box: [50, y, 500, y + 10],
});

// The SPADIA page this was found on: two bilirubins, first word shared,
// pdf.js splitting the name from its qualifier.
const rows = [
  row(["S_Kyselina", "močová", "337", "µmol/l"], 100),
  row(["S_Bilirubin", "celkový", "8,8", "µmol/l"], 120),
  row(["S_Bilirubin", "konjugovaný", "3,9", "µmol/l"], 140),
];

describe("rowBoxFor", () => {
  it("prefers the row that contains the whole name over one that merely starts it", () => {
    expect(rowBoxFor("S_Bilirubin konjugovaný", rows)).toEqual(rows[2].box);
    expect(rowBoxFor("S_Bilirubin celkový", rows)).toEqual(rows[1].box);
  });

  it("still falls back to a first-cell match when the name was split by the lab", () => {
    expect(rowBoxFor("S_Kyselina močová v séru", rows)).toEqual(rows[0].box);
  });

  it("gives up rather than guess when nothing fits", () => {
    expect(rowBoxFor("B_Hemoglobin", rows)).toBeNull();
  });
});

describe("rowBoxAt", () => {
  it("is the row the model pointed at, and nothing else", () => {
    expect(rowBoxAt(2, rows)).toEqual(rows[2].box);
    expect(rowBoxAt(undefined, rows)).toBeNull();
    expect(rowBoxAt(3, rows)).toBeNull();
  });
});
