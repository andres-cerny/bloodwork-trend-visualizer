/**
 * The shared page bound. It exists so that pages of several confirmed files
 * interleave under one ceiling instead of files waiting on each other.
 */
import { describe, expect, it } from "vitest";
import { createLimiter } from "../src/lib/inflight";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("createLimiter", () => {
  it("never holds more than `limit` slots, and releases waiters in arrival order", async () => {
    const lim = createLimiter(2);
    const gates = [deferred(), deferred(), deferred()];
    const order: number[] = [];
    const jobs = gates.map((g, i) =>
      lim.run(async () => {
        order.push(i);
        await g.promise;
      }),
    );
    await Promise.resolve();
    expect(lim.active).toBe(2);
    expect(lim.waiting).toBe(1);
    expect(order).toEqual([0, 1]);

    gates[0].resolve();
    await jobs[0];
    await Promise.resolve();
    expect(order).toEqual([0, 1, 2]);
    expect(lim.active).toBe(2);

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(jobs);
    expect(lim.active).toBe(0);
  });

  it("releases the slot when the job throws", async () => {
    const lim = createLimiter(1);
    await expect(lim.run(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(lim.active).toBe(0);
    await expect(lim.run(async () => 1)).resolves.toBe(1);
  });

  it("interleaves the pages of two files under one ceiling", async () => {
    const lim = createLimiter(3);
    let peak = 0;
    const page = () =>
      lim.run(async () => {
        peak = Math.max(peak, lim.active);
        await new Promise((r) => setTimeout(r, 2));
      });
    const fileA = Promise.all([page(), page(), page()]);
    const fileB = Promise.all([page(), page()]);
    await Promise.all([fileA, fileB]);
    expect(peak).toBe(3);
  });
});
