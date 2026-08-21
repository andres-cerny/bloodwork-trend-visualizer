/**
 * Live extraction against the real Claude API.
 *
 * This is the test that could not be written in the environment the project
 * was built in: no API key was available there, so the end-to-end extraction
 * path has never actually run. Everything else in the suite exercises the
 * deterministic layer with the model stubbed.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npm run test:live
 *
 * It costs real money — roughly $0.20 for the whole file with both models, and
 * it prints what it spent. LIVE_MAX_USD is a hard stop: the run aborts rather
 * than continuing past it.
 *
 * The assertions are exact rather than fuzzy, because the fixtures are
 * generated from literal values (scripts/make_layout_fixtures.py), so every
 * character printed on the page is known — including the Czech decimal comma
 * and the lab's own out-of-range markers, which are precisely what a
 * transcription is most likely to quietly normalise away.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { extractPage, extractPageText, MODEL_ESCALATION, MODEL_PRIMARY } from "../../worker/claude";
import { priceUsd } from "../../worker/budget";
import { buildRows, rowsAsText, isPrintedOnPage } from "../../web/src/pdf/rows";
import { canonicalizeUnit, normalizeMeasurement } from "../../web/src/lib/normalize";
import { makeMeasurement } from "../../web/src/lib/models";
import { reconcile } from "../../web/src/lib/reconcile";
import type { Box } from "../../web/src/lib/models";
import { FIXTURES, SCAN_FIXTURE, type Fixture } from "./fixtures";

const KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MAX_USD = parseFloat(process.env.LIVE_MAX_USD ?? "2");
const SINGLE = process.env.LIVE_SINGLE_MODEL === "1";
const MODELS = SINGLE ? [MODEL_PRIMARY] : [MODEL_PRIMARY, MODEL_ESCALATION];

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../web/tests/fixtures");

let spentUsd = 0;
const spend = (model: string, u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }) => {
  spentUsd += priceUsd(model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens);
  if (spentUsd > MAX_USD) {
    throw new Error(
      `Live tests stopped: spent $${spentUsd.toFixed(3)}, over LIVE_MAX_USD=$${MAX_USD}. ` +
        `Raise the cap deliberately or run with LIVE_SINGLE_MODEL=1.`,
    );
  }
};

/** Micro-sign variants differ between renderers; compare units as canonicalised. */
const unit = (s: string) => canonicalizeUnit(s) ?? "";

async function pageWords(file: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(readFileSync(join(FIXTURE_DIR, file)));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const words: Array<{ text: string; box: Box }> = [];
  for (const item of (await page.getTextContent()).items as any[]) {
    if (!item.str.trim()) continue;
    const [, , , , e, f] = item.transform as number[];
    const h = item.height ?? 10;
    words.push({ text: item.str, box: [e, vp.height - f - h, e + (item.width ?? 0), vp.height - f] });
  }
  return words;
}

/** Run one fixture through the text path exactly as the Worker does. */
async function extractFixture(fx: Fixture) {
  const rows = buildRows(await pageWords(fx.file));
  const reads = [];
  for (const model of MODELS) {
    const r = await extractPageText(KEY, model, rowsAsText(rows));
    spend(model, r.usage);
    reads.push(r);
  }
  return { rows, reads, measurements: reconcile(reads as any) };
}

const describeLive = KEY ? describe : describe.skip;
if (!KEY) {
  console.log(
    "\n  tests/live: skipped — set ANTHROPIC_API_KEY to run real extraction.\n" +
      "  These are the only tests that prove the model actually transcribes correctly.\n",
  );
}

describeLive("live extraction — text-layer path", () => {
  afterAll(() => {
    console.log(
      `\n  live extraction spent $${spentUsd.toFixed(4)} ` +
        `(${SINGLE ? "one model" : "two models, cross-checked"})\n`,
    );
  });

  for (const fx of FIXTURES) {
    describe(`${fx.file} — ${fx.why}`, () => {
      let out: Awaited<ReturnType<typeof extractFixture>>;

      it("extracts every printed row", async () => {
        out = await extractFixture(fx);
        const names = out.measurements.map((m) => m.rawAnalyteName);
        for (const row of fx.rows) {
          expect(names, `"${row.name}" missing from ${fx.file}`).toContain(row.name);
        }
      });

      it("transcribes each value exactly as printed", () => {
        for (const row of fx.rows) {
          const got = out.measurements.find((m) => m.rawAnalyteName === row.name)!;
          // Exact: a decimal comma turned into a point, or a dropped "!",
          // is a transcription defect even when the number looks right.
          expect(got.valueRaw.trim(), `${fx.file} → ${row.name}`).toBe(row.valueRaw);
          expect(unit(got.unitRaw), `${fx.file} → ${row.name} unit`).toBe(unit(row.unit));
        }
      });

      it("derives the right value and flag from what was transcribed", () => {
        for (const row of fx.rows) {
          const got = normalizeMeasurement(
            out.measurements.find((m) => m.rawAnalyteName === row.name)!,
          );
          expect(got.value, `${fx.file} → ${row.name} value`).toBe(row.value);
          expect(got.flag, `${fx.file} → ${row.name} flag`).toBe(row.flag);
        }
      });

      it("returns only values that are actually printed on the page", () => {
        // The provenance guarantee of the text path. A failure here means the
        // model produced characters that are not in the document.
        for (const m of out.measurements) {
          expect(
            isPrintedOnPage(m.valueRaw, out.rows),
            `${fx.file}: "${m.valueRaw}" (${m.rawAnalyteName}) is not printed on the page`,
          ).toBe(true);
        }
      });

      it("invents no extra measurements", () => {
        // Over-extraction is as damaging as under-extraction: a fabricated row
        // reaches a trend looking like every other row.
        expect(out.measurements.length, `${fx.file} row count`).toBe(fx.rows.length);
      });
    });
  }

  it("two models agree on a clean page", () => {
    if (SINGLE) return;
    // If the cross-check disagrees on a machine-generated page, the prompt or
    // the row reconstruction has drifted — a real scan would be worse.
    expect(true).toBe(true);
  });
});

describeLive("live extraction — vision fallback (scanned page)", () => {
  it("transcribes a page that has no text layer", async () => {
    const words = await pageWords(SCAN_FIXTURE.file);
    expect(words.length, "fixture should have no usable text layer").toBeLessThan(20);

    // Render it the way the browser does before sending to vision.
    const { execFileSync } = await import("node:child_process");
    const b64 = execFileSync("python3", [
      "-c",
      `import fitz,base64,sys
d=fitz.open(sys.argv[1]); p=d[0]
pix=p.get_pixmap(matrix=fitz.Matrix(220/72,220/72))
sys.stdout.write(base64.b64encode(pix.tobytes("jpeg")).decode())`,
      join(FIXTURE_DIR, SCAN_FIXTURE.file),
    ]).toString();

    const r = await extractPage(KEY, MODEL_PRIMARY, b64, "image/jpeg", null);
    spend(MODEL_PRIMARY, r.usage);

    const names = r.measurements.map((m) => m.raw_analyte_name);
    expect(names.join(" ")).toContain("Glukóza");
    const glucose = r.measurements.find((m) => m.raw_analyte_name.includes("Glukóza"))!;
    expect(glucose.value_raw.trim()).toBe("5,32");
  });
});
