/**
 * The client's side of a refusal: which errors end a batch, and what a
 * failure the browser describes in English says on a Czech screen.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NETWORK_COPY, TIMEOUT_COPY, UNAVAILABLE_COPY, getAllowance, isFatalApiError, isTransientApiError, withRetry } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("which refusals end a batch", () => {
  it("counts the allowance at zero — `no_documents`, plural — as fatal", () => {
    expect(isFatalApiError(new ApiError("x", "no_documents", 402))).toBe(true);
    expect(isFatalApiError(new ApiError("x", "no_document", 409))).toBe(true);
    expect(isFatalApiError(new ApiError("x", "unauthorized", 401))).toBe(true);
    expect(isFatalApiError(new ApiError("x", "extraction_failed", 502))).toBe(false);
  });

  it("retries what a second try can fix, and nothing refused on purpose", () => {
    for (const [code, status] of [["network", 0], ["timeout", 0], ["x", 429], ["x", 502], ["x", 503]] as const) {
      expect(isTransientApiError(new ApiError("x", code, status)), `${code} ${status}`).toBe(true);
    }
    for (const [code, status] of [["no_documents", 402], ["bad_request", 400], ["unauthorized", 401]] as const) {
      expect(isTransientApiError(new ApiError("x", code, status)), code).toBe(false);
    }
  });
});

describe("what a failure says", () => {
  it("a dropped connection is Czech, not the browser's 'Failed to fetch'", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(getAllowance()).rejects.toMatchObject({ code: "network", message: NETWORK_COPY });
  });

  it("an HTML 502 from the edge says the service is unavailable", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(getAllowance()).rejects.toMatchObject({ status: 502, message: UNAVAILABLE_COPY });
  });

  it("a request that never answers times out instead of hanging", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const p = getAllowance();
    const seen = expect(p).rejects.toMatchObject({ code: "timeout", message: TIMEOUT_COPY });
    await vi.advanceTimersByTimeAsync(21_000);
    await seen;
  });

  it("withRetry tries a transient failure again and stops on a real refusal", async () => {
    let n = 0;
    const flaky = () => (++n < 3 ? Promise.reject(new ApiError("x", "network", 0)) : Promise.resolve("ok"));
    expect(await withRetry(flaky, 3, 1)).toBe("ok");
    expect(n).toBe(3);
    let m = 0;
    await expect(withRetry(() => (++m, Promise.reject(new ApiError("x", "bad_request", 400))), 3, 1)).rejects.toMatchObject({ status: 400 });
    expect(m).toBe(1);
  });
});
