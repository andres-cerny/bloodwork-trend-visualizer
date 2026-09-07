/**
 * Scoring. Three separate columns, never averaged into one number — they fail
 * in different ways and a single "accuracy %" would hide the one that matters.
 *
 *  1. `scoreAgainstBaseline` — agreement with data/reports/*.json. That file is
 *     the *incumbent's output*, not truth. A disagreement is a case to
 *     adjudicate, never automatically the new arm's error; scoring it as error
 *     would reward imitating Sonnet 5 rather than reading the page.
 *  2. `fabrications` — values the arm returned that are not printed anywhere on
 *     the page. This one *is* objective, and it is the only one where a
 *     non-zero result is disqualifying rather than interesting.
 *  3. `rangeIntegrity` — the named check. See below.
 *
 * One cross-cutting rule, stated once at `stripValueMarkers` and used by every
 * value comparison here: the lab's printed out-of-range markers (`!`, `*`, `↑`,
 * `↓`) are decoration on a number, not the number, exactly as `normalize()`
 * treats them. Keeping one and dropping one are both faithful reads, so
 * neither is charged a value error. Digits, the decimal comma and the `<`/`>`
 * censors are untouched.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MATERIAL_CODES,
  compartmentCompatible,
  isPrintedOnPage,
  materialPrefix,
  materialWord,
  printedMaterial,
  sectionMaterial,
  type TextRow,
} from "@bw/lab-core";

export interface RawMeasurement {
  raw_analyte_name?: string;
  value_raw?: string;
  unit_raw?: string;
  ref_range_raw?: string;
  source_snippet?: string;
  row_index?: number;
  confidence?: string;
  source_page?: number;
  /**
   * Printed context a **truth** row carries and a model's answer never does:
   * the sheet's `Materiál` cell (`material`), the block heading above the row
   * (`section`, `group`), and the code `printedMaterial()` read off the page
   * (`printed_material`). Attached by the corpus loaders in corpora.ts and by
   * `annotateMaterial` below; see `scopeExclusion`.
   */
  material?: string;
  section?: string;
  group?: string;
  printed_material?: string;
}

/* ---------------------------------------------------------------- baseline */

export interface BaselinePage {
  file: string;
  pageNum: number;
  measurements: RawMeasurement[];
}

/**
 * The 15 accepted reports, indexed by source PDF and page.
 *
 * Keyed off `source_file` rather than the report id, because the id carries a
 * content hash that says nothing about which sample it came from.
 */
export function loadBaseline(): Map<string, RawMeasurement[]> {
  const out = new Map<string, RawMeasurement[]>();
  for (const f of readdirSync("data/reports").filter((x) => x.endsWith(".json"))) {
    const report = JSON.parse(readFileSync(join("data/reports", f), "utf8"));
    const src: string = (report.source_file ?? "").split(/[\\/]/).pop() ?? "";
    if (!src) continue;
    for (const m of report.measurements ?? []) {
      const key = `${src}#${m.source_page ?? 1}`;
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(m);
    }
  }
  return out;
}

