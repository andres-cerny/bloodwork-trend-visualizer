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
  MODEL_ESCALATION,
  MODEL_GEMINI,
  MODEL_PRIMARY,
  type PageExtraction,
} from "@bw/extraction";

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
}

/* -------------------------------------------------------------- readers */

type ReaderId = "sonnet" | "haiku" | "gemini";

const READER_MODEL: Record<ReaderId, string> = {
  sonnet: MODEL_PRIMARY,
  haiku: MODEL_ESCALATION,
  gemini: MODEL_GEMINI,
};

/**
 * The three settings `PHOTO_READERS` may take, and nothing else.
 *
 * Measured over 133 photographed pages, 3,585 truth rows
 * (docs/lab-adaptability.md):
 *
 *   sonnet+gemini   3583 confirmed,   5 flagged, 0 uncaught, 0 value errors
 *   sonnet+haiku    3307 confirmed, 494 flagged, 0 uncaught, 40 value errors
 *
 * `gemini+sonnet` is the same pair with the primary reversed — it exists so
 * the question "does the order matter?" can be answered by a flip rather than
 * a deploy. `sonnet+haiku` is the retreat.
 *
 * The **text path is not listed here and never varies**: it stays Sonnet +
 * Haiku because on that path the characters come from the file rather than
 * from pixels, and it was measured at 852/877 with zero value errors. Nothing
 * in this change touches it.
 */
const PHOTO_PAIRS: Record<string, readonly [ReaderId, ReaderId]> = {
  "sonnet+gemini": ["sonnet", "gemini"],
  "gemini+sonnet": ["gemini", "sonnet"],
  "sonnet+haiku": ["sonnet", "haiku"],
};

/** Today's behaviour, and what an unset or unrecognised var falls back to. */
export const DEFAULT_PHOTO_READERS = "sonnet+haiku";

const TEXT_READERS: readonly [ReaderId, ReaderId] = ["sonnet", "haiku"];

/**
 * Which pair reads this page, and under which name.
 *
 * Falls back to `sonnet+haiku` for an unknown value *and* for a Gemini pair
 * with no `GEMINI_API_KEY`: a missing secret must degrade to the pair that
 * still works rather than to a single silent reader. The name is returned so
 * the response can say which pair actually ran — a var that quietly did
 * nothing is worse than one that failed.
 */
export function photoReaders(env: Env): { name: string; readers: readonly ReaderId[] } {
  const asked = env.PHOTO_READERS ?? DEFAULT_PHOTO_READERS;
  // `Object.hasOwn`, not a truthiness check on the lookup: `PHOTO_PAIRS`
  // inherits `constructor`, `__proto__`, `toString` and `valueOf` from
  // Object.prototype, and each of those returned something truthy — so the
  // retreat below was skipped and `pair.includes` threw, 500ing /api/status
  // and 500ing /api/extract *after* a page had been spent
  // (docs/security-review-gemini.md, finding 5). It never failed open; the
  // false part was this function's own promise to fall back.
  if (!Object.hasOwn(PHOTO_PAIRS, asked)) {
    return { name: DEFAULT_PHOTO_READERS, readers: PHOTO_PAIRS[DEFAULT_PHOTO_READERS] };
  }
  const pair = PHOTO_PAIRS[asked];
  if (pair.includes("gemini") && !env.GEMINI_API_KEY) {
    return { name: DEFAULT_PHOTO_READERS, readers: PHOTO_PAIRS[DEFAULT_PHOTO_READERS] };
  }
  return { name: asked, readers: pair };
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

  const { imageBase64, mediaType, imageFullBase64, imageFullMediaType, textLayer, rowsText } =
    (await request.json().catch(() => ({}))) as {
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
    };

  // Digital PDFs take the text path: the characters come from the file, so
  // the client can verify every returned value against the printed page.
  // Only scans fall back to sending an image.
  const useText = typeof rowsText === "string" && rowsText.trim().length > 0;
  if (!useText && !imageBase64) return json({ error: "missing_page" }, 400);

  const pair = useText
    ? { name: DEFAULT_PHOTO_READERS, readers: TEXT_READERS }
    : photoReaders(env);
  const readers = env.SINGLE_MODEL === "1" ? pair.readers.slice(0, 1) : pair.readers;

  const read = (id: ReaderId): Promise<PageExtraction> => {
    const model = READER_MODEL[id];
    if (useText) return extractPageText(env.ANTHROPIC_API_KEY, model, rowsText!);
    if (id === "gemini") {
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
    );
  };

  // Both reads run concurrently — they are each other's completeness check, so
  // a page is only as slow as the slower model rather than their sum.
  const results = await Promise.allSettled(readers.map(read));

  let spent = 0;
  const reads = [];
  for (const r of results) {
    if (r.status !== "fulfilled") {
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
    return json(
      {
        error: "extraction_failed",
        message: "Stránku se nepodařilo přečíst. Zkuste ji prosím nahrát znovu.",
      },
      502,
    );
  }

  return json({
    reads,
    mode: useText ? "text" : "vision",
    /**
     * How many readers were *asked*. The client hands it to `reconcile`, which
     * cannot otherwise tell a page that was cross-checked from one whose second
     * request failed — and a page nobody cross-checked must never come back
     * looking confirmed.
     */
    readersAttempted: readers.length,
    /** Which pair actually ran, not which one was configured. */
    readers: pair.name,
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
        photoReaders: photoReaders(env).name,
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
