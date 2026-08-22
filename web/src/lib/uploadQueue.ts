/**
 * The upload queue's mechanics, with nothing about PDFs or React in them.
 *
 * Extracted so the rules can be tested directly: that files are worked in the
 * order they were added, that one bad document does not sink the ones behind
 * it, and that a fatal error stops the queue instead of burning it. Those are
 * exactly the properties that are painful to check through a browser and easy
 * to break while editing a component.
 */

export type JobStatus = "queued" | "running" | "done" | "failed" | "skipped";

export interface Job<F> {
  /** Unique and monotonic. Also the report id, so it must never repeat. */
  id: number;
  file: F;
  status: JobStatus;
  /** Page progress while running. */
  page: number;
  total: number;
  /** Outcomes worth mentioning — a page limit, a scan. Not failures. */
  notes: string[];
  error: string | null;
}

export function makeJob<F>(id: number, file: F): Job<F> {
  return { id, file, status: "queued", page: 0, total: 0, notes: [], error: null };
}

export interface RunOptions<F> {
  /** Worked in place, so files added mid-run are picked up by the same loop. */
  jobs: Job<F>[];
  process: (job: Job<F>) => Promise<void>;
  /** True when the error makes every remaining file fail the same way. */
  fatal: (e: unknown) => boolean;
  message: (e: unknown) => string;
  /** Told after every state change, so the UI can redraw. */
  publish: () => void;
  /** Shown on the files that never got their turn. */
  skipReason: string;
}

/**
 * Work the queue until nothing is left waiting.
 *
 * Re-reads the array on every pass rather than iterating a snapshot: a file
 * dropped while an earlier one is still being read joins the same run instead
 * of waiting for a second one to be started.
 */
export async function runQueue<F>(o: RunOptions<F>): Promise<void> {
  for (;;) {
    const job = o.jobs.find((j) => j.status === "queued");
    if (!job) return;

    job.status = "running";
    job.error = null;
    o.publish();

    try {
      await o.process(job);
      job.status = "done";
      o.publish();
    } catch (e) {
      job.status = "failed";
      job.error = o.message(e);
      if (o.fatal(e)) {
        // Say what happened to the rest. Left at "queued" they would sit there
        // with no explanation, looking like the app had simply stopped.
        for (const other of o.jobs) {
          if (other.status === "queued") {
            other.status = "skipped";
            other.error = o.skipReason;
          }
        }
        o.publish();
        return;
      }
      o.publish();
    }
  }
}
