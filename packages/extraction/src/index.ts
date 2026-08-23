/**
 * Bloodwork PDF extraction: the prompts, the tool schema, and the two calls
 * that transcribe one page. Server-side only.
 *
 * `Usage` is re-exported because PageExtraction carries one, so a caller
 * handling an extraction result needs the type. It is defined once, in
 * @bw/agent-core — a link rather than a copy.
 */
export type { Usage } from "@bw/agent-core";
export * from "./extract";
