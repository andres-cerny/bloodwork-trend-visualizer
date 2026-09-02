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
import { extractPage, extractPageText, MODEL_ESCALATION, MODEL_PRIMARY, type OnRow, type PageExtraction } from "@bw/extraction";

export interface Env extends BaseEnv {
  /** Set to "1" to run a single model instead of the two-model cross-check. */
  SINGLE_MODEL?: string;
  /**
   * "cheap": the text path is read once, by the cheaper reader. Measured on
   * the real corpus (docs/extraction-speed.md, 2026-09-02): on born-digital
   * pages a single Haiku read fabricates nothing and the client's printed-text
   * and candidate-row checks catch what a second reader used to. Scans keep
   * both readers — there is no text layer to check against.
   */
  TEXT_READERS?: string;
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

  const { imageBase64, mediaType, textLayer, rowsText, stream } = (await request
    .json()
    .catch(() => ({}))) as {
    imageBase64?: string;
    mediaType?: string;
    textLayer?: string | null;
    rowsText?: string | null;
    /** Ask for rows as they are written (NDJSON) instead of one JSON at the end. */
    stream?: boolean;
  };

  // Digital PDFs take the text path: the characters come from the file, so
  // the client can verify every returned value against the printed page.
  // Only scans fall back to sending an image.
  const useText = typeof rowsText === "string" && rowsText.trim().length > 0;
  if (!useText && !imageBase64) return json({ error: "missing_page" }, 400);

  const models =
    useText && env.TEXT_READERS === "cheap"
      ? [MODEL_ESCALATION]
      : env.SINGLE_MODEL === "1"
        ? [MODEL_PRIMARY]
        : [MODEL_PRIMARY, MODEL_ESCALATION];

  // Both reads run concurrently — they are each other's completeness check, so
  // a page is only as slow as the slower model rather than their sum.
  const read = (m: string, onRow?: OnRow) =>
    useText
      ? extractPageText(env.ANTHROPIC_API_KEY, m, rowsText!, onRow)
      : extractPage(env.ANTHROPIC_API_KEY, m, imageBase64!, mediaType || "image/jpeg", textLayer ?? null, onRow);

  if (stream !== true) {
    const results = await Promise.allSettled(models.map((m) => read(m)));
    const { status, body } = await settle(results, env, used, useText);
    return json(body, status);
  }

  // Streamed: one JSON object per line. Rows as each model writes them, then
  // a final "done" line that is exactly the buffered answer — so a client
  // may ignore every line but the last and be no worse off than before.
  // The HTTP status is already 200 once the first row is out, so a failure
  // after that is an "error" line rather than a status.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const line = (o: unknown) => writer.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
  void (async () => {
    try {
      const results = await Promise.allSettled(
        models.map((m) => read(m, (row) => void line({ type: "row", model: m, row }))),
      );
      const { status, body } = await settle(results, env, used, useText);
      await line(status === 200 ? { type: "done", ...body } : { type: "error", ...body });
    } catch (e) {
      await line({ type: "error", error: "extraction_failed", message: String(e) });
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  return new Response(readable, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Price the reads that landed, book them, and shape the answer. */
async function settle(
  results: PromiseSettledResult<PageExtraction>[],
  env: Env,
  used: number,
  useText: boolean,
): Promise<{ status: number; body: Record<string, unknown> }> {
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
    return { status: 502, body: { error: "extraction_failed", message: String(why?.reason ?? "unknown") } };
  }

  return {
    status: 200,
    body: {
      reads,
      mode: useText ? "text" : "vision",
      pagesUsed: used,
      costUsd: Math.round(spent * 10000) / 10000,
      // Zero across a whole report means the tools+system prefix is under the
      // ~1024-token cache minimum, not that something is broken.
      cacheReadTokens: reads.reduce((s, r) => s + r.usage.cacheReadTokens, 0),
      budget: await budgetState(env.BUDGET, "extract", budgetLimit(env)),
    },
  };
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
