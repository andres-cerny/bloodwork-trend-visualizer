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

/**
 * Capability that spend is booked against.
 *
 * The ledger used to be one global counter, which meant a runaway agent or an
 * eval sweep could freeze extraction — two demos, one fuse. Keyed per
 * capability, each has its own ceiling and its own failure.
 */
export type Capability = "agent" | "extract";

const KEY = (cap: Capability, i: number) => `spend_usd_${cap}_shard_${i}`;

/**
 * The pre-split key, still read so an existing deployment's history is not
 * silently zeroed by a deploy. Nothing writes it any more.
 */
const LEGACY_KEY = (i: number) => `spend_usd_shard_${i}`;

/**
 * Pricing lives in ./pricing.ts, not here: it is pure arithmetic and this
 * file is KV I/O. Anything that only needs to price a call imports that
 * module directly, so it never pulls `KVNamespace` into a Node program.
 */

export async function totalSpentUsd(kv: KVNamespace, cap: Capability): Promise<number> {
  const parts = await Promise.all([
    ...Array.from({ length: SHARDS }, (_, i) => kv.get(KEY(cap, i))),
    ...Array.from({ length: SHARDS }, (_, i) => kv.get(LEGACY_KEY(i))),
  ]);
  return parts.reduce((sum, v) => sum + (v ? parseFloat(v) || 0 : 0), 0);
}

export async function recordSpendUsd(
  kv: KVNamespace,
  cap: Capability,
  usd: number,
): Promise<void> {
  if (!(usd > 0)) return;
  const i = Math.floor(Math.random() * SHARDS);
  const current = parseFloat((await kv.get(KEY(cap, i))) || "0") || 0;
  await kv.put(KEY(cap, i), String(current + usd));
}

export interface BudgetState {
  spentUsd: number;
  budgetUsd: number;
  frozen: boolean;
  remainingUsd: number;
}

export async function budgetState(
  kv: KVNamespace,
  cap: Capability,
  budgetUsd: number,
): Promise<BudgetState> {
  const spentUsd = await totalSpentUsd(kv, cap);
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
