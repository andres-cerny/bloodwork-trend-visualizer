/**
 * Extraction: a PDF page in, structured rows out.
 *
 * Deliberately the boring worker. It is finished, its prompts are stable, and
 * it binds to exactly one secret. The reason it is separate from the agent is
 * that the agent is about to grow a database binding, and there is no version
 * of this that should inherit that reach.
 */
import {
  budgetState,
  consumePage,
  mintSession,
  recordSpendUsd,
  TURNSTILE_ACTION,
  verifyTurnstile,
} from "@bw/gate";
import { guard, json, budgetLimit, maxPages, sessionTtl, type BaseEnv } from "@bw/gate/http";
import { priceUsd } from "@bw/agent-core";
import { extractPage, extractPageText, MODEL_ESCALATION, MODEL_PRIMARY } from "@bw/extraction";

export interface Env extends BaseEnv {
  /** Set to "1" to run a single model instead of the two-model cross-check. */
  SINGLE_MODEL?: string;
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
    {
      hostnames: (env.TURNSTILE_HOSTNAMES ?? "").split(","),
      action: TURNSTILE_ACTION,
    },
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


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return json({
        budget: await budgetState(env.BUDGET, "extract", budgetLimit(env)),
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
    return json({ error: "not_found" }, 404);
  },
};