/** Loose key for lining the same printed row up across two extractions. */
export function nameKey(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/* ------------------------------------- two rules the adjudication settled */

/**
 * A marker row is not a measurement.
 *
 * AGILAB prints `KO+diferenciál 5p.` — the name of the panel the rows below
 * belong to — in the analyte column, with a bare `#` where a value would be,
 * and the text-layer baseline in `data/reports` carries it as a row. No reader
 * that looks at the page returns it, and none should: there is no number to be
 * right or wrong about. Counting it charged every reader four misses per shot
 * for the one thing they all got right, so a truth row whose `value_raw` is a
 * bare marker (`#`, `*`, `-`, `—`) or blank is dropped from truth before
 * scoring. It is dropped from *truth* only — a reader that emits such a row is
 * still charged an extra, which is the signal we want to keep.
 */
const BARE_MARKERS = new Set(["#", "*", "-", "—"]);

/* ------------------------------------------------------- D0: what a row is */

/**
 * **The scope rule** (docs/plans/lab-adaptability.md, Phase D, D0).
 *
 * The app tracks *blood analytes over time*, so a printed line is in scope
 * when it reports one. Five shapes are not, and each is decided here rather
 * than in the prompt, because code can see the whole page and the model
 * cannot see what the product is for:
 *
 *   material        urine and every other non-blood material. Never matched
 *                   on the analyte's name — the code comes from the same
 *                   machinery the app uses (`materialPrefix`, `materialWord`,
 *                   `sectionMaterial`, folded into `printedMaterial`), so a
 *                   prefix-free `Glukóza` under a `Moč chemicky` heading is
 *                   caught and a serum one beside it is not.
 *   anthropometric  a patient's weight or height. Not an analyte.
 *   toxicology      a screen printed under a `Toxikologie` heading — a
 *                   different kind of test, and `S_Etanol` sits in it, so
 *                   this cannot be a material rule.
 *   auxiliary       specimen handling: the `POMOCNÉ` block, `S_Separace séra`.
 *   receipt         `Krev srážlivá | přijato` under `Typ primárního vzorku`:
 *                   an acknowledgement that a tube arrived, with no analyte,
 *                   no unit and no range.
 *
 * **The asymmetry is deliberate and is the whole point of D0.** A blood
 * analyte whose printed *result* is a status — `málo materiálu`,
 * `neprovedeno` — stays. It explains an absent value, `correction.ts` says
 * such results "must survive verbatim", and without it a vanished TSH is
 * indistinguishable from a reading failure. Material decides scope; the
 * result's shape never does. `přijato` is not a counter-example: it is
 * receipt vocabulary on a row that reports no analyte at all.
 */
export type OutOfScope = "receipt" | "anthropometric" | "auxiliary" | "toxicology" | "material";

const fold = (s: string | undefined): string =>
  (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Folded, with every separator turned into a space, so `\b` works on `Pt_Hmotnost`. */
const words = (s: string | undefined): string => fold(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Weight and height, in Czech and Slovak. `Stred.hmot.HGB` is not `hmotnost`. */
const ANTHROPOMETRIC = /\b(?:hmotnost|hmotnosti|vaha|vahy|vyska|vysky|telesna)\b/;
/** Specimen handling printed as a row. */
const AUXILIARY = /\b(?:separace|separacia)\b.*\b(?:sera|seru)\b|\bpomocne\b/;
/** Receipt vocabulary — an arrival, not a result. */
const RECEIPT = /^(?:prijato|prijate|prijata|prijaty|dorucen)/;

/**
 * A block heading read through `sectionMaterial`'s own table, so the bench and
 * the app agree on what `Moč - odpady` means. The row is synthetic: a
 * single-cell heading is exactly the shape that function walks up to, and it
 * reads nothing but `cells`.
 */
function headingMaterial(text: string | undefined): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  return sectionMaterial([{ cells: [t] } as TextRow], 0);
}

/**
 * The material printed for a row: its own prefix first (closest to the
 * analyte), then its `Materiál` cell, then whatever the page said —
 * `printed_material`, which the corpus loader computed with
 * `printedMaterial()` over the real text rows — then its block heading.
 *
 * A prefix outside `MATERIAL_CODES` is ignored, exactly as `registry.ts`
 * ignores it: `xxx_eGF (CKD-EPI)` and `Pt_Hmotnost pacienta` are not
 * declaring a material, and treating an unknown code as non-blood would drop
 * five real serum rows from the truth.
 */
export function rowMaterialCode(row: RawMeasurement | null | undefined): string | null {
  if (!row) return null;
  const prefix = materialPrefix(row.raw_analyte_name);
  if (prefix && MATERIAL_CODES.has(prefix)) return prefix;
  return (
    materialWord(row.material ?? "") ??
    row.printed_material ??
    headingMaterial(row.section) ??
    headingMaterial(row.group) ??
    null
  );
}

/** Why D0 puts this row out of scope, or null when it is a blood result. */
export function scopeExclusion(row: RawMeasurement | null | undefined): OutOfScope | null {
  if (!row) return null;
  const name = words(row.raw_analyte_name);
  const value = words(row.value_raw);
  const blank = (s: string | undefined) => !(s ?? "").trim();
  if (RECEIPT.test(value) && blank(row.unit_raw) && blank(row.ref_range_raw)) return "receipt";
  if (ANTHROPOMETRIC.test(name)) return "anthropometric";
  if (AUXILIARY.test(name) || AUXILIARY.test(words(row.section)) || AUXILIARY.test(words(row.group))) return "auxiliary";
  if (/\btoxikolog/.test(words(row.section)) || /\btoxikolog/.test(words(row.group))) return "toxicology";
  const code = rowMaterialCode(row);
  if (code && !compartmentCompatible(code, "s")) return "material";
  return null;
}

/** In scope for the product: a blood analyte's row, number or status. */
export const inScope = (row: RawMeasurement | null | undefined): boolean => scopeExclusion(row) === null;

export function isMeasurementRow(row: RawMeasurement | null | undefined): boolean {
  const v = (row?.value_raw ?? "").trim();
  if (v === "" || BARE_MARKERS.has(v)) return false;
  return inScope(row);
}

/**
 * The material a page printed for each truth row, attached to the row.
 *
 * The truth for the real and photo classes is `data/reports`, whose rows carry
 * a name, a value and the printed snippet but no block heading — so the
 * material has to come from the page itself. Each row is located on the
 * printed rows by its name and value (the same join `repairRowIndex` uses),
 * and `printedMaterial()` reads the column or the heading above it. A row that
 * cannot be located keeps no material and therefore stays in scope: the
 * failure mode is "counted", never "silently dropped".
 */
export function annotateMaterial(truth: RawMeasurement[], rows: TextRow[] | null | undefined): RawMeasurement[] {
  if (!rows?.length) return truth;
  const used = new Set<number>();
  return truth.map((t) => {
    const k = nameKey(t.raw_analyte_name);
    const v = valKey(t.value_raw);
    for (let i = 0; i < rows.length; i++) {
      if (used.has(i)) continue;
      const text = rows[i].cells.join(" ");
      if (k && !nameKey(text).includes(k)) continue;
      if (v && !valKey(text).includes(v)) continue;
      used.add(i);
      const code = printedMaterial(rows, i)?.code;
      return code ? { ...t, printed_material: code } : t;
    }
    return t;
  });
}

/**
 * Read rows that stand for a row D0 puts out of scope.
 *
 * They are dropped from the *read* as well as from the truth, and that is not
 * the rule bare markers get. The prompt deliberately never mentions urine —
 * material is handled deterministically and the model is asked to transcribe
 * what it sees — so charging a reader an "extra" for a urine row it was told
 * to return would score obedience as error. The app does the same thing in
 * the same order: the model transcribes the page, then lab-core drops what is
 * not a blood analyte.
 *
 * Two ways in: the read row says so itself (a `U_` prefix, `přijato`), or it
 * lines up by name with a truth row that was dropped — which is how a
 * prefix-free urine `Glukóza` is recognised without the page in hand.
 */
export function inScopeReads(
  read: RawMeasurement[],
  truth: RawMeasurement[],
  key: (n: string | undefined) => string,
): RawMeasurement[] {
  const dropped = new Map<string, number>();
  for (const t of truth) {
    if (inScope(t)) continue;
    const k = key(t.raw_analyte_name);
    dropped.set(k, (dropped.get(k) ?? 0) + 1);
  }
  return read.filter((m) => {
    if (!inScope(m)) return false;
    const k = key(m.raw_analyte_name);
    const n = dropped.get(k) ?? 0;
    if (n > 0) {
      dropped.set(k, n - 1);
      return false;
    }
    return true;
  });
}

/**
 * Page-specific printed-name aliases.
 *
 * `20_10_6` p1 clips its analyte column: the sheet shows `Vazebná kapacita I`
 * — the first stroke of `Fe` — where the text layer the truth came from has
 * `Vazebná kapacita Fe`. A reader transcribing what is visible is right, and
 * both readers returned the correct 69,6. The alias makes that a match without
 * hand-editing the truth.
 *
 * Keyed by page (`<source_file>#<page>`, a two-page read joining two with `+`)
 * and never global: the other AGILAB pages print the same analytes in full, and
 * a global alias would match those on a prefix and hide a genuine miss.
 */
export type TruthAliases = Record<string, Record<string, string[]>>;

const ALIAS_FILE = fileURLToPath(new URL("truth_aliases.json", import.meta.url));
let aliasCache: TruthAliases | null = null;

export function loadTruthAliases(path: string = ALIAS_FILE): TruthAliases {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const out: TruthAliases = {};
    for (const [page, names] of Object.entries(raw)) {
      // `_about` carries the reason the file exists; it is not a page.
      if (page.startsWith("_") || !names || typeof names !== "object") continue;
      out[page] = names as Record<string, string[]>;
    }
    return out;
  } catch {
    return {};
  }
}

export interface MatchOptions {
  /** `<source_file>#<page>`; without it no alias applies. */
  pageKey?: string;
  /** Defaults to tests/bench/truth_aliases.json, read once. */
  aliases?: TruthAliases;
}

/**
 * `nameKey`, plus this page's aliases folded onto the truth's own key. Falls
 * back to plain `nameKey` when the page has none, so every other page is
 * matched exactly as before.
 */
export function aliasedNameKey(opts?: MatchOptions): (name: string | undefined) => string {
  if (!opts?.pageKey) return nameKey;
  const table = opts.aliases ?? (aliasCache ??= loadTruthAliases());
  const map = new Map<string, string>();
  for (const part of opts.pageKey.split("+")) {
    for (const [truthName, printed] of Object.entries(table[part.trim()] ?? {})) {
      for (const p of printed ?? []) map.set(nameKey(p), nameKey(truthName));
    }
  }
  if (!map.size) return nameKey;
  return (name) => {
    const k = nameKey(name);
    return map.get(k) ?? k;
  };
}

/* ------------------------------ the printed out-of-range marker, stated once */

/**
 * Whitespace squashed, and nothing else. The decimal comma must survive: `5,32`
 * and `5.32` are different numbers and this file will always say so.
 */
export const squash = (x: string | undefined): string => (x ?? "").replace(/\s+/g, "");

/**
 * The markers a Czech lab prints *beside* a value to say it is out of range.
 *
 * Exactly the set `parseValue()` in packages/lab-core/src/normalize.ts strips
 * before parsing (`VALUE_MARKERS` there): `!`, `*`, `↑`, `↓`. They are
 * decoration on the number, never part of it — the deployed app throws them
 * away and computes the flag from the reference interval instead.
 */
const VALUE_MARKERS = /[!*↑↓]/g;

/**
 * **The one rule this file has about markers, and it lives here.**
 *
 * Two readers can be equally right about `53,1 !` — the deployed prompt asks
 * for the row as printed, so keeping the `!` is faithful; `normalize()` drops
 * it a moment later, so dropping it loses nothing. Whichever way the truth
 * happens to have been recorded, charging the other reader a *value error* is
 * a claim about the number, and there is no disagreement about the number.
 *
 * So every comparison of a **value** in this file goes through `valKey`, and
 * the asymmetry that made this rule necessary is worth naming: `valueErrors`
 * already used `valKey` while `scoreAgainstBaseline` compared values
 * text-exact, so the same pair of reads scored clean on a photo page and as 25
 * value errors on the born-digital page beside it. One rule, one place.
 *
 * What it deliberately does **not** do:
 *
 *   - it never touches a digit, a decimal comma or a decimal point, so a
 *     genuine misread (`358` against `359`, `5,32` against `5.32`) still
 *     counts, exactly as before;
 *   - it never touches `<` or `>`. Those are censors, not markers: `<1,0`
 *     means "below the assay floor" and turning it into `1,0` invents a
 *     result. `censoredLostMarker` is the guard for that and it runs on the
 *     marker-stripped string, so a censor is caught whether or not a `!`
 *     stands beside it;
 *   - it never empties a cell. A value that is *nothing but* markers (`*`, the
 *     panel row AGILAB prints where a number would go) keeps its printed form,
 *     so it can never fold together with a blank and match by accident.
 *     `isMeasurementRow` is what drops those from truth.
 *
 * Units and reference ranges are compared with `sameText` — text-exact once
 * whitespace is squashed — because the out-of-range marker is decoration on a
 * *value*; a unit and an interval do not carry one, and folding `*` out of a
 * printed range would hide a real difference rather than a notational one.
 * Analyte names need no rule of their own: `nameKey` already drops every
 * non-alphanumeric, markers included.
 *
 * (tests/bench/subagent_score.bench.ts keeps its own two-line copy of this fold
 * for a different, already-published run. It is not imported from here on
 * purpose — re-defining it there would silently restate that benchmark's
 * numbers — but if a third copy is ever wanted, import this one instead.)
 */
export function stripValueMarkers(s: string): string {
  const bare = s.replace(VALUE_MARKERS, "");
  return bare === "" ? s : bare;
}

/** The comparison key for a **value**. See `stripValueMarkers`. */
export const valKey = (x: string | undefined): string => stripValueMarkers(squash(x));

/**
 * Whitespace-insensitive, otherwise exact — the decimal comma must survive.
 *
 * For units and ranges only. Values go through `valKey`; see above for why the
 * two are different and why that difference is not an oversight.
 */
function sameText(a: string | undefined, b: string | undefined): boolean {
  return squash(a) === squash(b);
}

export interface BaselineScore {
  baselineRows: number;
  armRows: number;
  matched: number;
  missing: string[];
  extra: string[];
  valueMismatch: Array<{ name: string; baseline: string; arm: string }>;
  unitMismatch: Array<{ name: string; baseline: string; arm: string }>;
  rangeMismatch: Array<{ name: string; baseline: string; arm: string }>;
}

/**
 * Index measurements by analyte name, keeping *every* occurrence.
 *
 * A single lab page legitimately prints the same analyte twice — a
 * differential count gives `B_Neutrofily` as both a fraction (0,527) and an
 * absolute count (# 2,900, 10^9/l), on two separate printed rows. An earlier
 * version of this file used a plain `Map`, so the second row silently
 * overwrote the first and every arm was charged seven phantom value
 * disagreements on that page. The measurement instrument was wrong, not the
 * arms — which is exactly the failure mode this benchmark exists to catch, so
 * it gets a named test rather than a quiet fix.
 */
function indexByName(ms: RawMeasurement[]): Map<string, RawMeasurement[]> {
  const out = new Map<string, RawMeasurement[]>();
  for (const m of ms) {
    const k = nameKey(m.raw_analyte_name);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(m);
  }
  return out;
}

export function scoreAgainstBaseline(
  baseline: RawMeasurement[],
  arm: RawMeasurement[],
): BaselineScore {
  // Occurrences are consumed in printed order, so the first baseline
  // `B_Neutrofily` is compared against the first one the arm returned.
  const byName = indexByName(arm);
  const taken = new Map<string, number>();

  const score: BaselineScore = {
    baselineRows: baseline.length,
    armRows: arm.length,
    matched: 0,
    missing: [],
    extra: [],
    valueMismatch: [],
    unitMismatch: [],
    rangeMismatch: [],
  };

  for (const b of baseline) {
    const k = nameKey(b.raw_analyte_name);
    const n = taken.get(k) ?? 0;
    const a = byName.get(k)?.[n];
    if (!a) {
      score.missing.push(b.raw_analyte_name ?? "?");
      continue;
    }
    taken.set(k, n + 1);
    score.matched++;
    const name = b.raw_analyte_name ?? "?";
    // Values through `valKey`, units and ranges through `sameText` — the one
    // marker rule, stated at `stripValueMarkers`.
    if (valKey(b.value_raw) !== valKey(a.value_raw))
      score.valueMismatch.push({ name, baseline: b.value_raw ?? "", arm: a.value_raw ?? "" });
    if (!sameText(b.unit_raw, a.unit_raw))
      score.unitMismatch.push({ name, baseline: b.unit_raw ?? "", arm: a.unit_raw ?? "" });
    if (!sameText(b.ref_range_raw, a.ref_range_raw))
      score.rangeMismatch.push({ name, baseline: b.ref_range_raw ?? "", arm: a.ref_range_raw ?? "" });
  }
  // Anything the arm returned beyond the occurrences the baseline accounted
  // for is extra — counted per occurrence, not per name.
  for (const [k, ms] of byName) {
    for (let i = taken.get(k) ?? 0; i < ms.length; i++) {
      score.extra.push(ms[i].raw_analyte_name ?? "?");
    }
  }
  return score;
}

/* ------------------------------------------------------------ fabrication */

/**
 * Values the arm returned that are printed nowhere on the page.
 *
 * Objective, and disqualifying: the whole premise of the text path is that
 * characters come from the file, so anything else is invention.
 */
export function fabrications(arm: RawMeasurement[], rows: TextRow[]): string[] {
  const bad: string[] = [];
  for (const m of arm) {
    for (const field of ["value_raw", "unit_raw", "ref_range_raw"] as const) {
      const v = (m as any)[field] as string | undefined;
      if (v && v.trim() && !isPrintedOnPage(v, rows)) {
        bad.push(`${m.raw_analyte_name ?? "?"}.${field}="${v}"`);
      }
    }
  }
  return bad;
}

/* --------------------------------------------- the merged-row guard */

/**
 * Did the reader fuse two printed rows into one record?
 *
 * This is the fault that disqualified Docling (docs/extraction-speed.md, "A7,
 * Docling — the layout-parser family, properly tested"): on some layouts it
 * merged adjacent printed rows, so one record came back as
 *
 *     Glukóza Cholesterol       range = "3,6 - 5,6 2,9 - 5,0"
 *     Monocyty Eozinofily       range = "2,0 - 12,0 0,0 - 5,0"
 *
 * — two analytes in one name, two reference intervals in one range. Nothing in
 * the existing scorer catches it. `matched` sees a name it cannot line up and
 * charges a miss plus an extra; the value column stays clean, because neither
 * number is *wrong*, they are merely both there. A reader could fuse half a
 * page and still show zero value errors.
 *
 * Every layout parser is in that risk class, so the column is printed for
 * **every** arm, not only for the layout-parser ones — a column that only ever
 * appears next to the suspect is not a control.
 *
 * Three independent rules; a row is reported once, listing each that fired:
 *
 *  1. **range** — `ref_range_raw` carries two complete intervals. A complete
 *     interval is two numbers with a dash (or `až`) between them, so
 *     `3,6 - 5,6 2,9 - 5,0` fires and `( 2,5000 - 6,4000 )` does not. The
 *     collapsed-separator fault `4,115,60` is *not* this rule's business —
 *     `looksCollapsed` owns it, and neither guard is allowed to cover for the
 *     other.
 *  2. **value** — `value_raw` carries two numbers where one is expected. Two
 *     deliberate exemptions, because a false positive here would be printed
 *     against every arm: a Czech thousands group (`10 000`, `2 900` — a space
 *     followed by exactly three digits is joined onto the number before it,
 *     which also means a genuine `141 138` is read conservatively as one
 *     number and missed), and a printed date (`21.05.2024`). A censor
 *     (`<1,0`), the lab's `!`/`*` markers and a qualifier (`1,0 pozitívne`)
 *     are one number each. A value that is itself an interval is skipped —
 *     that is a range in the wrong column, a different fault.
 *  3. **name** — `raw_analyte_name` concatenates two names that each appear as
 *     a *separate truth row on that page*. Checked only against the page's own
 *     truth, and only when the whole name is not itself a truth row, so
 *     `Vazebná kapacita Fe` is safe wherever the page really prints it. Names
 *     are keyed through `aliasedNameKey`, like every other match here. Without
 *     truth this rule cannot fire and is skipped.
 */
export interface MergedRow {
  name: string;
  /** Every rule that fired on this row. */
  reasons: Array<"range" | "value" | "name">;
  value_raw: string;
  ref_range_raw: string;
}

/** Rule 1's primitive: how many complete printed intervals are in this string? */
export function countIntervals(s: string | undefined): number {
  if (!s) return 0;
  const re = /-?\d+(?:[.,]\d+)?\s*(?:-|–|—|až)\s*-?\d+(?:[.,]\d+)?/g;
  return (s.match(re) ?? []).length;
}

/** Rule 1. */
export function twoIntervals(range: string | undefined): boolean {
  return countIntervals(range) >= 2;
}

/** Rule 2. */
export function twoValues(value: string | undefined): boolean {
  const raw = (value ?? "").trim();
  if (!raw) return false;
  // A date is one printed thing, however many digit runs it holds.
  if (/\d{1,4}\s*[./]\s*\d{1,2}\s*[./]\s*\d{2,4}/.test(raw)) return false;
  // A range printed in the value column is a different fault, not a merge.
  if (countIntervals(raw) >= 1) return false;
  const t = raw
    // The same marker set `stripValueMarkers` folds — one number, decorated.
    .replace(VALUE_MARKERS, " ")
    .replace(/[<>]/g, " ")
    // Czech thousands: a space before exactly three digits belongs to the
    // number in front of it. Conservative on purpose — see the header.
    .replace(/(\d)[\s ](?=\d{3}(?!\d))/g, "$1");
  return (t.match(/-?\d+(?:[.,]\d+)?/g) ?? []).length >= 2;
}

/** Rule 3. */
export function nameFusesTwoTruthRows(
  name: string | undefined,
  truth: RawMeasurement[],
  key: (n: string | undefined) => string,
): boolean {
  const printed = (name ?? "").trim();
  if (!printed) return false;
  const truthKeys = new Set(truth.filter(isMeasurementRow).map((t) => key(t.raw_analyte_name)).filter(Boolean));
  if (truthKeys.has(key(printed))) return false; // the whole name is a real row
  const words = printed.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const left = key(words.slice(0, i).join(" "));
    const right = key(words.slice(i).join(" "));
    if (left && right && left !== right && truthKeys.has(left) && truthKeys.has(right)) return true;
  }
  return false;
}

