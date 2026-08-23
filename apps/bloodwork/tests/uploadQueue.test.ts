/**
 * Uploading several documents at once means one file's outcome must not decide
 * another's. The rules that matter are: order is the order they were added, a
 * document that fails leaves the ones behind it alone, and an error that will
 * defeat every remaining file stops the queue rather than burning it.
 *
 * The last one is the reason the queue exists in a testable form at all. The
 * session's page allowance is spent in the middle of a batch, and before this
 * every remaining page of every remaining file retried and failed identically.
 */
import { describe, expect, it } from "vitest";
import { makeJob, runQueue, type Job } from "../src/lib/uploadQueue";
import { ApiError, isFatalApiError } from "@bw/api-client";

class Fatal extends Error {}

const opts = (
  jobs: Job<string>[],
  process: (job: Job<string>) => Promise<void>,
  extra: Partial<Parameters<typeof runQueue<string>>[0]> = {},
) => ({
  jobs,
  process,
  fatal: (e: unknown) => e instanceof Fatal,
  message: (e: unknown) => String(e instanceof Error ? e.message : e),
  publish: () => {},
  skipReason: "nezpracováno",
  ...extra,
});

const queue = (...names: string[]) => names.map((n, i) => makeJob(i + 1, n));
const states = (jobs: Job<string>[]) => jobs.map((j) => j.status);

describe("runQueue", () => {
  it("works files in the order they were added", async () => {
    const jobs = queue("a", "b", "c");
    const seen: string[] = [];
    await runQueue(opts(jobs, async (j) => void seen.push(j.file)));
    expect(seen).toEqual(["a", "b", "c"]);
    expect(states(jobs)).toEqual(["done", "done", "done"]);
  });

  it("processes each file exactly once", async () => {
    const jobs = queue("a", "b", "c");
    const seen: number[] = [];
    await runQueue(opts(jobs, async (j) => void seen.push(j.id)));
    expect(seen).toEqual([...new Set(seen)]);
    expect(seen).toHaveLength(3);
  });

  it("lets the rest of the batch through when one file fails", async () => {
    const jobs = queue("good", "bad", "alsogood");
    await runQueue(
      opts(jobs, async (j) => {
        if (j.file === "bad") throw new Error("nečitelné PDF");
      }),
    );
    expect(states(jobs)).toEqual(["done", "failed", "done"]);
    expect(jobs[1].error).toBe("nečitelné PDF");
    // The failure is recorded on the file it belongs to and nowhere else.
    expect(jobs[0].error).toBeNull();
    expect(jobs[2].error).toBeNull();
  });

  it("stops on a fatal error and says why the rest never ran", async () => {
    const jobs = queue("a", "b", "c");
    const seen: string[] = [];
    await runQueue(
      opts(jobs, async (j) => {
        seen.push(j.file);
        if (j.file === "b") throw new Fatal("limit ukázky vyčerpán");
      }),
    );
    // "c" is never attempted — that is the whole point.
    expect(seen).toEqual(["a", "b"]);
    expect(states(jobs)).toEqual(["done", "failed", "skipped"]);
    expect(jobs[1].error).toBe("limit ukázky vyčerpán");
    expect(jobs[2].error).toBe("nezpracováno");
  });

  it("picks up files added while it is already running", async () => {
    // Dropping a second PDF onto a run in progress must join that run rather
    // than sit at "queued" until something else starts a new one.
    const jobs = queue("a");
    const seen: string[] = [];
    await runQueue(
      opts(jobs, async (j) => {
        seen.push(j.file);
        if (j.file === "a") jobs.push(makeJob(2, "late"));
      }),
    );
    expect(seen).toEqual(["a", "late"]);
    expect(states(jobs)).toEqual(["done", "done"]);
  });

  it("republishes after every state change so progress is visible", async () => {
    // Without this the rail would jump from empty to finished, which on a
    // twelve-page report is a minute of looking like nothing is happening.
    const jobs = queue("a", "b");
    let published = 0;
    await runQueue(opts(jobs, async () => {}, { publish: () => void published++ }));
    // running + done, per file.
    expect(published).toBeGreaterThanOrEqual(4);
  });

  it("does nothing with an empty queue", async () => {
    const jobs: Job<string>[] = [];
    await runQueue(opts(jobs, async () => expect.fail("should not process")));
    expect(jobs).toEqual([]);
  });

  it("leaves already-finished files alone on a later run", async () => {
    const jobs = queue("a");
    await runQueue(opts(jobs, async () => {}));
    const seen: string[] = [];
    jobs.push(makeJob(2, "b"));
    await runQueue(opts(jobs, async (j) => void seen.push(j.file)));
    expect(seen).toEqual(["b"]);
  });
});

/**
 * Which API failures stop a batch. This is where the missing `page_limit`
 * lived: it is the one a queue reaches routinely, because five reports spend
 * the twelve-page session allowance long before the last one is read.
 */
describe("isFatalApiError", () => {
  const err = (code: string) => new ApiError("…", code);

  it("stops the batch when the allowance, the budget or the session is gone", () => {
    for (const code of ["page_limit", "budget_exhausted", "session_invalid"]) {
      expect(isFatalApiError(err(code)), code).toBe(true);
    }
  });

  it("lets a batch continue past a failure local to one page", () => {
    for (const code of ["extraction_failed", "missing_page", "unknown", "chat_failed"]) {
      expect(isFatalApiError(err(code)), code).toBe(false);
    }
  });

  it("treats a non-API error as local, not fatal", () => {
    // A corrupt PDF throws a plain Error out of pdf.js. It says nothing about
    // whether the next document can be read.
    expect(isFatalApiError(new Error("bad xref"))).toBe(false);
    expect(isFatalApiError("nope")).toBe(false);
    expect(isFatalApiError(null)).toBe(false);
  });
});
