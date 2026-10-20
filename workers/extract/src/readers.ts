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
import { MODEL_ESCALATION, MODEL_GEMINI, MODEL_MAP, MODEL_PRIMARY, resolveReaderModel } from "@bw/extraction";
import { LabCodes, type LabCodeTable } from "@bw/lab-core";

export type ReaderId = "sonnet" | "haiku" | "gemini";

export const READER_MODEL: Record<ReaderId, string> = {
  sonnet: MODEL_PRIMARY,
  haiku: MODEL_ESCALATION,
  gemini: MODEL_GEMINI,
};

/**
 * The model ids the vars may override. The reader *ids* keep their historical
 * names ("sonnet" is the primary slot, "haiku" the second Claude slot) so
 * `PHOTO_READERS` values and logs keep meaning what they meant; the model in
 * each slot is a var. An id outside `READER_MODELS` falls back to the default,
 * so a typo cannot route pages to an unpriced or unchecked model.
 */
export type ModelEnv = {
  MODEL_PRIMARY?: string;
  MODEL_SECOND?: string;
  MODEL_MAP?: string;
};

export function readerModel(env: ModelEnv, id: ReaderId): string {
  if (id === "sonnet") return resolveReaderModel(env.MODEL_PRIMARY, MODEL_PRIMARY);
  if (id === "haiku") return resolveReaderModel(env.MODEL_SECOND, MODEL_ESCALATION);
  return READER_MODEL[id];
}

/** The mapping fallback's model; same allowlist. */
export function mapModel(env: ModelEnv): string {
  return resolveReaderModel(env.MODEL_MAP, MODEL_MAP);
}

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

/**
 * `MAP_MODE`: "codes" — `/api/map` first looks each name up in the lab-code
 * table (a hit linked to one catalog entry needs no model), sends only the
 * rest to today's whole-catalog call, and attaches the NČLP code to every
 * answer it can; "codes-shortlist" — the model picks from 20 table rows per
 * name instead (measured weaker, round 5). Unset or anything else: today.
 * docs/plans/model-loop.md.
 */
export type MapModeEnv = { MAP_MODE?: string };
export const mapByCodesOn = (env: MapModeEnv): boolean => env.MAP_MODE === "codes" || env.MAP_MODE === "codes-shortlist";
export const mapCodeStep = (env: MapModeEnv): "catalog" | "shortlist" => (env.MAP_MODE === "codes-shortlist" ? "shortlist" : "catalog");

let labCodes: Promise<LabCodes> | null = null;
/**
 * The compact, pre-normalised NČLP index (docs/plans/lab-codes.md,
 * "Runtime"), bundled (~180 KiB gzip) but parsed only on the first mapping
 * call that asks for it — an isolate with MAP_MODE unset never pays for it.
 */
export function codeTable(): Promise<LabCodes> {
  return (labCodes ??= import("@bw/lab-core/codes/lab-codes.index.json").then((m) => new LabCodes((m.default ?? m) as unknown as LabCodeTable)));
}

