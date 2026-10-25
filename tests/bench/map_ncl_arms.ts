/**
 * Round 6 of docs/plans/model-loop.md: which way of asking Haiku 5.5 resolves
 * names NOT on the catalog (the public-launch reality) as well as unseen
 * spellings of known tests, without wrong mappings. Label text and units only.
 *
 *   with-secrets bloodwork -- env ARMS=a,b,c,d,e,f MAP_NCL_MAX_USD=1.2 npx vite-node --root . tests/bench/map_ncl_arms.ts
 *
 * Sets: the three of round 5 (map_codes.ts) and map_ncl_truth.json (41 names
 * not in the catalog; NČLP codes as truth, empty = not in the table either).
 *
 * Arms:
 *   a  MAP_MODE=codes — NČLP lookup, then today's whole-catalog call.
 *   b  Haiku picks from the WHOLE compact NČLP table (cached block).
 *   c  Haiku states the NČLP code from memory; validated against the table.
 *   d  Haiku describes the test blind (component, specimen, property, unit) →
 *      deterministic shortlist from that description → Haiku picks or "unknown".
 *   e  a, and only for its "unknown" answers a second try with the raw-name shortlist.
 *   g  what ships as MAP_MODE=codes-retry: e as one step, with an exact code
 *      hit the catalog lacks confirmed by a model pick before it may be "high".
 *   f  the same blind description → Haiku picks from the WHOLE table with its
 *      own description beside the name; a pick that contradicts the description
 *      (specimen or kind of quantity) is not applied — marked for review.
 * Every arm's pick passes the specimen check (codeMap.ts `specimenAgrees`).
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromRows, mapByCodes, pick, specimenAgrees, type CatalogEntry, type MapSuggestion, type NameToMap } from "@bw/extraction";
import { LabCodes, Registry, materialPrefix, normKey, type LabCodeHit, type LabCodeRow, type LabCodeTable } from "@bw/lab-core";

const R = dirname(fileURLToPath(import.meta.url));
const ROOT = join(R, "../..");
const MODEL = "claude-haiku-5-5";
const KEY = process.env.ANTHROPIC_API_KEY!;
const MAX_USD = parseFloat(process.env.MAP_NCL_MAX_USD ?? "1.2");
const ARMS = (process.env.ARMS ?? "a,b,c,d,e,f").split(",");
const BATCH = 25;

const raw = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf8")) as any[];
const registry = new Registry(JSON.parse(JSON.stringify(raw)));
const catalog: CatalogEntry[] = raw.map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));
const catalogIds = new Set(catalog.map((c) => c.id));
const indexTable = JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.index.json"), "utf8")) as LabCodeTable;
const shipped = new LabCodes(indexTable);
const nclpOnly = new LabCodes(JSON.parse(readFileSync(join(ROOT, "packages/lab-core/codes/lab-codes.json"), "utf8")) as LabCodeTable, { nclpOnly: true });

/* ---------------------------------------------------------------- pricing */
// Haiku 5.5: $0.10/$0.50 per 1M up to a 100K-token prompt, $0.50/$2.50 beyond;
// cache reads 0.1x, writes 1.25x of the input rate in force.
let spent = 0;
function price(u: Anthropic.Usage): number {
  const read = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
  const prompt = u.input_tokens + read + write;
  const [i, o] = prompt > 100_000 ? [0.5, 2.5] : [0.1, 0.5];
  const usd = (u.input_tokens * i + write * i * 1.25 + read * i * 0.1 + u.output_tokens * o) / 1e6;
  spent += usd;
  if (spent > MAX_USD) throw new Error(`stopped: $${spent.toFixed(3)} > MAP_NCL_MAX_USD`);
  return usd;
}

