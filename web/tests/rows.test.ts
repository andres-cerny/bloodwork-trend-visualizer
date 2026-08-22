/**
 * Row reconstruction is what makes the text path usable, and the provenance
 * check is what makes it trustworthy. Both are tested against coordinates
 * shaped like a real Czech lab table: an analyte name, a value with a decimal
 * comma, a unit and a parenthesised reference range, laid out in columns.
 */
import { describe, expect, it } from "vitest";
import type { Box } from "../src/lib/models";
import { buildRows, isPrintedOnPage, rowBoxFor, rowsAsText, rowTextAt } from "../src/pdf/rows";

/** Build a word at a column x and row y, as pdf.js would report it. */
const w = (text: string, x: number, y: number, h = 12): { text: string; box: Box } => ({
  text,
  box: [x, y, x + text.length * 6, y + h],
});

const PAGE = [
  // Deliberately out of document order — pdf.js does not promise reading order.
  ...[w("mmol/l", 330, 100), w("S_Glukóza", 50, 100), w("(4,11-5,60)", 420, 100), w("3,802", 250, 100)],
  ...[w("S_Cholesterol", 50, 130), w("4,80", 250, 130), w("mmol/l", 330, 130), w("(2,90-5,00)", 420, 130)],
  // A row whose cells sit on slightly different baselines — different font size.
  ...[w("S_CRP", 50, 160), w("<1,0", 250, 162, 10), w("mg/l", 330, 159), w("(1,0-5,0)", 420, 161)],
];

describe("buildRows", () => {
  it("groups items into printed rows regardless of document order", () => {
    const rows = buildRows(PAGE);
    expect(rows).toHaveLength(3);
    expect(rows[0].cells).toEqual(["S_Glukóza", "3,802", "mmol/l", "(4,11-5,60)"]);
  });

  it("tolerates baseline jitter within a row", () => {
    const rows = buildRows(PAGE);
    expect(rows[2].cells).toEqual(["S_CRP", "<1,0", "mg/l", "(1,0-5,0)"]);
  });

  it("spans the row bbox across all its cells", () => {
    const [first] = buildRows(PAGE);
    expect(first.box[0]).toBe(50);
    expect(first.box[2]).toBeGreaterThan(420);
  });

  it("returns nothing for a page with no text layer", () => {
    expect(buildRows([])).toEqual([]);
  });
});

describe("rowsAsText", () => {
  it("renders one printed row per line, indexed, with pipe-separated cells", () => {
    expect(rowsAsText(buildRows(PAGE)).split("\n")[1]).toBe(
      "1\tS_Cholesterol | 4,80 | mmol/l | (2,90-5,00)",
    );
  });

  it("numbers every line from zero, contiguously", () => {
    const lines = rowsAsText(buildRows(PAGE)).split("\n");
    lines.forEach((line, i) => expect(line.startsWith(`${i}\t`), line).toBe(true));
  });
});

describe("rowTextAt — the round trip the row_index anchor depends on", () => {
  const rows = buildRows(PAGE);

  it("resolves an index back to the printed row", () => {
    // What the model returns as row_index must land on the row it read, or the
    // verification tab shows the wrong line beside the page image.
    const lines = rowsAsText(rows).split("\n");
    lines.forEach((line, i) => {
      const printed = line.slice(line.indexOf("\t") + 1).split(" | ").join(" ");
      expect(rowTextAt(i, rows)).toBe(printed);
    });
  });

  it("returns nothing for an index off either end, rather than throwing", () => {
    expect(rowTextAt(-1, rows)).toBe("");
    expect(rowTextAt(rows.length, rows)).toBe("");
    expect(rowTextAt(undefined, rows)).toBe("");
  });
});

describe("isPrintedOnPage", () => {
  const rows = buildRows(PAGE);

  it("accepts a value that is printed, decimal comma and all", () => {
    expect(isPrintedOnPage("3,802", rows)).toBe(true);
    expect(isPrintedOnPage("<1,0", rows)).toBe(true);
  });

  it("rejects a value that is not on the page — the fabrication case", () => {
    // A plausible misread of "3,802": right digits, wrong decimal placement.
    expect(isPrintedOnPage("38,02", rows)).toBe(false);
    expect(isPrintedOnPage("4,81", rows)).toBe(false);
  });

  it("ignores whitespace, since pdf.js splits cells arbitrarily", () => {
    expect(isPrintedOnPage(" 4,80 ", rows)).toBe(true);
  });

  it("treats an empty claim as nothing to verify", () => {
    expect(isPrintedOnPage("", rows)).toBe(true);
  });
});

describe("rowBoxFor", () => {
  it("returns the row's own bbox — no text search needed", () => {
    const rows = buildRows(PAGE);
    expect(rowBoxFor("S_Cholesterol", rows)).toEqual(rows[1].box);
  });

  it("returns null for a name not on the page", () => {
    expect(rowBoxFor("S_Neexistuje", buildRows(PAGE))).toBeNull();
  });
});
