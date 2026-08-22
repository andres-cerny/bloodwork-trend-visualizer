/**
 * A counting semaphore, shared by every page of every file being read.
 *
 * The upload path has two nested places where work can run at once — files in
 * the queue, and pages within a file — and bounding them separately gets the
 * arithmetic wrong in both directions. With files strictly sequential and a
 * per-file bound of 8, a ten-file batch of two-and-three-page reports never had
 * more than three requests in flight: the bound was set for a long report and
 * the real corpus is many short ones. Measured live, that batch took 182 s
 * against the 45 s a pooled run predicted.
 *
 * Bounding the *total* instead makes the limit mean what it says regardless of
 * how the pages happen to be distributed across files. Ten one-page files and
 * one ten-page file now saturate the same ceiling.
 *
 * Deliberately not a queue with priorities: waiters are released in arrival
 * order, so the file dropped first still finishes first and the rail fills
 * roughly top to bottom.
 */
export interface Limiter {
  /** Run `fn` once a slot is free, releasing the slot even if it throws. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Slots currently held. Exposed for tests and for progress reporting. */
  readonly active: number;
  /** Callers parked waiting for a slot. */
  readonly waiting: number;
}

export function createLimiter(limit: number): Limiter {
  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  let active = 0;
  const queue: Array<() => void> = [];

  const release = () => {
    active -= 1;
    // Hand the slot straight to the next waiter rather than letting every
    // waiter wake and race for it.
    const next = queue.shift();
    if (next) next();
  };

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active += 1;
        resolve();
      });
    });
  };

  return {
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
