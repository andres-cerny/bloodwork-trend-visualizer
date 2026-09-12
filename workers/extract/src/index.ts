/**
 * Extraction: a PDF page in, structured rows out.
 *
 * Deliberately the boring worker. Its prompts are stable and it holds two model
 * keys and nothing else. The reason it is separate from the agent is that the
 * agent has a database binding, and there is no version of this that should
 * inherit that reach.
 *
 * It was reopened once, deliberately, for the image path's second reader: on
 * 133 photographed pages the deployed Sonnet+Haiku pair made 40 value errors
 * and flagged 494 rows for a human, where Sonnet paired with Gemini 3.8 Flash
 * made none and flagged 5 (docs/lab-adaptability.md). The pair is chosen by
 * `PHOTO_READERS`, it applies to images only, and it defaults to what the app
 * already did — so this code deployed on its own changes nothing.
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
import {
  billedUsage,
  extractPage,
  extractPageGemini,
  extractPageText,
  MODEL_MAP,
  suggestCanonical,
  type CatalogEntry,
  type NameToMap,
  type OnRow,
  type PageExtraction,
} from "@bw/extraction";
// A sibling module, not this one: workerd reads every named export of the
// entry module as a service or handler, so a constant left here stops
// `wrangler dev` from starting. index.ts exports its handler and nothing else.
import {
  DEFAULT_PHOTO_READERS,
  photoReaders,
  READER_MODEL,
  TEXT_READERS,
  type ReaderId,
} from "./readers";

export interface Env extends BaseEnv {
  /** Set to "1" to run a single model instead of the two-model cross-check. */
  SINGLE_MODEL?: string;
  /**
   * Google's key, for the image path's second reader. Extract only — the agent
   * never sees it, the same way it never sees a database binding.
   */
  GEMINI_API_KEY?: string;
  /**
   * Which two readers transcribe a page **image**. One of `PHOTO_PAIRS`.
   *
   * Unset means `sonnet+haiku`, which is what the app does today, so deploying
   * this code changes nothing until the var is set. That asymmetry is
   * deliberate: a config flip is reversible in a minute, a code change is not.
   */
  PHOTO_READERS?: string;
  /**
   * "cheap": the text path is read once, by the cheaper reader. Measured on
   * the real corpus (docs/extraction-speed.md, 2026-09-02): on born-digital
   * pages a single Haiku read fabricates nothing and the client's printed-text
   * and candidate-row checks catch what a second reader used to. Scans keep
   * both readers — there is no text layer to check against.
   *
   * Unset means both readers, which is what Moje krev deploys: the switch is
   * kept for the day cost matters more than the second opinion. Whatever it
   * says, `readersAttempted` reports how many were actually asked, so a
   * single-read page never comes back looking cross-checked.
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

  const {
    imageBase64,
    mediaType,
    imageFullBase64,
    imageFullMediaType,
    textLayer,
    rowsText,
    stream,
  } = (await request.json().catch(() => ({}))) as {
    imageBase64?: string;
    mediaType?: string;
    /**
     * The same photograph, larger — the photo path sends two encodes of one
     * shot because the readers see different amounts of it. Sonnet's tier
     * caps at a 2576 px long edge; Gemini spends a fixed token budget per
     * image part whatever the pixels are, so a bigger picture costs it
     * nothing. A PDF page sends only `imageBase64` and every reader gets
     * that, which is why the PDF path is untouched by this.
     */
    imageFullBase64?: string;
    imageFullMediaType?: string;
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

  // The text path never varies its pair (see ./readers); only an image asks
  // which two readers are configured.
  const pair = useText
    ? { name: DEFAULT_PHOTO_READERS, readers: TEXT_READERS }
    : photoReaders(env);
  // Two ways to ask for one reader, and they are not the same question.
  // `TEXT_READERS=cheap` drops the *first* reader on the text path, leaving
  // the cheaper one; `SINGLE_MODEL=1` keeps the primary everywhere. Either
  // way `readers.length` is what `readersAttempted` reports.
  const readers =
    useText && env.TEXT_READERS === "cheap"
      ? pair.readers.slice(1, 2)
      : env.SINGLE_MODEL === "1"
        ? pair.readers.slice(0, 1)
        : pair.readers;

  const read = (id: ReaderId, onRow?: OnRow): Promise<PageExtraction> => {
    const model = READER_MODEL[id];
    if (useText) return extractPageText(env.ANTHROPIC_API_KEY, model, rowsText!, onRow);
    if (id === "gemini") {
      // Google's reader does not stream its rows; the page still streams,
      // it just carries the Anthropic reader's rows alone until Gemini lands.
      return extractPageGemini(
        env.GEMINI_API_KEY!,
        model,
        imageFullBase64 ?? imageBase64!,
        (imageFullBase64 ? imageFullMediaType : mediaType) || "image/jpeg",
        textLayer ?? null,
      );
    }
    return extractPage(
      env.ANTHROPIC_API_KEY,
      model,
      imageBase64!,
      mediaType || "image/jpeg",
      textLayer ?? null,
      onRow,
    );
  };

  // Both reads run concurrently — they are each other's completeness check, so
  // a page is only as slow as the slower model rather than their sum.
  if (stream !== true) {
    const results = await Promise.allSettled(readers.map((id) => read(id)));
    const { status, body } = await settle(results, env, used, useText, readers, pair.name);
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
        readers.map((id) =>
          read(id, (row) => void line({ type: "row", model: READER_MODEL[id], row })),
        ),
      );
      const { status, body } = await settle(results, env, used, useText, readers, pair.name);
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

