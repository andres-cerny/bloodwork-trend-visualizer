import { defineConfig } from "vitest/config";

/**
 * The benchmark runner. Vitest is used purely as a module loader with a long
 * timeout — these files are sweeps that print tables and write JSONL, not
 * assertions. They live outside `npm test` because some of them spend money.
 *
 *   npm run bench:stage0     free — parse floor, token counts, cache probe
 *   npm run bench:latency    paid — the (model x effort x thinking) grid
 */
export default defineConfig({
  test: {
    include: ["tests/bench/**/*.bench.ts"],
    environment: "node",
    testTimeout: 3_600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    // A sweep prints its results; swallowing them would defeat the point.
    silent: false,
  },
});
