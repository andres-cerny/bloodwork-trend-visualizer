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
 * Knobs: BENCH_CLASSES=real,synthetic,public,photo  BENCH_ARMS=sonnet5,gemini38_ultra
 *        BENCH_MAX_USD (default 15, the hard stop)  BENCH_FRESH=1 (ignore persisted outputs)
 *        PYTHON_BIN (a python with PyMuPDF, for rendering)  PHOTO_DIR  PUBLIC_SHEETS_DIR
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
 * Columns per class:
 *   text pages   matched / missing / extra / valΔ against the baseline,
 *                fabrications against the printed rows, collapsed + decensored
 *   image pages  matched / missing / extra, VALUE ERRORS against hand-verified
 *                truth (column 2 for images), decensored
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
import { GEMINI_MODEL, describeRequest, geminiRequest } from "./gemini";
import { readImage, readText } from "./readers";
import {
  fabrications,
  pairStats,
  rangeIntegrity,
  scoreAgainstBaseline,
  valueErrors,
  type PairStats,
  type RawMeasurement,
} from "./score";

const OUT = "tests/bench/results/adapt";
const JSONL = "tests/bench/results/adapt.jsonl";
const MAX_USD = parseFloat(process.env.BENCH_MAX_USD ?? "15");
const DRY = process.env.BENCH_DRY_RUN === "1" || process.argv.includes("--dry-run");
const FRESH = process.env.BENCH_FRESH === "1";
const IN_FLIGHT = 4;

/* -------------------------------------------------------------------- arms */

type Input = "text" | "image";

