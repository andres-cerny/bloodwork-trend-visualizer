/**
 * Union two independent reads of the same page.
 *
 * Agreement marks a row trustworthy. A differing value, or a row that only one
 * model saw, is flagged for the verification tab. That second case is the one
 * that matters: a model occasionally drops most of a page and returns what it
 * did read with high confidence, and a per-row confidence score on a single
 * read cannot see that. Two reads act as each other's completeness
 * expectation.
 */
import { makeMeasurement, type Measurement } from "./models";
import { canonicalizeUnit, normalizeMeasurement, parseRange } from "./normalize";
import { normKey } from "./registry";

export interface RawRead {
  model: string;
  measurements: Array<{
    raw_analyte_name: string;
    value_raw: string;
    unit_raw?: string;
    ref_range_raw?: string;
    source_snippet?: string;
    /** Text path: the index of the printed row this came from. */
    row_index?: number;
    confidence?: "high" | "medium" | "low";
  }>;
}

/**
 * A page read by one reader when two were asked. Every row carries it, because
 * every row on such a page is uncorroborated — `review.ts` then renders them
 * `unconfirmed`, which is the whole point.
 */
export const SECOND_READ_FAILED = "druhé čtení se nezdařilo";

/**
 * Two reads agree on the number but not on what it is measured in, or against.
 * No colon on purpose: `review.ts` reads the readings out of a
 * "…: a / b" fact, and a unit like "mmol/l" would split on its own slash.
 * The reader is asked the same thing either way — compare the row with the
 * page — and the stored fact keeps the cause for the bench and the logs.
 */
export const UNIT_DIFFERS = "dvě čtení se liší v jednotce";
export const RANGE_DIFFERS = "dvě čtení se liší v referenčním rozmezí";

export interface ReconcileOptions {
  /**
   * How many readers were **asked**, not how many answered.
   *
   * Without it a failed request is invisible: one read means no two values to
   * differ and no row only one reader saw, so `reconcile` finds nothing to say
   * and every row comes back confirmed. A page nobody cross-checked then looks
   * fully verified — the strongest claim the app makes, made about the one
   * case with the least behind it. Defaults to `reads.length`, which is the
   * old behaviour for any caller that does not know.
   */
  expected?: number;
}

/**
 * The number as the lab printed it, without the lab's own out-of-range
 * marker. One reader copies the "!" beside 7,4 and the other does not, and
 * "7,4 !" versus "7,4" is not two readings of the number — it is one reading
 * and one transcription habit. Seen live 2026-09-12 as a doubted row a
 * reader could not resolve, because both readings were right.
 *
 * Spacing and letter case are habits too: "< 1,0" and "<1,0", "Negativní"
 * and "negativní" are one reading (docs/plans/model-loop.md, H4). The censor
 * sign and every digit stay — "<1,0" and ">1,0" still differ.
 */
const printedValue = (v: string): string => (v ?? "").replace(/[!*↑↓]/g, "").trim();
const valueKey = (v: string): string => printedValue(v).replace(/\s+/g, "").toLowerCase();

/** A unit as compared: canonical spelling, spacing and case ignored. */
const unitKey = (u: string | undefined): string => (canonicalizeUnit(u ?? "") ?? "").replace(/\s+/g, "").toLowerCase();

/** A printed interval as compared — only when it parses to numbers at all. */
function rangeKey(r: string | undefined): string | null {
  const p = parseRange(r ?? "");
  return p.low === null && p.high === null ? null : `${p.low ?? ""}|${p.high ?? ""}`;
}

type Raw = RawRead["measurements"][number];

interface Entry {
  m: Measurement;
  models: Set<string>;
  /** valueKey → the reading as shown (markers off, spacing kept). */
  values: Map<string, string>;
  units: Set<string>;
  ranges: Set<string>;
  /** Row indices the reads gave, and the first raw of each reader — for the fallback pairing. */
  rows: Set<number>;
  firstRaw: Raw;
}

