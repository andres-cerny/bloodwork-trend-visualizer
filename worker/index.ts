/**
 * Bloodwork demo Worker: static assets + the three AI routes.
 *
 * Every AI route is gated twice — a Turnstile-derived session token proves a
 * human started the session, and the spend ledger refuses once the global
 * budget is exhausted. The pre-baked demo is served as static assets and needs
 * neither, so a frozen budget degrades the site to a read-only demo rather
 * than breaking it.
 */
import { mintSession, verifySession, verifyTurnstile } from "./auth";
import { budgetState, priceUsd, recordSpendUsd } from "./budget";
import { chat, extractPage, MODEL_ESCALATION, MODEL_PRIMARY, type ChatTurn } from "./claude";

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

/** Shared preamble for the AI routes: session valid, budget not exhausted. */
async function guard(request: Request, env: Env): Promise<Response | null> {
  const token = request.headers.get("x-demo-session");
  const claims = await verifySession(env.SESSION_SECRET, token);
  if (!claims) {
    return json({ error: "session_invalid", message: "Ověření vypršelo. Načtěte stránku znovu." }, 401);
  }
  const state = await budgetState(env.BUDGET, budgetLimit(env));
  if (state.frozen) {
    return json(
      {
        error: "budget_exhausted",
        message: "Demo vyčerpalo svůj rozpočet na AI funkce. Ukázková data zůstávají dostupná.",
        budget: state,
      },
      402,
    );
  }
  return null;
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
  const blocked = await guard(request, env);
  if (blocked) return blocked;

  const { imageBase64, mediaType, textLayer } = (await request.json().catch(() => ({}))) as {
    imageBase64?: string;
    mediaType?: string;
    textLayer?: string | null;
  };
  if (!imageBase64) return json({ error: "missing_image" }, 400);

  const models = env.SINGLE_MODEL === "1" ? [MODEL_PRIMARY] : [MODEL_PRIMARY, MODEL_ESCALATION];

  // Both reads run concurrently — they are each other's completeness check, so
  // a page is only as slow as the slower model rather than their sum.
  const results = await Promise.allSettled(
    models.map((m) =>
      extractPage(env.ANTHROPIC_API_KEY, m, imageBase64, mediaType || "image/jpeg", textLayer ?? null),
    ),
  );

  let spent = 0;
  const reads = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    spent += priceUsd(r.value.model, r.value.usage.inputTokens, r.value.usage.outputTokens);
    reads.push(r.value);
  }
  if (spent > 0) await recordSpendUsd(env.BUDGET, spent);

  if (reads.length === 0) {
    const why = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    return json({ error: "extraction_failed", message: String(why?.reason ?? "unknown") }, 502);
  }

  return json({
    reads,
    costUsd: Math.round(spent * 10000) / 10000,
    budget: await budgetState(env.BUDGET, budgetLimit(env)),
  });
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  const blocked = await guard(request, env);
  if (blocked) return blocked;

  const { dataContext, history } = (await request.json().catch(() => ({}))) as {
    dataContext?: string;
    history?: ChatTurn[];
  };
  if (!Array.isArray(history) || history.length === 0) return json({ error: "missing_history" }, 400);

  try {
    const res = await chat(env.ANTHROPIC_API_KEY, (dataContext ?? "").slice(0, 60000), history);
    const spent = priceUsd(res.model, res.usage.inputTokens, res.usage.outputTokens);
    await recordSpendUsd(env.BUDGET, spent);
    return json({
      text: res.text,
      costUsd: Math.round(spent * 10000) / 10000,
      budget: await budgetState(env.BUDGET, budgetLimit(env)),
    });
  } catch (e) {
    return json({ error: "chat_failed", message: String(e) }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return json({
        budget: await budgetState(env.BUDGET, budgetLimit(env)),
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
