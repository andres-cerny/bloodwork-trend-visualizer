/**
 * Phase C of docs/plans/lab-adaptability.md — every document class through
 * every reader arm, scored per class in columns that are never averaged.
 *
 *   BENCH_DRY_RUN=1 npm run bench:adapt          free — the plan, page counts,
 *                                                 the cost estimate per arm, one
 *                                                 Gemini request shape; no client
 *                                                 is constructed, no key needed
 *   set -a; source .env; set +a
 *   BENCH_MAX_USD=5 npm run bench:adapt          paid — proposed to Ondřej with
 *                                                 the dry run's estimate first
 *
 *   BENCH_REMAP=1 npm run bench:adapt            free — re-map the persisted OCR
 *                                                 outputs with today's mapping
 *                                                 code and re-score them
 *                                                 against the same truth. No
 *                                                 call is made and no key is
 *                                                 needed; see `printRemap`.
 *
 * Knobs: BENCH_CLASSES=real,synthetic,public,photo  BENCH_ARMS=sonnet5,gemini38_ultra
 *        BENCH_MAX_USD (default 15, the hard stop)  BENCH_FRESH=1 (ignore persisted outputs)
 *        PYTHON_BIN (a python with PyMuPDF, for rendering)  PHOTO_DIR  PUBLIC_SHEETS_DIR
 *        MISTRAL_IN_FLIGHT (default 2 — the OCR provider's rate limit, not ours)
 *
 * Arms are declared once, in ARMS. A single arm names one reader and which
 * inputs it takes — Gemini is a photo reader, so it never sees a text page
 * (Gemini on the text path is out of scope). A pair arm names two single
 * arms and is computed offline from their persisted outputs, so a pair never
 * pays a second time and the Sonnet+Gemini table can be built from a
 * subagent-free Gemini run plus whatever Sonnet outputs exist ("Paying twice").
 *
 * Raw outputs persist to results/adapt/<arm>/<slug>.json and are reused on
 * the next run unless BENCH_FRESH=1; every call is one line of
 * results/adapt.jsonl. Scores go to results/adapt/scores.jsonl and to the
 * tables below, which are hand-copied into docs/lab-adaptability.md.
 *
 * ## A stored run is fully re-judgeable
 *
 * Each persisted record now carries `call.raw` — the provider's own answer,
 * not only our mapping of it (extract.ts, `RawAnswer`; for Mistral OCR the
 * page markdown, its tables and the block confidences, truncated per field at
 * RAW_FIELD_MAX with the cut recorded in the file). It is set only where there
 * is a real one: the LLM arms return our tool schema, so their `extraction`
 * already *is* their answer and `raw` stays unset rather than restating it.
 *
 * Why that is worth the kilobytes. For the OCR arms the accuracy of the arm is
 * our mapping code, not the model, so every mapping change has to be re-judged
 * against answers we have already paid for. Before this field the only route
 * back was `source_snippet`, and a snippet exists only for a row the *old*
 * mapping kept: BENCH_REMAP could move a row from wrong to right and never
 * from absent to present, a page whose table the old mapping rejected scored
 * zero forever, and the one real mapping bug found so far was precisely a bug
 * that dropped rows — the failure mode the re-judging route was blind to. With
 * `raw`, `remapFromRaw` re-runs the whole page through today's mapping and the
 * dropped rows come back. `printRemap` prefers it and says, per class, how many
 * pages it had; records written before this field fall back to the snippet
 * route and carry its caveats, which are printed with them.
 *
 * Columns per class:
 *   text pages   matched / missing / extra / valΔ against the baseline,
 *                fabrications against the printed rows, collapsed + decensored
 *   image pages  matched / missing / extra, VALUE ERRORS against hand-verified
 *                truth (column 2 for images), decensored
 *   every page   MERGED rows — two printed rows fused into one record, the
 *                fault that disqualified Docling (score.ts, `mergedRows`).
 *                Printed for every arm, not only the layout parsers: a column
 *                that only ever appears beside the suspect is not a control.
 *   pairs        confirmed, flagged, UNCAUGHT value errors (must be 0), caught,
 *                single-reader pages (one read missing — every row flagged)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { MODEL_ESCALATION, MODEL_PRIMARY } from "@bw/extraction";
import { rowsAsText } from "@bw/lab-core";

import { CLASSES, loadClass, pythonWithFitz, renderFor, type CorpusClass, type CorpusPage } from "./corpora";
import { type CallResult, type Reader } from "./extract";
import {
  GEMINI_MODEL,
  IMAGE_TOKENS,
  TILED_IMAGE_TOKENS,
  describeRequest,
  geminiRequest,
  pythonWithPillow,
  tilePage,
  type GeminiInput,
  type Tile,
} from "./gemini";
import {
  ANNOT_MODEL,
  ANNOT_PAGE_PRICE_USD,
  MISTRAL_OCR_MODEL,
  PAGE_PRICE_USD,
  describeRequest as describeMistralRequest,
  mistralRequest,
  remapFromRaw,
  remapMeasurements,
} from "./mistral";
import { CF_GLM, CF_QWEN, CF_SCOUT, GROQ_QWEN, MINISTRAL_14B, MISTRAL_SMALL, compatRequest, describeRequest as describeCompatRequest, type CompatProvider } from "./openai_compat";
import { readAnnotated, readDocument, readImage, readText } from "./readers";
import {
  fabrications,
  mergedRows,
  pairStats,
  rangeIntegrity,
  scoreAgainstBaseline,
  valueErrors,
  type MergedRow,
  type PairStats,
  type RawMeasurement,
} from "./score";

const OUT = "tests/bench/results/adapt";
const JSONL = "tests/bench/results/adapt.jsonl";
const MAX_USD = parseFloat(process.env.BENCH_MAX_USD ?? "15");
const DRY = process.env.BENCH_DRY_RUN === "1" || process.argv.includes("--dry-run");
const FRESH = process.env.BENCH_FRESH === "1";
const REMAP = process.env.BENCH_REMAP === "1";
const IN_FLIGHT = 4;
/**
 * How many OCR calls may be in flight at once — the OCR provider only.
 *
 * The first sweep put both Mistral arms through the shared pool and took 429 on
 * 91 of 146 photo pages and 14 of 32 born-digital pages, which is not a fact
 * about the reader. Every other arm keeps the pool's full width, so latency
 * stays comparable; mistral.ts, "429 is not a bad read", holds the other half
 * of the fix (a bounded retry with backoff, on 429 and nothing else).
 */
