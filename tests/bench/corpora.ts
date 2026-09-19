/**
 * The four document classes of docs/plans/lab-adaptability.md, one loader each.
 *
 *   real       samples/*.pdf — text-layer pages take the text path, scanned
 *              pages the image path; truth is data/reports (the incumbent's
 *              accepted output, so a disagreement is a case to adjudicate).
 *   synthetic  packages/lab-core/tests/fixtures/*.pdf — whatever exists at
 *              run time; truth from tests/live/fixtures.ts where a fixture
 *              has one, otherwise listed and not scored.
 *   public     tests/bench/public_sheets/<slug>.json — hand-transcribed truth
 *              (committed); the page is rendered from data/public-sheets/
 *              <source> (git-ignored) at 220 DPI, the browser's RENDER_DPI.
 *   photo      data/photos/manifest.json (phone shots of real sheets) and
 *              data/photos-sim/manifest.json (the stand-in until they exist),
 *              truth by `${source_file}#${page}` in data/reports — the same key
 *              the existing scorer uses; a `twopage` shot is the union.
 *
 * Every page says which path it takes (`kind`) and where its image comes from
 * (`image`), so a bench can decide per arm without knowing the class. Nothing
 * here touches the network; rendering goes through the scratch venv's PyMuPDF
 * exactly the way tests/live/extract.live.ts resolves `pythonWithFitz()`,
 * with `PYTHON_BIN` as the first candidate so the scratch venv is named in
 * the shell, never in code.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { type TextRow } from "@bw/lab-core";

import { FIXTURES, SCAN_FIXTURE, type Fixture } from "../live/fixtures";
import { parsePdf, realSamples } from "./corpus";
import { type Reader } from "./extract";
import { annotateMaterial, loadBaseline, type RawMeasurement } from "./score";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");

export type CorpusClass = "real" | "synthetic" | "public" | "photo";
export const CLASSES: CorpusClass[] = ["real", "synthetic", "public", "photo"];

export type ImageSource =
  /** A PDF page, rasterised at `RENDER_DPI` on demand. */
  | { pdf: string; page: number }
  /** A photo file — sent as-is to Gemini, downscaled for Claude (see `renderFor`). */
  | { file: string };

export interface CorpusPage {
  cls: CorpusClass;
  /** Filesystem-safe id, unique within the class. */
  slug: string;
  /** Baseline-style key for real and photo pages; the slug elsewhere. */
  key: string;
  /** Which path the app would take: the text layer, or a rendered image. */
  kind: "text" | "image";
  /** Text-layer rows when the page has a usable layer, whatever `kind` says. */
  rows: TextRow[] | null;
  image: ImageSource;
  /** Null when nothing to score against exists yet — listed, never scored. */
  truth: RawMeasurement[] | null;
  truthSource: string;
  meta: Record<string, unknown>;
}

/** The browser's render resolution (packages/lab-core/src/pdf/pdf.ts RENDER_DPI). */
export const RENDER_DPI = 220;
/** Sonnet 5's image tier: long edge in px. The PDF path keeps MAX_EDGE 1800. */
export const CLAUDE_PHOTO_EDGE = 2576;

const slugify = (s: string) => s.replace(/\.(pdf|jpe?g|png)$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "_");

/* -------------------------------------------------------------------- real */

/**
 * The printed rows of every real sample page, by `<file>#<page>`.
 *
 * Parsed once and shared: the photo class needs them too, because a photo's
 * truth is the baseline of the page it photographs, and the material of a
 * prefix-free urine row is only readable from that page's own headings
 * (`annotateMaterial`). Fifteen PDFs, well under a second.
 */
let sampleRowsCache: Map<string, TextRow[]> | null = null;

export async function sampleRows(): Promise<Map<string, TextRow[]>> {
  if (sampleRowsCache) return sampleRowsCache;
  const map = new Map<string, TextRow[]>();
  for (const path of realSamples()) {
    const { doc } = await parsePdf(path);
    for (const p of doc.pages) if (p.hasTextLayer) map.set(`${p.file}#${p.pageNum}`, p.rows);
  }
  return (sampleRowsCache = map);
}

