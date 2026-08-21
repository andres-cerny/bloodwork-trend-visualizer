/**
 * Global spend ledger with a hard freeze.
 *
 * Every Claude call this Worker makes is priced from the token usage the API
 * reports and added to a running total. Once the total reaches the configured
 * ceiling, AI features stop — extraction and chat both refuse. The pre-baked
 * demo keeps working, because it costs nothing to serve.
 *
 * The counter is sharded across several KV keys on purpose: KV throttles
 * writes to roughly one per second *per key*, and extracting a report fires
 * several page requests at once. Sharding spreads those writes so a burst
 * doesn't silently drop spend from the ledger.
 */

const SHARDS = 8;
const KEY = (i: number) => `spend_usd_shard_${i}`;

/** USD per million tokens (input, output) — mirrors MODEL_PRICING in src/config.py. */
export const MODEL_PRICING: Record<string, [number, number]> = {
  "claude-sonnet-5": [3.0, 15.0],
  "claude-opus-4-8": [5.0, 25.0],
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

export async function totalSpentUsd(kv: KVNamespace): Promise<number> {
  const parts = await Promise.all(
    Array.from({ length: SHARDS }, (_, i) => kv.get(KEY(i))),
  );
  return parts.reduce((sum, v) => sum + (v ? parseFloat(v) || 0 : 0), 0);
}

export async function recordSpendUsd(kv: KVNamespace, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  const i = Math.floor(Math.random() * SHARDS);
  const current = parseFloat((await kv.get(KEY(i))) || "0") || 0;
  await kv.put(KEY(i), String(current + usd));
}

export interface BudgetState {
  spentUsd: number;
  budgetUsd: number;
  frozen: boolean;
  remainingUsd: number;
}

export async function budgetState(kv: KVNamespace, budgetUsd: number): Promise<BudgetState> {
  const spentUsd = await totalSpentUsd(kv);
  return {
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    budgetUsd,
    frozen: spentUsd >= budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - spentUsd),
  };
}


/**
 * Pages already extracted under one session.
 *
 * The session token carries a `pages` allowance, but a claim nobody reads is
 * just a comment: without this counter one Turnstile solve buys unlimited
 * extraction calls for the token's lifetime. The spend ceiling still bounds
 * the loss, so this is about how fast a single visitor can consume it, not
 * about whether they can exceed it.
 *
 * Keyed per session, so ordinary sequential page extraction never contends.
 */
export async function consumePage(
  kv: KVNamespace,
  sid: string,
  allowance: number,
  ttlSeconds: number,
): Promise<{ ok: boolean; used: number }> {
  const key = `pages_${sid}`;
  const used = parseInt((await kv.get(key)) || "0", 10) || 0;
  if (used >= allowance) return { ok: false, used };
  // expirationTtl keeps these from accumulating; they are only meaningful for
  // as long as the session token itself is valid.
  await kv.put(key, String(used + 1), { expirationTtl: Math.max(60, ttlSeconds) });
  return { ok: true, used: used + 1 };
}