const MISTRAL_IN_FLIGHT = Math.max(1, parseInt(process.env.MISTRAL_IN_FLIGHT ?? "2", 10));

/**
 * A counting semaphore. `release` hands the slot straight to a waiter rather
 * than incrementing a counter, so two tasks cannot both see it free.
 */
function gate(n: number) {
  let free = n;
  const waiting: Array<() => void> = [];
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (free > 0) free--;
    else await new Promise<void>((r) => waiting.push(r));
    try {
      return await fn();
    } finally {
      const w = waiting.shift();
      if (w) w();
      else free++;
    }
  };
}
const mistralGate = gate(MISTRAL_IN_FLIGHT);
/**
 * The free chat tiers are rate-limited by design (openai_compat.ts): Groq's
 * is 30 RPM and 8k TPM, which is one page at a time; Mistral's Experiment
 * plan is ~1 request/s. Workers AI keeps the pool. `GROQ_IN_FLIGHT` raises
 * the Groq cap on the paid tier.
 */
const groqGate = gate(Math.max(1, parseInt(process.env.GROQ_IN_FLIGHT ?? "1", 10)));
const mistralChatGate = gate(Math.max(1, parseInt(process.env.MISTRAL_CHAT_IN_FLIGHT ?? "2", 10)));

/* -------------------------------------------------------------------- arms */

type Input = "text" | "image";

interface SingleArm {
  id: string;
  label: string;
  reader: Reader;
  inputs: Input[];
  /** USD per page, from docs/plans/lab-adaptability.md C5 — the dry run's estimate. */
  estimateUsd: Partial<Record<Input, number>>;
  /** Visual tokens one image page costs this reader — what `estimateUsd.image` rests on. */
  imageTokens?: number;
  /** Send the page as two overlapping halves, one image part each (gemini.ts). */
  tiled?: boolean;
  /**
   * Set when the model is billed per page rather than per token. Its
   * `estimateUsd` is then a *price*, not a derivation from a token budget, and
   * the table says so instead of leaving a blank `imgTok` to be misread.
   */
  pricePerPageUsd?: number;
  /**
   * Take a text-layer page as the ORIGINAL PDF instead of its `|`-joined rows.
   * The OCR arm reads a born-digital PDF's embedded text, so this — not a
   * raster — is the fair comparison against the deployed text path.
   */
  sourcePdf?: boolean;
  /**
   * Ask the OCR provider for a `document_annotation` in OUR schema instead of
   * a layout parse this repository then maps (mistral.ts, "annotations"). The
   * arm has no mapping layer, and its page is billed on the higher tier.
   */
  annotate?: boolean;
}

interface PairArm {
  id: string;
  label: string;
  pair: [string, string];
}

/**
 * Estimates: text pages from the confirmed run (docs/extraction-speed.md
 * "Confirmed on the real API": Sonnet $1.22/33, Haiku $0.45/33); image pages
 * derived in C5 (Sonnet ≈ $0.09, Haiku ≈ $0.026, Gemini ≈ $0.02 at high and
 * +1,120 image tokens ≈ $0.001 at ultra_high). Estimates, not prices — the
 * run records what it actually spent.
 *
 * `imageTokens` is the fixed visual budget per page, and the Gemini estimates
 * are that budget priced at $0.75/1M input: ultra_high buys 2,240, and the
 * tiled arm buys TILED_IMAGE_TOKENS = 4,480 by sending two ultra_high parts,
 * so it costs another 2,240 × $0.75/1M ≈ $0.002 a page — near Sonnet's 4,784
 * visual tokens (docs/extraction-speed.md) at about a third of the price.
 */
