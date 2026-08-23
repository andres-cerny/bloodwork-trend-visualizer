/**
 * What the agent sends back, one event at a time.
 *
 * This is the contract between the worker and both apps, and it is a stream
 * rather than a response for a reason that is not cosmetic: a tool-using agent
 * spends most of a turn not talking, and a UI that shows nothing until the
 * whole answer exists reads as broken. Retrofitting that later would touch
 * every caller, because the old client hard-coded `res.json()`.
 *
 * `usage` arrives on `done`, not alongside the text. Under streaming the token
 * counts are only final at the terminal message event — pricing off anything
 * earlier silently under-reports, and the ledger is what stops the demo
 * spending without limit.
 */
import type { Usage } from "./client";

export type AgentEvent =
  /** A fragment of the answer. Append it. */
  | { type: "text"; text: string }
  /** The model asked for a tool. Named so a UI can say what it is doing. */
  | { type: "tool_start"; id: string; name: string; input: unknown }
  /** That tool answered. */
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  /**
   * A chart the model named and the server resolved against the data source.
   * The model never fills one; `series` came from the deterministic layer.
   */
  | { type: "chart"; spec: unknown; series: unknown }
  /**
   * find_patient resolved to exactly one person. The ref is the server's,
   * from the directory lookup — never parsed out of model text. The client
   * pins it and sends it back with every later turn; the chip it renders is
   * what keeps a near-miss visible to the reader.
   */
  | { type: "patient"; ref: string; fullName: string; birthDate: string }
  /** Terminal. Usage is final here and nowhere earlier. */
  | { type: "done"; usage: Usage; model: string }
  | { type: "error"; message: string };

/** One event as a Server-Sent Events frame. */
export function toSse(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse an SSE body into events.
 *
 * Frames can split across chunk boundaries anywhere, so the tail of a chunk is
 * held until its blank line arrives — reading each chunk as a whole frame works
 * on a fast local connection and corrupts answers on a slow one.
 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as AgentEvent;
      } catch {
        // A frame we cannot parse is a bug on the sending side; dropping it
        // loses one fragment, throwing loses the whole answer.
      }
    }
  }
}
