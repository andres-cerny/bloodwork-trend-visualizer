/**
 * Does Gemini read a photograph better at full resolution than at 2576 px?
 *
 * The question decides the shape of the browser's photo encoder. Phase E as
 * planned sends **two** encodes of one shot — 2576 px for Sonnet's image tier,
 * the uncut original for Gemini, because Gemini spends a fixed token budget per
 * image part whatever the pixels are, so a bigger picture was assumed to be
 * free detail. Free to *Gemini*; not free to the phone that has to encode it,
 * hold it in memory alongside 63 other in-flight pages, and push it over a
 * mobile uplink inside one JSON body.
 *
 * The assumption is also already in doubt. The tiled arm (docs/lab-adaptability
 * .md, "the tiled arm, and a clean negative result") gave Gemini *double* the
 * visual budget — two `ultra_high` parts, 4,784 tokens, Sonnet's number — and
 * matched exactly the same 1,621 rows as the single `ultra_high` part at half
 * the price. If more budget over the same pixels bought nothing, more pixels
 * into the same budget is unlikely to buy anything either: the budget is what
 * the model actually sees.
 *
 * So: the same pages, the same deployed `extractPageGemini`, two encodes.
 *
 *   set -a; source .env; set +a
 *   PYTHON_BIN=/path/to/.venv-mac/bin/python npm run bench:photo-edge
 *
 * Five pages, two arms, three calls each — 30 calls, roughly half a dollar.
 * Three repeats because one Gemini read is not a measurement: the abbreviation
 * question needed five calls a page before the fault showed as a rate
 * (`zkr_gemini.bench.ts`), and a single-call A/B here would report noise.
 *
 * Two page classes on purpose, because the photo corpus cannot ask the
 * question on its own:
 *
 *   photo   data/photos-sim, native long edge 3024 px — only 1.17x the 2576
 *           tier. This is the *real* ratio for the corpus we hold, and it is
 *           the honest one for a page that fills a phone frame.
 *   public  a public sheet rasterised at 440 DPI, long edge ~5090 px — 2x the
 *           tier linearly, 4x the pixels. This is the ratio a 12 MP phone shot
 *           of an A4 page actually offers, and no photo in the corpus reaches
 *           it. Without this arm the answer would be "no difference at 1.17x",
 *           which proves much less than it sounds like.
 *
 * Writes results/photo_edge.json (git-ignored, like every bench result).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { extractPageGemini, MODEL_GEMINI } from "@bw/extraction";

import { loadClass, pythonWithFitz, render, type CorpusPage } from "./corpora";
import { priceUsd } from "./extract";
import { valueErrors, type RawMeasurement } from "./score";

const OUT = "tests/bench/results";
const PAGES = join(OUT, "photo_edge_pages");
const REPEATS = Number(process.env.EDGE_REPEATS ?? 3);

/** Sonnet 5's tier, and the single edge this bench is arguing about. */
const TIER_EDGE = 2576;
/** The high-resolution arm for a vector page: ~5090 px on the long edge. */
const HI_DPI = 440;

/**
 * Three photographs, one per lab that photographs densely, in three different
 * conditions — a clean shot, a skewed one and a dark one. If resolution helps
 * anywhere it helps where the glyphs are worst, so the arms must not all be
 * the easy case.
 */
const PHOTO_SLUGS = [
  "sim__2024_02_02_p1_flat",
  "sim__2020_09_213_p1_angle",
  "sim__2023_12_19_p1_dark",
];

/** Two public sheets, for the 2x-linear ratio the photo corpus cannot offer. */
const PUBLIC_SLUGS = ["breclav_p121", "stod_p1"];

interface Arm {
  name: "tier2576" | "full";
  path: string;
  mediaType: string;
  px: string;
}

/** `w h` as PyMuPDF reads it off the encoded file, for the table. */
const probeCache = new Map<string, string>();
function dims(python: string, path: string): string {
  if (probeCache.has(path)) return probeCache.get(path)!;
  const s = execFileSync(
    python,
    ["-c", "import pymupdf,sys;p=pymupdf.Pixmap(sys.argv[1]);print(p.width,p.height)", path],
    { encoding: "utf8" },
  ).trim();
  probeCache.set(path, s);
  return s;
}

