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
      name: "datasource",
      root: "./packages/agent/datasource",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      // The turn's evidence registry — the rule that one piece of evidence
      // gets one citation number, which nothing above it can enforce.
      name: "agent-core",
      root: "./packages/agent/core",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      // The tool step summaries. They are the one part of a ToolResult that
      // reaches the doctor's eye verbatim rather than the model's context, so
      // their Czech is user-visible copy and gets pinned like any other.
      name: "agent-tools",
      root: "./packages/agent/tools",
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
      // The chat client's pure helpers — the date formatter every rendered
      // date goes through, and the excerpt folder that must never touch a
      // word of a quote. Everything else in apps/chat is verified by the
      // screenshot walk; these two are the ones a regression would hide.
      name: "chat-app",
      root: "./apps/chat",
      include: ["src/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      // The portal client's pure helpers: how a page's reads become rows,
      // which is where a highlight lands on the wrong printed row.
      name: "portal-app",
      root: "./apps/portal",
      include: ["tests/**/*.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "portal",
      root: "./workers/portal",
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
      include: ["tests/bench/**/*.test.ts"],
      environment: "node",
    },
  },
]);
