/**
 * A counting semaphore, shared by every page of every file being read.
 *
 * Same construction as apps/bloodwork/src/lib/inflight.ts, and for the same
 * reason: bounding pages per file and running files one after another gets
 * the arithmetic wrong in both directions. Real reports are two or three
 * pages, so a per-file bound of four sat mostly idle while a five-file
 * backlog took five page-times. Bounding the *total* makes the limit mean
 * what it says regardless of how pages are spread across files — and lets a
 * file the reader has just confirmed extract in the background while the
 * next one is being reviewed.
 *
 * Waiters are released in arrival order, so the file confirmed first still
 * finishes first.
 */
export interface Limiter {
  /** Run `fn` once a slot is free, releasing the slot even if it throws. */
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Slots currently held. */
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
