import { defineConfig } from "vitest/config";

/**
 * Tests that can only run on a developer machine — they need an Anthropic API
 * key, a browser, or both, so they are deliberately outside the default
 * `npm test` run and outside CI.
 *
 *   npm run test:live   real extraction through the Claude API (costs money)
 *   npm run test:e2e    the built app driven in a real browser
 *   npm run test:handoff  both
 */
export default defineConfig({
  test: {
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