/**
 * Rows this read fused. `truth` is optional; without it rule 3 cannot run and
 * only the two self-contained rules apply.
 */
export function mergedRows(
  read: RawMeasurement[],
  truth?: RawMeasurement[] | null,
  opts?: MatchOptions,
): MergedRow[] {
  const key = aliasedNameKey(opts);
  const out: MergedRow[] = [];
  for (const m of read) {
    const reasons: MergedRow["reasons"] = [];
    if (twoIntervals(m.ref_range_raw)) reasons.push("range");
    if (twoValues(m.value_raw)) reasons.push("value");
    if (truth?.length && nameFusesTwoTruthRows(m.raw_analyte_name, truth, key)) reasons.push("name");
    if (reasons.length) {
      out.push({
        name: m.raw_analyte_name ?? "?",
        reasons,
        value_raw: m.value_raw ?? "",
        ref_range_raw: m.ref_range_raw ?? "",
      });
    }
  }
  return out;
}

/* ------------------------------------------------- the named range check */

/**
 * Did a reference range lose its separator?
 *
 * `docs/` records the failure this exists for: a range printed `4,11-5,60`
 * came back as `4,115,60`, which is not a parse error — it is a *plausible
 * wrong number*. Silently corrupting a reference interval is worse than
 * refusing to read it, and low effort or a weaker second reader is exactly
 * where the class would come back.
 *
 * The signal is a single run of digits carrying two or more decimal commas
 * with nothing between them.
 */
