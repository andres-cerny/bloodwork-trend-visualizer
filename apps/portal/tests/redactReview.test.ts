/**
 * The review screen must look like it cannot read what it painted over.
 *
 * The detector hands the screen every string it found — that is how the
 * boxes get painted and the text layer stripped — and the first version of
 * this screen listed them under the page as chips ("jméno · Jan Novák").
 * On the one screen whose job is to reassure the reader that the name goes
 * nowhere, that was the name, on screen, in our handwriting. So the markup
 * is rendered and searched: no detected string, no identity kind, only
 * "Začerněné pole N".
 *
 * Proven failing by rendering the chip-list version against the same
 * fixture: it contained "Jan Novák", "800101/0011" and "jméno".
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Box, type IdentityHit, stringsOf } from "@bw/lab-core";
import RedactReview, { hitZone } from "../src/ui/RedactReview";
import type { PreparedFile } from "../src/lib/upload";

const hits: IdentityHit[] = [
  { pageNum: 1, box: [120, 100, 260, 112], kind: "name", text: "Jan Novák" },
  { pageNum: 1, box: [120, 118, 230, 130], kind: "rodne-cislo", text: "800101/0011" },
  { pageNum: 1, box: [120, 136, 220, 148], kind: "birth-date", text: "1. 1. 1980" },
  { pageNum: 1, box: [120, 154, 330, 166], kind: "address", text: "Dlouhá 12, Praha" },
  { pageNum: 2, box: [400, 40, 540, 52], kind: "repeat", text: "Jan Novák" },
];

const page = (pageNum: number) =>
  ({
    pageNum,
    imageUrl: `blob:page-${pageNum}`,
    imageWidth: 1240,
    imageHeight: 1754,
    imageBase64: "",
    mediaType: "image/png",
    textLayer: "",
    words: [],
    rows: [],
    hasTextLayer: true,
  }) as unknown as PreparedFile["pages"][number];

const prepared: PreparedFile = { name: "vysledky.pdf", kind: "pdf", pages: [page(1), page(2)], hits, scanPages: [], truncated: 0 };

const draw = (p: PreparedFile) => renderToStaticMarkup(createElement(RedactReview, { prepared: p, onConfirm: () => {}, onCancel: () => {} }));
const render = () => draw(prepared);

describe("RedactReview", () => {
  it("renders none of the strings the detector found", () => {
    const html = render();
    for (const s of stringsOf(hits)) expect(html).not.toContain(s);
    for (const h of hits) expect(html).not.toContain(h.text);
  });

  it("names no identity kind beside a box", () => {
    const html = render();
    for (const word of ["jméno", "rodné číslo", "datum narození", "adresa", "opakování", "ručně"]) {
      expect(html.toLowerCase()).not.toContain(word);
    }
  });

  it("labels each box by its number only, as a button", () => {
    const html = render();
    expect(html).toContain('aria-label="Začerněné pole 1"');
    expect(html).toContain('aria-label="Začerněné pole 4"');
    // Page 2's one box is its first, not the fifth.
    expect(html).not.toContain("Začerněné pole 5");
    expect(html.match(/<button[^>]*class="review-hit"/g)).toHaveLength(5);
    // The painted boxes are not in the accessibility tree; the buttons are.
    expect(html.match(/class="review-box"[^>]*aria-hidden="true"/g)).toHaveLength(5);
  });

  it("carries no chip list", () => {
    expect(render()).not.toContain("review-hits");
  });
});

/**
 * A photograph reaches this screen through the scan door and no other: it is
 * in `scanPages` with an empty `hits`, which is how the screen knows that
 * nothing was found *because nothing could be looked at*.
 *
 * The two things this pins are the two ways it could go wrong. It must not
 * imply detection ran — an empty `hits` with the ordinary caption reads as "we
 * looked and your page is clean", which for a photograph is a false statement
 * about a header that is fully legible in the picture. And it must not call the
 * thing a sken, because the person just took it with their phone.
 */
const photo: PreparedFile = {
  name: "IMG_0042.jpg",
  kind: "photo",
  pages: [page(1)],
  hits: [],
  scanPages: [1],
  truncated: 0,
};

describe("RedactReview, given a photograph", () => {
  it("says nothing was found and that blacking out is the reader's job", () => {
    const html = draw(photo);
    expect(html).toContain("nic nenalezeno");
    expect(html).toContain("začerněte ručně");
  });

  it("calls it a fotografie, never a sken and never a strana", () => {
    const html = draw(photo);
    expect(html).toContain("Fotografie");
    expect(html.toLowerCase()).not.toContain("sken");
    expect(html).not.toContain("Strana 1");
  });

  it("opens with drawing already on, because drawing is the only way to redact it", () => {
    // The toggle reads "Hotovo" while drawing and "Začernit" while not.
    expect(draw(photo)).toContain('aria-pressed="true"');
    expect(draw(photo)).toContain("Hotovo");
  });

  it("still offers the confirm the flow cannot proceed without", () => {
    // No skip on this screen, for a photo least of all: `UploadFlow` renders
    // it instead of the queue and only `onConfirm` moves the file on.
    expect(draw(photo)).toContain("Ano, nahrát");
    expect(draw(photo)).toContain("Je vše osobní začerněné?");
  });

  it("presents no found box to dismiss", () => {
    expect(draw(photo)).not.toContain("Začerněné pole 1");
  });
});

describe("hitZone", () => {
  // Four boxes one printed line apart, drawn at a phone's scale: each zone
  // must be its own band, with no two overlapping, and the padding must
  // still reach where no neighbour is.
  const boxes: Box[] = hits.filter((h) => h.pageNum === 1).map((h) => h.box);
  const scale = 0.28;

  it("pads a lone box on every side to a finger's size", () => {
    const [x0, y0, x1, y1] = hitZone([[100, 100, 200, 110]], 0, scale);
    expect(x0).toBeLessThan(100);
    expect(y0).toBeLessThan(100);
    expect(x1).toBeGreaterThan(200);
    expect(y1).toBeGreaterThan(110);
    expect((y1 - y0) * scale).toBeGreaterThanOrEqual(32);
  });

  it("cuts stacked boxes at their midpoints, so no two zones overlap", () => {
    const zones = boxes.map((_, i) => hitZone(boxes, i, scale));
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const overlapH = Math.min(zones[i][3], zones[j][3]) - Math.max(zones[i][1], zones[j][1]);
        const overlapW = Math.min(zones[i][2], zones[j][2]) - Math.max(zones[i][0], zones[j][0]);
        expect(overlapH <= 0 || overlapW <= 0).toBe(true);
      }
    }
    // The middle box's band runs from the midpoint above to the midpoint below.
    expect(zones[1][1]).toBe((112 + 118) / 2);
    expect(zones[1][3]).toBe((130 + 136) / 2);
    // The top box still reaches upward, where nothing else is.
    expect(zones[0][1]).toBeLessThan(100 - 16 / scale + 1);
  });

  it("splits two boxes on one line at the gap between them", () => {
    const pair: Box[] = [
      [100, 100, 200, 112],
      [220, 100, 320, 112],
    ];
    const [a, b] = pair.map((_, i) => hitZone(pair, i, scale));
    expect(a[2]).toBe(210);
    expect(b[0]).toBe(210);
  });

  it("widens a box narrower than the ✕ to the control's width", () => {
    const [x0, , x1] = hitZone([[100, 100, 104, 110]], 0, 1);
    expect(x1 - x0).toBeGreaterThanOrEqual(32);
  });
});
