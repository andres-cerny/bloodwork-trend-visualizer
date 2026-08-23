/**
 * Bloodwork demo Worker: static assets + the three AI routes.
 *
 * Every AI route is gated twice — a Turnstile-derived session token proves a
 * human started the session, and the spend ledger refuses once the global
 * budget is exhausted. The pre-baked demo is served as static assets and needs
 * neither, so a frozen budget degrades the site to a read-only demo rather
 * than breaking it.
 */
import {
  budgetState,
  consumePage,
  mintSession,
  recordSpendUsd,
  verifySession,
  verifyTurnstile,
  type SessionClaims,
} from "@bw/gate";
import {
  priceUsd,
  resolveProfile,
  runAgent,
  toSse,
  type ChatTurn,
} from "@bw/agent-core";
import { SessionSource } from "@bw/datasource";
import { extractPage, extractPageText, MODEL_ESCALATION, MODEL_PRIMARY } from "@bw/extraction";

export interface Env {
  ASSETS: Fetcher;
  BUDGET: KVNamespace;
  ANTHROPIC_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  SESSION_SECRET: string;
  BUDGET_USD_LIMIT?: string;
  MAX_PAGES_PER_SESSION?: string;
  SESSION_TTL_SECONDS?: string;
  /** Set to "1" to run a single model instead of the two-model cross-check. */
  SINGLE_MODEL?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const budgetLimit = (env: Env) => parseFloat(env.BUDGET_USD_LIMIT ?? "20") || 20;
const maxPages = (env: Env) => parseInt(env.MAX_PAGES_PER_SESSION ?? "12", 10) || 12;
const sessionTtl = (env: Env) => parseInt(env.SESSION_TTL_SECONDS ?? "1800", 10) || 1800;

/**
 * Shared preamble for the AI routes: session valid, budget not exhausted.
 * Returns the claims on success so a caller can enforce per-session limits.
 */
async function guard(
  request: Request,
  env: Env,
  cap: "agent" | "extract",
): Promise<{ blocked: Response } | { claims: SessionClaims }> {
  const token = request.headers.get("x-demo-session");
  const claims = await verifySession(env.SESSION_SECRET, token);
  if (!claims) {
    return {
      blocked: json(
        { error: "session_invalid", message: "Ověření vypršelo. Načtěte stránku znovu." },
        401,
      ),
    };
  }
  const state = await budgetState(env.BUDGET, cap, budgetLimit(env));
  if (state.frozen) {
    return {
      blocked: json(
        {
          error: "budget_exhausted",
          message: "Demo vyčerpalo svůj rozpočet na AI funkce. Ukázková data zůstávají dostupná.",
          budget: state,
        },
        402,
      ),
    };
  }
  return { claims };
}

async function handleSession(request: Request, env: Env): Promise<Response> {
  const { turnstileToken } = (await request.json().catch(() => ({}))) as {
    turnstileToken?: string;
  };
  if (!turnstileToken) return json({ error: "missing_token" }, 400);

  const ok = await verifyTurnstile(
    env.TURNSTILE_SECRET_KEY,
    turnstileToken,
    request.headers.get("cf-connecting-ip"),
  );
  if (!ok) return json({ error: "turnstile_failed", message: "Ověření se nezdařilo." }, 403);

  const session = await mintSession(env.SESSION_SECRET, sessionTtl(env), maxPages(env));
  return json({ session, maxPages: maxPages(env), ttlSeconds: sessionTtl(env) });
}

async function handleExtract(request: Request, env: Env): Promise<Response> {
  const g = await guard(request, env, "extract");
  if ("blocked" in g) return g.blocked;

  // Spend the session's page allowance. Minting a `pages` claim and never
  // reading it back means one Turnstile solve buys unlimited extraction for
  // the token's lifetime.
  const { ok, used } = await consumePage(
    env.BUDGET,
    g.claims.sid,
    g.claims.pages,
    sessionTtl(env),
  );
  if (!ok) {
    return json(
      {
        error: "page_limit",
        message:
          `Limit ukázky je ${g.claims.pages} stran na jedno ověření. ` +
          `Načtěte stránku znovu a projděte ověřením „Nejsem robot“.`,
      },
      429,
    );
  }

  const { imageBase64, mediaType, textLayer, rowsText } = (await request
    .json()
    .catch(() => ({}))) as {
    imageBase64?: string;
    mediaType?: string;
    textLayer?: string | null;
    rowsText?: string | null;
  };

  // Digital PDFs take the text path: the characters come from the file, so
  // the client can verify every returned value against the printed page.
  // Only scans fall back to sending an image.
  const useText = typeof rowsText === "string" && rowsText.trim().length > 0;
  if (!useText && !imageBase64) return json({ error: "missing_page" }, 400);

  const models = env.SINGLE_MODEL === "1" ? [MODEL_PRIMARY] : [MODEL_PRIMARY, MODEL_ESCALATION];

  // Both reads run concurrently — they are each other's completeness check, so
  // a page is only as slow as the slower model rather than their sum.
  const results = await Promise.allSettled(
    models.map((m) =>
      useText
        ? extractPageText(env.ANTHROPIC_API_KEY, m, rowsText!)
        : extractPage(env.ANTHROPIC_API_KEY, m, imageBase64!, mediaType || "image/jpeg", textLayer ?? null),
    ),
  );

  let spent = 0;
  const reads = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    spent += priceUsd(
      r.value.model,
      r.value.usage.inputTokens,
      r.value.usage.outputTokens,
      r.value.usage.cacheReadTokens,
      r.value.usage.cacheWriteTokens,
    );
    reads.push(r.value);
  }
  if (spent > 0) await recordSpendUsd(env.BUDGET, "extract", spent);

  if (reads.length === 0) {
    const why = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return json({ error: "extraction_failed", message: String(why?.reason ?? "unknown") }, 502);
  }

  return json({
    reads,
    mode: useText ? "text" : "vision",
    pagesUsed: used,
    costUsd: Math.round(spent * 10000) / 10000,
    // Zero across a whole report means the tools+system prefix is under the
    // ~1024-token cache minimum, not that something is broken.
    cacheReadTokens: reads.reduce((s, r) => s + r.usage.cacheReadTokens, 0),
    budget: await budgetState(env.BUDGET, "extract", budgetLimit(env)),
  });
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

    if (url.pathname === "/api/status") {
      return json({
        budget: await budgetState(env.BUDGET, "agent", budgetLimit(env)),
        extractBudget: await budgetState(env.BUDGET, "extract", budgetLimit(env)),
        maxPages: maxPages(env),
        crossCheck: env.SINGLE_MODEL !== "1",
      });
    }
    if (url.pathname === "/api/session" && request.method === "POST") {
      return handleSession(request, env);
    }
    if (url.pathname === "/api/extract" && request.method === "POST") {
      return handleExtract(request, env);
    }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);

    return env.ASSETS.fetch(request);
  },
};