/* ---------------------------------------------------------------- sets */
type Item = { n: NameToMap; truthId: string | null; accept?: string[] };
const FAMILIES = ["vapnik", "vapnik_ionizovany", "vapnik_korigovany", "cholesterol", "hdl", "ldl", "non_hdl", "neutrofily", "neutrofily_abs", "lymfocyty", "lymfocyty_abs", "bilirubin_celkovy", "bilirubin_konjugovany", "ft4", "t4_celkovy", "ft3", "t3_celkovy", "egfr", "egfr_mdrd", "psa", "psa_volny", "troponin_t", "troponin_i", "zelezo", "ferritin", "transferrin", "saturace_trf", "mcv", "mch", "mchc", "mpv", "hemoglobin", "hematokrit"];
const heldOut: Item[] = [];
raw.forEach((d, i) => {
  const own = normKey(d.displayNameCs);
  const syns = (d.synonyms as string[]).filter((s) => normKey(s) !== own);
  const take = FAMILIES.includes(d.canonicalId) ? syns.slice(0, 3) : i % 9 === 0 ? syns.slice(0, 1) : [];
  for (const s of take) heldOut.push({ n: { rawName: s, unit: d.canonicalUnit, refRange: "", material: materialPrefix(s) }, truthId: d.canonicalId });
});
const negatives: Item[] = ([["U_Glukóza", "mmol/l"], ["U_Kreatinin", "mmol/l"], ["U_Bílkovina", "g/l"], ["U_Erytrocyty", "/µl"], ["dU_Sodík", "mmol/d"], ["S_Digoxin", "nmol/l"], ["S_Etanol", "g/l"], ["S_Teofylin", "mg/l"], ["Hmotnost pacienta", "kg"]] as const).map(
  ([n, u]) => ({ n: { rawName: n, unit: u, refRange: "", material: materialPrefix(n) }, truthId: null }),
);
const gate = JSON.parse(readFileSync(join(R, "map_gate_truth.json"), "utf8")).items as Array<{ name: string; truth: string }>;
const pub: Item[] = gate.filter((t) => !registry.match(t.name)).map((t) => ({ n: { rawName: t.name, unit: "", refRange: "", material: materialPrefix(t.name) }, truthId: t.truth === "NONE" ? null : t.truth }));
const ncl = (JSON.parse(readFileSync(join(R, "map_ncl_truth.json"), "utf8")).items as Array<{ name: string; unit: string; accept: string[] }>)
  .filter((t) => !registry.match(t.name))
  .map((t) => ({ n: { rawName: t.name, unit: t.unit, refRange: "", material: materialPrefix(t.name) }, truthId: null, accept: t.accept }));
const ONLY = (process.env.SETS ?? "").split(",").filter(Boolean);
const ALL_SETS: Array<{ id: string; items: Item[]; aCodes: LabCodes }> = [
  { id: "unseen catalog spellings", items: heldOut, aCodes: nclpOnly },
  { id: "urine twins / missing", items: negatives, aCodes: shipped },
  { id: "public misses", items: pub, aCodes: shipped },
  { id: "not in catalog (NČLP)", items: ncl, aCodes: shipped },
];
const SETS = ALL_SETS.filter((s, i) => !ONLY.length || ONLY.includes(String(i)));

/* ---------------------------------------------------------------- outcome */
interface Out { rawName: string; canonicalId: string | null; code: string | null; confidence: "high" | "medium" | "low"; review?: boolean; note?: string; isNew?: boolean }
const fromSug = (s: MapSuggestion | undefined, rawName: string): Out =>
  s ? { rawName, canonicalId: s.decision === "catalog" ? s.canonicalId : null, code: s.code ?? null, confidence: s.confidence, note: s.reason, isNew: s.decision === "new" } : { rawName, canonicalId: null, code: null, confidence: "low" };

/** A picked code → catalog id (single link) or a not-in-catalog code; specimen-checked. */
function resolve(n: NameToMap, code: string | null, confidence: Out["confidence"], note = ""): Out {
  const row = code ? shipped.byId(code) : undefined;
  if (!row) return { rawName: n.rawName, canonicalId: null, code: null, confidence: "low", note };
  const agrees = specimenAgrees(n.rawName, row);
  const s = fromRows(n, [row], catalogIds, agrees ? confidence : "low", "arm");
  return { rawName: n.rawName, canonicalId: s.decision === "catalog" ? s.canonicalId : null, code: row.id, confidence: s.confidence, note };
}

