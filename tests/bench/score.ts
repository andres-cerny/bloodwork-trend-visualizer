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
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isPrintedOnPage, type TextRow } from "@bw/lab-core";

export interface RawMeasurement {
  raw_analyte_name?: string;
  value_raw?: string;
  unit_raw?: string;
  ref_range_raw?: string;
  source_snippet?: string;
  row_index?: number;
  confidence?: string;
  source_page?: number;
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

export function isMeasurementRow(row: RawMeasurement | null | undefined): boolean {
  const v = (row?.value_raw ?? "").trim();
  return v !== "" && !BARE_MARKERS.has(v);
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

/** Whitespace-insensitive, otherwise exact — the decimal comma must survive. */
function sameText(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").replace(/\s+/g, "") === (b ?? "").replace(/\s+/g, "");
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
    if (!sameText(b.value_raw, a.value_raw))
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
    .replace(/[!*]/g, " ")
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
 */
export function censoredLostMarker(baselineValue: string, armValue: string): boolean {
  const hadMarker = /^[<>]/.test(baselineValue.trim());
  const hasMarker = /^[<>]/.test(armValue.trim());
  return hadMarker && !hasMarker;
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
 * `isMeasurementRow`. Values are compared with
 * whitespace squashed and the lab's own `!`/`*` markers stripped, because
 * `normalize()` strips them before parsing — a dropped marker is not a wrong
 * number. The decimal comma survives.
 */
export const squash = (x: string | undefined): string => (x ?? "").replace(/\s+/g, "");
export const valKey = (x: string | undefined): string => squash(x).replace(/[!*]/g, "");

export interface ValueErrors {
  /** Truth rows that carry a value — marker rows are not counted. */
  truthRows: number;
  /** Truth rows dropped by `isMeasurementRow`, reported so the drop is visible. */
  markerRows: number;
  readRows: number;
  matched: number;
  errors: Array<{ name: string; truth: string; read: string }>;
  missing: string[];
  extra: string[];
}

export function valueErrors(
  read: RawMeasurement[],
  truth: RawMeasurement[],
  opts?: MatchOptions,
): ValueErrors {
  const key = aliasedNameKey(opts);
  const rows = truth.filter(isMeasurementRow);
  const free = read.map((m) => m);
  const out: ValueErrors = {
    truthRows: rows.length,
    markerRows: truth.length - rows.length,
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
  readA: RawMeasurement[] | null,
  readB: RawMeasurement[] | null,
  truth: RawMeasurement[],
  opts?: MatchOptions,
): PairStats {
  const key = aliasedNameKey(opts);
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
