/**
 * The mapping confidence gate: is the model's own "high" the right thing to
 * file a mapping on without a human, or would a calibrated yes/no (Jev,
 * TypeSafe systemone) be better? docs/plans/model-loop.md, H13, round 2.
 *
 * Truth: tests/bench/map_gate_truth.json — printed names from the public
 * sample sheets the catalog does not match, hand-labelled. Only label text,
 * unit and printed range leave the machine; no value, no person.
 *
 *   with-secrets bloodwork -- npx vite-node --root . tests/bench/map_gate.ts
 *
 * Costs: one Haiku 5.5 mapping call per 30 names (~$0.002), Jev at
 * $0.042 / 1M tokens. MAP_GATE_DRY=1 prints the questions and sends nothing.
 *
 * Gates compared on Haiku 5.5's catalog proposals:
 *   current   decision "catalog" + confidence "high" + canApplyUnasked
 *   jev       Jev p(same test) >= threshold, and not contradicted by the
 *             deterministic evidence (unit, interval, material)
 * and, separately, Jev's calibration on truth pairs vs hand-picked near
 * misses (does p separate "the same test" from "a sibling test"?).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { suggestCanonical, type CatalogEntry, type NameToMap } from "@bw/extraction";
import { priceUsd } from "@bw/agent-core";
import {
  Registry,
  canApplyUnasked,
  isImplausible,
  materialPrefix,
  parseRange,
  scoreCandidate,
  type UnmappedAnalyte,
} from "@bw/lab-core";

const R = dirname(fileURLToPath(import.meta.url));
const DRY = process.env.MAP_GATE_DRY === "1";
const JEV_USD_PER_M = 0.042;
const truth = JSON.parse(readFileSync(join(R, "map_gate_truth.json"), "utf8")).items as Array<{ name: string; truth: string; wrong: string[] }>;
const registry = new Registry(JSON.parse(readFileSync(join(R, "../../apps/portal/public/registry.json"), "utf8")));
const catalog: CatalogEntry[] = [...registry.analytes.values()].map((d) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));

// Unit and printed range from the stored reads (Sonnet 5.5 first, then Gemini).
const printed = new Map<string, { unit: string; range: string }>();
for (const arm of ["sonnet55", "gemini38_ultra", "haiku55"]) {
  const dir = join(R, "results/adapt", arm);
  if (!existsSync(dir)) continue;
  for (const f of (await import("node:fs")).readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const m of j.call?.extraction?.measurements ?? []) {
      if (!printed.has(m.raw_analyte_name)) printed.set(m.raw_analyte_name, { unit: m.unit_raw ?? "", range: m.ref_range_raw ?? "" });
    }
  }
}
const names: NameToMap[] = truth.map((t) => ({
  rawName: t.name,
  unit: printed.get(t.name)?.unit ?? "",
  refRange: printed.get(t.name)?.range ?? "",
  material: materialPrefix(t.name),
}));

const analyteOf = (n: NameToMap): UnmappedAnalyte => {
  const r = parseRange(n.refRange);
  return {
    rawName: n.rawName,
    unitRaw: n.unit,
    occurrences: [],
    refRange: r.low !== null || r.high !== null ? ({ low: r.low, high: r.high } as any) : null,
    refRangeRaw: n.refRange,
    refRangeFrom: null,
    material: n.material,
    materialSource: n.material ? ("prefix" as any) : null,
  };
};

/* ---------------------------------------------------------------- Jev */
function question(n: NameToMap, id: string) {
  const a = registry.get(id)!;
  return {
    type: "noul",
    instructions:
      `A Czech/Slovak lab report prints the test name "${n.rawName}" with unit "${n.unit || "(none)"}" ` +
      `and reference range "${n.refRange || "(none)"}". Is this exactly the same laboratory test as the catalog ` +
      `entry "${a.displayNameCs}" (canonical unit "${a.canonicalUnit || "dimensionless"}")? ` +
      `A prefix like S_, B_, P_ names the specimen (serum, blood, plasma). A different fraction, ratio, ` +
      `calculation, method-specific variant that reports a different quantity, or a related test is NOT the same test.`,
    criteria: {
      true: "same analyte and same quantity; results could be plotted on one trend line",
      false: "a different test, a sibling (e.g. MCH vs MCHC, total vs conjugated), a ratio vs a single value, or unclear",
    },
  };
}

async function jev(questions: Record<string, unknown>): Promise<{ answers: Record<string, any>; tokens: number }> {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
    body: JSON.stringify({
      model: "jev-latest",
      state: "You map printed laboratory test names from Czech and Slovak lab reports onto a fixed catalog of blood tests.",
      questions,
    }),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as any;
  const tokens = Object.values(data.usage ?? {}).reduce((s: number, v: any) => s + (typeof v === "number" ? v : 0), 0) as number;
  return { answers: data.answers ?? {}, tokens };
}

function pTrue(a: any): number {
  const probs = a?.probabilities;
  if (probs && typeof probs === "object") for (const k of ["true", "yes", "1"]) if (k in probs) return Number(probs[k]);
  if (typeof a?.probability === "number") return a.probability;
  const v = a?.noul ?? a?.answer;
  if (typeof v === "number") return v;
  const c = Number(a?.confidence ?? 1);
  return v === true ? c : 1 - c;
}

