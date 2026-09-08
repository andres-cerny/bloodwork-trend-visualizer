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
  "claude-sonnet-5": [3.0, 15.0],
  "claude-opus-4-8": [5.0, 25.0],
  "claude-haiku-4-5": [1.0, 5.0],
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
  let price = MODEL_PRICING[model] ?? [3.0, 15.0];
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
