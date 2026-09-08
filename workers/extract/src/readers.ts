/**
 * Which two models read a page, and under which name.
 *
 * A separate module for a reason that is not tidiness: workerd reads every
 * named export of the module named by `main` as a service or a handler, so
 * `export const DEFAULT_PHOTO_READERS` sitting in index.ts made `wrangler dev`
 * refuse to start ("Incorrect type for map entry ... not of type 'function or
 * ExportedHandler'"). Deploy accepted it and production served it, so the cost
 * landed entirely on local development. index.ts exports its handler and
 * nothing else; helpers live here. `tests/guards/entry-exports.test.ts` keeps
 * it that way.
 */
import { MODEL_ESCALATION, MODEL_GEMINI, MODEL_PRIMARY } from "@bw/extraction";

export type ReaderId = "sonnet" | "haiku" | "gemini";

export const READER_MODEL: Record<ReaderId, string> = {
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

export const TEXT_READERS: readonly [ReaderId, ReaderId] = ["sonnet", "haiku"];

/**
 * The two vars this choice reads. Narrower than the Worker's `Env` on purpose:
 * the pair depends on configuration and a key, not on a KV binding or a
 * session secret, and `Env` satisfies this structurally.
 */
export type ReaderEnv = {
  PHOTO_READERS?: string;
  GEMINI_API_KEY?: string;
};

/**
 * Which pair reads this page, and under which name.
 *
 * Falls back to `sonnet+haiku` for an unknown value *and* for a Gemini pair
 * with no `GEMINI_API_KEY`: a missing secret must degrade to the pair that
 * still works rather than to a single silent reader. The name is returned so
 * the response can say which pair actually ran — a var that quietly did
 * nothing is worse than one that failed.
 */
export function photoReaders(env: ReaderEnv): { name: string; readers: readonly ReaderId[] } {
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
