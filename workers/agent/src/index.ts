/**
 * The agent: chat, tools, streaming. The worker with a future.
 *
 * This is the one that will grow bindings — a doctor's database, a vector
 * index, a conversation store. Keeping it apart from extraction is what stops
 * that reach being handed to a path that only ever needed an API key.
 */
import { budgetState, recordSpendUsd, type Capability } from "@bw/gate";
import { guard, json, budgetLimit, maxPages, sessionTtl, type BaseEnv } from "@bw/gate/http";
import { mintSession, verifyTurnstile, TURNSTILE_ACTION } from "@bw/gate";
import { priceUsd, resolveProfile, runAgent, toSse, type ChatTurn } from "@bw/agent-core";
import { D1DocumentStore, DatabaseSource, PatientDirectory, type D1Like } from "@bw/datasource";
import type { ToolContext } from "@bw/agent-tools";

export interface Env extends BaseEnv {
  DB_SPORT: D1Database;
  DB_ORTO: D1Database;
  EVIDENCE: R2Bucket;
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
 * Mint a session from one Turnstile pass — the same door extract has.
 *
 * It exists here too because the chat shell binds only this worker: without
 * it, the chat app's gate could collect a perfectly good token and have
 * nowhere to trade it for a session. The claims carry a page allowance the
 * agent never spends; consumePage stays extract-only, and a test pins that.
 */
async function handleSession(request: Request, env: Env): Promise<Response> {
  const { turnstileToken } = (await request.json().catch(() => ({}))) as {
    turnstileToken?: string;
  };
  if (!turnstileToken) return json({ error: "missing_token" }, 400);

  const ok = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    turnstileToken,
    request.headers.get("cf-connecting-ip"),
    {
      hostnames: (env.TURNSTILE_HOSTNAMES ?? "").split(","),
      action: TURNSTILE_ACTION,
    },
  );
  if (!ok) return json({ error: "turnstile_failed", message: "Ověření se nezdařilo." }, 403);

  const session = await mintSession(env.SESSION_SECRET, sessionTtl(env), maxPages(env));
  return json({ session, maxPages: maxPages(env), ttlSeconds: sessionTtl(env) });
}

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
  // For tool profiles the context is the server's, never the client's: it
  // states which patient is pinned, so the model does not ask for a patient
  // it already has — and a client cannot inject instructions through it.
  let serverContext = "";
  if (profile.tools.length > 0) {
    const t = TENANTS[String(tenant ?? "")];
    if (!t) return json({ error: "unknown_tenant", message: "Neznámá ordinace." }, 400);
    const db = env[t.binding] as unknown as D1Like;
    const directory = new PatientDirectory(db);
    // Both branches carry bind: on a unique find_patient match the rest of
    // the turn re-scopes to that patient. The pinned branch NEEDS it too —
    // asking about a second patient while one is pinned used to update the
    // chip (the patient event) while the tools kept reading the first one,
    // which is cross-patient mislabeling, the worst failure this app has.
    const ctx: ToolContext = { source: null, directory };
    ctx.bind = (ref: string) => {
      ctx.source = new DatabaseSource(db, ref);
      ctx.documents = new D1DocumentStore(db, ref);
    };
    if (patientRef !== undefined) {
      const patient = await directory.getPatient(String(patientRef));
      if (!patient) return json({ error: "unknown_patient", message: "Neznámý pacient." }, 400);
      ctx.bind(patient.id);
      serverContext = `Vybraný pacient: ${patient.fullName}, nar. ${patient.birthDate}. Nástroje jsou na něj napojené; ptá-li se lékař na jiného pacienta, vyhledej ho nástrojem find_patient.`;
    }
    data = ctx;
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
          context: profile.tools.length > 0 ? serverContext : (context ?? "").slice(0, 60000),
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
    // Real-patient page images, keyed by content hash. Unguessable rather
    // than session-guarded, because an <img> tag cannot send the session
    // header — and the record's owner chose this demo knowingly. Synthetic
    // evidence never comes through here; it ships as static assets.
    if (url.pathname.startsWith("/api/evidence/") && request.method === "GET") {
      const key = url.pathname.slice("/api/evidence/".length);
      if (!/^[a-z0-9-]{16,}\.png$/.test(key)) return json({ error: "not_found" }, 404);
      const obj = await env.EVIDENCE.get(key);
      if (!obj) return json({ error: "not_found" }, 404);
      return new Response(obj.body, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
        },
      });
    }
    if (url.pathname === "/api/session" && request.method === "POST") {
      return handleSession(request, env);
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    return json({ error: "not_found" }, 404);
  },
};