interface SingleArm {
  id: string;
  label: string;
  reader: Reader;
  inputs: Input[];
  /** USD per page, from docs/plans/lab-adaptability.md C5 — the dry run's estimate. */
  estimateUsd: Partial<Record<Input, number>>;
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
 */
export const ARMS: SingleArm[] = [
  { id: "sonnet5", label: "Sonnet 5 alone", reader: { model: MODEL_PRIMARY }, inputs: ["text", "image"], estimateUsd: { text: 0.037, image: 0.09 } },
  { id: "haiku45", label: "Haiku 4.5 alone", reader: { model: MODEL_ESCALATION }, inputs: ["text", "image"], estimateUsd: { text: 0.014, image: 0.026 } },
  { id: "gemini38_high", label: "Gemini 3.8 Flash, media high", reader: { model: GEMINI_MODEL, provider: "google", mediaResolution: "high" }, inputs: ["image"], estimateUsd: { image: 0.02 } },
  { id: "gemini38_ultra", label: "Gemini 3.8 Flash, media ultra_high", reader: { model: GEMINI_MODEL, provider: "google", mediaResolution: "ultra_high" }, inputs: ["image"], estimateUsd: { image: 0.021 } },
];

export const PAIRS: PairArm[] = [
  { id: "sonnet5+gemini38_ultra", label: "the planned photo pair", pair: ["sonnet5", "gemini38_ultra"] },
  { id: "sonnet5+gemini38_high", label: "what ultra_high buys the pair", pair: ["sonnet5", "gemini38_high"] },
  { id: "sonnet5+haiku45", label: "the retreat pair (deployed text pair)", pair: ["sonnet5", "haiku45"] },
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
    return JSON.parse(readFileSync(p, "utf8"));
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
  collapsed: number;
  decensored: number;
}

function scoreSingle(page: CorpusPage, arm: string, p: Persisted | null): PageScore | null {
  const read = readOf(p);
  const base: PageScore = {
    cls: page.cls, arm, slug: page.slug, kind: page.kind, ok: !!read,
    ms: p?.call.ms, usd: p?.call.costUsd, imageTokens: p?.call.imageTokens,
    truthRows: page.truth?.length ?? 0, readRows: read?.length ?? 0,
    matched: 0, missing: 0, extra: 0, valueErrors: [], fabrications: [], collapsed: 0, decensored: 0,
  };
  if (!read || !page.truth) return read || p ? base : null;
  const integ = rangeIntegrity(page.truth, read);
  base.collapsed = integ.collapsed.length;
  base.decensored = integ.decensored.length;
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
        (kind === "text" ? pad("valΔ", 6) + pad("fab", 5) : pad("valERR", 7)) + pad("coll", 5) + pad("decens", 7) + pad("p50 s", 7) + pad("USD", 8) + (kind === "image" ? pad("imgTok", 8) : ""),
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
          pad(sum(hits, (h) => h.collapsed), 5) + pad(sum(hits, (h) => h.decensored), 7) + pad(p50, 7) + pad(sum(hits, (h) => h.usd ?? 0).toFixed(3), 8) +
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

  console.log("\narm".padEnd(17) + pad("text", 6) + pad("image", 6) + pad("cached", 7) + pad("to call", 8) + pad("est USD", 9) + "  reader");
  let estimate = 0;
  for (const arm of singles) {
    const mine = jobs.filter((j) => j.arm === arm);
    const cached = mine.filter((j) => loadPersisted(arm.id, j.page.slug)).length;
    const toCall = mine.filter((j) => !loadPersisted(arm.id, j.page.slug));
    const usd = sum(toCall, (j) => arm.estimateUsd[j.page.kind] ?? 0);
    estimate += usd;
    console.log(
      arm.id.padEnd(17) + pad(mine.filter((j) => j.page.kind === "text").length, 6) + pad(mine.filter((j) => j.page.kind === "image").length, 6) +
        pad(cached, 7) + pad(toCall.length, 8) + pad(usd.toFixed(2), 9) + `  ${arm.reader.provider ?? "anthropic"}:${arm.reader.model}${arm.reader.mediaResolution ? "/" + arm.reader.mediaResolution : ""}`,
    );
  }
  for (const p of pairs) console.log(`${p.id.padEnd(24)}${pad("offline", 29)}  ${p.label}`);
  console.log(`\nestimated spend for the calls not yet persisted: $${estimate.toFixed(2)} (cap BENCH_MAX_USD=$${MAX_USD})`);

  if (DRY) {
    const gem = singles.find((a) => a.reader.provider === "google");
    if (gem) {
      console.log(`\n# Gemini request shape (${gem.id}; image bytes elided)\n`);
      console.log(JSON.stringify(describeRequest(geminiRequest(gem.reader, { kind: "image", base64: "AAAA", mediaType: "image/png" })), null, 1));
    }
    console.log("\ndry run — nothing was sent. Propose the estimate above before running for real.");
    return;
  }

  // Keys, checked before the first call so a missing one fails the run, not a page.
  const needs = new Set(jobs.filter((j) => !loadPersisted(j.arm.id, j.page.slug)).map((j) => j.arm.reader.provider ?? "anthropic"));
  const keys = { anthropic: process.env.ANTHROPIC_API_KEY ?? "", google: process.env.GEMINI_API_KEY ?? "" };
  for (const p of needs) if (!keys[p]) throw new Error(`${p === "google" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"} not set — set -a; source .env; set +a`);

  const python = pythonWithFitz();
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
      let call: CallResult;
      let imagePath: string | undefined;
      if (page.kind === "text") {
        call = await readText(keys[provider], arm.reader, page.rows!);
      } else {
        let rendered;
        try {
          rendered = renderFor(page, provider, join(OUT, "renders", page.cls), python);
        } catch (e: any) {
          console.log(`${arm.id.padEnd(16)} ${page.slug} render FAILED: ${e?.message ?? e}`);
          continue;
        }
        imagePath = rendered.path;
        call = await readImage(keys[provider], arm.reader, {
          base64: readFileSync(rendered.path).toString("base64"),
          mediaType: rendered.mediaType,
          textLayer: page.rows ? rowsAsText(page.rows) : null,
        });
      }
      spent += call.costUsd;
      const rec: Persisted = { arm: arm.id, cls: page.cls, slug: page.slug, key: page.key, kind: page.kind, image: imagePath, at: new Date().toISOString(), call };
      mkdirSync(join(OUT, arm.id), { recursive: true });
      // Persist a failure too: "Paying twice" applies to knowing it failed.
      writeFileSync(outPath(arm.id, page.slug), JSON.stringify(rec, null, 1));
      appendFileSync(JSONL, JSON.stringify({ ...rec, call: { ...call, extraction: undefined, rows: call.extraction?.measurements.length ?? null } }) + "\n");
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
