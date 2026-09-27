import { afterEach, describe, expect, it, vi } from "vitest";
import { OCR_TIMEOUT_MS, within } from "../src/lib/upload";

describe("local OCR cannot hold a photo up for ever", () => {
  afterEach(() => vi.useRealTimers());

  it("gives up on a job that never settles — a worker killed mid-recognize", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const raced = within(never, OCR_TIMEOUT_MS);
    const settled = expect(raced).rejects.toThrow(/did not finish/);
    await vi.advanceTimersByTimeAsync(OCR_TIMEOUT_MS);
    await settled;
  });

  it("passes a job that finishes in time through untouched", async () => {
    await expect(within(Promise.resolve(["řádek"]), OCR_TIMEOUT_MS)).resolves.toEqual(["řádek"]);
  });

  it("passes a job's own failure through, so it reads as a failed OCR", async () => {
    await expect(within(Promise.reject(new Error("worker died")), OCR_TIMEOUT_MS)).rejects.toThrow("worker died");
  });
});