export const ARMS: SingleArm[] = [
  { id: "sonnet5", label: "Sonnet 5 alone", reader: { model: MODEL_PRIMARY }, inputs: ["text", "image"], estimateUsd: { text: 0.037, image: 0.09 }, imageTokens: 4784 },
  { id: "haiku45", label: "Haiku 4.5 alone", reader: { model: MODEL_ESCALATION }, inputs: ["text", "image"], estimateUsd: { text: 0.014, image: 0.026 }, imageTokens: 4784 },
  { id: "gemini38_high", label: "Gemini 3.8 Flash, media high", reader: { model: GEMINI_MODEL, provider: "google", mediaResolution: "high" }, inputs: ["image"], estimateUsd: { image: 0.02 }, imageTokens: IMAGE_TOKENS.high },
  { id: "gemini38_ultra", label: "Gemini 3.8 Flash, media ultra_high", reader: { model: GEMINI_MODEL, provider: "google", mediaResolution: "ultra_high" }, inputs: ["image"], estimateUsd: { image: 0.021 }, imageTokens: IMAGE_TOKENS.ultra_high },
  // ultra_high is the top of the ladder, so more detail costs another *part*:
  // two overlapping halves, 2 × 2,240 tokens. Not ultra's $0.021 — see above.
  { id: "gemini38_tiled", label: "Gemini 3.8 Flash, two ultra_high tiles", reader: { model: GEMINI_MODEL, provider: "google", mediaResolution: "ultra_high" }, inputs: ["image"], estimateUsd: { image: 0.023 }, imageTokens: TILED_IMAGE_TOKENS, tiled: true },
  // Priced PER PAGE at $0.004, not per token: no `imageTokens`, and the
  // estimate is the price itself. mistral.ts, "Pricing — per page, not per
  // token".
  { id: "mistral_ocr", label: "Mistral OCR on a rendered page", reader: { model: MISTRAL_OCR_MODEL, provider: "mistral" }, inputs: ["image"], estimateUsd: { image: PAGE_PRICE_USD }, pricePerPageUsd: PAGE_PRICE_USD },
  // The cost question on the born-digital path: the same OCR model reading the
  // ORIGINAL PDF page, against the deployed text pair whose real-API numbers
  // are already recorded (docs/extraction-speed.md, "Confirmed on the real
  // API": Haiku 851/878, Sonnet 843/878, 0 value errors either way).
  { id: "mistral_ocr_digital", label: "Mistral OCR on the original PDF page", reader: { model: MISTRAL_OCR_MODEL, provider: "mistral" }, inputs: ["text"], estimateUsd: { text: PAGE_PRICE_USD }, pricePerPageUsd: PAGE_PRICE_USD, sourcePdf: true },
  // The third way of getting our schema out of Mistral, after our own mapper
  // (mistral_ocr) and an external Haiku mapper: the OCR call carries
  // `document_annotation_format` and Mistral runs mistral-small-2603 over its
  // own OCR output to fill it. Same endpoint, same pinned OCR model, one call,
  // and NO mapping layer of ours — so this arm's number is a measurement of
  // the model, which is the axis the Haiku mapper failed on. $0.005/page, the
  // annotations tier.
  { id: "mistral_annot", label: "Mistral OCR + document annotation (our schema)", reader: { model: MISTRAL_OCR_MODEL, provider: "mistral" }, inputs: ["image"], estimateUsd: { image: ANNOT_PAGE_PRICE_USD }, pricePerPageUsd: ANNOT_PAGE_PRICE_USD, annotate: true },
  // The free-tier candidates (openai_compat.ts), single readers first. Text
  // estimates: ~1.5k in + ~3.6k out at the list price; image estimates add
  // the image tokens each endpoint reported on the 2026-09-18 probe (GLM
  // ~5.1k, Scout ~2.4k, Qwen ~6.4k at Workers AI; Groq a fixed 2,048). The
  // Workers AI bill is on paper — the first ~10k neurons a day are free.
  { id: "cf_glm", label: "Workers AI: GLM-5.3 Flash", reader: { model: CF_GLM, provider: "cloudflare" }, inputs: ["text", "image"], estimateUsd: { text: 0.002, image: 0.0026 }, imageTokens: 5100 },
  { id: "cf_scout", label: "Workers AI: Llama 4 Scout", reader: { model: CF_SCOUT, provider: "cloudflare" }, inputs: ["text", "image"], estimateUsd: { text: 0.0035, image: 0.0037 }, imageTokens: 2400 },
  { id: "cf_qwen", label: "Workers AI: Qwen 3.8 27B", reader: { model: CF_QWEN, provider: "cloudflare" }, inputs: ["text", "image"], estimateUsd: { text: 0.012, image: 0.014 }, imageTokens: 6400 },
  { id: "groq_qwen", label: "Groq: Qwen 3.8 27B", reader: { model: GROQ_QWEN, provider: "groq" }, inputs: ["text", "image"], estimateUsd: { text: 0.016, image: 0.016 }, imageTokens: 2048 },
  { id: "mistral_small", label: "Mistral Small 4 (chat, vision)", reader: { model: MISTRAL_SMALL, provider: "mistral-chat" }, inputs: ["text", "image"], estimateUsd: { text: 0.0024, image: 0.003 } },
  { id: "ministral_14b", label: "Mistral: Ministral 3 14B (chat, vision)", reader: { model: MINISTRAL_14B, provider: "mistral-chat" }, inputs: ["text", "image"], estimateUsd: { text: 0.002, image: 0.003 } },
];

export const PAIRS: PairArm[] = [
  { id: "sonnet5+gemini38_ultra", label: "the planned photo pair", pair: ["sonnet5", "gemini38_ultra"] },
  { id: "sonnet5+gemini38_tiled", label: "the pair at matched visual budget", pair: ["sonnet5", "gemini38_tiled"] },
  { id: "sonnet5+gemini38_high", label: "what ultra_high buys the pair", pair: ["sonnet5", "gemini38_high"] },
  { id: "sonnet5+haiku45", label: "the retreat pair (deployed text pair)", pair: ["sonnet5", "haiku45"] },
  { id: "sonnet5+mistral_ocr", label: "a reader and a layout parser", pair: ["sonnet5", "mistral_ocr"] },
  { id: "gemini38_ultra+mistral_ocr", label: "the cheap pair — two vendors, ~$0.025/page", pair: ["gemini38_ultra", "mistral_ocr"] },
  { id: "sonnet5+mistral_annot", label: "a reader and a schema-filling OCR", pair: ["sonnet5", "mistral_annot"] },
  { id: "gemini38_ultra+mistral_annot", label: "the cheap pair, no mapper of ours", pair: ["gemini38_ultra", "mistral_annot"] },
  // A free reader beside Gemini (photos) or Haiku (text): what the app would
  // run if Sonnet left the pair. The number that decides is UNCAUGHT.
  { id: "gemini38_ultra+cf_glm", label: "free photo pair: Gemini + GLM", pair: ["gemini38_ultra", "cf_glm"] },
  { id: "gemini38_ultra+cf_scout", label: "free photo pair: Gemini + Scout", pair: ["gemini38_ultra", "cf_scout"] },
  { id: "gemini38_ultra+cf_qwen", label: "free photo pair: Gemini + Qwen (Workers AI)", pair: ["gemini38_ultra", "cf_qwen"] },
  { id: "gemini38_ultra+groq_qwen", label: "free photo pair: Gemini + Qwen (Groq)", pair: ["gemini38_ultra", "groq_qwen"] },
  { id: "gemini38_ultra+mistral_small", label: "free photo pair: Gemini + Mistral Small", pair: ["gemini38_ultra", "mistral_small"] },
  { id: "gemini38_ultra+ministral_14b", label: "free photo pair: Gemini + Ministral 14B", pair: ["gemini38_ultra", "ministral_14b"] },
  { id: "haiku45+cf_glm", label: "free text pair: Haiku + GLM", pair: ["haiku45", "cf_glm"] },
  { id: "haiku45+cf_scout", label: "free text pair: Haiku + Scout", pair: ["haiku45", "cf_scout"] },
  { id: "haiku45+cf_qwen", label: "free text pair: Haiku + Qwen (Workers AI)", pair: ["haiku45", "cf_qwen"] },
  { id: "haiku45+groq_qwen", label: "free text pair: Haiku + Qwen (Groq)", pair: ["haiku45", "groq_qwen"] },
  { id: "haiku45+mistral_small", label: "free text pair: Haiku + Mistral Small", pair: ["haiku45", "mistral_small"] },
  { id: "haiku45+ministral_14b", label: "free text pair: Haiku + Ministral 14B", pair: ["haiku45", "ministral_14b"] },
  { id: "cf_glm+cf_scout", label: "two free readers, one host", pair: ["cf_glm", "cf_scout"] },
  { id: "cf_glm+groq_qwen", label: "two free readers, two vendors", pair: ["cf_glm", "groq_qwen"] },
  { id: "cf_glm+ministral_14b", label: "two free readers, two vendors, one in the EU", pair: ["cf_glm", "ministral_14b"] },
];

