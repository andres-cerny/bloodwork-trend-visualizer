/**
 * What a Claude call costs, in dollars.
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
};

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
): number {
  const [inPrice, outPrice] = MODEL_PRICING[model] ?? [3.0, 15.0];
  return (
    (inputTokens / 1e6) * inPrice +
    (cacheWriteTokens / 1e6) * inPrice * 1.25 +
    (cacheReadTokens / 1e6) * inPrice * 0.1 +
    (outputTokens / 1e6) * outPrice
  );
}
