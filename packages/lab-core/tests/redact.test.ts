/**
 * The identity detector, on hand-built text layers shaped like pdf.js output.
 *
 * The property worth proving is not "the header is found" — it is that
 * nothing identifying survives into what leaves the browser, including the
 * occurrences that carry no label. The footer case below was written before
 * the sweep pass existed and failed against label-only detection; it is the
 * fault this file exists to keep out.
 */
import { describe, expect, it } from "vitest";
import {
  type Box,
  buildRows,
  canRedact,
  findIdentity,
  identityVariants,
  stripIdentity,
  survivingIdentity,
  sweepRepeats,
} from "@bw/lab-core";

/** One printed item, as pdf.js reports it: 5px per glyph, 10px tall. */
const w = (text: string, x: number, y: number) => ({
  text,
  box: [x, y, x + text.length * 5, y + 10] as Box,
});

/** Padding rows, so a page clears the text-layer floor the way a real one does. */
const filler = (fromY: number) =>
  Array.from({ length: 14 }, (_, i) => [
    w(`S_Parametr${i}`, 50, fromY + i * 19),
    w("5,32", 250, fromY + i * 19),
    w("mmol/l", 330, fromY + i * 19),
    w("(4,11-5,60)", 420, fromY + i * 19),
  ]).flat();

const header = [
  w("Laboratoř Vzor a.s.", 50, 55),
  w("Pacient: Jan Ukázka", 50, 74),
  w("Rodné číslo: 800101/0006", 300, 74),
  w("Datum narození: 1. 1. 1980", 50, 88),
  w("Bydliště: Dlouhá 12, Praha 1", 300, 88),
  w("Datum odběru: 3.6.2025", 50, 102),
];

const page = (words: ReturnType<typeof w>[]) => [{ pageNum: 1, words }];

describe("label-anchored header", () => {
  const { hits, strings } = findIdentity(page([...header, ...filler(130)]));
  const texts = (kind: string) => hits.filter((h) => h.kind === kind).map((h) => h.text);

  it("finds each identifier by its label, and only the value", () => {
    expect(texts("name")).toEqual(["Jan Ukázka"]);
    expect(texts("rodne-cislo")).toEqual(["800101/0006"]);
    expect(texts("birth-date")).toEqual(["1. 1. 1980"]);
    expect(texts("address")).toEqual(["Dlouhá 12, Praha 1"]);
  });

  it("leaves the draw date alone — it is not identity, and the trend needs it", () => {
    expect(strings.some((s) => s.includes("3.6.2025") || s.includes("2025"))).toBe(false);
  });

  it("boxes the value, not the label in front of it", () => {
    const name = hits.find((h) => h.kind === "name")!;
    // "Pacient: " is nine glyphs of the item that starts at x=50. The fixture
    // draws every glyph 5px wide; the real model gives "Pacient: " less than
    // that (narrow i, t, colon, space) plus a glyph of bleed, so the box may
    // start inside the label's tail — but never over its head, and never
    // past the value.
    expect(name.box[0]).toBeGreaterThan(50 + 5 * 5);
    expect(name.box[0]).toBeLessThan(50 + 9 * 5);
    expect(name.box[2]).toBeGreaterThanOrEqual(50 + "Pacient: Jan Ukázka".length * 5 - 5);
  });

  it("finds the value in the next item when the label ends its own", () => {
    const split = page([
      w("Pacient:", 50, 74),
      w("Novák Jan", 95, 74),
      w("Rodné číslo:", 300, 74),
      w("800101/0006", 365, 74),
      w("Datum odběru:", 50, 88),
      w("3.6.2025", 120, 88),
      ...filler(130),
    ]);
    const { hits } = findIdentity(split);
    expect(hits.find((h) => h.kind === "name")?.text).toBe("Novák Jan");
    expect(hits.find((h) => h.kind === "rodne-cislo")?.text).toBe("800101/0006");
    // The name stops at the next label rather than swallowing the draw date.
    expect(hits.find((h) => h.kind === "name")?.text).not.toContain("3.6.2025");
  });
});

describe("bare rodné číslo", () => {
  it("is recognised without a label when it decodes to a date", () => {
    const { hits } = findIdentity(page([w("800101/0006", 400, 800), ...filler(130)]));
    expect(hits.map((h) => h.kind)).toContain("rodne-cislo");
  });

  it("does not mistake a sample number for one", () => {
    // 99 is not a month in any of the four series the number can encode.
    const { hits } = findIdentity(page([w("999999/9999", 400, 800), ...filler(130)]));
    expect(hits).toEqual([]);
  });
});

