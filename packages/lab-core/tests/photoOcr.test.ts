/**
 * The photo OCR adapter and the lab-sheet score (docs/plans/photo-capture.md,
 * D2 and D4).
 *
 * The fixture is shaped on what Tesseract (tesseract.js 7, `ces`) actually
 * returned for a flattened simulated photo — word boxes, a label split into
 * two words, a line whose value sits 10 px higher than its label, a table rule
 * read as a leading `l`. Every identity in it is invented (the "Ukázka" family
 * the redaction tests use); no recorded text is copied.
 */
import { describe, expect, it } from "vitest";
import { findIdentity } from "../src/redact";
import { LAB_SHEET_MIN, labSheetScore, ocrPhrases, type OcrLine } from "../src/photoOcr";
import type { Box } from "../src/models";

const w = (text: string, box: Box, conf = 95) => ({ text, conf, box });

/** A lab sheet's header and three result rows, as Tesseract lines. */
export const HEADER: OcrLine[] = [
  {
    words: [
      w("Oddělení", [401, 172, 510, 195]),
      w("klinické", [521, 172, 610, 195]),
      w("Datum", [895, 176, 980, 198]),
      w("narození:", [991, 176, 1092, 199]),
      w("12.03.1985", [1135, 177, 1282, 200], 78),
    ],
  },
  {
    // The value sits higher and taller than its label: an accent and a
    // descender, which is what split the row before the line-y step.
    words: [w("Pacient:", [498, 217, 592, 241]), w("Jana", [659, 207, 765, 251]), w("Ukázková", [778, 215, 897, 252])],
  },
  {
    // A table rule read as a leading "l" glued to the label.
    words: [w("lRodné", [905, 268, 1018, 291]), w("číslo:", [1028, 269, 1092, 292]), w("855312/0004", [1206, 266, 1425, 295], 92)],
  },
  { words: [w("Vyšetření", [159, 355, 300, 391]), w("Výsledek", [623, 362, 749, 390]), w("Jednotka", [798, 363, 926, 386]), w("Ref.", [1003, 362, 1060, 385]), w("meze", [1070, 363, 1150, 386])] },
  { words: [w("S_Glukóza", [159, 447, 330, 474]), w("5,21", [659, 449, 713, 475]), w("mmol/l", [833, 451, 920, 469], 40), w("3,90", [1051, 453, 1093, 473]), w("-", [1143, 463, 1152, 467]), w("5,60", [1198, 454, 1244, 474])] },
  { words: [w("S_Kreatinin", [159, 490, 350, 518]), w("81,4", [657, 492, 712, 518]), w("µmol/l", [833, 494, 920, 512], 13), w("44,0", [1049, 495, 1093, 516]), w("-", [1143, 505, 1152, 509]), w("104,0", [1198, 496, 1255, 516])] },
  { words: [w("B_Hemoglobin", [158, 533, 367, 561]), w("141,0", [656, 534, 720, 560]), w("g/l", [832, 528, 870, 565], 76), w("135,0", [1050, 539, 1110, 559]), w("-", [1143, 545, 1152, 549]), w("175,0", [1198, 540, 1255, 560])] },
];

describe("ocrPhrases", () => {
  it("is what lets findIdentity read a photo: raw words lose the labels", () => {
    const raw = HEADER.flatMap((l) => l.words.map((x) => ({ text: x.text, box: x.box })));
    const bare = findIdentity([{ pageNum: 1, words: raw }]).hits.map((h) => h.kind).sort();
    const adapted = findIdentity([{ pageNum: 1, words: ocrPhrases(HEADER) }]).hits.map((h) => h.kind).sort();
    // The rodné číslo is recognised bare by its shape, and "Pacient:" is one
    // word; "Datum narození:" is two, and only the adapter keeps it a label.
    expect(bare).not.toContain("birth-date");
    expect(adapted).toEqual(["birth-date", "name", "rodne-cislo"]);
  });

  it("merges words across a space and not across a column gap", () => {
    const texts = ocrPhrases(HEADER).map((p) => p.text);
    expect(texts).toContain("Datum narození:");
    expect(texts).toContain("Oddělení klinické");
    // A result and its unit are separate columns, as pdf.js gives them.
    expect(texts).toContain("5,21");
    expect(texts).toContain("mmol/l");
  });

  it("gives every phrase on a line the line's median top and bottom", () => {
    const line = ocrPhrases([HEADER[1]]);
    expect(new Set(line.map((p) => `${p.box[1]}:${p.box[3]}`)).size).toBe(1);
  });

  it("drops a border glyph only before a capitalised word", () => {
    const p = ocrPhrases([
      { words: [w("lRodné", [0, 0, 60, 20]), w("číslo:", [65, 0, 120, 20])] },
      { words: [w("lipidy", [0, 40, 60, 60])] },
      { words: [w("|Pacient:", [0, 80, 90, 100])] },
    ]).map((x) => x.text);
    expect(p).toEqual(["Rodné číslo:", "lipidy", "Pacient:"]);
  });

  it("returns nothing for nothing, and skips empty words", () => {
    expect(ocrPhrases([])).toEqual([]);
    expect(ocrPhrases([{ words: [w(" ", [0, 0, 5, 5])] }])).toEqual([]);
  });
});

describe("labSheetScore", () => {
  const lines = (ls: OcrLine[]) => ls.map((l) => l.words.map((x) => x.text).join(" "));

  it("passes a lab sheet", () => {
    const s = labSheetScore(lines(HEADER));
    expect(s.units).toBeGreaterThanOrEqual(3);
    expect(s.headers).toBeGreaterThanOrEqual(2);
    expect(s.lab).toBe(true);
  });

  it("warns on a receipt, a blank page and OCR noise", () => {
    const receipt = ["TESCO Praha 4", "Rohlík 4 ks 12,00", "Mléko 1 l 24,90", "DPH 12 % 3,99", "Celkem 40,89 Kč", "Děkujeme"];
    expect(labSheetScore(receipt).lab).toBe(false);
    expect(labSheetScore([]).score).toBe(0);
    expect(labSheetScore(["ll | i — ;", "ÍŇ 1 2 3", "x x x"]).lab).toBe(false);
  });

  it("reads a Slovak sheet as a lab sheet — a foreign lab is still a lab", () => {
    const sk = ["Vyšetrenie Výsledok Jednotky Referenčné hodnoty", "Glukóza 5,1 mmol/l 3,9 - 5,6", "Kreatinín 78 µmol/l 44 - 104", "Hemoglobín 139 g/l 120 - 160"];
    expect(labSheetScore(sk).score).toBeGreaterThanOrEqual(LAB_SHEET_MIN);
  });
});
