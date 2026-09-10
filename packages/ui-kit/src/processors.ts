/**
 * Who processes a page — said by the deployment, not from memory.
 *
 * Both apps' privacy copy used to name its processors as literal text. That
 * made the promise falsifiable by configuration: `workers/portal-extract` is
 * config over the extractor's code, so a `GEMINI_API_KEY` secret and a
 * `PHOTO_READERS` var would send redacted page images of real family data to
 * Google while the page still named Anthropic alone, with nothing failing and
 * nothing warning (docs/security-review-gemini.md, finding 1).
 *
 * `/api/status` reports the pair that actually runs, so the sentence is
 * rendered from it. A notice driven by the deployment cannot be falsified by a
 * config flip.
 *
 * **Not knowing says more, never less.** While the status request is in
 * flight, or when it fails, these answer with the broader set. Naming a
 * processor that turns out to be idle is an over-disclosure and ages safely;
 * the other direction is a false statement to a patient about where their
 * medical record went, and there is no small version of that.
 */

/**
 * The pairs that stay inside Anthropic. An allowlist rather than a search for
 * "gemini", so the failing direction is the safe one: a pair added later, or a
 * value nobody here recognises, discloses more rather than less.
 */
const ANTHROPIC_ONLY: ReadonlySet<string> = new Set(["sonnet+haiku"]);

/** Whether page images may reach Google under the pair this deployment runs. */
export function sendsToGoogle(photoReaders: string | null | undefined): boolean {
  return typeof photoReaders !== "string" || !ANTHROPIC_ONLY.has(photoReaders);
}

/**
 * The processor clause, preposition included — the one part of the privacy
 * copy that varies with the deployment, so it varies in exactly one place.
 */
export function processorPhrase(photoReaders: string | null | undefined): string {
  return sendsToGoogle(photoReaders)
    ? "na Anthropic API, u fotografií také na Google Gemini API"
    : "na Anthropic API";
}

/**
 * What the providers actually commit to.
 *
 * This read „data neukládají ani na nich netrénují" — they neither store nor
 * train. Only the second half is a published commitment: both vendors say paid
 * traffic is not trained on, and both retain inputs briefly for abuse
 * monitoring. The weaker sentence is the true one, and it is a factual claim
 * to a patient about their medical records, so it says only what is true.
 */
export const RETENTION_NOTE =
  "Na datech se netrénuje; u zpracovatele se uchovávají jen krátkodobě kvůli kontrole zneužití.";