describe("the sweep: an identifier printed again without its label", () => {
  const words = [
    ...header,
    ...filler(130),
    // The footer a real report carries: name first-name-last, then surname
    // first in capitals, then the number without its slash.
    w("Jan Ukázka", 50, 800),
    w("UKÁZKA Jan", 200, 800),
    w("8001010006", 400, 800),
  ];

  it("is boxed in every spelling — the fault the sweep exists for", () => {
    const { hits } = findIdentity(page(words));
    const footer = hits.filter((h) => h.box[1] >= 800);
    expect(footer.map((h) => h.text).sort()).toEqual(["8001010006", "Jan Ukázka", "UKÁZKA Jan"]);
  });

  it("leaves nothing identifying in the stripped text layer", () => {
    const { hits, strings } = findIdentity(page(words));
    const left = stripIdentity(words, hits, strings);
    expect(survivingIdentity(left, strings)).toEqual([]);
    // The lab rows are untouched.
    expect(buildRows(left).some((r) => r.cells.join(" ").includes("S_Parametr3 5,32"))).toBe(true);
  });

  it("does not sweep when nothing was found — there is nothing to look for", () => {
    const clean = filler(130);
    expect(sweepRepeats(page(clean), [])).toEqual([]);
  });
});

describe("variants", () => {
  it("covers the spellings a report uses", () => {
    expect(identityVariants("Jan Novák")).toEqual(expect.arrayContaining(["Jan Novák", "Novák Jan", "Jan", "Novák"]));
    expect(identityVariants("800101/0006")).toEqual(expect.arrayContaining(["800101/0006", "8001010006", "800101 / 0006"]));
    expect(identityVariants("1. 1. 1980")).toEqual(expect.arrayContaining(["1. 1. 1980", "1.1.1980"]));
  });

  it("drops fragments too short to mean anything", () => {
    expect(identityVariants("Li Wu")).not.toContain("Li");
  });
});

describe("canRedact", () => {
  it("refuses a page whose text layer is too thin to verify", () => {
    expect(canRedact(header)).toBe(false);
    expect(canRedact([...header, ...filler(130)])).toBe(true);
  });
});

/*
 * The same detector on a real PDF text layer through real pdf.js — the shape
 * the browser actually hands it, split into items where pdf.js decides to
 * split them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

async function fixturePage(file: string): Promise<{ text: string; box: Box }[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", file)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false }).promise;
  const pg = await doc.getPage(1);
  const content = await pg.getTextContent();
  const viewport = pg.getViewport({ scale: 1 });
  const words: Array<{ text: string; box: Box }> = [];
  for (const item of content.items as any[]) {
    const str: string = item.str ?? "";
    if (!str.trim()) continue;
    const [, , , , e, f] = item.transform as number[];
    const h = item.height ?? 10;
    const y0 = viewport.height - f - h;
    words.push({ text: str, box: [e, y0, e + (item.width ?? 0), y0 + h] });
  }
  return words;
}

describe("identity.pdf through pdf.js", () => {
  it("clears the header and the unlabelled footer, and leaves the lab rows", async () => {
    const words = await fixturePage("identity.pdf");
    expect(canRedact(words)).toBe(true);
    const { hits, strings } = findIdentity([{ pageNum: 1, words }]);

    const kinds = new Set(hits.map((h) => h.kind));
    expect([...kinds].sort()).toEqual(["address", "birth-date", "name", "repeat", "rodne-cislo"]);
    // The footer sits at y≈800 in PDF units; both its items are boxed.
    expect(hits.filter((h) => h.box[1] > 780).map((h) => h.text).sort()).toEqual(["8001010006", "Jan Novák"]);

    const left = stripIdentity(words, hits, strings);
    expect(survivingIdentity(left, strings)).toEqual([]);
    const rows = buildRows(left).map((r) => r.cells.join(" | "));
    expect(rows.some((r) => r.includes("S_Glukóza | 5,32"))).toBe(true);
    expect(rows.some((r) => r.includes("Datum odběru"))).toBe(true);
  });

  it("refuses the scanned fixture: nothing to search, so nothing to promise", async () => {
    expect(canRedact(await fixturePage("scanned.pdf"))).toBe(false);
  });
});
