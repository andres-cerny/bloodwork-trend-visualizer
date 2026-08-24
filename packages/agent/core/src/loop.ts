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
import { runTool, TOOLS, type ToolContext, type ToolResult } from "@bw/agent-tools";
import { clientFor, usageOf, type Usage } from "./client";
import type { AgentEvent } from "./events";
import { FOLLOWUP_SENTINEL, type Profile } from "./profiles";
import { createSourceRegistry } from "./sources";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Enough rounds for list -> fetch -> chart, and not enough to run away. */
const MAX_ROUNDS = 6;

/** More than three chips is a menu, not a suggestion. */
const MAX_FOLLOWUPS = 3;

/** A proposal long enough to need scrolling is not a question, it is a paste. */
const MAX_FOLLOWUP_CHARS = 200;

/**
 * The gate every text delta passes through.
 *
 * The sentinel can split across delta boundaries anywhere — "…hodnota.\n\n@@NAV"
 * then "AZUJICI@@\n[…]" — so the gate holds back the longest suffix that could
 * still grow into the sentinel, plus the whitespace in front of it, and streams
 * it the instant the match dies. Streamed text cannot be taken back, which is
 * why the holding is pessimistic and the release is late rather than the other
 * way round: briefly buffering three characters is invisible, leaking `@@NAV`
 * into a doctor's answer is not.
 *
 * Anything still held when the stream ends and never became a sentinel is
 * flushed as text — an answer ending in "@" is odd, an answer with its last
 * word silently eaten is a defect.
 */
function tailGate() {
  let held = "";
  let tail: string | null = null;
  return {
    /** What is safe to stream now. */
    push(delta: string): string {
      if (tail !== null) {
        tail += delta;
        return "";
      }
      const buf = held + delta;
      const at = buf.indexOf(FOLLOWUP_SENTINEL);
      if (at !== -1) {
        tail = buf.slice(at + FOLLOWUP_SENTINEL.length);
        held = "";
        return buf.slice(0, at).replace(/\s+$/, "");
      }
      let keep = 0;
      for (let n = Math.min(FOLLOWUP_SENTINEL.length - 1, buf.length); n > 0; n--) {
        if (buf.endsWith(FOLLOWUP_SENTINEL.slice(0, n))) {
          keep = n;
          break;
        }
      }
      // The blank line before the sentinel is scaffolding too, and there is no
      // un-emitting it once the reader has it.
      while (keep < buf.length && /\s/.test(buf[buf.length - keep - 1])) keep++;
      held = buf.slice(buf.length - keep);
      return buf.slice(0, buf.length - keep);
    },
    /** Held text that turned out to be an ordinary ending. */
    flush(): string {
      const out = tail === null ? held : "";
      held = "";
      return out;
    },
    /** Everything after the sentinel, or null if it never arrived. */
    tail(): string | null {
      return tail;
    },
  };
}

/**
 * The proposals out of the tail, or none at all.
 *
 * Every failure mode here — no array, truncated JSON, a number where a question
 * belongs — resolves to an empty list, because the alternative is showing the
 * reader the scaffolding. A turn with no chips looks finished; a turn with
 * `["Ukaž graf` under it looks broken.
 */
export function parseFollowups(tail: string): string[] {
  const start = tail.indexOf("[");
  const end = tail.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(tail.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const q = item.trim();
    if (!q || q.length > MAX_FOLLOWUP_CHARS) continue;
    if (out.some((x) => x.toLowerCase() === q.toLowerCase())) continue;
    out.push(q);
    if (out.length === MAX_FOLLOWUPS) break;
  }
  return out;
}

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
  data?: ToolContext;
}): AsyncGenerator<AgentEvent> {
  const { apiKey, profile, history, context, data } = opts;
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

  // The turn's evidence registry — one for the whole turn, so numbering is
  // stable across rounds and tools; tools embed the numbers in what the model
  // reads. Its rule (one piece of evidence, one number) lives in sources.ts.
  // The context is used as handed over, NOT copied: the server's bind closure
  // mutates this same object mid-turn when find_patient resolves, and a copy
  // here would receive the closure but never the mutation.
  const { sources, cite } = createSourceRegistry();
  const ctx = data;
  if (ctx) ctx.cite = cite;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.messages.stream({
      model: profile.model,
      max_tokens: profile.maxTokens,
      system,
      messages,
      ...(tools.length ? { tools: tools as unknown as Anthropic.Tool[] } : {}),
    });

    // A fresh gate per round: a tail the model emitted before asking for a
    // tool is scaffolding out of place, and gets dropped rather than shown.
    const gate = tailGate();
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const out = gate.push(event.delta.text);
        if (out) yield { type: "text", text: out };
      }
    }
    const held = gate.flush();
    if (held) yield { type: "text", text: held };
    const rawTail = gate.tail();

    const message = await stream.finalMessage();
    total = add(total, usageOf(message.usage));

    const calls = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (calls.length === 0) {
      if (sources.length > 0) yield { type: "sources", sources };
      // After the evidence, before the terminal event: the chips belong to a
      // finished answer, and a malformed tail is silently no chips at all.
      const questions = rawTail === null ? [] : parseFollowups(rawTail);
      if (questions.length > 0) yield { type: "followups", questions };
      yield { type: "done", usage: total, model: profile.model };
      return;
    }

    // A missing context is mis-wiring on the server, not a state the model
    // can recover from. A missing *patient* inside the context is the model's
    // to handle — runTool answers it per tool, and find_patient still works.
    if (!data) {
      yield { type: "error", message: "Tento profil nemá připojený zdroj dat." };
      yield { type: "done", usage: total, model: profile.model };
      return;
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const call of calls) {
      yield { type: "tool_start", id: call.id, name: call.name, input: call.input };
      const r: ToolResult = await runTool(call.name, call.input as Record<string, unknown>, ctx!);
      yield { type: "tool_result", id: call.id, name: call.name, ok: r.ok, summary: r.summary };
      // A chart is emitted as its own event so the client can draw it without
      // parsing the model's prose. The series came from the data source, never
      // from the model.
      if (r.chart) yield { type: "chart", spec: r.chart.spec, series: r.chart.series };
      // Same reasoning for a resolved patient: the ref rides its own event,
      // and the client pins it rather than scraping the transcript.
      if (r.patient) yield { type: "patient", ...r.patient };
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
