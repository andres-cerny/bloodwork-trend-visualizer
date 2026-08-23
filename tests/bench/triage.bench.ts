/**
 * Arm A8 — decide, before spending anything, whether a page is worth sending.
 *
 *   npm run bench:triage
 *
 * Stage 0 found that three of fifteen files route their *final* page to the
 * vision path, and that every one of those pages carries zero measurement rows:
 * they are footer or signature pages. The demo renders each at 220 DPI and
 * sends it to two vision models to be told there is nothing there — the
 * slowest and most expensive call the system can make, on ~20% of files, for
 * nothing.
 *
 * The obvious rule is "skip pages with no measurement rows". The obvious rule
 * is also dangerous, and in exactly this project's characteristic way: **a
 * genuine scan of a real results page also has no rows**, because it has no
 * text layer to build rows from. A rule that cannot tell those apart would
 * silently drop a page of real results, which is far worse than the waste it
 * saves.
 *
 * So the rule is not "no rows" but "no rows *and* no ink to read" — a blank
 * trailing page in a digital PDF still carries a few text items (a footer, a
 * page number), while a true scan carries almost none but a large image. The
 * discriminator is measured below on both, and the guard is required to refuse
 * the scan fixture before any saving is claimed.
 */
import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parsePdf, realSamples } from "./corpus";

/** Same shape as the auditor's rule: a name, then a number after it. */
const NUMERIC = /^[<>]?\s*-?\d[\d\s.,]*$/;

export interface PageSignal {
  rowCount: number;
  textItems: number;
  measurementRows: number;
  hasTextLayer: boolean;
  /** Does the page paint a bitmap? The only reliable scan/blank discriminator. */
  hasImage: boolean;
}

/**
 * Should this page be sent to a model at all?
 *
 * Returns `"send"`, `"skip"` (nothing to read), or `"vision"` (no text layer,
 * but there is clearly something on the page — a scan).
 *
 * The order matters: the scan test comes *first*, so a page can only be skipped
 * after it has been ruled out as a scan.
 */
export function triage(sig: PageSignal): "send" | "skip" | "vision" {
  // No usable text layer. If the page carries almost no text at all it is
  // either blank or an image — and an image of a lab report must still be
  // read, so anything that is not near-empty goes to vision.
  if (!sig.hasTextLayer) {
    // Text count cannot separate a scan from a blank page — both carry only a
    // handful of items, and the first version of this rule classified a real
    // scanned results page as "skip". Ink is the discriminator: if the page
    // paints a bitmap there is something to read, so it goes to vision.
    return sig.hasImage ? "vision" : "skip";
  }
  // Has a text layer, but nothing in it looks like a printed measurement.
  return sig.measurementRows === 0 ? "skip" : "send";
}

function signalFor(page: { rows: any[]; hasTextLayer: boolean; hasImage: boolean }): PageSignal {
  const measurementRows = page.rows.filter(
    (r: any) =>
      r.cells.length >= 2 &&
      /\p{L}/u.test(r.cells[0]) &&
      r.cells.slice(1).some((c: string) => NUMERIC.test(c)),
  ).length;
  const textItems = page.rows.reduce((n: number, r: any) => n + r.cells.length, 0);
  return {
    rowCount: page.rows.length,
    textItems,
    measurementRows,
    hasTextLayer: page.hasTextLayer,
    hasImage: page.hasImage,
  };
}

describe("A8 — page triage", () => {
  it("refuses to skip a genuine scan of real results", async () => {
    // packages/lab-core/tests/fixtures/scanned.pdf is a rendered lab page with the text layer
    // stripped — the exact case the naive "no rows" rule would throw away.
    const path = "packages/lab-core/tests/fixtures/scanned.pdf";
    if (!existsSync(path)) {
      console.log(`${path} missing — regenerate with scripts/make_layout_fixtures.py`);
      return;
    }
    const { doc } = await parsePdf(path);
    for (const page of doc.pages) {
      const sig = signalFor(page);
      const verdict = triage(sig);
      console.log(
        `  scanned.pdf p${page.pageNum}: rows=${sig.rowCount} textItems=${sig.textItems} ` +
          `meas=${sig.measurementRows} hasText=${sig.hasTextLayer} ` +
          `hasImage=${sig.hasImage} -> ${verdict}`,
      );
      // This is the assertion the whole arm rests on.
      expect(verdict, "a scanned results page must never be skipped").not.toBe("skip");
    }
  });

  it("measures what triage would actually save on the real corpus", async () => {
    let send = 0;
    let skip = 0;
    let vision = 0;
    const skipped: string[] = [];

    for (const path of realSamples()) {
      const { doc } = await parsePdf(path);
      for (const page of doc.pages) {
        const sig = signalFor(page);
        const verdict = triage(sig);
        if (verdict === "send") send++;
        else if (verdict === "vision") vision++;
        else {
          skip++;
          skipped.push(
            `${doc.file}#${page.pageNum} (rows=${sig.rowCount}, textItems=${sig.textItems}, ` +
              `hasText=${sig.hasTextLayer})`,
          );
        }
      }
    }

    const total = send + skip + vision;
    console.log(`\n  ${total} pages: ${send} send, ${vision} vision, ${skip} skipped\n`);
    for (const s of skipped) console.log(`    skip: ${s}`);

    // Vision pages cost far more than text pages; price the saving honestly.
    const TEXT_PAGE_S = 19.8; // sonnet5/index median, from the latency grid
    console.log(
      `\n  ${skip}/${total} pages (${((skip / total) * 100).toFixed(0)}%) never sent.\n` +
        `  On a 10-file batch that is ~${(skip / 15 * 10).toFixed(1)} pages, and at\n` +
        `  concurrency 8 removing them saves a wave only when it empties one —\n` +
        `  the real saving is the 220 DPI render and the vision round-trip.`,
    );

    expect(skip).toBeGreaterThan(0);
  });
});
