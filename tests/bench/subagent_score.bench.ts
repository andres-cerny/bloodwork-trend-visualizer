/**
 * Subagent benchmark, step 2 — score what the subagents wrote.
 *
 *   npx vitest run --config tests/bench/vitest.config.ts tests/bench/subagent_score.bench.ts
 *
 * Reads results/subagent/out/<variant>/<slug>.json (one tool input per page,
 * written by subagents standing in for the reader) and scores each variant
 * in the same three columns the paid benchmark uses — agreement with the
 * accepted reports, fabrications against the printed rows, range integrity —
 * plus the checks this run exists to evaluate:
 *
 *   - unclaimed: numeric candidate rows no returned measurement points at
 *     (what a deterministic completeness check would flag);
 *   - caught: baseline rows the variant missed that were ALSO unclaimed
 *     candidates — the misses the check would have surfaced to the reader;
 *   - wrongRow: a row_index whose printed row does not contain the value;
 *   - outChars: size of the measurements JSON, a proxy for output tokens.
 *
 * A "current" arm is synthesised from the haiku_text and sonnet_text reads —
 * the deployed worker runs both and reconciles — so Haiku-only can be
 * compared with what the app does today rather than with Sonnet alone.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import { it } from "vitest";

import { isPrintedOnPage, type TextRow } from "@bw/lab-core";

import { candidateRows, UNIT } from "./candidates";
import {
  annotateMaterial,
  fabrications,
  inScopeReads,
  isMeasurementRow,
  loadBaseline,
  nameKey,
  rangeIntegrity,
  type RawMeasurement,
} from "./score";

const BASE = "tests/bench/results/subagent";

const NUM = /^[<>]?\s*-?\d+(?:[,.]\d+)?$/;
const squash = (x: string | undefined) => (x ?? "").replace(/\s+/g, "");
/** normalize() strips "!" and "*" from a value before parsing, so so do we. */
const valKey = (x: string | undefined) => squash(x).replace(/[!*]/g, "");
const unitKey = (x: string | undefined) => squash(x).replace(/[µμ]/g, "u");

const STOP = /^(?:málo|materiálu|neprovedeno|přijato|negat\.?|pozit\.?|bezrozm\.?|[<>]?\s*\d)/i;

/**
 * What the client would do without a returned name: read it off the row.
 *
 * Anchored on the value the model returned — the name is what stands before
 * the value cell once the lab code, the accreditation flag, the "#" marker,
 * an ALL-CAPS section label and a unit cell are dropped. Without the value
 * anchor a row like "S_IGF | 1 | 245" cannot tell name from number.
 */
function nameFromRow(rows: TextRow[], idx: number | undefined, value: string | undefined): string {
  if (idx === undefined || idx < 0 || idx >= rows.length) return "";
  const cells = rows[idx].cells.map((c) => c.trim()).filter(Boolean);
  const v = valKey(value);
  let end = v ? cells.findIndex((c) => valKey(c) === v) : -1;
  if (end < 0) end = cells.findIndex((c) => NUM.test(c));
  if (end < 0) end = cells.length;
  const head = cells.slice(0, end);
  const parts: string[] = [];
  head.forEach((c, i) => {
    // Leading accreditation flag / lab code / marker — never part of a name.
    if ((i === 0 && /^[A-Za-z]$/.test(c)) || (i <= 1 && /^\d{3,6}$/.test(c))) return;
    if (c === "#") return;
    // A unit printed between the name and the value (this lab's layout).
    const unitLike = UNIT.test(c) || /^[a-zµμ%‰][a-z0-9µμ.^]*\/[a-z0-9.,^\/]+$/i.test(c) || /^bezrozm\.?$/i.test(c);
    if (unitLike && i === head.length - 1 && i > 0) return;
    // A section label: all caps, letters only, and not the only name cell.
    const isCaps = /^[A-ZÀ-Ž]{4,}$/.test(c) && head.slice(i + 1).some((x) => /[A-Za-zÀ-ž]{2}/.test(x));
    if (isCaps) return;
    if (/^(?:málo|materiálu|neprovedeno|přijato)$/i.test(c) || /^[|*!]+$/.test(c)) return;
    parts.push(c);
  });
  return parts.join(" ");
}

