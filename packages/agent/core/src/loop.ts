/**
 * One agent turn: stream text, run the tools the model asks for, repeat until
 * it stops asking.
 *
 * Two things here are load-bearing rather than incidental.
 *
 * Usage is accumulated across every round-trip and emitted once, on `done`.
 * A tool-using turn makes several API calls, and pricing only the last one
 * under-reports the turn by however many tool rounds it took — the ledger is
 * the only thing bounding what this demo can spend, so it has to see all of it.
 *
 * The loop is bounded. A model that keeps calling tools forever is not
 * hypothetical, and an unbounded loop against a paid API is the expensive kind
 * of bug. It stops and says so rather than continuing quietly.
 */
import Anthropic from "@anthropic-ai/sdk";
import { runTool, TOOLS, type ToolResult } from "@bw/agent-tools";
import type { PatientDataSource } from "@bw/datasource";
import { clientFor, usageOf, type Usage } from "./client";
import type { AgentEvent } from "./events";
import type { Profile } from "./profiles";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Enough rounds for list -> fetch -> chart, and not enough to run away. */
const MAX_ROUNDS = 6;

const zero = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

const add = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export async function* runAgent(opts: {
  apiKey: string;
  profile: Profile;
  history: ChatTurn[];
  /** Injected data, for profiles with no tools. */
  context?: string;
  /** Required by profiles that have tools. */
  source?: PatientDataSource;
}): AsyncGenerator<AgentEvent> {
  const { apiKey, profile, history, context, source } = opts;
  const client = clientFor(apiKey);
  const tools = TOOLS.filter((t) => profile.tools.includes(t.name));

  // The instructions are stable across a conversation; the patient's data is
  // not, so the cache breakpoint sits between them.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: profile.system, cache_control: { type: "ephemeral" } },
  ];
  if (context) system.push({ type: "text", text: `=== DATA PACIENTA ===\n${context}` });

  const messages: Anthropic.MessageParam[] = history.slice(-12).map((t) => ({
    role: t.role,
    content: t.content,
  }));

  let total = zero();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.messages.stream({
      model: profile.model,
      max_tokens: profile.maxTokens,
      system,
      messages,
      ...(tools.length ? { tools: tools as unknown as Anthropic.Tool[] } : {}),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { type: "text", text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();
    total = add(total, usageOf(message.usage));

    const calls = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (calls.length === 0) {
      yield { type: "done", usage: total, model: profile.model };
      return;
    }

    if (!source) {
      yield { type: "error", message: "Tento profil nemá připojený zdroj dat." };
      yield { type: "done", usage: total, model: profile.model };
      return;
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of calls) {
      yield { type: "tool_start", id: call.id, name: call.name, input: call.input };
      const r: ToolResult = await runTool(call.name, call.input as Record<string, unknown>, source);
      yield { type: "tool_result", id: call.id, name: call.name, ok: r.ok, summary: r.summary };
      // A chart is emitted as its own event so the client can draw it without
      // parsing the model's prose. The series came from the data source, never
      // from the model.
      if (r.chart) yield { type: "chart", spec: r.chart.spec, series: r.chart.series };
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(r.content),
        is_error: !r.ok,
      });
    }
    messages.push({ role: "user", content: results });
  }

  yield {
    type: "error",
    message: `Agent nedospěl k odpovědi ani po ${MAX_ROUNDS} kolech nástrojů.`,
  };
  yield { type: "done", usage: total, model: profile.model };
}
