/**
 * What the first PUT of a report carries, and what a failed store does not do.
 *
 * The painted pages exist in the browser as data: URLs — ~59 kB of JPEG each
 * — and until 2026-09-19 the first PUT carried them in `pages[].imageUrl`.
 * The worker strips them at rest, but it counts them against
 * MAX_PAYLOAD_BYTES first, so a six-page document answered 413 after the
 * document slot was taken and every page had been read and paid for. The
 * first row goes without the pixels; the second, after the page uploads,
 * names them by route.
 *
 * The api module is replaced: this is a test of what is sent, not of a
 * worker.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LabReport } from "@bw/lab-core";
import type { RedactedPage } from "@bw/lab-core/pdf";

const puts: LabReport[] = [];
const released: string[] = [];
let failFirstPut: Error | null = null;

vi.mock("../src/lib/api", () => ({
  putReport: async (report: LabReport) => {
    puts.push(structuredClone(report));
    if (puts.length === 1 && failFirstPut) throw failFirstPut;
    return { ok: true };
  },
  putPage: async (reportId: string, pageNum: number) => ({ ok: true, imageUrl: `/api/reports/${reportId}/${pageNum}` }),
  releaseDocument: async (id: string) => {
    released.push(id);
    return { ok: true, allowance: { free: 5, purchased: 0, used: 0, remaining: 5 } };
  },
  openDocument: async () => ({ ok: true, allowance: { free: 5, purchased: 0, used: 1, remaining: 4 } }),
  extractPage: async () => ({ reads: [], readersAttempted: 1 }),
  isFatalApiError: () => false,
}));

import { storeReport } from "../src/lib/upload";

const DATA_URL = `data:image/jpeg;base64,${"/9j/4AAQ".repeat(2000)}`;

const page = (n: number): RedactedPage =>
  ({
    pageNum: n,
    imageUrl: DATA_URL,
    imageWidth: 1240,
    imageHeight: 1754,
    imageBase64: "",
    mediaType: "image/jpeg",
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    words: [],
    rows: [],
    hasTextLayer: true,
  }) as unknown as RedactedPage;

const report = (pages: RedactedPage[]): LabReport => ({
  id: "r-1",
  sourceFile: "report-2026-09-19.pdf",
  reportDate: "2026-09-19",
  labName: null,
  patientName: null,
  patientId: null,
  pages: pages.map((p) => ({ pageNum: p.pageNum, imageUrl: p.imageUrl, imageWidth: p.imageWidth, imageHeight: p.imageHeight })),
  measurements: [],
});

beforeEach(() => {
  puts.length = 0;
  released.length = 0;
  failFirstPut = null;
});

describe("storeReport", () => {
  it("sends the first row without the painted pixels, and the second with the routes", async () => {
    const pages = [1, 2, 3, 4, 5, 6].map(page);
    const stored = await storeReport(report(pages), pages);

    expect(puts).toHaveLength(2);
    const first = JSON.stringify(puts[0]);
    expect(first, "no data: URL in the first PUT").not.toContain("data:");
    expect(first.length, "a six-page row stays far under the worker's 2 MiB").toBeLessThan(4_000);
    expect(puts[0].pages.map((p) => p.pageNum)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(puts[0].pages.every((p) => p.imageWidth === 1240 && p.imageHeight === 1754), "sizes ride along").toBe(true);

    expect(puts[1].pages.map((p) => p.imageUrl)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `/api/reports/r-1/${n}`));
    expect(stored.pages[0].imageUrl).toBe("/api/reports/r-1/1");
  });

  it("a failed store does not give the document back — the pages were read — and the worker's sentence comes through", async () => {
    failFirstPut = new Error("Report je příliš velký.");
    const pages = [1, 2].map(page);
    await expect(storeReport(report(pages), pages)).rejects.toThrow("Report je příliš velký.");
    expect(released).toEqual([]);
    expect(puts).toHaveLength(1);
  });
});