export function looksCollapsed(range: string | undefined): boolean {
  if (!range) return false;
  return /\d[\d]*[,.]\d+[,.]\d/.test(range.replace(/\s+/g, ""));
}

/**
 * A censored value must never become a number.
 *
 * `<1,0` means "below the assay's floor". Dropping the `<` turns "we could not
 * measure it" into "it is 1,0", which reads as a real result.
 *
 * `<` and `>` are censors, not out-of-range markers, so `valKey` leaves them
 * alone; running the test on the marker-stripped string is only what makes
 * `! <1,0` and `<1,0` read as the same censored value, so a reader that keeps
 * the lab's `!` is not accused of decensoring.
 */
export function censoredLostMarker(baselineValue: string, armValue: string): boolean {
  const censored = (v: string) => /^[<>]/.test(valKey(v));
  return censored(baselineValue) && !censored(armValue);
}

export interface RangeIntegrity {
  collapsed: Array<{ name: string; range: string }>;
  decensored: Array<{ name: string; baseline: string; arm: string }>;
}

export function rangeIntegrity(
  baseline: RawMeasurement[],
  arm: RawMeasurement[],
): RangeIntegrity {
  const byName = indexByName(baseline);
  const taken = new Map<string, number>();

  const out: RangeIntegrity = { collapsed: [], decensored: [] };
  for (const a of arm) {
    const name = a.raw_analyte_name ?? "?";
    if (looksCollapsed(a.ref_range_raw)) {
      out.collapsed.push({ name, range: a.ref_range_raw ?? "" });
    }
    const k = nameKey(name);
    const n = taken.get(k) ?? 0;
    const b = byName.get(k)?.[n];
    if (b) taken.set(k, n + 1);
    if (b && censoredLostMarker(b.value_raw ?? "", a.value_raw ?? "")) {
      out.decensored.push({ name, baseline: b.value_raw ?? "", arm: a.value_raw ?? "" });
    }
  }
  return out;
}

