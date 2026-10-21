/**
 * Which request shape a reader model accepts, and the one check every reply
 * goes through.
 *
 * The extraction calls were written for Sonnet 5 and Haiku 4.5, and both lean
 * on a *forced* tool call: `tool_choice: {type: "tool"}` guarantees the reply
 * is the record and nothing else. The 5.5 generation splits on that:
 *
 *   - Sonnet 5.5 (and Opus 5.5, Fable 5.1) reject a forced `tool_choice` with
 *     a 400. They take `auto` plus `strict: true` on the tool, and a sentence
 *     in the turn saying which tool answers. `auto` does not guarantee a call,
 *     so a reply with no tool call is a failed read, never an empty page.
 *     Sonnet 5.5 also rejects `thinking: {type: "disabled"}`; its "off" is
 *     `{type: "between_tools"}`, which is what transcription wants — thinking
 *     here is output tokens, and output tokens are the wait
 *     (docs/extraction-speed.md, r² = 0.993).
 *   - Haiku 5.5 still accepts a forced tool, and a forced call skips thinking,
 *     so it keeps today's shape exactly.
 *   - Sonnet 5 and Haiku 4.5 are unchanged byte for byte — this module must
 *     not move the deployed request (Haiku 4.5 400s on `output_config.effort`,
 *     which is why nothing here sets one for it).
 *
 * Nothing sets `temperature` (Sonnet 5.5 and Haiku 5.5 reject non-default
 * sampling) and nothing prefills an assistant turn (rejected on every model
 * from the 4.6 family on).
 */
import type Anthropic from "@anthropic-ai/sdk";

import type { Usage } from "@bw/agent-core";

/** Models that 400 on `tool_choice` `any`/`tool`. */
const NO_FORCED_TOOL = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]);

/** Models whose lowest thinking setting is `between_tools` (and that reject `disabled`). */
const BETWEEN_TOOLS = new Set(["claude-sonnet-5-5"]);

/** Models that cannot turn thinking off at all; effort is the only lever. */
const ALWAYS_THINKS = new Set(["claude-opus-5-5", "claude-fable-5-1"]);

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ReaderShape {
  /** True when the call is forced; false when `auto` + strict + a nudge. */
  forced: boolean;
  tool_choice: Anthropic.ToolChoice;
  /** Spread into the request; absent keys are simply not sent. */
  extra: Record<string, unknown>;
  /** A sentence appended to the user turn, only for `auto` models. */
  nudge: string | null;
}

export function forcesTool(model: string): boolean {
  return !NO_FORCED_TOOL.has(model);
}

/**
 * The request fields that depend on the model, for a call whose only valid
 * answer is one call of `toolName`.
 *
 * `effort` is opt-in and only sent where the model accepts it; a caller that
 * passes nothing gets today's request for today's models.
 */
export function readerShape(model: string, toolName: string, opts: { effort?: Effort } = {}): ReaderShape {
  const extra: Record<string, unknown> = {};
  if (BETWEEN_TOOLS.has(model)) extra.thinking = { type: "between_tools" };
  if (ALWAYS_THINKS.has(model)) extra.output_config = { effort: opts.effort ?? "low" };
  else if (opts.effort && model !== "claude-haiku-4-5") extra.output_config = { effort: opts.effort };
  if (forcesTool(model)) {
    return { forced: true, tool_choice: { type: "tool", name: toolName }, extra, nudge: null };
  }
  return {
    forced: false,
    tool_choice: { type: "auto" },
    extra,
    nudge: `Odpověz výhradně jedním voláním nástroje ${toolName}.`,
  };
}

/** The tool as sent to this model: `strict` wherever the call is not forced. */
export function toolFor<T extends object>(model: string, tool: T): T {
  return forcesTool(model) ? tool : ({ ...tool, strict: true } as T);
}

/**
 * A reply the provider billed but that is not a usable record.
 *
 * Duck-typed by `billedUsage` (gemini.ts) like `BilledReadError`, so the
 * Worker prices it and reports the reader as failed. A failed reader is the
 * safe outcome: `readersAttempted` stays 2 while only one read lands, so the
 * page comes back unconfirmed rather than looking cross-checked.
 */
export class UnusableReplyError extends Error {
  readonly name = "UnusableReplyError";
  constructor(message: string, readonly model: string, readonly usage: Usage, readonly stopReason: string | null) {
    super(message);
  }
}

/**
 * The tool input of a reply, or a throw that says why there is none.
 *
 * Three replies used to pass silently as "this reader found these rows":
 *   - `max_tokens`: a tool call cut off mid-array. The SDK hands back whatever
 *     prefix parsed, so a dense page read *partially* looked like a page with
 *     fewer rows — and on a page both readers truncate the same way, the
 *     missing rows have no witness at all.
 *   - `refusal`: the 5.5 models run safety classifiers; a declined page has
 *     no content to read.
 *   - no tool call at all, which `auto` allows.
 */
export function recordInput(message: Anthropic.Message, model: string, usage: Usage, toolName: string): Record<string, unknown> {
  const stop = (message.stop_reason as string | null) ?? null;
  if (stop === "max_tokens") throw new UnusableReplyError("reply cut off at max_tokens", model, usage, stop);
  if (stop === "refusal") throw new UnusableReplyError("model declined the page", model, usage, stop);
  // The request offers exactly one tool, so any tool_use block is that tool;
  // the name is preferred when present.
  const block =
    message.content.find((b) => b.type === "tool_use" && b.name === toolName) ??
    message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new UnusableReplyError("reply carried no tool call", model, usage, stop);
  return (block.input as Record<string, unknown>) ?? {};
}
