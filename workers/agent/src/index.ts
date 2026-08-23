/**
 * The agent: chat, tools, streaming. The worker with a future.
 *
 * This is the one that will grow bindings — a doctor's database, a vector
 * index, a conversation store. Keeping it apart from extraction is what stops
 * that reach being handed to a path that only ever needed an API key.
 */
import { budgetState, recordSpendUsd } from "@bw/gate";
import { guard, json, budgetLimit, type BaseEnv } from "@bw/gate/http";
import { priceUsd, resolveProfile, runAgent, toSse, type ChatTurn } from "@bw/agent-core";
import { SessionSource } from "@bw/datasource";

export interface Env extends BaseEnv {}

/**
 * One agent turn, streamed.
 *
 * SSE rather than JSON because a tool-using agent spends most of a turn not
 * talking, and a UI that shows nothing until the whole answer exists reads as
 * broken. The apps name a profile; they never send a prompt, and an unknown
 * name is refused rather than defaulted — quietly serving the clinical agent to
 * a bad request is worse than refusing it.
 *
 * Cost is recorded on the terminal event, where the accumulated usage across
 * every tool round-trip is final. Pricing anything earlier under-reports a
 * multi-round turn, and the ledger is the only thing bounding this demo.
 */
async function handleChat(request: Request, env: Env): Promise<Response> {
  const g = await guard(request, env, "agent");
  if ("blocked" in g) return g.blocked;

  const { profile: profileName, history, context, reports } = (await request
    .json()
    .catch(() => ({}))) as {
    profile?: string;
    history?: ChatTurn[];
    context?: string;
    reports?: unknown[];
  };

  const profile = resolveProfile(profileName);
  if (!profile) return json({ error: "unknown_profile", message: "Neznámý profil." }, 400);
  if (!Array.isArray(history) || history.length === 0) {
    return json({ error: "missing_history" }, 400);
  }

  // A profile with tools needs somewhere to look. Today that is whatever the
  // reader loaded in their own browser, handed over with the question — the
  // same privacy model the demo has always had.
  const source =
    profile.tools.length > 0
      ? new SessionSource(Array.isArray(reports) ? (reports as never[]) : [])
      : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: Parameters<typeof toSse>[0]) => controller.enqueue(enc.encode(toSse(e)));
      try {
        for await (const event of runAgent({
          apiKey: env.ANTHROPIC_API_KEY,
          profile,
          history,
          context: (context ?? "").slice(0, 60000),
          source,
        })) {
          if (event.type === "done") {
            const spent = priceUsd(
              event.model,
              event.usage.inputTokens,
              event.usage.outputTokens,
              event.usage.cacheReadTokens,
              event.usage.cacheWriteTokens,
            );
            await recordSpendUsd(env.BUDGET, "agent", spent);
          }
          send(event);
        }
      } catch (e) {
        send({ type: "error", message: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/agent/status") {
      return json({ budget: await budgetState(env.BUDGET, "agent", budgetLimit(env)) });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    return json({ error: "not_found" }, 404);
  },
};