function readJson(path: string): any | null {
  try {
    let txt = readFileSync(path, "utf8").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/**
 * A row_index the client can prove wrong — the value is not on that row —
 * and can usually fix: the same value with the same name sits a row or two
 * away. This is what a deterministic repair in the client would do before
 * trusting the index for highlighting or for the unclaimed-row check.
 */
function repairRowIndex(m: RawMeasurement, rows: TextRow[]): { idx: number | undefined; repaired: boolean; broken: boolean } {
  const idx = m.row_index;
  if (typeof idx !== "number") return { idx: undefined, repaired: false, broken: false };
  const v = valKey(m.value_raw);
  const onRow = (i: number) => i >= 0 && i < rows.length && (!v || squash(rows[i].cells.join(" ")).includes(v));
  if (onRow(idx)) return { idx, repaired: false, broken: false };
  const nk = nameKey(m.raw_analyte_name);
  for (const d of [1, -1, 2, -2, 3, -3]) {
    const j = idx + d;
    if (onRow(j) && (!nk || nameKey(rows[j].cells.join(" ")).includes(nk))) return { idx: j, repaired: true, broken: false };
  }
  return { idx, repaired: false, broken: true };
}

interface PageScore {
  variant: string;
  key: string;
  ok: boolean;
  armRows: number;
  baselineRows: number;
  matched: number;
  missing: string[];
  extra: string[];
  valueMismatch: any[];
  unitMismatch: any[];
  rangeMismatch: any[];
  fabrications: string[];
  collapsed: number;
  decensored: number;
  unclaimed: number[];
  caught: string[];
  caughtQual: string[];
  repaired: number;
  /** Baseline rows dropped before scoring: D0's scope rule plus bare markers. */
  droppedRows: number;
  wrongRow: string[];
  outChars: number;
}

function scorePage(
  variant: string,
  key: string,
  armAll: RawMeasurement[],
  rows: TextRow[],
  baseAll: RawMeasurement[],
): PageScore {
  // D0 (docs/plans/lab-adaptability.md, Phase D): the accepted reports carry
  // rows this product does not track — urine and other non-blood materials,
  // specimen receipts, patient anthropometrics. `annotateMaterial` reads each
  // row's material off the printed page, `isMeasurementRow` drops what is out
  // of scope, and `inScopeReads` drops the same rows from the arm so a reader
  // is charged neither a miss for leaving them out nor an extra for
  // transcribing them. This replaced a hand-written `NON_RESULT` name list.
  const annotated = annotateMaterial(baseAll, rows);
  const base = annotated.filter(isMeasurementRow);
  const arm = inScopeReads(armAll, annotated, nameKey);
  const s = matchBaseline(base, arm);
  const fab = fabrications(arm, rows);
  const integ = rangeIntegrity(base, arm);
  const allCands = candidateRows(rows);
  const cands = allCands.filter((c) => c.kind === "numeric").map((c) => c.index);
  const qualCands = allCands.filter((c) => c.kind === "qualitative").map((c) => c.index);

  // Row indexes as the client would use them after the repair pass.
  const wrongRow: string[] = [];
  let repaired = 0;
  const claimed = new Set<number>();
  for (const m of arm) {
    const r = repairRowIndex(m, rows);
    if (r.repaired) repaired++;
    if (r.broken) wrongRow.push(`${m.raw_analyte_name}@${m.row_index} value "${m.value_raw}" not on row`);
    if (r.idx !== undefined && !r.broken) claimed.add(r.idx);
  }
  const unclaimed = cands.filter((i) => !claimed.has(i));
  const unclaimedQual = qualCands.filter((i) => !claimed.has(i));
  const rowText = (i: number) => nameKey(rows[i].cells.join(" "));
  const inRows = (name: string, idxs: number[]) => {
    const k = nameKey(name);
    return !!k && idxs.some((i) => rowText(i).includes(k));
  };
  // A miss is "caught" when the printed row it lives on is an unclaimed
  // candidate — matched loosely by the analyte name appearing in that row.
  const realMissing = s.missing;
  const caught = realMissing.filter((n) => inRows(n, unclaimed));
  const caughtQual = realMissing.filter((n) => !caught.includes(n) && inRows(n, unclaimedQual));
  return {
    variant,
    key,
    ok: true,
    armRows: s.armRows,
    baselineRows: s.baselineRows,
    matched: s.matched,
    missing: s.missing,
    extra: s.extra,
    valueMismatch: s.valueMismatch,
    unitMismatch: s.unitMismatch,
    rangeMismatch: s.rangeMismatch,
    fabrications: fab,
    collapsed: integ.collapsed.length,
    decensored: integ.decensored.length,
    unclaimed,
    caught,
    caughtQual,
    repaired,
    droppedRows: annotated.filter((t) => !isMeasurementRow(t)).length,
    wrongRow,
    outChars: JSON.stringify(arm).length,
  };
}

/**
 * Like scoreAgainstBaseline, but a baseline row prefers the arm row with the
 * same name AND value before falling back to occurrence order — a page that
 * prints a differential as fractions then absolutes must not be charged ten
 * value errors because a reader listed them the other way round. Units are
 * compared with µ (U+00B5) and μ (U+03BC) folded together; the demo's own
 * verification already treats them as the same character.
 */
function matchBaseline(base: RawMeasurement[], arm: RawMeasurement[]) {
  const free = arm.map((m, i) => ({ m, i }));
  const out = {
    baselineRows: base.length,
    armRows: arm.length,
    matched: 0,
    missing: [] as string[],
    extra: [] as string[],
    valueMismatch: [] as Array<{ name: string; baseline: string; arm: string }>,
    unitMismatch: [] as Array<{ name: string; baseline: string; arm: string }>,
    rangeMismatch: [] as Array<{ name: string; baseline: string; arm: string }>,
  };
  for (const b of base) {
    const k = nameKey(b.raw_analyte_name);
    const same = free.filter((f) => nameKey(f.m.raw_analyte_name) === k);
    const pick = same.find((f) => valKey(f.m.value_raw) === valKey(b.value_raw)) ?? same[0];
    if (!pick) {
      out.missing.push(b.raw_analyte_name ?? "?");
      continue;
    }
    free.splice(free.indexOf(pick), 1);
    out.matched++;
    const name = b.raw_analyte_name ?? "?";
    if (valKey(b.value_raw) !== valKey(pick.m.value_raw)) out.valueMismatch.push({ name, baseline: b.value_raw ?? "", arm: pick.m.value_raw ?? "" });
    if (unitKey(b.unit_raw) !== unitKey(pick.m.unit_raw)) out.unitMismatch.push({ name, baseline: b.unit_raw ?? "", arm: pick.m.unit_raw ?? "" });
    if (squash(b.ref_range_raw) !== squash(pick.m.ref_range_raw)) out.rangeMismatch.push({ name, baseline: b.ref_range_raw ?? "", arm: pick.m.ref_range_raw ?? "" });
  }
  for (const f of free) out.extra.push(f.m.raw_analyte_name ?? "?");
  return out;
}

/** The deployed shape: two reads reconciled by analyte name and occurrence. */
function reconcile(a: RawMeasurement[], b: RawMeasurement[]): { merged: RawMeasurement[]; disagreements: number } {
  const merged: RawMeasurement[] = [...a];
  const seen = new Map<string, number>();
  for (const m of a) seen.set(nameKey(m.raw_analyte_name), (seen.get(nameKey(m.raw_analyte_name)) ?? 0) + 1);
  const used = new Map<string, number>();
  let disagreements = 0;
  for (const m of b) {
    const k = nameKey(m.raw_analyte_name);
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    if (n < (seen.get(k) ?? 0)) {
      const twin = a.filter((x) => nameKey(x.raw_analyte_name) === k)[n];
      if (twin && (twin.value_raw ?? "").replace(/\s+/g, "") !== (m.value_raw ?? "").replace(/\s+/g, "")) disagreements++;
      continue;
    }
    merged.push(m); // a row only the second reader found
  }
  return { merged, disagreements };
}

it("subagent bench — score the variants", () => {
  const index = JSON.parse(readFileSync(`${BASE}/index.json`, "utf8")) as any[];
  const baseline = loadBaseline();
  const rowsOf = new Map<string, TextRow[]>();
  for (const p of index) {
    if (p.hasTextLayer) rowsOf.set(p.slug, JSON.parse(readFileSync(`${BASE}/pages/${p.slug}.rows.json`, "utf8")));
  }
  const slugToKey = new Map(index.map((p) => [p.slug, p.key] as const));

  const variants = readdirSync(`${BASE}/out`).filter((d) => existsSync(`${BASE}/out/${d}`) && readdirSync(`${BASE}/out/${d}`).length);
  const scores: PageScore[] = [];
  const perVariantArm = new Map<string, Map<string, RawMeasurement[]>>();
  const broken: string[] = [];

  for (const v of variants) {
    const arms = new Map<string, RawMeasurement[]>();
    for (const f of readdirSync(`${BASE}/out/${v}`).filter((f) => f.endsWith(".json"))) {
      // Vision outputs are named after the image: <slug>_220 / <slug>_1568.
      const slug = f.replace(/\.json$/, "").replace(/_(220|1568)$/, "");
      const rows = rowsOf.get(slug);
      const key = slugToKey.get(slug);
      if (!rows || !key) continue;
      const data = readJson(`${BASE}/out/${v}/${f}`);
      if (!data || !Array.isArray(data.measurements)) {
        broken.push(`${v}/${f}`);
        continue;
      }
      const arm: RawMeasurement[] = data.measurements.map((m: any) => ({
        ...m,
        raw_analyte_name: m.raw_analyte_name ?? nameFromRow(rows, m.row_index, m.value_raw),
      }));
      arms.set(slug, arm);
      scores.push(scorePage(v, key, arm, rows, baseline.get(key) ?? []));
    }
    perVariantArm.set(v, arms);
  }

  // Synthesised "current" arms: haiku + sonnet reconciled, on pages both
  // read — once for the subagent pair, once for the real-API pair.
  let disagreementsTotal = 0;
  for (const [hv, sv, label] of [
    ["haiku_text", "sonnet_text", "current(sonnet+haiku)"],
    ["api_haiku_text", "api_sonnet_text", "api_current(sonnet+haiku)"],
  ] as const) {
    const h = perVariantArm.get(hv);
    const s = perVariantArm.get(sv);
    if (!h || !s) continue;
    for (const [slug, ha] of h) {
      const sa = s.get(slug);
      if (!sa) continue;
      const { merged, disagreements } = reconcile(sa, ha);
      disagreementsTotal += disagreements;
      scores.push(scorePage(label, slugToKey.get(slug)!, merged, rowsOf.get(slug)!, baseline.get(slugToKey.get(slug)!) ?? []));
    }
  }

  writeFileSync(`${BASE}/scores.jsonl`, scores.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (broken.length) console.log(`unparseable outputs: ${broken.join(", ")}\n`);

  const names = [...new Set(scores.map((r) => r.variant))];
  console.log(
    "variant".padEnd(24) + "pages".padStart(6) + "base".padStart(6) + "rows".padStart(6) + "match".padStart(7) +
      "miss".padStart(6) + "extra".padStart(6) + "valΔ".padStart(6) + "unitΔ".padStart(7) + "rangeΔ".padStart(7) +
      "fab".padStart(5) + "coll".padStart(5) + "dropped".padStart(8) + "fixedIdx".padStart(9) + "badIdx".padStart(7) + "unclaimed".padStart(10) + "caught".padStart(7) + "caughtQ".padStart(8) + "outChars".padStart(9),
  );
  for (const v of names) {
    const hits = scores.filter((r) => r.variant === v);
    const sum = (f: (r: PageScore) => number) => hits.reduce((n, r) => n + f(r), 0);
    console.log(
      v.padEnd(24) + String(hits.length).padStart(6) + String(sum((r) => r.baselineRows)).padStart(6) +
        String(sum((r) => r.armRows)).padStart(6) + String(sum((r) => r.matched)).padStart(7) +
        String(sum((r) => r.missing.length)).padStart(6) + String(sum((r) => r.extra.length)).padStart(6) +
        String(sum((r) => r.valueMismatch.length)).padStart(6) + String(sum((r) => r.unitMismatch.length)).padStart(7) +
        String(sum((r) => r.rangeMismatch.length)).padStart(7) + String(sum((r) => r.fabrications.length)).padStart(5) +
        String(sum((r) => r.collapsed)).padStart(5) + String(sum((r) => r.droppedRows)).padStart(8) +
        String(sum((r) => r.repaired)).padStart(9) + String(sum((r) => r.wrongRow.length)).padStart(7) +
        String(sum((r) => r.unclaimed.length)).padStart(10) + String(sum((r) => r.caught.length)).padStart(7) +
        String(sum((r) => r.caughtQual.length)).padStart(8) + String(sum((r) => r.outChars)).padStart(9),
    );
  }
  console.log(`\ncurrent arms: ${disagreementsTotal} value disagreements between the two readers (both pairs)`);

  // The detail that matters for adjudication: every miss, mismatch and
  // fabrication, per variant, so a human can decide who was right.
  for (const v of names) {
    console.log(`\n--- ${v}`);
    for (const r of scores.filter((r) => r.variant === v)) {
      const bits: string[] = [];
      if (r.missing.length) bits.push(`missing: ${r.missing.join("; ")}`);
      if (r.extra.length) bits.push(`extra: ${r.extra.join("; ")}`);
      if (r.valueMismatch.length) bits.push(`valΔ: ${r.valueMismatch.map((m) => `${m.name} ${m.baseline}→${m.arm}`).join("; ")}`);
      if (r.rangeMismatch.length) bits.push(`rangeΔ: ${r.rangeMismatch.map((m) => `${m.name} ${m.baseline}→${m.arm}`).join("; ")}`);
      if (r.fabrications.length) bits.push(`fab: ${r.fabrications.join("; ")}`);
      if (r.wrongRow.length) bits.push(`wrongRow: ${r.wrongRow.join("; ")}`);
      if (r.unclaimed.length) bits.push(`unclaimed rows: ${r.unclaimed.join(",")}`);
      if (r.repaired) bits.push(`row_index repaired: ${r.repaired}`);
      if (bits.length) console.log(`${r.key}\n   ${bits.join("\n   ")}`);
    }
  }
});
