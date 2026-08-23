/**
 * The agent: what Claude is told, which model answers, what it may reach for,
 * and what a call costs.
 *
 * Shared by both apps through the agent worker. The apps never send a system
 * prompt — they name a profile, and it is resolved here. That is the rule that
 * keeps one shared backend from decaying into two backends sharing a file, and
 * it is a security boundary too: a client that can send a prompt can delete
 * every guardrail in one.
 */
export * from "./client";
export * from "./pricing";
export * from "./events";
export * from "./profiles";
export * from "./loop";
