/**
 * Mapping eval, step 1 — dump what the model is asked on each fixture.
 *
 *   npx vitest run --config tests/bench/vitest.config.ts tests/bench/map_dump.bench.ts
 *
 * Writes results/map_eval/<fixture>.json: the system prompt and the batches
 * of `mapPrompt()` text, 30 names each, exactly as the extract worker sends
 * them. No call is made. See map_eval.ts for the whole loop.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { OUT, catalogOf, dumpOf, fixtures, reportsOf, shippedRegistry } from "./map_eval";

it("map eval — dump the prompts", async () => {
  mkdirSync(OUT, { recursive: true });
  const registry = shippedRegistry();
  const catalog = catalogOf(registry);
  for (const f of fixtures()) {
    const reports = await reportsOf(f.dir, registry);
    const { dump } = dumpOf(f.slug, reports, catalog);
    writeFileSync(join(OUT, `${f.slug}.json`), JSON.stringify(dump, null, 1));
    console.log(`${f.slug}: ${reports[0]?.measurements.length ?? 0} rows → ${dump.asked.length} names to ask in ${dump.batches.length} batch(es)`);
  }
});
