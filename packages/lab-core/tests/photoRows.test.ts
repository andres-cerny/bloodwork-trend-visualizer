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
  MAX_TEXT_SKEW_DEG,
  photoRowGuard,
  textInTwoBlocks,
  textSkewDeg,
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

describe("rowHasName — whole tokens, Czech included", () => {
  it("does not match a short name inside a longer word: Fe is not Ferritin", () => {
    const iron = ocrRows([line(100, "Železo", "18"), line(152, "Ferritin", "15")]);
    expect(matchReadRows([{ rawAnalyteName: "Fe", valueRaw: "15" }], iron)).toEqual([-1]);
    expect(rowHasName("Ferritin 15 ug/l", "Fe")).toBe(false);
  });

  it("does not match a prefixed code inside another: S-K is not S-Kreatinin", () => {
    expect(rowHasName("S-Kreatinin 84 umol/l", "S-K")).toBe(false);
    expect(rowHasName("S-K 4,1 mmol/l", "S-K")).toBe(true);
  });

  it("still matches across Czech letters, a dropped separator and an OCR typo", () => {
    expect(rowHasName("Železo 18 umol/l", "Železo")).toBe(true);
    expect(rowHasName("S_Glukóza 5,1 mmol/l", "S_Glukóza")).toBe(true);
    expect(rowHasName("SGlukoza 5,1 mmol/l", "S_Glukóza")).toBe(true);
    expect(rowHasName("Saturace transferlnu železem 29,4 %", "Saturace transferinu železem")).toBe(true);
  });
});

describe("photoRowGuard — no frames at all on a photo that cannot be framed safely", () => {
  /** Twelve printed rows, each tilted by `deg`, three words wide. */
  const tilted = (deg: number, x0 = 100): OcrLine[] =>
    Array.from({ length: 12 }, (_, r) => {
      const t = Math.tan((deg * Math.PI) / 180);
      const y = 100 + r * 52;
      return { words: [0, 350, 700].map((dx, i) => w(`slovo${i}`, [x0 + dx, y + dx * t, x0 + dx + 120, y + dx * t + 30])) };
    });

  it("reads the tilt from the OCR word centres", () => {
    expect(textSkewDeg(tilted(0))).toBeCloseTo(0, 5);
    expect(textSkewDeg(tilted(3))).toBeCloseTo(3, 1);
    expect(textSkewDeg([])).toBeNull();
  });

  it("withholds on text tilted past the limit when the picture was not flattened", () => {
    expect(MAX_TEXT_SKEW_DEG).toBeCloseTo((Math.atan(2.25 / 160) * 180) / Math.PI, 1);
    expect(photoRowGuard(null, false, tilted(0.3), 1200, 1700)).toBeNull();
    expect(photoRowGuard(null, false, tilted(2), 1200, 1700)).toBe("skewed");
    // A flattened picture was straightened by its homography; its OCR tilt is not the photo's.
    expect(photoRowGuard(portrait, true, tilted(0.3), 1200, 1700)).toBeNull();
  });

  it("withholds on two sheets: found as one page, a landscape frame, or text in two blocks", () => {
    expect(photoRowGuard(spread, true, tilted(0), 2400, 1700)).toBe("two-sheets");
    expect(photoRowGuard(null, false, tilted(0), 1700, 1200)).toBe("two-sheets");
    const twoBlocks = [...tilted(0, 60), ...tilted(0, 1300)];
    expect(textInTwoBlocks(twoBlocks, 2200)).toBe(true);
    expect(photoRowGuard(null, false, twoBlocks, 2200, 2400)).toBe("two-sheets");
  });

  it("lets a single level sheet through, a page-wide title crossing the middle", () => {
    const one = [...tilted(0), { words: [w("Laboratoř", [100, 40, 500, 70]), w("klinické", [520, 40, 800, 70]), w("biochemie", [820, 40, 1100, 70])] }];
    expect(textInTwoBlocks(one, 1200)).toBe(false);
    expect(photoRowGuard(null, false, one, 1200, 1700)).toBeNull();
  });
});

describe("toPhotoQuad — a tenth of a pixel is enough", () => {
  it("rounds the corners to one decimal", () => {
    const toPhoto = homography([[0, 0], [1200, 0], [1200, 1700], [0, 1700]], portrait.corners);
    for (const [x, y] of toPhotoQuad([100.123, 152.456, 1060.789, 182.01], toPhoto)) {
      expect(Math.round(x * 10) / 10).toBe(x);
      expect(Math.round(y * 10) / 10).toBe(y);
    }
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
    const out = locatePhotoRows(reads, { rows, toPhoto: null, withhold: null });
    expect(out[0]?.quad).toEqual([[100, 152], [1060, 152], [1060, 182], [100, 182]]);
    expect(out[0]?.bbox).toEqual([100, 152, 1060, 182]);
    expect(out[1]).toBeNull();
  });

  it("gives no highlight at all on two sheets, even where a row would match", () => {
    expect(locatePhotoRows(reads, { rows, toPhoto: null, withhold: "two-sheets" })).toEqual([null, null]);
  });

  it("gives none without an OCR pass", () => {
    expect(locatePhotoRows(reads, null)).toEqual([null, null]);
  });

  it("carries the flattened-frame box back to the photo as a quadrilateral", () => {
    // Flattened 1200×1700 frame → a skewed page on the photo.
    const toPhoto = homography([[0, 0], [1200, 0], [1200, 1700], [0, 1700]], portrait.corners);
    const src: PhotoRowSource = { rows, toPhoto, withhold: null };
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