/* ---------------------------------------------------------------- shared */
const client = new Anthropic({ apiKey: KEY, maxRetries: 2 });
const TABLE_TEXT = "Tabulka NČLP (kód název):\n" + indexTable.rows.map((r) => `${r.id} ${r.names.cs.name}`).join("\n");

async function call(system: string, content: Anthropic.ContentBlockParam[], tool: Anthropic.Tool, maxTokens = 6000) {
  const msg = await client.messages.create({ model: MODEL, max_tokens: maxTokens, system, tools: [tool], tool_choice: { type: "tool", name: tool.name }, messages: [{ role: "user", content }] });
  price(msg.usage);
  const b = msg.content.find((x) => x.type === "tool_use");
  return { input: (b && b.type === "tool_use" ? b.input : {}) as any, usage: msg.usage };
}
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const nameLine = (n: NameToMap) => `- "${n.rawName}" — jednotka: ${n.unit || "(žádná)"}; materiál: ${n.material ?? "(neuveden)"}`;
const byName = (answers: any[], key = "raw_name") => new Map((Array.isArray(answers) ? answers : []).map((a: any) => [String(a?.[key] ?? "").replace(/^"|"$/g, ""), a]));

/* ---------------------------------------------------------------- b, f: whole table */
const SYSTEM_TABLE =
  "Přiřazuješ názvy laboratorních vyšetření z českých výsledkových listů ke kódům NČLP z přiložené tabulky. " +
  "Ke každému názvu vyber kód řádku, který je totéž vyšetření ve stejném materiálu a se stejným druhem veličiny, nebo \"unknown\". " +
  "Prefix S_ je sérum, P_ plazma, B_ krev, U_ moč, dU_ sbíraná moč; bez prefixu u biochemie sérum, u krevního obrazu krev. Konvenční jednotka je totéž vyšetření. " +
  "Kód nikdy nevymýšlej; musí být v tabulce. Když to vyšetření v tabulce není, odpověz \"unknown\". Confidence \"high\" jen při jednoznačné shodě.";
