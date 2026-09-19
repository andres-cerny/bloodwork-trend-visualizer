/**
 * Mapping eval, the API arm — the same batches through `suggestCanonical`,
 * i.e. Haiku 4.5 exactly as the extract worker calls it. PAID, a few cents:
 * the catalog prefix is cached across batches.
 *
 *   set -a; . ./.env; set +a
 *   BENCH_MAX_USD=0.5 npx vitest run --config tests/bench/vitest.config.ts tests/bench/map_api.bench.ts
 *
 * Writes results/map_eval/out/api/<fixture>.<batch>.json in the raw tool
 * shape map_score.bench.ts reads (MAP_ARM=api). The subagent arms answer the
 * same prompts without spend; this arm is the confirmation that the deployed
 * model behaves like them.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { MODEL_MAP, suggestCanonical } from "@bw/extraction";

import { priceUsd } from "./extract";
import { OUT, catalogOf, fixtures, shippedRegistry } from "./map_eval";
import type { Dump } from "./map_eval";

const MAX_USD = parseFloat(process.env.BENCH_MAX_USD ?? "0.5");

it("map eval — the API arm", async () => {
  const key = process.env.ANTHROPIC_API_KEY ?? "";
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const catalog = catalogOf(shippedRegistry());
  const dir = join(OUT, "out", "api");
  mkdirSync(dir, { recursive: true });
  let spent = 0;
  for (const f of fixtures()) {
    const dump = JSON.parse(readFileSync(join(OUT, `${f.slug}.json`), "utf-8")) as Dump;
    for (const b of dump.batches) {
      if (spent > MAX_USD) throw new Error(`stopped at ${spent.toFixed(3)} USD`);
      const r = await suggestCanonical(key, MODEL_MAP, b.names, catalog);
      const usd = priceUsd(MODEL_MAP, r.usage);
      spent += usd;
      // Back to the wire shape, so the scorer reads every arm the same way.
      const input = {
        suggestions: r.suggestions.map((s) => ({
          raw_name: s.rawName,
          decision: s.decision,
          canonical_id: s.canonicalId,
          new_id: s.proposed?.id ?? null,
          new_name_cs: s.proposed?.displayNameCs ?? null,
          new_unit: s.proposed?.unit ?? null,
          reason: s.reason,
          confidence: s.confidence,
        })),
      };
      writeFileSync(join(dir, `${f.slug}.${b.n}.json`), JSON.stringify(input, null, 1));
      console.log(`${f.slug}#${b.n}: ${r.suggestions.length}/${b.names.length} answered, ${usd.toFixed(4)} USD`);
    }
  }
  console.log(`total ${spent.toFixed(4)} USD`);
});
