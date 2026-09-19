/**
 * The mapping model's eval, shared by its two steps (docs/plans/multi-user.md
 * Goal 1): what the deterministic catalog left null on each fixture, put to
 * the model with the exact prompt the extract worker sends, and the answer
 * judged with the exact gate the portal applies (`judge` in
 * apps/portal/src/lib/aiMapping.ts).
 *
 * Step 1, map_dump.bench.ts, builds one LabReport per fixture out of its
 * printed rows and writes, per fixture, the batches of `mapPrompt()` text
 * (30 names each, `MAP_BATCH`) to results/map_eval/<fixture>.json. The model
 * is then run either as a subagent handed the system prompt and one batch
 * verbatim (no spend), or through the API (map_api.bench.ts); each writes the
 * tool input JSON to results/map_eval/out/<arm>/<fixture>.<batch>.json.
 *
 * Step 2, map_score.bench.ts, shapes those answers with `toSuggestions`, runs
 * `judge` over them and scores every name against the fixture's truth.
 *
 * Six columns, never averaged — the first is the only one that must be zero:
 *   applied wrong    — filed without a click onto an id the truth does not name
 *   applied right    — filed without a click onto the truth's id
 *   shown right      — a catalog suggestion the truth confirms, left for a click
 *                      (medium/low confidence, or the evidence gate refused it)
 *   shown wrong      — a catalog suggestion the truth denies, left for a click
 *   left alone       — unknown, new, or not_blood where the truth names an id
 *                      or NEW: nothing filed, the person decides
 *   parked/new right — not_blood on urine, new on NEW:, as the truth says
 *   traps            — of the truth's `wrong` ids, how many the model named
 *                      (applied or shown); a sub-count of the wrong columns
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type AnalyteDef,
  type LabReport,
  type Measurement,
  type Observed,
  type TextRow,
  type UnmappedAnalyte,
  NUMERIC_CELL,
  Registry,
  findUnmapped,
  normalizeMeasurement,
  observedStats,
  trendable,
} from "@bw/lab-core";
import { MAP_BATCH, SYSTEM_MAP, mapPrompt, type CatalogEntry, type NameToMap } from "@bw/extraction";

import { labFixtureDirs, pdfPages, printedRows, readTruth, type Truth } from "../../packages/lab-core/tests/labFixtures";

export const ROOT = new URL("../../", import.meta.url).pathname;
export const OUT = join(ROOT, "tests/bench/results/map_eval");
const SYNTHETIC = join(ROOT, "packages/lab-core/tests/fixtures/labs");
const BIOLAB = join(ROOT, "data/real_seed/biolab");

/** The fixtures: the four synthetic labs and, when present, the git-ignored BioLAB payloads. */
export function fixtures(): Array<{ slug: string; dir: string }> {
  const dirs = labFixtureDirs(SYNTHETIC).map((dir) => ({ slug: dir.split("/").pop()!, dir }));
  if (existsSync(BIOLAB)) dirs.push({ slug: "biolab", dir: BIOLAB });
  return dirs;
}

export function shippedRegistry(): Registry {
  const defs = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf-8")) as AnalyteDef[];
  return new Registry(defs);
}

export function catalogOf(registry: Registry): CatalogEntry[] {
  return [...registry.analytes.values()].map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));
}

const VALUE = /^[<>]?\s*-?\d+(?:[,.]\d+)?\s*\*?$/;
const RANGE = /^(?:[<>]\s*-?\d+(?:[,.]\d+)?|-?\d+(?:[,.]\d+)?\s*[-–]\s*-?\d+(?:[,.]\d+)?)$/;
const FLAG = /^(?:H|L|HH|LL|\*|!|\+|-)$/;

/**
 * A printed row as a Measurement: the cells after the name read for the value,
 * the interval (one cell, or two numeric cells on a split layout) and the unit
 * — the truth's printed unit when it has one, because the unit column is the
 * one thing the layouts disagree on most and the truth was written from the
 * sheet.
 */
