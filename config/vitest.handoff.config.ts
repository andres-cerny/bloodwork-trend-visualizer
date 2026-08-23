import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests that can only run on a developer machine — they need an Anthropic API
 * key, a browser, or both, so they are deliberately outside the default
 * `npm test` run and outside CI.
 *
 *   npm run test:live   real extraction through the Claude API (costs money)
 *   npm run test:e2e    the built app driven in a real browser
 *   npm run test:handoff  both
 *
 * It lives in config/ rather than at the repo root on purpose. Vitest looks for
 * a `vitest.workspace.*` file in the *config file's own directory*, not in the
 * working directory — so once the restructure adds a workspace file at the
 * root, a config sitting beside it would silently lose its own `include` and
 * report "no test files found". Being one directory down is what keeps this
 * config authoritative over what it runs.
 *
 * `root` is therefore pinned explicitly: the include globs are relative to the
 * config's directory, and these tests live above it.
 */
export default defineConfig({
  test: {
    root: fileURLToPath(new URL("..", import.meta.url)),
    include: ["tests/live/**/*.live.ts", "e2e/**/*.e2e.ts"],
    environment: "node",
    // A live extraction round-trips two models; a browser run boots a server.
    testTimeout: 180_000,
    hookTimeout: 120_000,
    // These hit a paid API and a real browser — running files in parallel
    // makes cost and failures harder to attribute.
    fileParallelism: false,
  },
});