/* ------------------------------------------- image classes: value errors */

/**
 * Image pages have no rows to check provenance against, so column 2 becomes
 * value errors against hand-verified truth — objective because a human
 * checked the truth, as docs/extraction-speed.md's vision table already did.
 *
 * Matching is the rule subagent_score.bench.ts settled on: a truth row prefers
 * the read row with the same name AND value before falling back to occurrence
 * order, so a differential printed as fractions then absolutes is not charged
 * ten errors for coming back the other way round. Names are keyed through
 * `aliasedNameKey`, so a page whose printed name is clipped can be matched by
 * what it prints; truth rows that are not measurements are dropped first by
 * `isMeasurementRow`. Values are compared through `valKey`, the file's single
 * marker rule — see `stripValueMarkers`, which `scoreAgainstBaseline` now
 * shares, so the same read is scored the same way whether the page was a
 * photograph or a born-digital PDF.
 */

export interface ValueErrors {
  /** Truth rows that carry a value — marker rows are not counted. */
  truthRows: number;
  /** Truth rows dropped as bare markers, reported so the drop is visible. */
  markerRows: number;
  /** Truth rows dropped by D0's scope rule — see `scopeExclusion`. */
  scopeRows: number;
  readRows: number;
  matched: number;
  errors: Array<{ name: string; truth: string; read: string }>;
  missing: string[];
  extra: string[];
}