function measurementOf(name: string, row: TextRow, page: number, index: number, unitHint: string): Measurement {
  const cells = row.cells.map((c) => c.trim());
  // The name may span several cells; the value is the first numeric cell
  // after the last cell that is part of the name.
  const nameCells = name.split(/\s+/);
  let start = 0;
  for (let i = 0; i < cells.length; i++) if (nameCells.includes(cells[i]) || name.startsWith(cells[i])) start = i + 1;
  const rest = cells.slice(start);
  const vi = rest.findIndex((c) => VALUE.test(c) || NUMERIC_CELL.test(c));
  const valueRaw = vi >= 0 ? rest[vi].replace(/\s*\*$/, "") : rest[0] ?? "";
  const after = vi >= 0 ? rest.slice(vi + 1) : rest.slice(1);
  let refRangeRaw = "";
  const numeric = after.filter((c) => NUMERIC_CELL.test(c));
  const ranged = after.find((c) => RANGE.test(c));
  if (ranged) refRangeRaw = ranged;
  else if (numeric.length >= 2) refRangeRaw = `${numeric[0]} - ${numeric[1]}`;
  const unitRaw = unitHint || after.find((c) => !NUMERIC_CELL.test(c) && !RANGE.test(c) && !FLAG.test(c) && c.length <= 14) || "";
  return normalizeMeasurement({
    rawAnalyteName: name,
    valueRaw,
    unitRaw,
    refRangeRaw,
    sourceSnippet: cells.join(" | "),
    rowIndex: index,
    sourcePage: page,
    confidence: "high",
    canonicalId: null,
    value: null,
    unit: null,
    refRangeLow: null,
    refRangeHigh: null,
    refRangeText: null,
    flag: "unknown" as Measurement["flag"],
    extractedBy: "fixture",
    escalated: false,
    disagreement: null,
    corrected: false,
  } as Measurement);
}

/** One LabReport per fixture, matched by the shipped registry exactly as the portal would. */
export async function reportsOf(dir: string, registry: Registry): Promise<LabReport[]> {
  const pdf = join(dir, "report.pdf");
  if (existsSync(pdf)) {
    const truth = readTruth(dir);
    const pages = await pdfPages(pdf);
    const measurements = printedRows(pages).map((r) => {
      const m = measurementOf(r.name, r.rows[r.index], r.page, r.index, truth[r.name]?.unit ?? "");
      m.canonicalId = registry.matchRow(r.name, r.rows, r.index);
      return m;
    });
    return [
      {
        id: `fixture-${dir.split("/").pop()}`,
        sourceFile: "report.pdf",
        reportDate: "2026-01-15",
        labName: null,
        patientName: null,
        patientId: null,
        pages: pages.map((rows, i) => ({ pageNum: i + 1, imageUrl: "", imageWidth: 0, imageHeight: 0, rows })),
        measurements,
      },
    ];
  }
  return readdirSync(dir)
    .filter((f) => f.startsWith("report_") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as LabReport)
    .map((r) => ({ ...r, measurements: r.measurements.map((m) => ({ ...m, canonicalId: registry.match(m.rawAnalyteName) })) }));
}

export function truthOf(dir: string): Truth {
  const raw = JSON.parse(readFileSync(join(dir, "truth.json"), "utf-8")) as { names?: Record<string, string> };
  if (raw.names) return Object.fromEntries(Object.entries(raw.names).map(([k, v]) => [k, { answer: v, unit: "", note: "" }]));
  return readTruth(dir);
}

export interface Batch {
  n: number;
  names: NameToMap[];
  prompt: string;
}

export interface Dump {
  slug: string;
  system: string;
  batches: Batch[];
  /** Every name the model is asked about, with the truth beside it — for the scorer, never for the model. */
  asked: string[];
}

/** What the model is asked on a fixture: the unmapped, trendable names in batches of MAP_BATCH. */
export function dumpOf(slug: string, reports: LabReport[], catalog: CatalogEntry[]): { dump: Dump; unmapped: UnmappedAnalyte[]; stats: Map<string, Observed> } {
  const unmapped = findUnmapped(reports).filter(trendable);
  const stats = observedStats(reports);
  const names: NameToMap[] = unmapped.map((a) => ({ rawName: a.rawName, unit: a.unitRaw, refRange: a.refRangeRaw, material: a.material }));
  const batches: Batch[] = [];
  for (let i = 0; i < names.length; i += MAP_BATCH) {
    const slice = names.slice(i, i + MAP_BATCH);
    batches.push({ n: batches.length + 1, names: slice, prompt: mapPrompt(slice, catalog) });
  }
  return { dump: { slug, system: SYSTEM_MAP, batches, asked: names.map((n) => n.rawName) }, unmapped, stats };
}
