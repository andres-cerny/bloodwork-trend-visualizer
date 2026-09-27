/**
 * The read's two new promises: a page that fails for a reason a second try
 * can fix is tried again before it counts as failed, and a read where every
 * page failed says whether the document went back — which is what decides
 * whether „Zkusit znovu" reuses the id or opens a new one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Registry } from "@bw/lab-core";

const calls = { extract: 0, release: 0 };
let extractAnswers: Array<() => Promise<unknown>> = [];
let releaseAnswer: () => Promise<unknown> = async () => ({ ok: true, released: true, allowance: {} });

vi.mock("@bw/lab-core/pdf", () => ({ rowsAsText: () => "0\tS_Glukóza | 5,32" }));
vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    // No waiting between tries in a test.
    withRetry: (fn: () => Promise<unknown>, tries?: number, _ms?: number, retryable?: (e: unknown) => boolean) => actual.withRetry(fn, tries ?? 3, 0, retryable),
    openDocument: async () => ({ ok: true, already: false, allowance: { free: 5, purchased: 0, used: 1, remaining: 4 } }),
    releaseDocument: async () => {
      calls.release++;
      return releaseAnswer();
    },
    extractPage: async () => {
      calls.extract++;
      const next = extractAnswers.shift();
      if (!next) throw new Error("no answer scripted");
      return next();
    },
  };
});

import { ApiError } from "../src/lib/api";
import { ReadFailed, extractReport, type PreparedFile } from "../src/lib/upload";

const page = { pageNum: 1, imageUrl: "data:", imageWidth: 10, imageHeight: 10, imageBase64: "", mediaType: "image/jpeg", words: [], rows: [], blob: new Blob() };
const prepared: PreparedFile = { name: "a.pdf", kind: "pdf", pages: [page as never], hits: [], scanPages: [], truncated: 0 };
const ok = async () => ({ reads: [{ model: "m", extraction: { rows: [], report_date: "2026-03-04" } }], mode: "text", costUsd: 0.01, budget: {} });

beforeEach(() => {
  calls.extract = 0;
  calls.release = 0;
  extractAnswers = [];
  releaseAnswer = async () => ({ ok: true, released: true, allowance: {} });
});

describe("reading a document", () => {
  it("tries a page again after a dropped connection, and reads it", async () => {
    extractAnswers = [async () => Promise.reject(new ApiError("x", "network", 0)), ok];
    const out = await extractReport("r1", prepared, [page as never], new Registry([]), () => {});
    expect(calls.extract).toBe(2);
    expect(out.report.id).toBe("r1");
    expect(calls.release).toBe(0);
  });

  it("does not send again a page that timed out or that the readers failed — it would be paid twice", async () => {
    extractAnswers = [async () => Promise.reject(new ApiError("x", "timeout", 0))];
    await expect(extractReport("r1", prepared, [page as never], new Registry([]), () => {})).rejects.toBeInstanceOf(ReadFailed);
    expect(calls.extract).toBe(1);
    calls.extract = 0;
    extractAnswers = [async () => Promise.reject(new ApiError("Čtení stránky selhalo.", "extraction_failed", 502))];
    await expect(extractReport("r1", prepared, [page as never], new Registry([]), () => {})).rejects.toBeInstanceOf(ReadFailed);
    expect(calls.extract).toBe(1);
  });

  it("does not retry a refusal the server meant", async () => {
    extractAnswers = [async () => Promise.reject(new ApiError("Neplatná stránka.", "bad_request", 400))];
    await expect(extractReport("r1", prepared, [page as never], new Registry([]), () => {})).rejects.toBeInstanceOf(ReadFailed);
    expect(calls.extract).toBe(1);
  });

  it("gives the document back when every page failed, and says it did", async () => {
    extractAnswers = [0, 1, 2].map(() => async () => Promise.reject(new ApiError("Služba je dočasně nedostupná.", "unknown", 503)));
    const e = await extractReport("r1", prepared, [page as never], new Registry([]), () => {}).catch((x) => x);
    expect(e).toBeInstanceOf(ReadFailed);
    expect(e.released).toBe(true);
    expect(e.message).toMatch(/vrátil do vašeho nároku/);
    expect(calls.extract).toBe(3);
  });

  it("says nothing went back when the release did not happen", async () => {
    extractAnswers = [async () => Promise.reject(new ApiError("x", "bad_request", 400))];
    releaseAnswer = async () => ({ ok: true, released: false, allowance: {} });
    const e = await extractReport("r1", prepared, [page as never], new Registry([]), () => {}).catch((x) => x);
    expect(e.released).toBe(false);
    expect(e.message).not.toMatch(/vrátil/);
  });
});