const TABLE_TOOL: Anthropic.Tool = {
  name: "pick_codes",
  description: "Kód NČLP ke každému názvu.",
  input_schema: { type: "object", properties: { answers: { type: "array", items: { type: "object", properties: { raw_name: { type: "string" }, code: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] } }, required: ["raw_name", "code", "confidence"] } } }, required: ["answers"] },
};
async function tableArm(items: Item[], statement?: Map<string, any>): Promise<Out[]> {
  const out = new Map<string, Out>();
  const run = async (batch: Item[]) => {
    const lines = batch.map((x) => nameLine(x.n) + (statement ? `; popis: ${JSON.stringify(statement.get(x.n.rawName) ?? {})}` : "")).join("\n");
    const { input } = await call(SYSTEM_TABLE + (statement ? " U každého názvu je i tvůj předchozí popis vyšetření bez tabulky; vyber řádek, který mu odpovídá." : ""), [
      { type: "text", text: TABLE_TEXT, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Názvy:\n${lines}` },
    ], TABLE_TOOL);
    const a = byName(input.answers);
    for (const x of batch) {
      const ans = a.get(x.n.rawName);
      const code = typeof ans?.code === "string" && shipped.byId(ans.code) ? ans.code : null;
      out.set(x.n.rawName, resolve(x.n, code, ans?.confidence ?? "low"));
    }
  };
  const bs = chunks(items, BATCH);
  // The first batch alone writes the cache; the rest read it.
  if (bs.length) await run(bs[0]);
  await Promise.all(bs.slice(1).map(run));
  return items.map((x) => out.get(x.n.rawName)!);
}

/* ---------------------------------------------------------------- c: memory */
const MEMORY_TOOL: Anthropic.Tool = {
  name: "nclp_from_memory",
  description: "Kód NČLP ke každému názvu, jak ho znáš.",
  input_schema: { type: "object", properties: { answers: { type: "array", items: { type: "object", properties: { raw_name: { type: "string" }, nclp_code: { type: "string" }, nclp_name: { type: "string" }, confidence: { type: "string", enum: ["high", "medium", "low"] } }, required: ["raw_name", "nclp_code", "nclp_name", "confidence"] } } }, required: ["answers"] },
};
let memoryReal = 0, memoryTotal = 0;
async function memoryArm(items: Item[]): Promise<Out[]> {
  const out = new Map<string, Out>();
  await Promise.all(chunks(items, 30).map(async (batch) => {
    const { input } = await call("Jsi expert na český Národní číselník laboratorních položek (NČLP). Ke každému názvu uveď pětimístný kód položky NČLP a její název, nebo \"unknown\".", [{ type: "text", text: batch.map((x) => nameLine(x.n)).join("\n") }], MEMORY_TOOL);
    const a = byName(input.answers);
    for (const x of batch) {
      const ans = a.get(x.n.rawName);
      const code = String(ans?.nclp_code ?? "").trim();
      if (/^\d{5}$/.test(code)) memoryTotal++;
      const row = shipped.byId(code);
      if (row) memoryReal++;
      out.set(x.n.rawName, resolve(x.n, row ? row.id : null, ans?.confidence ?? "low"));
    }
  }));
  return items.map((x) => out.get(x.n.rawName)!);
}

/* ---------------------------------------------------------------- d, f: blind description */
const PROPS = ["látková koncentrace", "hmotnostní koncentrace", "katalytická koncentrace", "počet (koncentrace buněk)", "podíl", "arbitrární koncentrace / index", "čas", "poměr", "přítomnost / kvalitativně", "jiná"];
const PROP_CODES: Record<string, string[]> = {
  "látková koncentrace": ["SCnc"], "hmotnostní koncentrace": ["MCnc"], "katalytická koncentrace": ["CCnc"], "počet (koncentrace buněk)": ["NCnc"],
  "podíl": ["NFr", "SFr", "MFr", "VFr", "CFr"], "čas": ["Time", "RelTime"], "arbitrární koncentrace / index": ["ACnc", "Titr", "CCnc", "RelSCnc"],
};
const DESCRIBE_TOOL: Anthropic.Tool = {
  name: "describe_tests",
  description: "Co je každé vyšetření, bez seznamu.",
  input_schema: { type: "object", properties: { answers: { type: "array", items: { type: "object", properties: {
    raw_name: { type: "string" },
    component: { type: "string", description: "Měřená složka formálně česky, jak by ji pojmenoval NČLP (např. 'Sodný kation', 'Hyaluronát', 'Anti-mitochondrie IgG')." },
    specimen: { type: "string", enum: ["S", "P", "B", "U", "dU", "jiný", "neznámý"] },
    property: { type: "string", enum: PROPS },
    unit: { type: "string" },
    plain_name: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  }, required: ["raw_name", "component", "specimen", "property", "unit", "plain_name", "confidence"] } } }, required: ["answers"] },
};
async function describe(items: Item[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  await Promise.all(chunks(items, 30).map(async (batch) => {
    const { input } = await call("Jsi klinický biochemik. Ke každému vytištěnému názvu laboratorního vyšetření popiš, co měří: složku, materiál (bez prefixu u biochemie sérum, u krevního obrazu krev), druh veličiny a jednotku. Nevymýšlej; nepoznáš-li to, napiš confidence low.", [{ type: "text", text: batch.map((x) => nameLine(x.n)).join("\n") }], DESCRIBE_TOOL);
    const a = byName(input.answers);
    for (const x of batch) out.set(x.n.rawName, a.get(x.n.rawName) ?? {});
  }));
  return out;
}
const SPEC_MAT: Record<string, string> = { S: "s", P: "p", B: "b", U: "u", dU: "du" };

/** Does a table row contradict the blind statement (specimen or kind of quantity)? */
function contradicts(st: any, row: LabCodeRow): string | null {
  const m = SPEC_MAT[st?.specimen];
  if (m && !(m === row.mat || (["s", "p"].includes(m) && ["s", "p"].includes(row.mat)))) return `materiál ${st.specimen} vs ${row.spec}`;
  const props = PROP_CODES[st?.property];
  if (props && !props.includes(row.prop)) return `veličina ${st.property} vs ${row.prop}`;
  return null;
}

async function describeArm(items: Item[], st: Map<string, any>): Promise<Out[]> {
  const out: Out[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let k = next++; k < items.length; k = next++) {
      const x = items[k];
      const s = st.get(x.n.rawName) ?? {};
      const mat = SPEC_MAT[s.specimen] ?? x.n.material;
      const merged = new Map<string, LabCodeHit>();
      for (const h of [...shipped.shortlist(String(s.component || x.n.rawName), s.unit || x.n.unit, mat, 20), ...shipped.shortlist(x.n.rawName, x.n.unit, x.n.material, 10)]) {
        if (!merged.has(h.row.id)) merged.set(h.row.id, h);
      }
      const sl = [...merged.values()].slice(0, 20);
      if (!sl.length) { out[k] = { rawName: x.n.rawName, canonicalId: null, code: null, confidence: "low" }; continue; }
      const p = await pick(client, MODEL, x.n, sl);
      price({ input_tokens: p.usage.inputTokens, output_tokens: p.usage.outputTokens, cache_read_input_tokens: p.usage.cacheReadTokens, cache_creation_input_tokens: p.usage.cacheWriteTokens } as any);
      out[k] = resolve(x.n, p.code === "unknown" ? null : p.code, p.confidence);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

async function fArm(items: Item[], st: Map<string, any>): Promise<Out[]> {
  const picked = await tableArm(items, st);
  return picked.map((o, i) => {
    if (!o.code) return o;
    const why = contradicts(st.get(items[i].n.rawName), shipped.byId(o.code)!);
    return why ? { ...o, canonicalId: null, code: null, confidence: "low" as const, review: true, note: why } : o;
  });
}

async function eArm(items: Item[], codes: LabCodes): Promise<Out[]> {
  const a = await mapByCodes(KEY, MODEL, items.map((x) => x.n), catalog, codes, "catalog");
  price({ input_tokens: a.usage.inputTokens, output_tokens: a.usage.outputTokens, cache_read_input_tokens: a.usage.cacheReadTokens, cache_creation_input_tokens: a.usage.cacheWriteTokens } as any);
  const outs = items.map((x, i) => fromSug(a.suggestions[i], x.n.rawName));
  const retry = items.map((x, i) => [x, i] as const).filter(([, i]) => !outs[i].canonicalId && !outs[i].code);
  if (retry.length) {
    const r = await mapByCodes(KEY, MODEL, retry.map(([x]) => x.n), catalog, codes, "shortlist");
    price({ input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens, cache_read_input_tokens: r.usage.cacheReadTokens, cache_creation_input_tokens: r.usage.cacheWriteTokens } as any);
    retry.forEach(([x, i], k) => (outs[i] = fromSug(r.suggestions[k], x.n.rawName)));
  }
  return outs;
}

/* ---------------------------------------------------------------- score */
function score(items: Item[], outs: Out[]) {
  const t = { right: 0, wrongConf: 0, wrongOther: 0, unknown: 0, review: 0, autoAdd: 0, autoAddWrong: 0 };
  const wrongs: string[] = [];
  items.forEach((x, i) => {
    const o = outs[i];
    if (o.review) t.review++;
    let right: boolean;
    if (x.accept) {
      right = x.accept.length === 0 ? !o.code && !o.canonicalId : !!o.code && x.accept.includes(o.code);
    } else {
      right = o.canonicalId === x.truthId;
    }
    // What VITE_AUTO_ENTRIES would add: a "new" answer with a code at "high".
    if (o.isNew && o.code && o.confidence === "high") {
      t.autoAdd++;
      if (!right) (t.autoAddWrong++, wrongs.push(`AUTO-ADD ${x.n.rawName} [${x.n.unit}] → ${o.code} ${shipped.byId(o.code)?.names.cs.name ?? ""} (truth ${x.truthId ?? x.accept?.join("/")})`));
    }
    if (right) return void t.right++;
    const answered = x.accept ? !!o.code || !!o.canonicalId : !!o.canonicalId;
    if (!answered) return void t.unknown++;
    if (o.confidence === "high") (t.wrongConf++, wrongs.push(`HIGH ${x.n.rawName} [${x.n.unit}] → ${o.canonicalId ?? ""} ${o.code ?? ""} ${o.code ? shipped.byId(o.code)?.names.cs.name ?? "" : ""}`));
    else (t.wrongOther++, wrongs.push(`${o.confidence} ${x.n.rawName} → ${o.canonicalId ?? ""} ${o.code ?? ""}`));
  });
  return { t, wrongs };
}

/* ---------------------------------------------------------------- run */
const all = SETS.flatMap((s) => s.items);
const results: Record<string, Record<string, { t: ReturnType<typeof score>["t"]; usd: number; s: number; wrongs: string[] }>> = {};
let statements: Map<string, any> | null = null;
let describeUsd = 0, describeS = 0;
for (const arm of ARMS) {
  for (const set of SETS) {
    const before = spent;
    const t0 = performance.now();
    let outs: Out[];
    if (arm === "a") {
      const a = await mapByCodes(KEY, MODEL, set.items.map((x) => x.n), catalog, set.aCodes, "catalog");
      price({ input_tokens: a.usage.inputTokens, output_tokens: a.usage.outputTokens, cache_read_input_tokens: a.usage.cacheReadTokens, cache_creation_input_tokens: a.usage.cacheWriteTokens } as any);
      outs = set.items.map((x, i) => fromSug(a.suggestions[i], x.n.rawName));
    } else if (arm === "b") outs = await tableArm(set.items);
    else if (arm === "c") outs = await memoryArm(set.items);
    else if (arm === "e") outs = await eArm(set.items, set.aCodes);
    else if (arm === "g") {
      // What ships as MAP_MODE=codes-retry: e, with exact drafts confirmed by the model.
      const g = await mapByCodes(KEY, MODEL, set.items.map((x) => x.n), catalog, set.aCodes, "catalog+shortlist");
      price({ input_tokens: g.usage.inputTokens, output_tokens: g.usage.outputTokens, cache_read_input_tokens: g.usage.cacheReadTokens, cache_creation_input_tokens: g.usage.cacheWriteTokens } as any);
      outs = set.items.map((x, i) => fromSug(g.suggestions[i], x.n.rawName));
    }
    else {
      if (!statements) {
        const t1 = performance.now(), b1 = spent;
        statements = await describe(all);
        describeUsd = spent - b1;
        describeS = (performance.now() - t1) / 1000;
      }
      outs = arm === "d" ? await describeArm(set.items, statements) : await fArm(set.items, statements);
    }
    const { t, wrongs } = score(set.items, outs);
    ((results[arm] ??= {})[set.id] = { t, usd: spent - before, s: (performance.now() - t0) / 1000, wrongs });
    console.log(`${arm} | ${set.id.padEnd(26)} | n ${String(set.items.length).padStart(3)} | right ${t.right} · wrong-conf ${t.wrongConf} · wrong-other ${t.wrongOther} · unknown ${t.unknown}${t.review ? ` · review ${t.review}` : ""}${t.autoAdd ? ` · auto-add ${t.autoAdd} (wrong ${t.autoAddWrong})` : ""} | $${((spent - before) / set.items.length).toFixed(5)}/name | ${((performance.now() - t0) / 1000).toFixed(1)} s`);
    for (const w of wrongs.slice(0, 6)) console.log(`      ${w}`);
  }
}
if (statements) console.log(`\nblind descriptions (shared by d and f): $${describeUsd.toFixed(4)} for ${all.length} names, ${describeS.toFixed(1)} s`);
if (ARMS.includes("c")) console.log(`memory codes: ${memoryReal} of ${memoryTotal} five-digit codes exist in the table`);
console.log(`spent $${spent.toFixed(4)}`);
mkdirSync(join(R, "results"), { recursive: true });
writeFileSync(join(R, "results/map_ncl_arms.json"), JSON.stringify({ results, describeUsd, memoryReal, memoryTotal, spent }, null, 1));
