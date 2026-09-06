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
 * ten errors for coming back the other way round. Values are compared with
 * whitespace squashed and the lab's own `!`/`*` markers stripped, because
 * `normalize()` strips them before parsing — a dropped marker is not a wrong
 * number. The decimal comma survives.
 */
export const squash = (x: string | undefined): string => (x ?? "").replace(/\s+/g, "");
export const valKey = (x: string | undefined): string => squash(x).replace(/[!*]/g, "");

export interface ValueErrors {
  truthRows: number;
  readRows: number;
  matched: number;
  errors: Array<{ name: string; truth: string; read: string }>;
  missing: string[];
  extra: string[];
}

export function valueErrors(read: RawMeasurement[], truth: RawMeasurement[]): ValueErrors {
  const free = read.map((m) => m);
  const out: ValueErrors = { truthRows: truth.length, readRows: read.length, matched: 0, errors: [], missing: [], extra: [] };
  for (const t of truth) {
    const k = nameKey(t.raw_analyte_name);
    const same = free.filter((m) => nameKey(m.raw_analyte_name) === k);
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
): PairStats {
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
    if (only) stats.singleReaderErrors = valueErrors(only, truth).errors;
    return stats;
  }

  // Occurrence-ordered pairing by name, like reconcile().
  const byName = (ms: RawMeasurement[]) => {
    const m = new Map<string, RawMeasurement[]>();
    for (const x of ms) {
      const k = nameKey(x.raw_analyte_name);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(x);
    }
    return m;
  };
  const a = byName(readA);
  const b = byName(readB);
  const t = byName(truth);
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