/* ---------------------------------------------------------------- run */
const pairs: Array<{ n: NameToMap; id: string; label: boolean; why: string }> = [];
const add = (n: NameToMap, id: string, why: string) => {
  if (!registry.get(id) || pairs.some((p) => p.n.rawName === n.rawName && p.id === id)) return;
  const t = truth.find((x) => x.name === n.rawName)!;
  pairs.push({ n, id, label: t.truth === id, why });
};
for (const [i, t] of truth.entries()) {
  if (t.truth !== "NONE") add(names[i], t.truth, "truth");
  for (const w of t.wrong) add(names[i], w, "near-miss");
}

let spent = 0;
let haiku: Awaited<ReturnType<typeof suggestCanonical>> | null = null;
if (DRY) {
  console.log(JSON.stringify(question(names[0], truth[0].truth), null, 1));
  console.log(`${names.length} names, ${pairs.length} truth/near-miss pairs (+ Haiku's proposals). Nothing sent.`);
  process.exit(0);
}
haiku = await suggestCanonical(process.env.ANTHROPIC_API_KEY!, "claude-haiku-5-5", names, catalog);
spent += priceUsd(haiku.model, haiku.usage.inputTokens, haiku.usage.outputTokens, haiku.usage.cacheReadTokens, haiku.usage.cacheWriteTokens);
for (const s of haiku.suggestions) {
  if (s.decision === "catalog" && s.canonicalId) add(names.find((n) => n.rawName === s.rawName)!, s.canonicalId, "haiku");
}

const p = new Map<string, number>();
let jevTokens = 0;
for (let i = 0; i < pairs.length; i += 20) {
  const chunk = pairs.slice(i, i + 20);
  const qs = Object.fromEntries(chunk.map((x, j) => [`q${i + j}`, question(x.n, x.id)]));
  const r = await jev(qs);
  jevTokens += r.tokens;
  chunk.forEach((x, j) => p.set(`${x.n.rawName}\u0000${x.id}`, pTrue(r.answers[`q${i + j}`])));
}
spent += (jevTokens / 1e6) * JEV_USD_PER_M;

/* ---------------------------------------------------------------- score */
const lines: string[] = [];
const log = (s: string) => { console.log(s); lines.push(s); };
log("# Jev calibration on truth vs near-miss pairs");
for (const x of pairs.filter((x) => x.why !== "haiku")) {
  log(`${x.label ? "SAME " : "other"} p=${p.get(`${x.n.rawName}\u0000${x.id}`)!.toFixed(3)}  ${x.n.rawName} → ${x.id}`);
}
const same = pairs.filter((x) => x.label).map((x) => p.get(`${x.n.rawName}\u0000${x.id}`)!);
const other = pairs.filter((x) => !x.label).map((x) => p.get(`${x.n.rawName}\u0000${x.id}`)!);
let auc = 0;
for (const a of same) for (const b of other) auc += a > b ? 1 : a === b ? 0.5 : 0;
log(`AUC (same vs other) = ${(auc / (same.length * other.length)).toFixed(3)}  (${same.length} same, ${other.length} other)`);

log("\n# Gates on Haiku 5.5's proposals (what would be filed without a human)");
const rows = haiku.suggestions.map((s) => {
  const t = truth.find((x) => x.name === s.rawName)!;
  const n = names.find((x) => x.rawName === s.rawName)!;
  const a = s.canonicalId ? registry.get(s.canonicalId) : null;
  const cand = a ? scoreCandidate(analyteOf(n), a, new Map()) : null;
  const pj = s.canonicalId ? p.get(`${s.rawName}\u0000${s.canonicalId}`) ?? null : null;
  const right = s.decision === "catalog" ? s.canonicalId === t.truth : t.truth === "NONE";
  return { s, t, cand, pj, right };
});
for (const r of rows) {
  log(`${r.right ? "right" : "WRONG"} ${r.s.decision.padEnd(9)} ${r.s.confidence.padEnd(6)} ${String(r.s.canonicalId ?? "").padEnd(22)} truth=${r.t.truth.padEnd(22)} canApply=${r.cand ? canApplyUnasked(r.cand) : "-"} jev=${r.pj === null ? "-" : r.pj.toFixed(3)}  ${r.s.rawName}`);
}
const gate = (name: string, f: (r: (typeof rows)[number]) => boolean) => {
  const filed = rows.filter((r) => r.s.decision === "catalog" && r.s.canonicalId && f(r));
  const wrong = filed.filter((r) => !r.right).length;
  const reachable = rows.filter((r) => r.t.truth !== "NONE").length;
  log(`${name.padEnd(34)} filed ${filed.length} (wrong ${wrong}) of ${reachable} names that have a catalog entry`);
};
log("");
gate("current: high + canApplyUnasked", (r) => r.s.confidence === "high" && !!r.cand && canApplyUnasked(r.cand));
gate("model's high alone", (r) => r.s.confidence === "high");
for (const th of [0.5, 0.8, 0.9, 0.95]) gate(`jev >= ${th} + not contradicted`, (r) => (r.pj ?? 0) >= th && !!r.cand && !isImplausible(r.cand, { nameByModel: true }));
log(`\nHaiku usage ${JSON.stringify(haiku.usage)}`);
log(`spent $${spent.toFixed(4)} (Haiku $${priceUsd(haiku.model, haiku.usage.inputTokens, haiku.usage.outputTokens, haiku.usage.cacheReadTokens, haiku.usage.cacheWriteTokens).toFixed(4)}, Jev ${jevTokens} tokens)`);
mkdirSync(join(R, "results"), { recursive: true });
writeFileSync(join(R, "results/map_gate.txt"), lines.join("\n") + "\n");