it("Gemini at 2576 px against full resolution, on the same pages", async () => {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const python: string | null = pythonWithFitz();
  if (!python) throw new Error("no Python with PyMuPDF — set PYTHON_BIN");
  const py: string = python;
  mkdirSync(PAGES, { recursive: true });

  const photos = (await loadClass("photo")).filter((p) => PHOTO_SLUGS.includes(p.slug));
  const pub = (await loadClass("public")).filter((p) => PUBLIC_SLUGS.includes(p.slug));
  const chosen = [...photos, ...pub];
  if (chosen.length !== PHOTO_SLUGS.length + PUBLIC_SLUGS.length) {
    throw new Error(`missing pages: got ${chosen.map((p) => p.slug).join(",")}`);
  }

  /** The two encodes of one page. Both arms are the *same picture*, resized. */
  function arms(page: CorpusPage): Arm[] {
    let full: string;
    let fullType: string;
    if ("file" in page.image) {
      full = page.image.file;
      fullType = /\.png$/i.test(full) ? "image/png" : "image/jpeg";
    } else {
      full = join(PAGES, `${page.slug}.hi.png`);
      render(python, page.image.pdf, page.image.page, "dpi", HI_DPI, full);
      fullType = "image/png";
    }
    const small = join(PAGES, `${page.slug}.${TIER_EDGE}.jpg`);
    render(python, full, 1, "edge", TIER_EDGE, small);
    return [
      { name: "tier2576", path: small, mediaType: "image/jpeg", px: dims(py, small) },
      { name: "full", path: full, mediaType: fullType, px: dims(py, full) },
    ];
  }

  const log: any[] = [];
  let usd = 0;

  for (const page of chosen) {
    const truth = (page.truth ?? []) as RawMeasurement[];
    for (const arm of arms(page)) {
      const b64 = readFileSync(arm.path).toString("base64");
      for (let i = 1; i <= REPEATS; i++) {
        const t0 = Date.now();
        // The deployed call, no text-layer hint: a photograph has none, and
        // handing one over would answer a different question.
        const ex = await extractPageGemini(key, MODEL_GEMINI, b64, arm.mediaType, null);
        const read = ex.measurements as unknown as RawMeasurement[];
        const s = valueErrors(read, truth, { pageKey: page.key });
        const cost = priceUsd(MODEL_GEMINI, ex.usage);
        usd += cost;
        const rec = {
          slug: page.slug,
          cls: page.cls,
          arm: arm.name,
          px: arm.px,
          bytes: Math.round(b64.length * 0.75),
          call: i,
          truthRows: s.truthRows,
          readRows: s.readRows,
          matched: s.matched,
          valueErrors: s.errors.length,
          missing: s.missing.length,
          extra: s.extra.length,
          inTokens: ex.usage.inputTokens,
          outTokens: ex.usage.outputTokens,
          ms: Date.now() - t0,
          usd: Number(cost.toFixed(4)),
          errors: s.errors,
        };
        log.push(rec);
        console.log(
          `${page.slug.padEnd(28)} ${arm.name.padEnd(9)} ${arm.px.padEnd(10)} #${i}` +
            `  truth ${rec.truthRows}  match ${rec.matched}  valERR ${rec.valueErrors}` +
            `  miss ${rec.missing}  extra ${rec.extra}  in ${rec.inTokens}` +
            `  ${(rec.ms / 1000).toFixed(1)}s  $${rec.usd}`,
        );
        for (const e of s.errors) console.log(`      ${e.name}: truth "${e.truth}" read "${e.read}"`);
      }
    }
  }

  console.log("\narm        pages calls truth match valERR miss extra  medianIn  medianMs   USD");
  for (const name of ["tier2576", "full"] as const) {
    const rows = log.filter((r) => r.arm === name);
    const sum = (f: (r: any) => number) => rows.reduce((a, r) => a + f(r), 0);
    const med = (f: (r: any) => number) => {
      const v = rows.map(f).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    };
    console.log(
      `${name.padEnd(10)} ${String(new Set(rows.map((r) => r.slug)).size).padStart(5)}` +
        ` ${String(rows.length).padStart(5)} ${String(sum((r) => r.truthRows)).padStart(5)}` +
        ` ${String(sum((r) => r.matched)).padStart(5)} ${String(sum((r) => r.valueErrors)).padStart(6)}` +
        ` ${String(sum((r) => r.missing)).padStart(4)} ${String(sum((r) => r.extra)).padStart(5)}` +
        ` ${String(med((r) => r.inTokens)).padStart(9)} ${String(med((r) => r.ms)).padStart(9)}` +
        ` ${sum((r) => r.usd).toFixed(3).padStart(5)}`,
    );
  }
  console.log(`\ntotal $${usd.toFixed(3)}`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "photo_edge.json"), JSON.stringify({ usd, repeats: REPEATS, log }, null, 1));
});
