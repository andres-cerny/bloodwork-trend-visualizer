/**
 * The Ověření highlight on photos (docs/plans/photo-capture.md, Phase E).
 *
 * Fixture rows are shaped like Tesseract's output on a flattened page: one
 * word per item, rows 52 px apart, a value column far right of the name.
 * Values and names are invented; no recorded OCR text is copied.
 */
import { describe, expect, it } from "vitest";
import type { Box } from "../src/models";
import type { OcrLine } from "../src/photoOcr";
import { homography, type PageQuad } from "../src/photoPage";
import {
  isTwoSheets,
  locatePhotoRows,
  matchReadRows,
  ocrRows,
  rowHasName,
  rowHasValue,
  toPhotoQuad,
  type PhotoRowSource,
} from "../src/photoRows";

const w = (text: string, box: Box) => ({ text, conf: 90, box });

/** One printed row per line: name words at x≈100, value at 800, unit at 950. */
function line(y: number, name: string, value: string, unit = "mmol/l"): OcrLine {
  const words = name.split(" ").map((t, i) => w(t, [100 + i * 140, y, 220 + i * 140, y + 30]));
  return { words: [...words, w(value, [800, y, 880, y + 30]), w(unit, [950, y, 1060, y + 30])] };
}

const lines: OcrLine[] = [
  line(100, "Sodík", "140"),
  line(152, "Draslík", "4,2"),
  line(204, "Chloridy", "104"),
  line(256, "Vápník", "2,41"),
];
const rows = ocrRows(lines);

const portrait: PageQuad = { corners: [[40, 30], [1240, 50], [1230, 1750], [30, 1740]], confidence: 0.95, frameSides: [false, false, false, false], cornerCut: false };
const spread: PageQuad = { corners: [[40, 30], [2400, 40], [2400, 1700], [40, 1690]], confidence: 0.98, frameSides: [false, false, false, false], cornerCut: false };

describe("ocrRows", () => {
  it("builds one row per printed line, name and value on it", () => {
    expect(rows).toHaveLength(4);
    expect(rows[1].text).toContain("Draslík");
    expect(rows[1].text).toContain("4,2");
  });
});

describe("matchReadRows — name and value on one OCR row, else nothing", () => {
  it("frames the row that carries both", () => {
    expect(matchReadRows([{ rawAnalyteName: "Draslík", valueRaw: "4,2" }], rows)).toEqual([1]);
  });

  it("never frames the neighbour row: a value printed one row off gets nothing", () => {
    // The reader paired Draslík with Chloridy's value: no one row carries both.
    expect(matchReadRows([{ rawAnalyteName: "Draslík", valueRaw: "104" }], rows)).toEqual([-1]);
  });

  it("gives nothing when the name is not on the page", () => {
    expect(matchReadRows([{ rawAnalyteName: "Hořčík", valueRaw: "0,9" }], rows)).toEqual([-1]);
  });

  it("gives nothing when two rows could be it", () => {
    const twice = ocrRows([line(100, "Glukóza", "5,1"), line(152, "Glukóza", "5,1")]);
    expect(matchReadRows([{ rawAnalyteName: "Glukóza", valueRaw: "5,1" }], twice)).toEqual([-1]);
  });

  it("gives nothing to two reads that claim the same row", () => {
    const reads = [
      { rawAnalyteName: "Sodík", valueRaw: "140" },
      { rawAnalyteName: "Sodík", valueRaw: "140" },
    ];
    expect(matchReadRows(reads, rows)).toEqual([-1, -1]);
  });

  it("forgives an OCR typo in the name, never in the value", () => {
    expect(rowHasName("Chlor1dy 104 mmol/l", "Chloridy")).toBe(true);
    expect(rowHasValue("Chloridy 1O4 mmol/l", "104")).toBe(false);
    expect(rowHasValue("CRP < 0,5 mg/l", "<0,5")).toBe(true);
    expect(rowHasValue("Glukóza 7,2 ! mmol/l", "7,2 !")).toBe(true);
  });
});

describe("isTwoSheets — the guard", () => {
  it("is false for a portrait page and for no page", () => {
    expect(isTwoSheets(portrait)).toBe(false);
    expect(isTwoSheets(null)).toBe(false);
  });

  it("is true for a found page wider than tall", () => {
    expect(isTwoSheets(spread)).toBe(true);
  });
});

describe("locatePhotoRows", () => {
  const reads = [
    { rawAnalyteName: "Draslík", valueRaw: "4,2" },
    { rawAnalyteName: "Hořčík", valueRaw: "0,9" },
  ];

  it("returns a quad and its bounds for a match, null for no match", () => {
    const out = locatePhotoRows(reads, { rows, toPhoto: null, twoSheets: false });
    expect(out[0]?.quad).toEqual([[100, 152], [1060, 152], [1060, 182], [100, 182]]);
    expect(out[0]?.bbox).toEqual([100, 152, 1060, 182]);
    expect(out[1]).toBeNull();
  });

  it("gives no highlight at all on two sheets, even where a row would match", () => {
    expect(locatePhotoRows(reads, { rows, toPhoto: null, twoSheets: true })).toEqual([null, null]);
  });

  it("gives none without an OCR pass", () => {
    expect(locatePhotoRows(reads, null)).toEqual([null, null]);
  });

  it("carries the flattened-frame box back to the photo as a quadrilateral", () => {
    // Flattened 1200×1700 frame → a skewed page on the photo.
    const toPhoto = homography([[0, 0], [1200, 0], [1200, 1700], [0, 1700]], portrait.corners);
    const src: PhotoRowSource = { rows, toPhoto, twoSheets: false };
    const q = locatePhotoRows(reads, src)[0]!.quad;
    expect(q).toEqual(toPhotoQuad(rows[1].box, toPhoto));
    // A skewed quad: its top edge is not horizontal.
    expect(q[1][1]).not.toBeCloseTo(q[0][1], 1);
    const [x0, y0, x1, y1] = locatePhotoRows(reads, src)[0]!.bbox;
    for (const [x, y] of q) {
      expect(x).toBeGreaterThanOrEqual(x0);
      expect(x).toBeLessThanOrEqual(x1);
      expect(y).toBeGreaterThanOrEqual(y0);
      expect(y).toBeLessThanOrEqual(y1);
    }
  });
});