export function valueErrors(
  readAll: RawMeasurement[],
  truth: RawMeasurement[],
  opts?: MatchOptions,
): ValueErrors {
  const key = aliasedNameKey(opts);
  const rows = truth.filter(isMeasurementRow);
  const scopeRows = truth.filter((t) => !inScope(t)).length;
  const read = inScopeReads(readAll, truth, key);
  const free = read.map((m) => m);
  const out: ValueErrors = {
    truthRows: rows.length,
    // The two drops partition truth: a row out of scope is counted there
    // whatever its value, so the columns still sum to truth.length.
    markerRows: truth.filter((t) => inScope(t) && !isMeasurementRow(t)).length,
    scopeRows,
    readRows: read.length,
    matched: 0,
    errors: [],
    missing: [],
    extra: [],
  };
  for (const t of rows) {
    const k = key(t.raw_analyte_name);
    const same = free.filter((m) => key(m.raw_analyte_name) === k);
    const pick = same.find((m) => valKey(m.value_raw) === valKey(t.value_raw)) ?? same[0];
    if (!pick) {
      out.missing.push(t.raw_analyte_name ?? "?");
      continue;
    }
    free.splice(free.indexOf(pick), 1);
    out.matched++;
    if (valKey(t.value_raw) !== valKey(pick.value_raw)) {
      out.errors.push({ name: t.raw_analyte_name ?? "?", truth: t.value_raw ?? "", read: pick.value_raw ?? "" });
    }
  }
  for (const m of free) out.extra.push(m.raw_analyte_name ?? "?");
  return out;
}

