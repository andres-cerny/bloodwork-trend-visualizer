/**
 * The agent: what Claude is told, which model answers, and what a call costs.
 *
 * Shared by both apps through the agent worker. The apps never send a system
 * prompt — they name a profile, and the worker resolves it here. That is the
 * rule that keeps one shared backend from decaying into two backends sharing a
 * file.
 */
export * from "./client";
export * from "./pricing";
export * from "./chat";
