/**
 * Could Haiku 5.5 decide *every* mapping, not only the names the catalog
 * misses? docs/plans/model-loop.md, round 3 (Ondřej's idea). Evaluation only.
 *
 * Three name sets, label text only (no value, no person):
 *   held-out   catalog synonyms the model is asked to place, given the
 *              catalog's id | name | unit list WITHOUT synonyms — so every
 *              one is a name it has not been shown. Weighted to look-alike
 *              families (calcium, cholesterols, % vs absolute counts,
 *              bilirubins, T4/T3, eGFRs, PSA, troponins, iron).
 *   negatives  same-name tests from the wrong specimen (U_…) and tests the
 *              catalog lacks: the right answer is not a catalog id.
 *   public     every printed name on the public sample sheets (stored reads),
 *              truth = the deterministic match where it matched, else the
 *              hand label (map_gate_truth.json); disagreements are printed.
 *
 *   with-secrets bloodwork -- npx vite-node --root . tests/bench/map_first.ts
 *
 * ~$0.03 on Haiku 5.5. MAP_FIRST_DRY=1 counts the names and sends nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { suggestCanonical, type CatalogEntry, type MapSuggestion, type NameToMap } from "@bw/extraction";
import { priceUsd } from "@bw/agent-core";
import { Registry, materialPrefix, normKey } from "@bw/lab-core";

const R = dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.MAP_FIRST_MODEL ?? "claude-haiku-5-5";
const raw = JSON.parse(readFileSync(join(R, "../../apps/portal/public/registry.json"), "utf8")) as any[];
const registry = new Registry(JSON.parse(JSON.stringify(raw)));
const catalog: CatalogEntry[] = raw.map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));

type Item = { set: string; n: NameToMap; truth: string | null; family?: string };
const items: Item[] = [];

// Held-out synonyms: every synonym of the look-alike families whose key is not
// the display name's own (those are trivial), plus a deterministic spread of
// the rest of the catalog (every 7th entry's first two such synonyms).
const FAMILIES: Record<string, string[]> = {
  calcium: ["vapnik", "vapnik_ionizovany", "vapnik_korigovany"],
  cholesterol: ["cholesterol", "hdl", "ldl", "non_hdl", "vldl", "remnantni_cholesterol"],
  diff: ["neutrofily", "neutrofily_abs", "lymfocyty", "lymfocyty_abs", "monocyty", "monocyty_abs", "eosinofily", "eosinofily_abs", "basofily", "basofily_abs"],
  bilirubin: ["bilirubin_celkovy", "bilirubin_konjugovany", "bilirubin_nekonjugovany"],
  thyroid: ["ft4", "t4_celkovy", "ft3", "t3_celkovy", "tsh"],
  egfr: ["egfr", "egfr_mdrd", "egfr_cystatin"],
  psa: ["psa", "psa_volny", "pomer_fpsa_psa"],
  cardiac: ["troponin_t", "troponin_i", "bnp", "nt_probnp", "ck", "ck_mb"],
  iron: ["zelezo", "ferritin", "transferrin", "saturace_trf", "vk_fe_celkova", "vk_fe_volna"],
  rbc: ["mcv", "mch", "mchc", "mpv", "rdw", "rdw_sd", "hemoglobin", "hematokrit"],
};
const familyOf = new Map<string, string>();
for (const [f, ids] of Object.entries(FAMILIES)) for (const id of ids) familyOf.set(id, f);
raw.forEach((d, i) => {
  const fam = familyOf.get(d.canonicalId);
  const own = normKey(d.displayNameCs);
  const syns = (d.synonyms as string[]).filter((s) => normKey(s) !== own && normKey(s) !== normKey(d.canonicalId.replace(/_/g, " ")));
  const take = fam ? syns.slice(0, 4) : i % 7 === 0 ? syns.slice(0, 2) : [];
  for (const s of take) {
    items.push({ set: "held-out", n: { rawName: s, unit: d.canonicalUnit, refRange: "", material: materialPrefix(s) }, truth: d.canonicalId, family: fam });
  }
});

// Negatives: a blood test's name from urine, and tests the catalog lacks.
for (const [name, unit] of [["U_Glukóza", "mmol/l"], ["U_Kreatinin", "mmol/l"], ["U_Bílkovina", "g/l"], ["U_Erytrocyty", "/µl"], ["U_Leukocyty", "/µl"], ["dU_Sodík", "mmol/d"], ["S_Digoxin", "nmol/l"], ["S_Etanol", "g/l"], ["B_pH", ""], ["S_Teofylin", "mg/l"], ["Hmotnost pacienta", "kg"]] as const) {
  items.push({ set: "negatives", n: { rawName: name, unit, refRange: "", material: materialPrefix(name) }, truth: null });
}

// Public sheets: every printed name in the stored reads, with its unit and range.
const gateTruth = new Map((JSON.parse(readFileSync(join(R, "map_gate_truth.json"), "utf8")).items as any[]).map((t) => [t.name, t.truth === "NONE" ? null : t.truth]));
const seen = new Set<string>();
for (const arm of ["sonnet55"]) {
  const dir = join(R, "results/adapt", arm);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (j.cls !== "public") continue;
    for (const m of j.call?.extraction?.measurements ?? []) {
      const name = m.raw_analyte_name as string;
      if (seen.has(name) || /^(u|fu|du|pt)[_/-]/i.test(name)) continue;
      seen.add(name);
      const det = registry.match(name);
      const truth = det ?? (gateTruth.has(name) ? gateTruth.get(name)! : undefined);
      if (truth === undefined) continue; // unlabelled: not scored
      items.push({ set: det ? "public, catalog matched" : "public, catalog missed", n: { rawName: name, unit: m.unit_raw ?? "", refRange: m.ref_range_raw ?? "", material: materialPrefix(name) }, truth });
    }
  }
}

console.log(Object.entries(items.reduce((a: Record<string, number>, x) => ((a[x.set] = (a[x.set] ?? 0) + 1), a), {})).map(([k, v]) => `${k}: ${v}`).join(" · "));
if (process.env.MAP_FIRST_DRY === "1") process.exit(0);

// MAP_FIRST_RUNS=3 asks the same names again and reports how often the answer
// changes: Haiku 5.5 takes no temperature, so a mapping a trend depends on must
// be stable by itself or be stored after the first answer.
const RUNS = Math.max(1, parseInt(process.env.MAP_FIRST_RUNS ?? "1", 10));
const runs: Array<{ res: Awaited<ReturnType<typeof suggestCanonical>>; ms: number }> = [];
for (let r = 0; r < RUNS; r++) {
  const t0 = performance.now();
  const res = await suggestCanonical(process.env.ANTHROPIC_API_KEY!, MODEL, items.map((x) => x.n), catalog);
  runs.push({ res, ms: performance.now() - t0 });
}
const { res, ms } = runs[0];
const by = new Map<string, MapSuggestion>(res.suggestions.map((s) => [s.rawName, s]));
if (RUNS > 1) {
  const answer = (s?: MapSuggestion) => (s ? (s.decision === "catalog" ? s.canonicalId : s.decision) : "none");
  const maps = runs.map((r) => new Map(r.res.suggestions.map((s) => [s.rawName, s])));
  let changed = 0, idChanged = 0, confChanged = 0;
  const notes: string[] = [];
  for (const x of items) {
    const a = maps.map((m) => answer(m.get(x.n.rawName)));
    const c = maps.map((m) => m.get(x.n.rawName)?.confidence ?? "-");
    if (new Set(a).size > 1) {
      changed++;
      const ids = a.filter((v) => v && !["unknown", "new", "not_blood", "none"].includes(v));
      if (new Set(ids).size > 1) idChanged++;
      if (notes.length < 30) notes.push(`  ${x.n.rawName} [${x.n.unit}]: ${a.join(" | ")}  (${c.join("/")})`);
    } else if (new Set(c).size > 1) confChanged++;
  }
  console.log(`\n## repeat stability over ${RUNS} runs: answer differs on ${changed} of ${items.length} names; two different catalog ids on ${idChanged}; same answer but different confidence on ${confChanged}`);
  for (const n of notes) console.log(n);
}

const sets = [...new Set(items.map((x) => x.set))];
for (const set of sets) {
  const xs = items.filter((x) => x.set === set);
  let right = 0, unknown = 0, wrongHigh = 0, wrongOther = 0, missing = 0;
  const notes: string[] = [];
  for (const x of xs) {
    const s = by.get(x.n.rawName);
    if (!s) { missing++; continue; }
    const id = s.decision === "catalog" ? s.canonicalId : null;
    if (id === x.truth) right++;
    else if (id === null) { unknown++; if (notes.length < 40) notes.push(`  unknown(${s.decision}/${s.confidence}) ${x.n.rawName} [${x.n.unit}] truth=${x.truth}`); }
    else if (s.confidence === "high") { wrongHigh++; notes.push(`  WRONG-HIGH ${x.n.rawName} [${x.n.unit}] → ${id}, truth=${x.truth}${x.family ? ` (${x.family})` : ""} — ${s.reason}`); }
    else { wrongOther++; notes.push(`  wrong-${s.confidence} ${x.n.rawName} [${x.n.unit}] → ${id}, truth=${x.truth}${x.family ? ` (${x.family})` : ""}`); }
  }
  console.log(`\n## ${set}: ${xs.length} names — right ${right}, unknown ${unknown}, WRONG high ${wrongHigh}, wrong (medium/low) ${wrongOther}, no answer ${missing}`);
  for (const n of notes) console.log(n);
}
const usd = runs.reduce((t, r) => t + priceUsd(r.res.model, r.res.usage.inputTokens, r.res.usage.outputTokens, r.res.usage.cacheReadTokens, r.res.usage.cacheWriteTokens), 0);
console.log(`\n${items.length} names in ${Math.ceil(items.length / 30)} parallel batches: ${(ms / 1000).toFixed(1)} s for the first run; $${usd.toFixed(4)} for ${RUNS} run(s) (first: ${JSON.stringify(res.usage)})`);