/**
 * Names the deterministic match left null, put to the mapping model with the
 * catalog beside them (packages/extraction/src/map.ts). Reopened for this on
 * purpose: the worker holds the model key, and a mapping call is a model
 * call with no more reach than a page read — no database, no value; names,
 * units and intervals only. One call spends one page of the session's
 * allowance and is priced and booked exactly like a read.
 */
const MAX_MAP_NAMES = 200;
const MAX_MAP_CATALOG = 600;
const clip = (v: unknown, n: number): string => (typeof v === "string" ? v.slice(0, n) : "");

async function handleMap(request: Request, env: Env): Promise<Response> {
  const g = await guard(request, env, "extract");
  if ("blocked" in g) return g.blocked;
  const { ok, used } = await consumePage(env.BUDGET, g.claims.sid, g.claims.pages, sessionTtl(env));
  if (!ok) return json({ error: "page_limit", message: "Limit ověření je vyčerpán. Načtěte stránku znovu." }, 429);

  const body = (await request.json().catch(() => ({}))) as { names?: unknown; catalog?: unknown };
  const names: NameToMap[] = (Array.isArray(body.names) ? body.names : [])
    .slice(0, MAX_MAP_NAMES)
    .map((n: Record<string, unknown>) => ({
      rawName: clip(n.rawName, 200),
      unit: clip(n.unit, 40),
      refRange: clip(n.refRange, 60),
      material: typeof n.material === "string" ? n.material.slice(0, 8) : null,
    }))
    .filter((n) => n.rawName.trim() !== "");
  const catalog: CatalogEntry[] = (Array.isArray(body.catalog) ? body.catalog : [])
    .slice(0, MAX_MAP_CATALOG)
    .map((c: Record<string, unknown>) => ({ id: clip(c.id, 64), name: clip(c.name, 120), unit: clip(c.unit, 40) }))
    .filter((c) => /^[a-z0-9_]+$/.test(c.id));
  if (names.length === 0 || catalog.length === 0) return json({ error: "missing_names" }, 400);

  try {
    const r = await suggestCanonical(env.ANTHROPIC_API_KEY, MODEL_MAP, names, catalog);
    const spent = priceUsd(r.model, r.usage.inputTokens, r.usage.outputTokens, r.usage.cacheReadTokens, r.usage.cacheWriteTokens);
    if (spent > 0) await recordSpendUsd(env.BUDGET, "extract", spent);
    return json({
      suggestions: r.suggestions,
      model: r.model,
      pagesUsed: used,
      costUsd: Math.round(spent * 10000) / 10000,
      budget: await budgetState(env.BUDGET, "extract", budgetLimit(env)),
    });
  } catch (e) {
    const billed = billedUsage(e);
    if (billed) {
      const spent = priceUsd(billed.model, billed.usage.inputTokens, billed.usage.outputTokens, billed.usage.cacheReadTokens, billed.usage.cacheWriteTokens);
      if (spent > 0) await recordSpendUsd(env.BUDGET, "extract", spent);
    }
    console.warn(`map rejected: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`.slice(0, 300));
    return json({ error: "map_failed", message: "Návrh přiřazení se nepodařilo získat. Zkuste to prosím znovu." }, 502);
  }
}

