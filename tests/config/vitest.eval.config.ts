import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The eval runner. Vitest is a module loader with a long timeout here, the same
 * way bench/ uses it — these are sweeps that print a table and write JSON, not
 * assertions.
 *
 * Outside `npm test` because it spends real money, and in config/ for the same
 * reason the handoff config is: a workspace file at the repo root would capture
 * a config sitting beside it and silently replace its `include`.
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: ["tests/evals/**/*.eval.ts"],
    environment: "node",
    testTimeout: 1_800_000,
    fileParallelism: false,
    // A sweep prints its results; swallowing them would defeat the point.
    silent: false,
  },
});