/* ------------------------------------------------- reader pairs, two numbers */

/**
 * Two numbers for a reader pair, never merged: uncaught value errors (both
 * readers wrong the same way — must be 0) and flagged rows (disagreements,
 * the cost of review — reported so it can be judged, not averaged away).
 *
 * Rows are lined up the way `reconcile()` in lab-core does: by analyte name
 * and occurrence. A row both reads carry with one value is *confirmed*; if
 * that agreed value is not the truth's, the pair let it through, and that is
 * an uncaught error. A row with two values, or found by one read only, is
 * *flagged* — `reconcile()` writes `disagreement` on both.
 *
 * The silent-single-reader rule: when one read is missing (the request
 * failed), nothing is confirmed. Every row of the surviving read is flagged
 * (`"druhé čtení se nezdařilo"`), `singleReader` is true, and the surviving
 * read's own value errors are listed under `singleReaderErrors` so the
 * condition is visible per shot rather than hidden in a 0.
 */
export interface PairStats {
  singleReader: boolean;
  confirmedRows: number;
  flaggedRows: number;
  /** Confirmed rows whose agreed value is not the truth (truth "" = a row both invented). */
  uncaughtValueErrors: Array<{ name: string; truth: string; read: string }>;
  /** Flagged rows where at least one read was wrong — the flag earned its keep. */
  caughtValueErrors: number;
  /** Value errors of the one read that came back, when only one did. */
  singleReaderErrors: Array<{ name: string; truth: string; read: string }>;
}

