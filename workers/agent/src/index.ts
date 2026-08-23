/**
 * The agent: chat, tools, streaming. The worker with a future.
 *
 * This is the one that will grow bindings — a doctor's database, a vector
 * index, a conversation store. Keeping it apart from extraction is what stops
 * that reach being handed to a path that only ever needed an API key.
 */
import { budgetState, recordSpendUsd, type Capability } from "@bw/gate";
import { guard, json, budgetLimit, type BaseEnv } from "@bw/gate/http";
import { priceUsd, resolveProfile, runAgent, toSse, type ChatTurn } from "@bw/agent-core";
import { D1DocumentStore, DatabaseSource, PatientDirectory, type D1Like } from "@bw/datasource";
import type { ToolContext } from "@bw/agent-tools";

export interface Env extends BaseEnv {
  DB_SPORT: D1Database;
  DB_ORTO: D1Database;
}

/**
 * The tenant allowlist. A slug the map does not hold is refused with the same
 * posture as an unknown profile — a default here would quietly serve one
 * practice's assistant against another practice's database.
 */
const TENANTS: Record<string, { binding: "DB_SPORT" | "DB_ORTO"; label: string }> = {
  sport: { binding: "DB_SPORT", label: "Sportovní medicína" },
  orto: { binding: "DB_ORTO", label: "Ortopedie a fyzioterapie" },
};

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
  const { profile: profileName, history, context, tenant, patientRef } = (await request
    .json()
    .catch(() => ({}))) as {
    profile?: string;
    history?: ChatTurn[];
    context?: string;
    tenant?: string;
    patientRef?: string;
  };

  const profile = resolveProfile(profileName);
  if (!profile) return json({ error: "unknown_profile", message: "Neznámý profil." }, 400);
  if (!Array.isArray(history) || history.length === 0) {
    return json({ error: "missing_history" }, 400);
  }

  // Spend books to the ledger of who is spending: the bloodwork chat to the
  // shared agent ledger, each practice's assistant to its own. A doctor
  // exploring one demo must not be able to freeze the other — that ledger
  // merge bug has been fixed once already, one level down.
  const capability: Capability =
    profile.tools.length > 0 && String(tenant) in TENANTS
      ? (`clinical-${tenant}` as Capability)
      : "agent";
  const g = await guard(request, env, capability);
  if ("blocked" in g) return g.blocked;

  // A profile with tools reads a practice's database, and which practice is
  // part of the request's identity: unknown tenant refused, never defaulted.
  // The patientRef is only ever one the server handed out — it is validated
  // against this tenant's directory, so a ref from the other practice is
  // indistinguishable from a ref that never existed.
  let data: ToolContext | undefined;
  if (profile.tools.length > 0) {
    const t = TENANTS[String(tenant ?? "")];
    if (!t) return json({ error: "unknown_tenant", message: "Neznámá ordinace." }, 400);
    const db = env[t.binding] as unknown as D1Like;
    const directory = new PatientDirectory(db);
    if (patientRef !== undefined) {
      const patient = await directory.getPatient(String(patientRef));
      if (!patient) return json({ error: "unknown_patient", message: "Neznámý pacient." }, 400);
      data = {
        source: new DatabaseSource(db, patient.id),
        directory,
        documents: new D1DocumentStore(db, patient.id),
      };
    } else {
      // Unpinned: find_patient can still run, and on a unique match it binds
      // the rest of the turn through this closure — the ref came from the
      // directory, so the guarantee holds that no source opens un-validated.
      const ctx: ToolContext = { source: null, directory };
      ctx.bind = (ref: string) => {
        ctx.source = new DatabaseSource(db, ref);
        ctx.documents = new D1DocumentStore(db, ref);
      };
      data = ctx;
    }
  }

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
          data,
        })) {
          if (event.type === "done") {
            const spent = priceUsd(
              event.model,
              event.usage.inputTokens,
              event.usage.outputTokens,
              event.usage.cacheReadTokens,
              event.usage.cacheWriteTokens,
            );
            await recordSpendUsd(env.BUDGET, capability, spent);
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

    if (url.pathname === "/api/agent/status" || url.pathname === "/api/status") {
      const tenant = url.searchParams.get("tenant");
      const cap: Capability =
        tenant && tenant in TENANTS ? (`clinical-${tenant}` as Capability) : "agent";
      return json({ budget: await budgetState(env.BUDGET, cap, budgetLimit(env, cap)) });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    return json({ error: "not_found" }, 404);
  },
};