const armIds = (process.env.BENCH_ARMS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const classIds = (process.env.BENCH_CLASSES ?? "").split(",").map((s) => s.trim()).filter(Boolean) as CorpusClass[];
const singles = ARMS.filter((a) => !armIds.length || armIds.includes(a.id));
const pairs = PAIRS.filter((p) => !armIds.length || armIds.includes(p.id) || (armIds.includes(p.pair[0]) && armIds.includes(p.pair[1])));
const classes = CLASSES.filter((c) => !classIds.length || classIds.includes(c));

/* ---------------------------------------------------------------- persist */

interface Persisted {
  arm: string;
  cls: CorpusClass;
  slug: string;
  key: string;
  kind: Input;
  image?: string;
  at: string;
  call: CallResult;
}

const outPath = (arm: string, slug: string) => join(OUT, arm, `${slug}.json`);

function loadPersisted(arm: string, slug: string): Persisted | null {
  const p = outPath(arm, slug);
  if (FRESH || !existsSync(p)) return null;
  try {
    const rec = JSON.parse(readFileSync(p, "utf8")) as Persisted;
    // A failed call is a note, not a result: it must not be reused as one,
    // or a 400 on every page would look like a finished arm on the next run.
    if (rec?.call && rec.call.ok === false) return null;
    return rec;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ scoring */

function readOf(p: Persisted | null | undefined): RawMeasurement[] | null {
  return p?.call?.ok && p.call.extraction ? (p.call.extraction.measurements as RawMeasurement[]) : null;
}

interface PageScore {
  cls: CorpusClass;
  arm: string;
  slug: string;
  kind: Input;
  ok: boolean;
  ms?: number;
  usd?: number;
  imageTokens?: number;
  truthRows: number;
  readRows: number;
  matched: number;
  missing: number;
  extra: number;
  valueErrors: Array<{ name: string; truth: string; read: string }>;
  fabrications: string[];
  /** Rows this arm fused out of two printed rows — the Docling class. */
  merged: MergedRow[];
  collapsed: number;
  decensored: number;
}

function scoreSingle(page: CorpusPage, arm: string, p: Persisted | null): PageScore | null {
  const read = readOf(p);
  const base: PageScore = {
    cls: page.cls, arm, slug: page.slug, kind: page.kind, ok: !!read,
    ms: p?.call.ms, usd: p?.call.costUsd, imageTokens: p?.call.imageTokens,
    truthRows: page.truth?.length ?? 0, readRows: read?.length ?? 0,
    matched: 0, missing: 0, extra: 0, valueErrors: [], fabrications: [], merged: [], collapsed: 0, decensored: 0,
  };
  if (!read || !page.truth) return read || p ? base : null;
  const integ = rangeIntegrity(page.truth, read);
  base.collapsed = integ.collapsed.length;
  base.decensored = integ.decensored.length;
  // Every arm, every class. See the file header.
  base.merged = mergedRows(read, page.truth, { pageKey: page.key });
  if (page.kind === "text" && page.rows) {
    const s = scoreAgainstBaseline(page.truth, read);
    base.matched = s.matched;
    base.missing = s.missing.length;
    base.extra = s.extra.length;
    base.valueErrors = s.valueMismatch.map((m) => ({ name: m.name, truth: m.baseline, read: m.arm }));
    base.fabrications = fabrications(read, page.rows);
  } else {
    const v = valueErrors(read, page.truth);
    base.matched = v.matched;
    base.missing = v.missing.length;
    base.extra = v.extra.length;
    base.valueErrors = v.errors;
  }
  return base;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);

function printSingles(cls: CorpusClass, scores: PageScore[], truthSource: string): void {
  const rows = scores.filter((s) => s.cls === cls);
  if (!rows.length) return;
  for (const kind of ["text", "image"] as Input[]) {
    const ofKind = rows.filter((s) => s.kind === kind);
    if (!ofKind.length) continue;
    console.log(`\n## ${cls} — ${kind} pages, truth: ${truthSource}`);
    console.log(
      "arm".padEnd(16) + pad("pages", 6) + pad("ok", 4) + pad("truth", 6) + pad("rows", 6) + pad("match", 6) + pad("miss", 6) + pad("extra", 6) +
        (kind === "text" ? pad("valΔ", 6) + pad("fab", 5) : pad("valERR", 7)) + pad("MERGED", 7) + pad("coll", 5) + pad("decens", 7) + pad("p50 s", 7) + pad("USD", 8) + (kind === "image" ? pad("imgTok", 8) : ""),
    );
    for (const arm of singles.map((a) => a.id)) {
      const hits = ofKind.filter((s) => s.arm === arm);
      if (!hits.length) continue;
      const ms = hits.filter((h) => h.ok).map((h) => h.ms ?? 0).sort((a, b) => a - b);
      const p50 = ms.length ? (ms[Math.floor(ms.length / 2)] / 1000).toFixed(1) : "-";
      const img = hits.map((h) => h.imageTokens).filter((x): x is number => typeof x === "number");
      console.log(
        arm.padEnd(16) + pad(hits.length, 6) + pad(hits.filter((h) => h.ok).length, 4) + pad(sum(hits, (h) => h.truthRows), 6) + pad(sum(hits, (h) => h.readRows), 6) +
          pad(sum(hits, (h) => h.matched), 6) + pad(sum(hits, (h) => h.missing), 6) + pad(sum(hits, (h) => h.extra), 6) +
          (kind === "text" ? pad(sum(hits, (h) => h.valueErrors.length), 6) + pad(sum(hits, (h) => h.fabrications.length), 5) : pad(sum(hits, (h) => h.valueErrors.length), 7)) +
          pad(sum(hits, (h) => h.merged.length), 7) + pad(sum(hits, (h) => h.collapsed), 5) + pad(sum(hits, (h) => h.decensored), 7) + pad(p50, 7) + pad(sum(hits, (h) => h.usd ?? 0).toFixed(3), 8) +
          (kind === "image" ? pad(img.length ? Math.round(sum(img, (x) => x) / img.length) : "-", 8) : ""),
      );
    }
    // The detail that matters for adjudication.
    for (const h of ofKind) {
      const bits: string[] = [];
      if (!h.ok) bits.push("FAILED");
      if (h.valueErrors.length) bits.push(`${kind === "text" ? "valΔ" : "valERR"}: ${h.valueErrors.map((e) => `${e.name} ${e.truth}→${e.read}`).join("; ")}`);
      if (h.fabrications.length) bits.push(`fab: ${h.fabrications.join("; ")}`);
      if (h.decensored) bits.push(`decensored: ${h.decensored}`);
      if (bits.length) console.log(`   ${h.arm.padEnd(14)} ${h.slug}: ${bits.join(" | ")}`);
    }
    // The named warning. A merged row is not a wrong number and not a
    // fabrication, so it would otherwise pass every other column clean.
    const fused = ofKind.filter((h) => h.merged.length);
    if (fused.length) {
      console.log(`   !! MERGED ROWS — two printed rows in one record (the Docling class, docs/extraction-speed.md A7):`);
      for (const h of fused) {
        for (const m of h.merged) {
          console.log(`      ${h.arm.padEnd(20)} ${h.slug}: [${m.reasons.join("+")}] "${m.name}" value="${m.value_raw}" range="${m.ref_range_raw}"`);
        }
      }
    }
  }
}

/* ------------------------------------------------- re-mapping, without paying */

/**
 * Re-map the persisted OCR outputs and re-score them, offline.
 *
 * This arm's accuracy is decided by *our* code, not by a model (mistral.ts,
 * "Mapping OCR output onto RawMeasurement"), so a mapping change has to be
 * judged against the API's real answers — and paying for the same 146 pages a
 * second time to grade our own regex is not a benchmark, it is a bill.
 *
 * There are two routes back to those answers, and which one a record gets is
 * printed per class, because they are not equally good.
 *
 * **`raw`** — the provider's own answer, stored with the record since
 * `CallResult.raw` existed. `remapFromRaw` re-runs `rowsFromOcrPage` on it, so
 * today's mapping sees the page exactly as the day's call did: rows the old
 * mapping dropped come back, a table it rejected outright is re-judged, and the
 * header is read rather than reconstructed. This is the honest route and the
 * only caveat left is the obvious one — a page the API never answered for (or
 * answered 429 to) has nothing to re-map and stays at zero.
 *
 * **`snippet`** — the fallback for records written before that field, resting
 * on rule 12: `source_snippet` is the whole printed row, rejoined with `" | "`,
 * and no cell can contain a `|`, so the cells survive the round trip exactly
 * and `remapMeasurements` re-runs the mapping on them. What it cannot do must
 * be said wherever *those* numbers are quoted:
 *
 *   - a row the OLD mapping dropped is not in the file, so it cannot come back
 *     — the "after" column can move a row from wrong to right, never from
 *     absent to present;
 *   - a page whose tables the old mapping rejected entirely stays at zero even
 *     though the answer may have been fine;
 *   - the table's header row was consumed, so a re-mapped table is inferred
 *     from its cells even where the original read a header. Run this mode
 *     BEFORE a mapping change too: "before" against the persisted score is the
 *     reconstruction's own error bar, and only the movement beyond it is the
 *     change.
 */
type RemapSource = "raw" | "snippet";

function printRemap(rows: Array<{ cls: CorpusClass; arm: string; slug: string; kind: Input; source: RemapSource; before: PageScore; after: PageScore }>): void {
  if (!rows.length) {
    console.log("\nnothing to re-map: no persisted OCR output for the selected arms and classes.");
    return;
  }
  const col = (s: PageScore) => [s.readRows, s.matched, s.missing, s.extra, s.valueErrors.length, s.merged.length, s.collapsed];
  const heads = ["rows", "match", "miss", "extra", "valERR", "MERGED", "coll"];
  for (const cls of classes) {
    const here = rows.filter((r) => r.cls === cls);
    if (!here.length) continue;
    const fromRaw = here.filter((r) => r.source === "raw").length;
    console.log(`\n## ${cls} — persisted mapping → re-mapped`);
    // Which route, said before the numbers rather than after them: the two
    // carry different caveats and only one of them can un-drop a row.
    console.log(
      fromRaw === here.length
        ? `re-mapped from the provider's own answer (call.raw) on all ${here.length} pages.`
        : fromRaw === 0
          ? `re-mapped from source_snippet on all ${here.length} pages — no record carries call.raw, so a row the old mapping dropped cannot come back.`
          : `re-mapped from call.raw on ${fromRaw} of ${here.length} pages; the other ${here.length - fromRaw} fell back to source_snippet, where a dropped row cannot come back.`,
    );
    console.log("arm".padEnd(22) + pad("pages", 6) + pad("truth", 7) + heads.map((h) => pad(h, 16)).join(""));
    for (const arm of [...new Set(here.map((r) => r.arm))]) {
      const hits = here.filter((r) => r.arm === arm);
      const b = heads.map((_, i) => sum(hits, (h) => col(h.before)[i]));
      const a = heads.map((_, i) => sum(hits, (h) => col(h.after)[i]));
      console.log(
        arm.padEnd(22) + pad(hits.length, 6) + pad(sum(hits, (h) => h.before.truthRows), 7) +
          heads.map((_, i) => pad(`${b[i]} → ${a[i]}`, 16)).join(""),
      );
    }
    for (const r of here) {
      const b = col(r.before);
      const a = col(r.after);
      if (b.every((x, i) => x === a[i])) continue;
      console.log(`   ${r.arm.padEnd(20)} ${r.slug.padEnd(30)} ` + heads.map((h, i) => (b[i] === a[i] ? "" : `${h} ${b[i]}→${a[i]}`)).filter(Boolean).join("  "));
    }
    // The class that matters most: a wrong number that reads as a real result.
    for (const r of here) {
      for (const e of r.after.valueErrors) console.log(`   !! ${r.arm} ${r.slug}: STILL WRONG ${e.name} ${e.truth}→${e.read}`);
    }
  }
}

interface PairScore extends PairStats {
  cls: CorpusClass;
  arm: string;
  slug: string;
  condition: string | null;
}

function printPairs(cls: CorpusClass, scores: PairScore[]): void {
  const rows = scores.filter((s) => s.cls === cls);
  if (!rows.length) return;
  console.log(`\n## ${cls} — reader pairs (two numbers, never merged)`);
  console.log("pair".padEnd(26) + pad("pages", 6) + pad("single", 7) + pad("confirmed", 10) + pad("flagged", 8) + pad("UNCAUGHT", 9) + pad("caught", 7) + pad("1-rdr ERR", 10));
  for (const p of pairs) {
    const hits = rows.filter((s) => s.arm === p.id);
    if (!hits.length) continue;
    console.log(
      p.id.padEnd(26) + pad(hits.length, 6) + pad(hits.filter((h) => h.singleReader).length, 7) + pad(sum(hits, (h) => h.confirmedRows), 10) +
        pad(sum(hits, (h) => h.flaggedRows), 8) + pad(sum(hits, (h) => h.uncaughtValueErrors.length), 9) + pad(sum(hits, (h) => h.caughtValueErrors), 7) +
        pad(sum(hits, (h) => h.singleReaderErrors.length), 10),
    );
    // Photos: per condition, because "angle" and "twopage" are the shots that decide.
    const conds = [...new Set(hits.map((h) => h.condition).filter(Boolean))];
    for (const c of conds) {
      const hc = hits.filter((h) => h.condition === c);
      console.log(
        `  ${String(c)}`.padEnd(26) + pad(hc.length, 6) + pad(hc.filter((h) => h.singleReader).length, 7) + pad(sum(hc, (h) => h.confirmedRows), 10) +
          pad(sum(hc, (h) => h.flaggedRows), 8) + pad(sum(hc, (h) => h.uncaughtValueErrors.length), 9) + pad(sum(hc, (h) => h.caughtValueErrors), 7) +
          pad(sum(hc, (h) => h.singleReaderErrors.length), 10),
      );
    }
    for (const h of hits) {
      if (h.uncaughtValueErrors.length) console.log(`   ${h.slug}: UNCAUGHT ${h.uncaughtValueErrors.map((e) => `${e.name} ${e.truth || "∅"}→${e.read}`).join("; ")}`);
      if (h.singleReader) console.log(`   ${h.slug}: single reader — every row flagged`);
    }
  }
}

/* -------------------------------------------------------------------- run */

interface Job {
  arm: SingleArm;
  page: CorpusPage;
}

it("lab adaptability — class × arm, scored per class", async () => {
  const pages = new Map<CorpusClass, CorpusPage[]>();
  for (const cls of classes) pages.set(cls, await loadClass(cls));

  // The plan: which pages each arm would read, and what that costs.
  const jobs: Job[] = [];
  const skipped: Array<{ cls: CorpusClass; slug: string; why: string }> = [];
  for (const cls of classes) {
    for (const page of pages.get(cls)!) {
      if (!page.truth) {
        skipped.push({ cls, slug: page.slug, why: "no truth" });
        continue;
      }
      if (page.meta.available === false) {
        skipped.push({ cls, slug: page.slug, why: "source file missing" });
        continue;
      }
      for (const arm of singles) if (arm.inputs.includes(page.kind)) jobs.push({ arm, page });
    }
  }

  console.log(`\n# bench:adapt ${DRY ? "— DRY RUN, no network" : ""}\n`);
  console.log("class".padEnd(11) + pad("pages", 6) + pad("text", 6) + pad("image", 6) + pad("truth", 6) + pad("skip", 6) + "  truth source");
  for (const cls of classes) {
    const ps = pages.get(cls)!;
    const src = [...new Set(ps.map((p) => p.truthSource).filter((s) => s !== "none"))].join(", ") || "none";
    console.log(
      cls.padEnd(11) + pad(ps.length, 6) + pad(ps.filter((p) => p.kind === "text").length, 6) + pad(ps.filter((p) => p.kind === "image").length, 6) +
        pad(ps.filter((p) => p.truth).length, 6) + pad(skipped.filter((s) => s.cls === cls).length, 6) + `  ${src}`,
    );
  }
  for (const s of skipped) console.log(`   skip ${s.cls}/${s.slug}: ${s.why}`);

  console.log("\narm".padEnd(21) + pad("text", 6) + pad("image", 6) + pad("imgTok", 8) + pad("cached", 7) + pad("to call", 8) + pad("est USD", 9) + "  reader");
  let estimate = 0;
  for (const arm of singles) {
    const mine = jobs.filter((j) => j.arm === arm);
    const cached = mine.filter((j) => loadPersisted(arm.id, j.page.slug)).length;
    const toCall = mine.filter((j) => !loadPersisted(arm.id, j.page.slug));
    const usd = sum(toCall, (j) => arm.estimateUsd[j.page.kind] ?? 0);
    estimate += usd;
    console.log(
      arm.id.padEnd(20) + pad(mine.filter((j) => j.page.kind === "text").length, 6) + pad(mine.filter((j) => j.page.kind === "image").length, 6) +
        // A per-page model has no visual token budget, and a blank here would
        // read as "unknown" rather than "not how this one is billed".
        pad(arm.pricePerPageUsd ? "$/page" : (arm.imageTokens ?? "-"), 8) + pad(cached, 7) + pad(toCall.length, 8) + pad(usd.toFixed(2), 9) +
        `  ${arm.reader.provider ?? "anthropic"}:${arm.reader.model}${arm.reader.mediaResolution ? "/" + arm.reader.mediaResolution : ""}${arm.tiled ? " ×2 tiles" : ""}` +
        (arm.pricePerPageUsd ? `  $${arm.pricePerPageUsd.toFixed(3)}/page${arm.sourcePdf ? ", original PDF page" : ""}` : ""),
    );
  }
  for (const p of pairs) console.log(`${p.id.padEnd(28)}${pad("offline", 29)}  ${p.label}`);
  console.log(`\nestimated spend for the calls not yet persisted: $${estimate.toFixed(2)} (cap BENCH_MAX_USD=$${MAX_USD})`);
  const perPage = singles.filter((a) => a.pricePerPageUsd);
  if (perPage.length) {
    const many = perPage.length > 1;
    // Each arm's own price, because there are now two tiers: a plain OCR page
    // is $0.004 and an annotated one $0.005, and one figure standing for both
    // would understate the arm that costs more.
    console.log(
      `note: ${perPage.map((a) => `${a.id} $${a.pricePerPageUsd!.toFixed(3)}`).join(", ")} — billed PER PAGE, ` +
        `not per token, so ${many ? "those estimates are" : "that estimate is"} the price itself, ` +
        `and ${many ? "their" : "its"} imgTok/USD columns are not token counts.`,
    );
  }

  if (REMAP) {
    console.log("\n# BENCH_REMAP — persisted OCR responses re-mapped offline. Nothing is sent, nothing is spent.");
    const rows: Array<{ cls: CorpusClass; arm: string; slug: string; kind: Input; source: RemapSource; before: PageScore; after: PageScore }> = [];
    for (const cls of classes) {
      for (const page of pages.get(cls)!) {
        if (!page.truth) continue;
        for (const arm of singles.filter((a) => a.reader.provider === "mistral")) {
          const p = loadPersisted(arm.id, page.slug);
          if (!p?.call.extraction) continue;
          const before = scoreSingle(page, arm.id, p);
          // The provider's own answer where the record has one — that route can
          // bring a dropped row back. Otherwise the snippets, with their limits.
          const fromRaw = remapFromRaw(p.call.raw);
          const source: RemapSource = fromRaw ? "raw" : "snippet";
          const measurements = fromRaw ?? remapMeasurements(p.call.extraction.measurements as RawMeasurement[]);
          const after = scoreSingle(page, arm.id, { ...p, call: { ...p.call, extraction: { ...p.call.extraction, measurements: measurements as any } } });
          if (before && after) rows.push({ cls, arm: arm.id, slug: page.slug, kind: page.kind, source, before, after });
        }
      }
    }
    printRemap(rows);
    return;
  }

  if (DRY) {
    const gem = singles.find((a) => a.reader.provider === "google");
    if (gem) {
      const input: GeminiInput = gem.tiled
        ? { kind: "tiles", tiles: [{ base64: "AAAA", mediaType: "image/png" }, { base64: "BBBB", mediaType: "image/png" }] }
        : { kind: "image", base64: "AAAA", mediaType: "image/png" };
      console.log(`\n# Gemini request shape (${gem.id}; image bytes elided)\n`);
      console.log(JSON.stringify(describeRequest(geminiRequest(gem.reader, input)), null, 1));
    }
    // One per OCR arm: the image path and the born-digital path send
    // materially different documents, and a dry run that showed only the first
    // would hide the `pages` selector the PDF arm turns on.
    for (const ocr of singles.filter((a) => a.reader.provider === "mistral")) {
      const input = ocr.annotate
        ? ({ kind: "image_annot", base64: "AAAA", mediaType: "image/png" } as const)
        : ocr.sourcePdf
          ? ({ kind: "pdf", base64: "AAAA", page: 1, name: "page.pdf" } as const)
          : ({ kind: "image", base64: "AAAA", mediaType: "image/png" } as const);
      console.log(
        `\n# Mistral OCR request shape (${ocr.id}; $${(ocr.pricePerPageUsd ?? PAGE_PRICE_USD).toFixed(3)}/page` +
          (ocr.annotate ? `, annotations tier, schema filled by ${ANNOT_MODEL}` : "") +
          `; document bytes elided)\n`,
      );
      // The whole schema and the whole Czech prompt are printed, not elided:
      // both are derived from @bw/extraction and the point of the dry run is
      // to show that they are what every other reader is handed.
      console.log(JSON.stringify(describeMistralRequest(mistralRequest(ocr.reader, input)), null, 1));
    }
    console.log("\ndry run — nothing was sent. Propose the estimate above before running for real.");
    return;
  }

  // Keys, checked before the first call so a missing one fails the run, not a page.
  const needs = new Set(jobs.filter((j) => !loadPersisted(j.arm.id, j.page.slug)).map((j) => j.arm.reader.provider ?? "anthropic"));
  const keys = {
    anthropic: process.env.ANTHROPIC_API_KEY ?? "",
    google: process.env.GEMINI_API_KEY ?? "",
    mistral: process.env.MISTRAL_API_KEY ?? "",
    // Empty means "the wrangler login" — openai_compat.ts reads the OAuth
    // token itself and fails the call, not the run, when there is none.
    cloudflare: process.env.CLOUDFLARE_API_TOKEN ?? "",
    groq: process.env.GROQ_API_KEY ?? "",
    "mistral-chat": process.env.MISTRAL_API_KEY ?? "",
  };
  const KEY_NAME = { anthropic: "ANTHROPIC_API_KEY", google: "GEMINI_API_KEY", mistral: "MISTRAL_API_KEY", cloudflare: "", groq: "GROQ_API_KEY", "mistral-chat": "MISTRAL_API_KEY" } as const;
  for (const p of needs) if (!keys[p] && KEY_NAME[p]) throw new Error(`${KEY_NAME[p]} not set — set -a; source .env; set +a`);

  const python = pythonWithFitz();
  const pillow = singles.some((a) => a.tiled) ? pythonWithPillow() : null;
  mkdirSync(OUT, { recursive: true });
  const persisted = new Map<string, Persisted>();
  const pkey = (arm: string, slug: string) => `${arm}/${slug}`;

  let spent = 0;
  let stopped = false;
  let next = 0;
  const worker = async () => {
    for (;;) {
      if (stopped) return;
      const i = next++;
      if (i >= jobs.length) return;
      const { arm, page } = jobs[i];
      const cached = loadPersisted(arm.id, page.slug);
      if (cached) {
        persisted.set(pkey(arm.id, page.slug), cached);
        continue;
      }
      const provider = arm.reader.provider ?? "anthropic";
      // The OCR provider answers 429 when asked too fast, and a 429 is not a
      // reading failure. It alone is gated; every other arm keeps the pool.
      const polite = <T,>(fn: () => Promise<T>): Promise<T> =>
        provider === "mistral" ? mistralGate(fn) : provider === "groq" ? groqGate(fn) : provider === "mistral-chat" ? mistralChatGate(fn) : fn();
      let call: CallResult;
      let imagePath: string | undefined;
      if (page.kind === "text" && arm.sourcePdf) {
        // The born-digital arm: the original PDF page, not a render of it and
        // not the joined rows. `image` is a `{pdf, page}` for every text page.
        if (!("pdf" in page.image)) {
          console.log(`${arm.id.padEnd(16)} ${page.slug} skipped: no source PDF for a text page`);
          continue;
        }
        const doc = { base64: readFileSync(page.image.pdf).toString("base64"), page: page.image.page, name: page.slug + ".pdf" };
        call = await polite(() => readDocument(keys[provider], arm.reader, doc));
      } else if (page.kind === "text") {
        call = await polite(() => readText(keys[provider], arm.reader, page.rows!));
      } else {
        let rendered;
        try {
          rendered = renderFor(page, provider, join(OUT, "renders", page.cls), python);
        } catch (e: any) {
          console.log(`${arm.id.padEnd(16)} ${page.slug} render FAILED: ${e?.message ?? e}`);
          continue;
        }
        imagePath = rendered.path;
        // The tiled arm sends the same rendered page as two overlapping
        // halves, cached beside the render so a rerun never crops twice.
        let tiles: Tile[] | undefined;
        if (arm.tiled) {
          try {
            tiles = tilePage(rendered.path, join(OUT, "renders", page.cls), page.slug, pillow).map((path) => ({
              base64: readFileSync(path).toString("base64"),
              mediaType: path.endsWith(".png") ? "image/png" : "image/jpeg",
            }));
          } catch (e: any) {
            console.log(`${arm.id.padEnd(16)} ${page.slug} tiling FAILED: ${e?.message ?? e}`);
            continue;
          }
        }
        const img = {
          base64: readFileSync(rendered.path).toString("base64"),
          mediaType: rendered.mediaType,
          textLayer: page.rows ? rowsAsText(page.rows) : null,
          tiles,
        };
        call = await polite(() => (arm.annotate ? readAnnotated(keys[provider], arm.reader, img) : readImage(keys[provider], arm.reader, img)));
      }
      spent += call.costUsd;
      const rec: Persisted = { arm: arm.id, cls: page.cls, slug: page.slug, key: page.key, kind: page.kind, image: imagePath, at: new Date().toISOString(), call };
      mkdirSync(join(OUT, arm.id), { recursive: true });
      // Persist a failure too: "Paying twice" applies to knowing it failed.
      writeFileSync(outPath(arm.id, page.slug), JSON.stringify(rec, null, 1));
      // One line per call: the mapped rows and the provider's answer both live
      // in the per-page file, and a page of markdown here would stop this being
      // a log.
      appendFileSync(JSONL, JSON.stringify({ ...rec, call: { ...call, extraction: undefined, raw: undefined, rows: call.extraction?.measurements.length ?? null } }) + "\n");
      persisted.set(pkey(arm.id, page.slug), rec);
      console.log(
        `${arm.id.padEnd(16)} ${page.cls.padEnd(9)} ${page.slug.padEnd(34)} ${call.ok ? pad(Math.round(call.ms), 6) + " ms" : "FAILED " + call.error} ` +
          (call.ok ? ` in=${pad(call.usage.inputTokens, 6)} out=${pad(call.usage.outputTokens, 5)} rows=${pad(call.extraction?.measurements.length ?? 0, 3)} $${call.costUsd.toFixed(4)}` : "") +
          `  total $${spent.toFixed(3)}`,
      );
      if (spent >= MAX_USD) {
        console.log(`\n!! spend cap $${MAX_USD} reached — stopping cleanly`);
        stopped = true;
      }
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  console.log(`\nspent $${spent.toFixed(3)} of $${MAX_USD} cap over ${next} jobs`);

  // Score everything persisted, including outputs from earlier runs.
  const singleScores: PageScore[] = [];
  const pairScores: PairScore[] = [];
  for (const cls of classes) {
    for (const page of pages.get(cls)!) {
      if (!page.truth) continue;
      for (const arm of singles) {
        const p = persisted.get(pkey(arm.id, page.slug)) ?? loadPersisted(arm.id, page.slug);
        const s = scoreSingle(page, arm.id, p);
        if (s) singleScores.push(s);
      }
      if (page.kind !== "image") continue;
      for (const pr of pairs) {
        const a = persisted.get(pkey(pr.pair[0], page.slug)) ?? loadPersisted(pr.pair[0], page.slug);
        const b = persisted.get(pkey(pr.pair[1], page.slug)) ?? loadPersisted(pr.pair[1], page.slug);
        if (!a && !b) continue;
        pairScores.push({ cls, arm: pr.id, slug: page.slug, condition: (page.meta.condition as string | null) ?? null, ...pairStats(readOf(a), readOf(b), page.truth) });
      }
    }
  }
  writeFileSync(join(OUT, "scores.jsonl"), [...singleScores, ...pairScores].map((r) => JSON.stringify(r)).join("\n") + "\n");

  for (const cls of classes) {
    const ps = pages.get(cls)!;
    const src = [...new Set(ps.map((p) => p.truthSource).filter((s) => s !== "none"))].join(", ") || "none";
    printSingles(cls, singleScores, src);
    printPairs(cls, pairScores);
  }
  console.log(`\nwrote ${OUT}/scores.jsonl and ${JSONL}`);
});