export async function realPages(): Promise<CorpusPage[]> {
  const baseline = loadBaseline();
  const out: CorpusPage[] = [];
  for (const path of realSamples()) {
    const { doc } = await parsePdf(path);
    for (const p of doc.pages) {
      const key = `${p.file}#${p.pageNum}`;
      const base = baseline.get(key) ?? null;
      const truth = base ? annotateMaterial(base, p.rows) : null;
      // A trailing page with neither a text layer nor a bitmap is a footer;
      // the app skips it, so the bench does too — unless the accepted report
      // says it carried results, in which case it is worth a look.
      if (!p.hasTextLayer && !p.hasImage && !truth) continue;
      out.push({
        cls: "real",
        slug: `${slugify(p.file)}__p${p.pageNum}`,
        key,
        kind: p.hasTextLayer ? "text" : "image",
        rows: p.hasTextLayer ? p.rows : null,
        image: { pdf: path, page: p.pageNum },
        truth,
        truthSource: truth ? "data/reports" : "none",
        meta: { hasImage: p.hasImage, textLength: p.textLength },
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- synthetic */

export const FIXTURE_DIR = join(REPO, "packages/lab-core/tests/fixtures");

function fixtureTruth(fx: Fixture): RawMeasurement[] {
  return fx.rows.map((r) => ({
    raw_analyte_name: r.name,
    value_raw: r.valueRaw,
    unit_raw: r.unit,
    // The fixture truth pins name, value and unit; the range is checked by
    // the parity tests, not here.
    ref_range_raw: (r as any).refRangeRaw ?? undefined,
  }));
}

export async function syntheticPages(): Promise<CorpusPage[]> {
  if (!existsSync(FIXTURE_DIR)) return [];
  const byFile = new Map<string, Fixture>();
  for (const fx of [...FIXTURES, SCAN_FIXTURE]) byFile.set(fx.file, fx);

  const out: CorpusPage[] = [];
  for (const f of readdirSync(FIXTURE_DIR).filter((x) => x.endsWith(".pdf")).sort()) {
    const path = join(FIXTURE_DIR, f);
    const { doc } = await parsePdf(path);
    const fx = byFile.get(f);
    // A fixture's truth names one page (optional `page`, default 1); the
    // other pages of a multi-page fixture are listed without truth rather
    // than charged phantom misses.
    const truthPage = (fx as any)?.page ?? 1;
    for (const p of doc.pages) {
      const hasTruth = !!fx && p.pageNum === truthPage;
      out.push({
        cls: "synthetic",
        slug: doc.pages.length > 1 ? `${slugify(f)}__p${p.pageNum}` : slugify(f),
        key: `${f}#${p.pageNum}`,
        kind: p.hasTextLayer ? "text" : "image",
        rows: p.hasTextLayer ? p.rows : null,
        image: { pdf: path, page: p.pageNum },
        truth: hasTruth ? fixtureTruth(fx!) : null,
        truthSource: hasTruth ? "tests/live/fixtures.ts" : "none",
        meta: { why: fx?.why ?? null, hasImage: p.hasImage },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ public */

export const PUBLIC_TRUTH_DIR = join(REPO, "tests/bench/public_sheets");
export const PUBLIC_PDF_DIR = process.env.PUBLIC_SHEETS_DIR ?? join(REPO, "data/public-sheets");

export interface PublicSheet {
  slug: string;
  source: string;
  page: number;
  language?: string;
  conventions?: string[];
  rows: Array<RawMeasurement & { flag_raw?: string; abbr?: string; material?: string; section?: string; group?: string }>;
}

export function publicPages(): CorpusPage[] {
  if (!existsSync(PUBLIC_TRUTH_DIR)) return [];
  const out: CorpusPage[] = [];
  for (const f of readdirSync(PUBLIC_TRUTH_DIR).filter((x) => x.endsWith(".json") && x !== "manifest.json").sort()) {
    const sheet = JSON.parse(readFileSync(join(PUBLIC_TRUTH_DIR, f), "utf8")) as PublicSheet;
    if (!sheet || !Array.isArray(sheet.rows) || !sheet.source) continue;
    const pdf = join(PUBLIC_PDF_DIR, sheet.source);
    out.push({
      cls: "public",
      slug: slugify(sheet.slug ?? f),
      key: `${sheet.source}#${sheet.page}`,
      kind: "image",
      rows: null,
      image: { pdf, page: sheet.page },
      // `section`, `group` and `material` are printed context, not a reader's
      // answer: the scorer's D0 scope rule reads them (score.ts,
      // `scopeExclusion`) and nothing else does.
      truth: sheet.rows.map((r) => ({
        raw_analyte_name: r.raw_analyte_name,
        value_raw: r.value_raw,
        unit_raw: r.unit_raw,
        ref_range_raw: r.ref_range_raw,
        ...(r.section ? { section: r.section } : {}),
        ...(r.group ? { group: r.group } : {}),
        ...(r.material ? { material: r.material } : {}),
      })),
      truthSource: `tests/bench/public_sheets/${f}`,
      meta: {
        language: sheet.language ?? null,
        conventions: sheet.conventions ?? [],
        available: existsSync(pdf),
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------- photo */

export interface PhotoEntry {
  file: string;
  source_file: string;
  page?: number;
  pages?: number[];
  condition?: string;
}

/**
 * The manifest shape is young. data/photos-sim writes an object keyed by
 * filename (`{"x_p1_flat.jpg": {source_file, pages, condition}}`); a bare
 * array or `{files:[…]}` of entries carrying their own `file` is accepted too.
 */
function readManifest(dir: string): PhotoEntry[] {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return [];
  const m = JSON.parse(readFileSync(path, "utf8"));
  let list: any[];
  if (Array.isArray(m)) list = m;
  else if (Array.isArray(m.files ?? m.photos ?? m.entries)) list = m.files ?? m.photos ?? m.entries;
  else list = Object.entries(m).map(([file, e]: [string, any]) => ({ file, ...(e ?? {}) }));
  return list.filter((e) => e && e.file && e.source_file);
}

export async function photoPages(): Promise<CorpusPage[]> {
  const baseline = loadBaseline();
  const printed = await sampleRows();
  const out: CorpusPage[] = [];
  const dirs = process.env.PHOTO_DIR
    ? [{ dir: process.env.PHOTO_DIR, set: basename(process.env.PHOTO_DIR) }]
    : [
        { dir: join(REPO, "data/photos"), set: "real" },
        { dir: join(REPO, "data/photos-sim"), set: "sim" },
      ];
  for (const { dir, set } of dirs) {
    for (const e of readManifest(dir)) {
      const pages = e.pages ?? [e.page ?? 1];
      const src = e.source_file.split(/[\\/]/).pop() ?? e.source_file;
      const keys = pages.map((p) => `${src}#${p}`);
      // Each page's baseline rows are annotated with the material *that page*
      // prints, before a two-page shot unions them — the headings differ.
      const truth = keys.flatMap((k) => annotateMaterial(baseline.get(k) ?? [], printed.get(k)));
      const file = join(dir, e.file);
      out.push({
        cls: "photo",
        slug: `${set}__${slugify(e.file)}`,
        key: keys.join("+"),
        kind: "image",
        rows: null,
        image: { file },
        truth: keys.some((k) => baseline.has(k)) ? truth : null,
        truthSource: "data/reports",
        meta: { set, condition: e.condition ?? null, pages, available: existsSync(file) },
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- together */

export async function loadClass(cls: CorpusClass): Promise<CorpusPage[]> {
  switch (cls) {
    case "real":
      return realPages();
    case "synthetic":
      return syntheticPages();
    case "public":
      return publicPages();
    case "photo":
      return photoPages();
  }
}

/* --------------------------------------------------------------- rendering */

/**
 * A Python that can rasterise. Same candidates as tests/live/extract.live.ts,
 * `PYTHON_BIN` first — that is where the scratch venv goes.
 */
export function pythonWithFitz(): string | null {
  const candidates = [
    process.env.PYTHON_BIN,
    join(REPO, ".venv-mac/bin/python"),
    join(REPO, ".venv/bin/python"),
    "python3.11",
    "python3",
  ].filter(Boolean) as string[];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["-c", "import pymupdf"], { stdio: "ignore" });
      return bin;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * One script for both jobs: a PDF page at a DPI, or an image file capped to a
 * long edge. PyMuPDF opens a JPEG/PNG as a one-page document whose rect is
 * its pixel size, so the same matrix arithmetic scales either. JPEG output
 * when the target ends in .jpg (photos), PNG otherwise (renders, dumps).
 */
const RENDER_PY = `
import pymupdf, sys
src, page, mode, arg, out = sys.argv[1:6]
doc = pymupdf.open(src)
pg = doc[int(page) - 1]
if mode == "dpi":
    s = float(arg) / 72
else:
    # An image document's rect is in points scaled by the file's DPI metadata
    # (a 96 DPI JPEG opens at 0.75x its pixels), so base the scale on the
    # true pixel size or a photo under the cap would be shrunk anyway.
    px = pymupdf.Pixmap(src)
    base = px.width / pg.rect.width
    s = base * min(1.0, float(arg) / max(px.width, px.height))
pix = pg.get_pixmap(matrix=pymupdf.Matrix(s, s), alpha=False)
if out.lower().endswith(".jpg"):
    pix.save(out, jpg_quality=85)
else:
    pix.save(out)
print(pix.width, pix.height)
`;

export interface Rendered {
  path: string;
  mediaType: "image/png" | "image/jpeg";
  width?: number;
  height?: number;
}

/**
 * The bytes a reader gets. Claude: a 220 DPI render, or a photo downscaled
 * to its 2576 px tier. Gemini: the same render, or the untouched photo —
 * "if Gemini can see more pixels, give it a clear picture". Mistral OCR takes
 * the same bytes as Gemini and for a blunter reason: it is billed per page
 * whatever the pixels are, so there is nothing to save by shrinking one.
 * Cached under `outDir` so a second arm never pays the render twice.
 */
export function renderFor(page: CorpusPage, provider: NonNullable<Reader["provider"]>, outDir: string, python: string | null): Rendered {
  mkdirSync(outDir, { recursive: true });
  if ("file" in page.image) {
    const mediaType = /\.png$/i.test(page.image.file) ? "image/png" : "image/jpeg";
    // Gemini and Mistral OCR take the untouched photo; Claude and the
    // free-tier chat endpoints (openai_compat.ts, "Images") the 2576 px tier.
    if (provider === "google" || provider === "mistral") return { path: page.image.file, mediaType };
    const out = join(outDir, `${page.slug}.claude.jpg`);
    if (!existsSync(out)) render(python, page.image.file, 1, "edge", CLAUDE_PHOTO_EDGE, out);
    return { path: out, mediaType: "image/jpeg" };
  }
  const out = join(outDir, `${page.slug}.png`);
  if (!existsSync(out)) render(python, page.image.pdf, page.image.page, "dpi", RENDER_DPI, out);
  return { path: out, mediaType: "image/png" };
}

/**
 * Rasterise one page at a named resolution. Exported so an arm that needs a
 * resolution other than its provider's default — the photo-edge measurement,
 * for one — asks for it here rather than restating the PyMuPDF call.
 */
export function render(python: string | null, src: string, page: number, mode: "dpi" | "edge", arg: number, out: string): void {
  if (!python) throw new Error("no Python with PyMuPDF — set PYTHON_BIN to the scratch venv's python");
  if (!existsSync(src)) throw new Error(`missing source ${src}`);
  execFileSync(python, ["-c", RENDER_PY, src, String(page), mode, String(arg), out], { stdio: ["ignore", "ignore", "inherit"] });
}
