import { defineWorkspace } from "vitest/config";

/**
 * What `npm test` runs: every project's unit tests, free and offline.
 *
 * Each project sets its own `root`, so its `include` is relative to its own
 * directory — which is what replaced the single config that had to reach
 * upwards with "../worker/tests/**" and "../bench/**" to find everything from
 * inside web/.
 *
 * Deliberately absent: bench/ sweeps and config/vitest.handoff.config.ts. Those
 * spend money or need a browser, so they stay outside the default run and are
 * invoked by their own scripts. Note the handoff config lives one directory
 * down precisely so *this* file does not capture it — vitest looks for a
 * workspace beside the config it was given.
 */
export default defineWorkspace([
  {
    test: {
      name: "lab-core",
      root: "./packages/lab-core",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "ui-kit",
      root: "./packages/ui-kit",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "bloodwork",
      root: "./apps/bloodwork",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "gate",
      root: "./packages/gate",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "agent",
      root: "./workers/agent",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "bloodwork-shell",
      root: "./apps/bloodwork/worker",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "chat-shell",
      root: "./apps/chat/worker",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "extract",
      root: "./workers/extract",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "bench",
      root: ".",
      include: ["bench/**/*.test.ts"],
      environment: "node",
    },
  },
]);
