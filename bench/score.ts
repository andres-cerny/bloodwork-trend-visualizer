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
