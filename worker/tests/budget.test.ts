/** The ledger decides when AI features freeze, so its arithmetic is load-bearing. */
import { describe, expect, it } from "vitest";
import { budgetState, priceUsd, recordSpendUsd, totalSpentUsd } from "../budget";

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
});

describe("ledger", () => {
  it("accumulates across shards", async () => {
    const kv = fakeKv();
    for (let i = 0; i < 40; i++) await recordSpendUsd(kv, 0.25);
    expect(await totalSpentUsd(kv)).toBeCloseTo(10, 6);
  });

  it("ignores non-positive amounts", async () => {
    const kv = fakeKv();
    await recordSpendUsd(kv, 0);
    await recordSpendUsd(kv, -5);
    expect(await totalSpentUsd(kv)).toBe(0);
  });

  it("freezes once spend reaches the ceiling, not before", async () => {
    const kv = fakeKv();
    await recordSpendUsd(kv, 19.99);
    expect((await budgetState(kv, 20)).frozen).toBe(false);
    await recordSpendUsd(kv, 0.01);
    const state = await budgetState(kv, 20);
    expect(state.frozen).toBe(true);
    expect(state.remainingUsd).toBe(0);
  });
});
