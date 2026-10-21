/**
 * The mapping fallback, today vs through the code table (docs/plans/
 * model-loop.md round 5): the same names, Haiku 5.5 both ways, scored against
 * catalog-id truth. Label text, units and ranges only — no value.
 *
 *   with-secrets bloodwork -- npx vite-node --root . tests/bench/map_codes.ts
 *
 * Name sets (tests/bench/map_first.ts builds the same ones):
 *   held-out    catalog synonyms, weighted to look-alikes. Today's call sees
 *               the catalog without synonyms; the code path gets an index of
 *               NČLP's own names only (no catalog vocabulary lent), so neither
 *               side has seen the spelling — the honest floor for both.
 *   negatives   urine twins of blood tests and tests the catalog lacks.
 *   public      the public sheets' names the shipped catalog misses
 *               (map_gate_truth.json), with the shipped index.
 *
 * ~$0.15 in total. MAP_CODES_LIMIT caps the held-out set for a quick run.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mapByCodes, suggestCanonical, type CatalogEntry, type MapSuggestion, type NameToMap } from "@bw/extraction";
import { priceUsd } from "@bw/agent-core";
import { LabCodes, Registry, materialPrefix, normKey, type LabCodeTable } from "@bw/lab-core";

const R = dirname(fileURLToPath(import.meta.url));
const ROOT = join(R, "../..");
const MODEL = "claude-haiku-5-5";
const raw = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf8")) as any[];
const registry = new Registry(JSON.parse(JSON.stringify(raw)));
const catalog: CatalogEntry[] = raw.map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));
const fullTable = JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.json"), "utf8")) as LabCodeTable;
const nclpOnly = new LabCodes(fullTable, { nclpOnly: true });
const shipped = new LabCodes(JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.index.json"), "utf8")) as LabCodeTable);

type Item = { n: NameToMap; truth: string | null };
const FAMILIES = ["vapnik", "vapnik_ionizovany", "vapnik_korigovany", "cholesterol", "hdl", "ldl", "non_hdl", "neutrofily", "neutrofily_abs", "lymfocyty", "lymfocyty_abs", "bilirubin_celkovy", "bilirubin_konjugovany", "ft4", "t4_celkovy", "ft3", "t3_celkovy", "egfr", "egfr_mdrd", "psa", "psa_volny", "troponin_t", "troponin_i", "zelezo", "ferritin", "transferrin", "saturace_trf", "mcv", "mch", "mchc", "mpv", "hemoglobin", "hematokrit"];
const heldOut: Item[] = [];
raw.forEach((d, i) => {
  const own = normKey(d.displayNameCs);
  const syns = (d.synonyms as string[]).filter((s) => normKey(s) !== own);
  const take = FAMILIES.includes(d.canonicalId) ? syns.slice(0, 3) : i % 9 === 0 ? syns.slice(0, 1) : [];
  for (const s of take) heldOut.push({ n: { rawName: s, unit: d.canonicalUnit, refRange: "", material: materialPrefix(s) }, truth: d.canonicalId });
});
const negatives: Item[] = ([["U_Glukóza", "mmol/l"], ["U_Kreatinin", "mmol/l"], ["U_Bílkovina", "g/l"], ["U_Erytrocyty", "/µl"], ["dU_Sodík", "mmol/d"], ["S_Digoxin", "nmol/l"], ["S_Etanol", "g/l"], ["S_Teofylin", "mg/l"], ["Hmotnost pacienta", "kg"]] as const).map(
  ([n, u]) => ({ n: { rawName: n, unit: u, refRange: "", material: materialPrefix(n) }, truth: null }),
);
const gate = JSON.parse(readFileSync(join(R, "map_gate_truth.json"), "utf8")).items as Array<{ name: string; truth: string }>;
const pub: Item[] = gate
  .filter((t) => !registry.match(t.name))
  .map((t) => ({ n: { rawName: t.name, unit: "", refRange: "", material: materialPrefix(t.name) }, truth: t.truth === "NONE" ? null : t.truth }));

const limit = parseInt(process.env.MAP_CODES_LIMIT ?? "100000", 10);
const sets: Array<{ id: string; items: Item[]; codes: LabCodes }> = [
  { id: "held-out (NČLP names only for the code path)", items: heldOut.slice(0, limit), codes: nclpOnly },
  { id: "negatives", items: negatives, codes: shipped },
  { id: "public, catalog misses", items: pub, codes: shipped },
];

function score(items: Item[], sug: MapSuggestion[]) {
  const by = new Map(sug.map((s) => [s.rawName, s]));
  const t = { right: 0, wrongHigh: 0, wrongOther: 0, unknown: 0, noModel: 0 };
  const notes: string[] = [];
  for (const x of items) {
    const s = by.get(x.n.rawName);
    const id = s?.decision === "catalog" ? s.canonicalId : null;
    if (id === x.truth) t.right++;
    else if (id === null) t.unknown++;
    else if (s?.confidence === "high") (t.wrongHigh++, notes.push(`WRONG-HIGH ${x.n.rawName} [${x.n.unit}] → ${id} (truth ${x.truth}) ${s?.reason ?? ""}`));
    else (t.wrongOther++, notes.push(`wrong-${s?.confidence} ${x.n.rawName} → ${id} (truth ${x.truth})`));
    if (s?.reason?.includes("vyhledání")) t.noModel++;
  }
  return { t, notes };
}

let total = 0;
for (const set of sets) {
  if (!set.items.length) continue;
  const names = set.items.map((x) => x.n);
  let t0 = performance.now();
  const today = await suggestCanonical(process.env.ANTHROPIC_API_KEY!, MODEL, names, catalog);
  const msToday = performance.now() - t0;
  const usdToday = priceUsd(today.model, today.usage.inputTokens, today.usage.outputTokens, today.usage.cacheReadTokens, today.usage.cacheWriteTokens);
  t0 = performance.now();
  const hybrid = await mapByCodes(process.env.ANTHROPIC_API_KEY!, MODEL, names, catalog, set.codes, "catalog");
  const msHybrid = performance.now() - t0;
  const usdHybrid = priceUsd(hybrid.model, hybrid.usage.inputTokens, hybrid.usage.outputTokens, hybrid.usage.cacheReadTokens, hybrid.usage.cacheWriteTokens);
  t0 = performance.now();
  const viaCodes = await mapByCodes(process.env.ANTHROPIC_API_KEY!, MODEL, names, catalog, set.codes, "shortlist");
  const msCodes = performance.now() - t0;
  const usdCodes = priceUsd(viaCodes.model, viaCodes.usage.inputTokens, viaCodes.usage.outputTokens, viaCodes.usage.cacheReadTokens, viaCodes.usage.cacheWriteTokens);
  total += usdToday + usdCodes + usdHybrid;
  const h = score(set.items, hybrid.suggestions);
  const coded = hybrid.suggestions.filter((x) => x?.code).length;
  const a = score(set.items, today.suggestions);
  const b = score(set.items, viaCodes.suggestions);
  console.log(`\n## ${set.id}: ${set.items.length} names`);
  console.log(`  today (whole catalog): right ${a.t.right} · unknown ${a.t.unknown} · WRONG high ${a.t.wrongHigh} · wrong other ${a.t.wrongOther} · $${usdToday.toFixed(4)} · ${(msToday / 1000).toFixed(1)} s`);
  console.log(`  codes, catalog step (MAP_MODE=codes; lookup ${h.t.noModel} without a model, ${hybrid.asked} to the model; ${coded} answers carry a code): right ${h.t.right} · unknown ${h.t.unknown} · WRONG high ${h.t.wrongHigh} · wrong other ${h.t.wrongOther} · $${usdHybrid.toFixed(4)} · ${(msHybrid / 1000).toFixed(1)} s`);
  for (const n of h.notes.slice(0, 8)) console.log("    hybrid", n);
  console.log(`  codes, shortlist step (lookup ${b.t.noModel} without a model, ${viaCodes.asked} shortlist calls): right ${b.t.right} · unknown ${b.t.unknown} · WRONG high ${b.t.wrongHigh} · wrong other ${b.t.wrongOther} · $${usdCodes.toFixed(4)} · ${(msCodes / 1000).toFixed(1)} s`);
  for (const n of a.notes.slice(0, 8)) console.log("    today", n);
  for (const n of b.notes.slice(0, 12)) console.log("    codes", n);
}
console.log(`\nspent $${total.toFixed(4)}`);