export function reconcile(reads: RawRead[], opts: ReconcileOptions = {}): Measurement[] {
  const byKey = new Map<string, Entry>();

  // A page can print one name twice — Glukóza under Sérum and again under
  // Moč. Keyed on the name alone those two rows collapse into one measurement
  // with a false "two readings differ" flag. So a name any single read
  // returned more than once is keyed on its row index as well (or, without
  // indices, on the order it came in); a name returned once per read keeps
  // the plain key, so two readers numbering the same row differently still
  // meet. Guard seen failing 2026-09-06 (reconcile.test.ts, "printed twice").
  const twice = new Set<string>();
  for (const read of reads) {
    const seen = new Set<string>();
    for (const raw of read.measurements ?? []) {
      const k = normKey(raw.raw_analyte_name);
      if (seen.has(k)) twice.add(k);
      seen.add(k);
    }
  }

  const absorb = (e: Entry, raw: Raw) => {
    e.values.set(valueKey(raw.value_raw), e.values.get(valueKey(raw.value_raw)) ?? printedValue(raw.value_raw));
    e.units.add(unitKey(raw.unit_raw));
    const r = rangeKey(raw.ref_range_raw);
    if (r !== null) e.ranges.add(r);
    if (typeof raw.row_index === "number") e.rows.add(raw.row_index);
  };

  for (const read of reads) {
    const ordinal = new Map<string, number>();
    for (const raw of read.measurements ?? []) {
      // Group on the normalized analyte name so "S_Glukóza" and "Glukóza"
      // from two models are recognised as the same row rather than both
      // surviving as separate, each looking like the other model missed it.
      const name = normKey(raw.raw_analyte_name);
      const nth = ordinal.get(name) ?? 0;
      ordinal.set(name, nth + 1);
      const key = twice.has(name) ? `${name}\u0000${raw.row_index ?? nth}` : name;
      const existing = byKey.get(key);
      if (existing) {
        existing.models.add(read.model);
        absorb(existing, raw);
      } else {
        const e: Entry = {
          m: makeMeasurement({
            rawAnalyteName: raw.raw_analyte_name,
            valueRaw: raw.value_raw,
            unitRaw: raw.unit_raw ?? "",
            refRangeRaw: raw.ref_range_raw ?? "",
            sourceSnippet: raw.source_snippet ?? "",
            // Carried through so the caller can resolve it against its own
            // rows; on the text path the model no longer sends any text here.
            rowIndex: raw.row_index,
            confidence: raw.confidence ?? "high",
            extractedBy: read.model,
          }),
          models: new Set([read.model]),
          values: new Map(),
          units: new Set(),
          ranges: new Set(),
          rows: new Set(),
          firstRaw: raw,
        };
        absorb(e, raw);
        byKey.set(key, e);
      }
    }
  }

  pairOrphans(byKey);

  const total = reads.length;
  // A caller may report fewer readers than answered — it cannot report more
  // answers than there are — so the two are reconciled rather than trusted.
  const expected = Math.max(opts.expected ?? total, total);
  const out: Measurement[] = [];
  for (const { m, models, values, units, ranges } of byKey.values()) {
    // Say what the readings were, not which program produced them. A model id
    // tells a clinician nothing; two conflicting numbers side by side tell
    // them exactly what to check on the page.
    let disagreement: string | null = null;
    if (values.size > 1) {
      disagreement = `dvě nezávislá čtení se liší: ${[...values.values()].join(" / ")}`;
    } else if (expected > total) {
      // A whole reader is missing. Nothing on this page was corroborated, so
      // nothing on it may be presented as confirmed.
      disagreement = SECOND_READ_FAILED;
    } else if (total > 1 && models.size < total) {
      disagreement = "řádek našlo jen jedno ze dvou čtení";
    } else if (units.size > 1) {
      // The number is agreed; what it is in is not. The primary's unit used to
      // win in silence, and the unit decides the trend axis and the mapping.
      disagreement = UNIT_DIFFERS;
    } else if (ranges.size > 1) {
      // The flag (high/low) is computed from the primary's interval alone.
      disagreement = RANGE_DIFFERS;
    }
    // `escalated` says a cross-check was *attempted*, not that it landed.
    out.push(normalizeMeasurement({ ...m, disagreement, escalated: expected > 1 }));
  }
  return out;
}

/**
 * Pair rows the name key left apart: two readers that spelled one printed row
 * differently ("B_Neutrofily %" / "B_Neutrofily - relativně", "urea" / "URE
 * urea" — the abbreviation column glued on) became two rows, each "seen by one
 * reader", on every such row of the page.
 *
 * Only an orphan (one reader) meets an orphan of another reader, and only on
 * evidence that names a single row: the same `row_index` (the text path — the
 * index is the printed row itself), or else the same printed value *and* unit
 * when exactly one orphan on each side carries that pair. Ambiguity leaves
 * both rows as they were, flagged: a wrong merge would hide a missing row.
 * The first reader's row is kept, so the primary's name is still the one shown.
 */
function pairOrphans(byKey: Map<string, Entry>): void {
  const orphans = () => [...byKey.entries()].filter(([, e]) => e.models.size === 1);
  const merge = (keep: [string, Entry], drop: [string, Entry]) => {
    for (const model of drop[1].models) keep[1].models.add(model);
    for (const [k, v] of drop[1].values) if (!keep[1].values.has(k)) keep[1].values.set(k, v);
    for (const u of drop[1].units) keep[1].units.add(u);
    for (const r of drop[1].ranges) keep[1].ranges.add(r);
    for (const i of drop[1].rows) keep[1].rows.add(i);
    byKey.delete(drop[0]);
  };
  const order = [...byKey.keys()];
  const first = (x: [string, Entry], y: [string, Entry]): [[string, Entry], [string, Entry]] =>
    order.indexOf(x[0]) <= order.indexOf(y[0]) ? [x, y] : [y, x];
  const modelOf = (e: Entry) => [...e.models][0];

  // 1. The same printed row.
  for (const o of orphans()) {
    if (!byKey.has(o[0]) || o[1].rows.size !== 1) continue;
    const idx = [...o[1].rows][0];
    const peers = orphans().filter(([k, e]) => k !== o[0] && modelOf(e) !== modelOf(o[1]) && e.rows.size === 1 && [...e.rows][0] === idx);
    if (peers.length === 1) merge(...first(o, peers[0]));
  }
  // 2. The same value and unit, unambiguous on both sides.
  const vu = (e: Entry) => (e.values.size === 1 ? `${[...e.values.keys()][0]}\u0000${[...e.units][0] ?? ""}` : null);
  for (const o of orphans()) {
    if (!byKey.has(o[0])) continue;
    const k = vu(o[1]);
    if (!k || k.startsWith("\u0000")) continue;
    const same = (model: string, eq: boolean) =>
      orphans().filter(([, e]) => (modelOf(e) === model) === eq && vu(e) === k);
    const mine = same(modelOf(o[1]), true);
    const theirs = same(modelOf(o[1]), false);
    if (mine.length === 1 && theirs.length === 1) merge(...first(o, theirs[0]));
  }
}
