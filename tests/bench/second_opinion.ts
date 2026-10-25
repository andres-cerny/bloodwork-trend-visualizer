/**
 * The second opinion on weak list matches, on real names: every weak match
 * in the public sample sheets' stored reads, plus the look-alike cases the
 * round-3 evaluation found. docs/plans/model-loop.md, round 4.
 *
 *   with-secrets bloodwork -- npx vite-node --root . tests/bench/second_opinion.ts
 *
 * One Haiku 5.5 mapping call (~$0.003). SECOND_OPINION_DRY=1 lists the weak
 * matches and sends nothing.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { suggestCanonical, type CatalogEntry } from "@bw/extraction";
import { priceUsd } from "@bw/agent-core";
import { Registry, findWeakMatches, makeMeasurement, normalizeMeasurement, type LabReport } from "@bw/lab-core";

import { judgeSecondOpinion } from "../../apps/portal/src/lib/aiMapping";

const R = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(R, "../../apps/portal/public/registry.json"), "utf8"));
const registry = new Registry(raw);
const catalog: CatalogEntry[] = raw.map((d: any) => ({ id: d.canonicalId, name: d.displayNameCs, unit: d.canonicalUnit }));

const mk = (name: string, value: string, unit: string, range: string) =>
  normalizeMeasurement(makeMeasurement({ rawAnalyteName: name, valueRaw: value, unitRaw: unit, refRangeRaw: range, sourceSnippet: "", confidence: "high", extractedBy: "bench" }));

const reports: LabReport[] = [];
const dir = join(R, "results/adapt/sonnet55");
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (j.cls !== "public") continue;
    const ms = (j.call?.extraction?.measurements ?? [])
      .filter((m: any) => !/^(u|fu|du|pt)[_/-]/i.test(m.raw_analyte_name))
      .map((m: any) => ({ ...mk(m.raw_analyte_name, m.value_raw, m.unit_raw ?? "", m.ref_range_raw ?? ""), canonicalId: registry.match(m.raw_analyte_name) }));
    reports.push({ id: j.slug, pages: [], reportDate: "2026-01-01", labName: j.call?.extraction?.lab_name ?? j.slug, measurements: ms } as unknown as LabReport);
  }
}
// The look-alikes round 3 found, as a lab would print them.
const lookalike = (name: string, value: string, unit: string, range: string) => ({ ...mk(name, value, unit, range), canonicalId: registry.match(name) });
reports.push({
  id: "lookalikes",
  pages: [],
  reportDate: "2026-01-01",
  labName: "Look-alike lab",
  measurements: [
    lookalike("P_Protrombinový test", "11,8", "s", "9,5 - 13,0"),
    lookalike("HbA1c", "5,6", "%", "4,0 - 6,0"),
    lookalike("Glukóza", "1", "arb.j.", ""),
    lookalike("P_Antitrombin III", "0,28", "mg/L", "0,19 - 0,31"),
    lookalike("Leukocyty", "6,2", "G/l", "4,0 - 10,0"),
    lookalike("S_Albumin", "4,1", "g/dl", "3,5 - 5,2"),
  ],
} as unknown as LabReport);

const weak = findWeakMatches(reports, registry);
console.log(`${weak.length} weak list matches:`);
for (const w of weak) console.log(`  ${w.analyte.rawName} [${w.analyte.unitRaw}] → ${w.listId} (${w.why}, ${w.lab})`);
if (process.env.SECOND_OPINION_DRY === "1" || weak.length === 0) process.exit(0);

const t0 = performance.now();
const res = await suggestCanonical(
  process.env.ANTHROPIC_API_KEY!,
  "claude-haiku-5-5",
  weak.map((w) => ({ rawName: w.analyte.rawName, unit: w.analyte.unitRaw, refRange: w.analyte.refRangeRaw, material: w.analyte.material })),
  catalog,
);
const ms = performance.now() - t0;
console.log("\nverdicts:");
for (const o of judgeSecondOpinion({ ...res, budget: null as any }, weak, registry, new Map())) {
  console.log(`  ${o.verdict.padEnd(7)} ${o.rawName} [${o.unit}] list=${o.listId} → ${o.canonicalId ?? "none"}   model: ${o.said.decision}/${o.said.canonicalId ?? "-"}/${o.said.confidence} — ${o.said.reason}`);
}
console.log(`\n${(ms / 1000).toFixed(1)} s, $${priceUsd(res.model, res.usage.inputTokens, res.usage.outputTokens, res.usage.cacheReadTokens, res.usage.cacheWriteTokens).toFixed(4)}`);
