/** The ledger decides when AI features freeze, so its arithmetic is load-bearing. */
import { describe, expect, it } from "vitest";
import { budgetState, recordSpendUsd, totalSpentUsd } from "../src/budget";
import { priceUsd } from "@bw/agent-core";

/** Minimal in-memory stand-in for the KV binding. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

describe("pricing", () => {
  it("prices from the same table as src/config.py", () => {
    // 1M input + 1M output on Sonnet 5 = $3 + $15
    expect(priceUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBeCloseTo(18, 6);
    expect(priceUsd("claude-opus-4-8", 1_000_000, 1_000_000)).toBeCloseTo(30, 6);
  });

  it("falls back to Sonnet pricing for an unknown model rather than charging zero", () => {
    expect(priceUsd("something-new", 1_000_000, 0)).toBeCloseTo(3, 6);
  });

  it("bills a cache read at a tenth and a cache write at 1.25x", () => {
    // Counting cached input at the full rate would overstate spend and freeze
    // the demo earlier than the ceiling actually requires.
    expect(priceUsd("claude-sonnet-5", 0, 0, 1_000_000, 0)).toBeCloseTo(0.3, 6);
    expect(priceUsd("claude-sonnet-5", 0, 0, 0, 1_000_000)).toBeCloseTo(3.75, 6);
  });

  it("defaults cache tokens to zero so existing call sites are unaffected", () => {
    expect(priceUsd("claude-sonnet-5", 1_000_000, 1_000_000)).toBeCloseTo(18, 6);
  });
});

describe("ledger", () => {
  it("accumulates across shards", async () => {
    const kv = fakeKv();
    for (let i = 0; i < 40; i++) await recordSpendUsd(kv, "extract", 0.25);
    expect(await totalSpentUsd(kv, "extract")).toBeCloseTo(10, 6);
  });

  it("ignores non-positive amounts", async () => {
    const kv = fakeKv();
    await recordSpendUsd(kv, "extract", 0);
    await recordSpendUsd(kv, "extract", -5);
    expect(await totalSpentUsd(kv, "extract")).toBe(0);
  });

  it("freezes once spend reaches the ceiling, not before", async () => {
    const kv = fakeKv();
    await recordSpendUsd(kv, "extract", 19.99);
    expect((await budgetState(kv, "extract", 20)).frozen).toBe(false);
    await recordSpendUsd(kv, "extract", 0.01);
    const state = await budgetState(kv, "extract", 20);
    expect(state.frozen).toBe(true);
    expect(state.remainingUsd).toBe(0);
  });
});

describe("the ledger is per capability", () => {
  it("does not let one capability's spend freeze the other", async () => {
    const kv = fakeKv();
    await recordSpendUsd(kv, "agent", 50);
    expect(await totalSpentUsd(kv, "agent")).toBeCloseTo(50);
    // The whole point of the split: an agent that burns its ceiling must not
    // take extraction down with it.
    expect(await totalSpentUsd(kv, "extract")).toBe(0);
    expect((await budgetState(kv, "extract", 40)).frozen).toBe(false);
    expect((await budgetState(kv, "agent", 40)).frozen).toBe(true);
  });

  it("still counts spend written before the split", async () => {
    const kv = fakeKv();
    // A deployed ledger has history under the old un-prefixed keys. Ignoring it
    // would silently reset the ceiling to zero on the deploy that splits them.
    await kv.put("spend_usd_shard_3", "12.5");
    expect(await totalSpentUsd(kv, "agent")).toBeCloseTo(12.5);
    expect(await totalSpentUsd(kv, "extract")).toBeCloseTo(12.5);
  });
});
