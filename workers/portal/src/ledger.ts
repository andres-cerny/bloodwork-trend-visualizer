/**
 * Per-person monthly spend, so one family member's decade of reports cannot
 * freeze another's upload.
 *
 * Same construction as @bw/gate's ledger — a counter sharded across KV keys,
 * because KV throttles writes per key and a report's pages land at once —
 * but keyed by user and calendar month rather than by capability. The
 * capability-level ceiling still exists underneath: moje-krev-extract keeps
 * its own ledger, and a request that clears this one can still be refused
 * there. Two fuses, and this is the finer one.
 */

const SHARDS = 8;

export const monthOf = (d = new Date()): string => d.toISOString().slice(0, 7);

const KEY = (uid: string, month: string, i: number) => `user_spend_${uid}_${month}_shard_${i}`;

export async function userSpentUsd(kv: KVNamespace, uid: string, month: string): Promise<number> {
  const parts = await Promise.all(Array.from({ length: SHARDS }, (_, i) => kv.get(KEY(uid, month, i))));
  return parts.reduce((sum, v) => sum + (v ? parseFloat(v) || 0 : 0), 0);
}

export async function recordUserSpendUsd(kv: KVNamespace, uid: string, month: string, usd: number): Promise<void> {
  if (!(usd > 0)) return;
  const i = Math.floor(Math.random() * SHARDS);
  const current = parseFloat((await kv.get(KEY(uid, month, i))) || "0") || 0;
  // Ninety days: long enough to outlive the month it counts, short enough
  // that a departed user's ledger does not sit in KV forever.
  await kv.put(KEY(uid, month, i), String(current + usd), { expirationTtl: 90 * 86400 });
}

export interface UserBudget {
  spentUsd: number;
  budgetUsd: number;
  frozen: boolean;
  remainingUsd: number;
  /** The month this ledger counts, YYYY-MM. */
  month: string;
}

export async function userBudget(kv: KVNamespace, uid: string, budgetUsd: number, month = monthOf()): Promise<UserBudget> {
  const spentUsd = await userSpentUsd(kv, uid, month);
  return {
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    budgetUsd,
    frozen: spentUsd >= budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - spentUsd),
    month,
  };
}