export function pairStats(
  readAllA: RawMeasurement[] | null,
  readAllB: RawMeasurement[] | null,
  truth: RawMeasurement[],
  opts?: MatchOptions,
): PairStats {
  const key = aliasedNameKey(opts);
  // Both reads lose the rows D0 puts out of scope, for the reason given at
  // `inScopeReads`: the app drops them after the model transcribes them, so a
  // pair must be judged on the rows that survive that filter.
  const readA = readAllA && inScopeReads(readAllA, truth, key);
  const readB = readAllB && inScopeReads(readAllB, truth, key);
  const stats: PairStats = {
    singleReader: false,
    confirmedRows: 0,
    flaggedRows: 0,
    uncaughtValueErrors: [],
    caughtValueErrors: 0,
    singleReaderErrors: [],
  };
  if (!readA || !readB) {
    const only = readA ?? readB;
    stats.singleReader = true;
    stats.flaggedRows = only?.length ?? 0;
    if (only) stats.singleReaderErrors = valueErrors(only, truth, opts).errors;
    return stats;
  }

  // Occurrence-ordered pairing by name, like reconcile().
  const byName = (ms: RawMeasurement[]) => {
    const m = new Map<string, RawMeasurement[]>();
    for (const x of ms) {
      const k = key(x.raw_analyte_name);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    return m;
  };
  const a = byName(readA);
  const b = byName(readB);
  const t = byName(truth.filter(isMeasurementRow));
  const keys = new Set([...a.keys(), ...b.keys()]);

  for (const k of keys) {
    const as = a.get(k) ?? [];
    const bs = b.get(k) ?? [];
    const ts = t.get(k) ?? [];
    const n = Math.max(as.length, bs.length);
    for (let i = 0; i < n; i++) {
      const ra = as[i];
      const rb = bs[i];
      const name = (ra ?? rb)?.raw_analyte_name ?? "?";
      // Truth occurrence: prefer the one whose value either read produced.
      const tr =
        ts.find((x) => valKey(x.value_raw) === valKey(ra?.value_raw) || valKey(x.value_raw) === valKey(rb?.value_raw)) ??
        ts[i] ??
        ts[0];
      const truthVal = tr ? valKey(tr.value_raw) : null;
      if (ra && rb && valKey(ra.value_raw) === valKey(rb.value_raw)) {
        stats.confirmedRows++;
        if (truthVal !== valKey(ra.value_raw)) {
          stats.uncaughtValueErrors.push({ name, truth: tr?.value_raw ?? "", read: ra.value_raw ?? "" });
        }
      } else {
        stats.flaggedRows++;
        const wrong = [ra, rb].some((r) => r && truthVal !== null && valKey(r.value_raw) !== truthVal);
        if (wrong) stats.caughtValueErrors++;
      }
    }
  }
  return stats;
}
