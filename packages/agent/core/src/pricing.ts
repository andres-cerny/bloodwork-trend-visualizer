/**
 * What a model call costs, in dollars — Claude, and the image path's Gemini
 * reader.
 *
 * Split out from the ledger deliberately: pricing is pure arithmetic over
 * numbers the API reports, while the ledger it feeds is KV I/O. Keeping them
 * in one file meant that anything wanting to price a call — the benchmark
 * harness and the live extraction tests both do — dragged `KVNamespace` into a
 * plain Node program, where that type does not exist.
 *
 * So this file must stay free of any runtime's globals. It is arithmetic.
 */

/** USD per million tokens (input, output) — mirrors MODEL_PRICING in src/config.py. */
export const MODEL_PRICING: Record<string, [number, number]> = {
  // Anthropic first-party list prices, checked 2026-10-19. Sonnet 5 was
  // carried here at $3/$15 (Sonnet 4.6's rate) since it shipped; it is $2/$10,
  // so every ledger and bench number priced through this table overstated
  // Sonnet by 50% (docs/plans/model-loop.md, round 1).
  "claude-sonnet-5": [2.0, 10.0],
  "claude-sonnet-5-5": [2.0, 10.0],
  "claude-opus-4-8": [5.0, 25.0],
  "claude-opus-5": [5.0, 25.0],
  "claude-opus-5-5": [4.0, 20.0],
  "claude-haiku-4-5": [1.0, 5.0],
  // Haiku 5.5 has two rate cards by prompt length: this one up to 100K input
  // tokens, $0.50/$2.50 beyond. No call here comes near 100K (a text page is
  // capped at 40,000 characters, a mapping batch at 30 names plus the
  // catalog), so the long card is not modelled.
  "claude-haiku-5-5": [0.1, 0.5],
  // The image path's second reader, paid tier. Not a Claude model, but the
  // extract ledger prices every call it makes through this table and the
  // fallback below is Sonnet's — four times Gemini's rate, which would freeze
  // the demo's budget early on numbers nobody spent.
  "gemini-3.8-flash": [0.75, 3.75],
};

/**
 * A price that is already announced but not yet in force.
 *
 * Gemini 3.8 Flash doubles on 2027-01-01 (docs/plans/lab-adaptability.md,
 * "Risks"). Writing that down as a comment means the ledger silently
 * under-counts by half from New Year until somebody remembers; writing it here
 * means it does not. `at` is a parameter rather than a read of the clock deep
 * inside, so a test can stand on either side of the date.
 */
const SCHEDULED_PRICING: Record<string, Array<{ from: string; price: [number, number] }>> = {
  "gemini-3.8-flash": [{ from: "2027-01-01", price: [1.5, 7.5] }],
};

/** The rate in force for `model` at `at`. */
export function pricingFor(model: string, at: Date = new Date()): [number, number] {
  // An unpriced id is charged at the dearest Sonnet-or-cheaper rate we know
  // of, so a forgotten entry over- rather than under-counts the ledger.
  let price = MODEL_PRICING[model] ?? [5.0, 25.0];
  for (const step of SCHEDULED_PRICING[model] ?? []) {
    if (at >= new Date(`${step.from}T00:00:00Z`)) price = step.price;
  }
  return price;
}

/**
 * Price one call.
 *
 * Cached input is billed differently from fresh input — a cache write costs
 * ~1.25x and a cache read ~0.1x — so counting every input token at full rate
 * would overstate spend and freeze the demo early. The multipliers apply to
 * the model's own input rate.
 */
export function priceUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
  at: Date = new Date(),
): number {
  const [inPrice, outPrice] = pricingFor(model, at);
  return (
    (inputTokens / 1e6) * inPrice +
    (cacheWriteTokens / 1e6) * inPrice * 1.25 +
    (cacheReadTokens / 1e6) * inPrice * 0.1 +
    (outputTokens / 1e6) * outPrice
  );
}