/** Price the reads that landed, book them, and shape the answer. */
async function settle(
  results: PromiseSettledResult<PageExtraction>[],
  env: Env,
  used: number,
  useText: boolean,
  readers: readonly ReaderId[],
  readersName: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const readersAttempted = readers.length;
  let spent = 0;
  const reads = [];
  for (const [i, r] of results.entries()) {
    if (r.status !== "fulfilled") {
      // Say which reader failed and why. Two uploads on 2026-09-12 came back
      // with 67 rows "nepotvrzeno" because a second read was rejected here in
      // silence, and the cause — rate limit, overload, a body that would not
      // parse — was unknowable afterwards. The provider's message is logged,
      // never returned (see the 502 below).
      console.warn(
        `reader ${readers[i] ?? i} rejected (${readersName}, ${useText ? "text" : "vision"}): ` +
          (r.reason instanceof Error ? `${r.reason.name}: ${r.reason.message}` : String(r.reason)).slice(0, 160),
      );
      // A call the provider billed whose body would not parse: the money is
      // gone whether or not the answer could be read, and only fulfilled reads
      // used to be priced (docs/security-review-gemini.md, finding 4).
      const billed = billedUsage(r.reason);
      if (billed) {
        spent += priceUsd(
          billed.model,
          billed.usage.inputTokens,
          billed.usage.outputTokens,
          billed.usage.cacheReadTokens,
          billed.usage.cacheWriteTokens,
        );
      }
      continue;
    }
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
    // The provider's own error text does not come back out. Google's is a
    // JSON.stringify of its error body, and a Gemini body that will not parse
    // yields a message V8 builds from the *input* — model output transcribed
    // from the patient's page. The portal logs whatever the extractor hands it
    // (docs/security-review-gemini.md, finding 6), so what is returned is a
    // stable code the client can act on and a sentence the reader can act on.
    // On the streamed path this is the "error" line, so it is the same
    // sentence whether or not the page was asked for as a stream.
    return {
      status: 502,
      body: {
        error: "extraction_failed",
        message: "Stránku se nepodařilo přečíst. Zkuste ji prosím nahrát znovu.",
      },
    };
  }

  return {
    status: 200,
    body: {
      reads,
      mode: useText ? "text" : "vision",
      /**
       * How many readers were *asked*. The client hands it to `reconcile`,
       * which cannot otherwise tell a page that was cross-checked from one
       * whose second request failed — and a page nobody cross-checked must
       * never come back looking confirmed.
       */
      readersAttempted,
      /** Which pair actually ran, not which one was configured. */
      readers: readersName,
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
        photoReaders: photoReaders(env).name,
      });
    }
    if (url.pathname === "/api/session" && request.method === "POST") {
      return handleSession(request, env);
    }
    if (url.pathname === "/api/extract" && request.method === "POST") {
      return handleExtract(request, env);
    }
    if (url.pathname === "/api/map" && request.method === "POST") {
      return handleMap(request, env);
    }
    return json({ error: "not_found" }, 404);
  },
};
