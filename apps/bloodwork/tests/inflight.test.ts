/**
 * The global in-flight limit, and the queue running several files at once.
 *
 * These exist because the bug they guard against was invisible from inside the
 * code and cost 4x wall-clock in production: files ran one at a time while a
 * per-file bound of 8 sat almost entirely idle, because the real corpus is many
 * short reports rather than a few long ones. Nothing failed; it was just slow,
 * which is the kind of defect a test has to be written for deliberately.
 */
import { describe, expect, it } from "vitest";

import { createLimiter } from "../src/lib/inflight";
import { makeJob, runQueue, type Job } from "../src/lib/uploadQueue";

/** A promise you can settle from the outside, for pinning concurrency open. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLimiter", () => {
  it("never runs more than the limit at once", async () => {
    const limiter = createLimiter(3);
    let running = 0;
    let peak = 0;
    const gate = deferred();

    const tasks = Array.from({ length: 10 }, () =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );

    // Everything that can start has started; the rest must be parked.
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(3);
    expect(limiter.waiting).toBe(7);

    gate.resolve();
    await Promise.all(tasks);
    expect(peak).toBe(3);
    expect(limiter.active).toBe(0);
  });

  it("frees the slot when the task throws, rather than leaking it", async () => {
    const limiter = createLimiter(1);
    await expect(limiter.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // If the slot leaked, this would hang instead of resolving.
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
    expect(limiter.active).toBe(0);
  });

  it("releases waiters in arrival order, so the first file still finishes first", async () => {
    const limiter = createLimiter(1);
    const order: number[] = [];
    const gate = deferred();
    const first = limiter.run(async () => { await gate.promise; order.push(0); });
    const rest = [1, 2, 3].map((i) => limiter.run(async () => { order.push(i); }));
    gate.resolve();
    await Promise.all([first, ...rest]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("treats a nonsensical limit as one rather than as unbounded", async () => {
    for (const bad of [0, -5, NaN]) {
      const limiter = createLimiter(bad);
      let peak = 0;
      let running = 0;
      const gate = deferred();
      const tasks = [1, 2].map(() =>
        limiter.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await gate.promise;
          running -= 1;
        }),
      );
      await Promise.resolve();
      expect(peak, String(bad)).toBe(1);
      gate.resolve();
      await Promise.all(tasks);
    }
  });
});

describe("runQueue with several files open at once", () => {
  const opts = (jobs: Job<string>[], process: (j: Job<string>) => Promise<void>, extra = {}) => ({
    jobs,
    process,
    fatal: (e: unknown) => (e as Error).message === "fatal",
    message: (e: unknown) => String(e),
    publish: () => {},
    skipReason: "skipped",
    ...extra,
  });

  it("defaults to one file at a time, so an unthinking caller keeps the old behaviour", async () => {
    const jobs = [1, 2, 3].map((i) => makeJob(i, `f${i}`));
    let peak = 0;
    let running = 0;
    await runQueue(
      opts(jobs, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await Promise.resolve();
        running -= 1;
      }),
    );
    expect(peak).toBe(1);
  });

  it("opens several files at once when asked", async () => {
    const jobs = [1, 2, 3, 4, 5, 6].map((i) => makeJob(i, `f${i}`));
    let peak = 0;
    let running = 0;
    const gate = deferred();
    const run = runQueue(
      opts(
        jobs,
        async () => {
          running += 1;
          peak = Math.max(peak, running);
          await gate.promise;
          running -= 1;
        },
        { fileConcurrency: 3 },
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(3);
    gate.resolve();
    await run;
    expect(jobs.every((j) => j.status === "done")).toBe(true);
  });

  it("never hands the same file to two workers", async () => {
    const jobs = Array.from({ length: 12 }, (_, i) => makeJob(i, `f${i}`));
    const seen: number[] = [];
    await runQueue(
      opts(
        jobs,
        async (j) => {
          seen.push(j.id);
          await new Promise((r) => setTimeout(r, 1));
        },
        { fileConcurrency: 4 },
      ),
    );
    expect(seen.length).toBe(12);
    expect(new Set(seen).size).toBe(12);
  });

  it("still stops the whole queue on a fatal error", async () => {
    const jobs = [1, 2, 3, 4, 5].map((i) => makeJob(i, `f${i}`));
    await runQueue(
      opts(
        jobs,
        async (j) => {
          if (j.id === 1) throw new Error("fatal");
          await new Promise((r) => setTimeout(r, 5));
        },
        { fileConcurrency: 2 },
      ),
    );
    expect(jobs[0].status).toBe("failed");
    // Nothing may be left silently waiting with no explanation.
    expect(jobs.some((j) => j.status === "queued")).toBe(false);
    expect(jobs.filter((j) => j.status === "skipped").length).toBeGreaterThan(0);
  });

  it("lets one bad file fail without sinking the others", async () => {
    const jobs = [1, 2, 3, 4].map((i) => makeJob(i, `f${i}`));
    await runQueue(
      opts(
        jobs,
        async (j) => {
          if (j.id === 2) throw new Error("just this one");
          await new Promise((r) => setTimeout(r, 1));
        },
        { fileConcurrency: 2 },
      ),
    );
    expect(jobs.find((j) => j.id === 2)!.status).toBe("failed");
    expect(jobs.filter((j) => j.status === "done").length).toBe(3);
  });
});
