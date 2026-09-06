/**
 * The two gates against uploading a report twice, driven headlessly.
 *
 * What matters is *when* each gate fires relative to what costs money: the
 * fingerprint gate must fire before the PDF is opened and before the
 * extractor is asked anything, and the content gate must fire after the
 * read and before the save. So the fakes count their calls, and the
 * assertions are about the counts as much as the outcomes.
 *
 * Proven failing: with `sameFile` short-circuited to null, the first test
 * sees the extractor called once and stops there.
 */
import { describe, expect, it, vi } from "vitest";
import type { IdentityHit, LabReport } from "@bw/lab-core";
import type { RedactedPage } from "@bw/lab-core/pdf";
import { ApiError } from "../src/lib/api";
import { fingerprintFile, type ExtractOutcome, type PreparedFile } from "../src/lib/upload";
import { alreadyStored, createUploadQueue, probablyStored, type QueueDeps, type QueueState } from "../src/lib/uploadQueue";

const pdf = (name: string, bytes: number[]) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, ...bytes])], name, { type: "application/pdf" });

const stored = (id: string, reportDate: string, labName: string, fingerprint?: string): LabReport => ({
  id, sourceFile: `report-${reportDate}.pdf`, reportDate, labName, patientName: null, patientId: null,
  pages: [{ pageNum: 1, imageUrl: `/api/pages/${id}/1`, imageWidth: 800, imageHeight: 1100 }],
  measurements: [], ...(fingerprint ? { fingerprint } : {}),
});

const prepared = (name: string): PreparedFile => ({ name, pages: [], hits: [], scanPages: [], truncated: 0 });
const page = { pageNum: 1, imageUrl: "blob:x", imageWidth: 800, imageHeight: 1100, blob: new Blob([]), mediaType: "image/jpeg", rows: [], words: [], imageBase64: "" } as unknown as RedactedPage;

/** What the extractor answers: a read report on this date from this lab. */
const outcome = (id: string, reportDate: string | null, labName: string | null, fingerprint: string): ExtractOutcome => ({
  report: { id, sourceFile: "report.pdf", reportDate, labName, patientName: null, patientId: null, pages: [], measurements: [], fingerprint },
  notes: [],
});

function harness(reports: LabReport[], extractAs: { reportDate: string | null; labName: string | null } = { reportDate: "2024-11-01", labName: "SPADIA LAB" }) {
  let n = 0;
  const deps: QueueDeps = {
    reports: () => reports,
    fingerprint: fingerprintFile,
    prepare: vi.fn(async (file: File) => prepared(file.name)),
    redact: vi.fn(async () => [page]),
    check: () => [],
    extract: vi.fn(async (id: string, _p, _pages, _prog, _row, fingerprint: string) => outcome(id, extractAs.reportDate, extractAs.labName, fingerprint)),
    store: vi.fn(async (r: LabReport) => r),
    newId: () => `new-${++n}`,
    onStored: vi.fn(),
    onBudget: vi.fn(),
  };
  const states: QueueState[] = [];
  const q = createUploadQueue(deps, (st) => states.push(st));
  return { deps, q, states, last: () => states[states.length - 1] };
}

/** Wait until the queue's state satisfies `pred`, or fail loudly. */
async function until(h: ReturnType<typeof harness>, pred: (s: QueueState) => boolean, what: string) {
  for (let i = 0; i < 200; i++) {
    if (h.states.length && pred(h.last())) return h.last();
    await new Promise((r) => setTimeout(r, 1));
  }
  throw new Error(`never reached: ${what}\nlast state: ${JSON.stringify(h.last(), null, 1)}`);
}

describe("the first gate: the file's fingerprint", () => {
  it("stops a file the account already holds before the PDF is opened or the extractor asked", async () => {
    const file = pdf("vysledky.pdf", [1, 2, 3]);
    const fp = await fingerprintFile(file);
    const existing = stored("r-old", "2024-10-25", "SPADIA LAB", fp);
    const h = harness([existing]);

    h.q.enqueue([file]);
    const st = await until(h, (s) => s.stage.kind === "duplicate", "the duplicate stage");
    expect(st.stage).toMatchObject({ kind: "duplicate", name: "vysledky.pdf", existing: { id: "r-old" } });
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.deps.extract).not.toHaveBeenCalled();

    // Skip, the default: a log line saying which report it was, nothing spent.
    h.q.decide("skip");
    const after = await until(h, (s) => s.stage.kind === "idle" && s.log.length === 1, "the skip logged");
    expect(after.log[0]).toEqual({ name: "vysledky.pdf", status: "skipped", notes: [alreadyStored(existing)], error: null });
    expect(after.log[0].notes[0]).toBe("Tento report už máte nahraný (25. 10. 2024, SPADIA LAB).");
    expect(h.deps.prepare).not.toHaveBeenCalled();
    expect(h.deps.extract).not.toHaveBeenCalled();
    expect(h.deps.store).not.toHaveBeenCalled();
  });

  it("on Nahradit runs the normal flow under the existing report's id", async () => {
    const file = pdf("vysledky.pdf", [1, 2, 3]);
    const fp = await fingerprintFile(file);
    const existing = stored("r-old", "2024-10-25", "SPADIA LAB", fp);
    const h = harness([existing]);

    h.q.enqueue([file]);
    await until(h, (s) => s.stage.kind === "duplicate", "the duplicate stage");
    h.q.decide("replace");
    await until(h, (s) => s.stage.kind === "review", "the review screen");
    expect(h.deps.prepare).toHaveBeenCalledTimes(1);

    h.q.confirm([] as IdentityHit[]);
    await until(h, (s) => s.log.some((l) => l.status === "done"), "the save");
    expect(h.deps.extract).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.deps.extract).mock.calls[0][0]).toBe("r-old");
    expect(vi.mocked(h.deps.extract).mock.calls[0][5]).toBe(fp);
    expect(h.deps.store).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.deps.store).mock.calls[0][0]).toMatchObject({ id: "r-old", fingerprint: fp });
    expect(h.deps.onStored).toHaveBeenCalledWith(expect.objectContaining({ id: "r-old" }));
    expect(h.last().log[0].notes[0]).toBe("Nahradil původní report (25. 10. 2024, SPADIA LAB).");
    // Replacing is not asked about twice: the content gate stays quiet.
    expect(h.last().running).toEqual([]);
  });

  it("lets a new file through with a fresh id and its fingerprint on the report", async () => {
    const file = pdf("nove.pdf", [9, 9, 9]);
    const h = harness([stored("r-old", "2024-10-25", "SPADIA LAB", "a".repeat(64))], { reportDate: "2025-01-05", labName: "synlab" });
    h.q.enqueue([file]);
    await until(h, (s) => s.stage.kind === "review", "the review screen");
    h.q.confirm([]);
    await until(h, (s) => s.log.some((l) => l.status === "done"), "the save");
    expect(vi.mocked(h.deps.extract).mock.calls[0][0]).toBe("new-1");
    expect(vi.mocked(h.deps.store).mock.calls[0][0]).toMatchObject({ id: "new-1", fingerprint: await fingerprintFile(file) });
    expect(h.last().log[0]).toEqual({ name: "nove.pdf", status: "done", notes: [], error: null });
  });
});

describe("the second gate: the same date and laboratory", () => {
  it("holds a read whose date and laboratory match a stored report, before saving", async () => {
    const file = pdf("export.pdf", [4, 5, 6]);
    const existing = stored("r-old", "2024-11-01", "SPADIA LAB", "b".repeat(64));
    const h = harness([existing]);
    h.q.enqueue([file]);
    await until(h, (s) => s.stage.kind === "review", "the review screen");
    h.q.confirm([]);
    const st = await until(h, (s) => s.running.some((r) => r.phase === "probable"), "the probable phase");
    expect(st.running[0]).toMatchObject({ id: "new-1", phase: "probable", existing: { id: "r-old" } });
    expect(h.deps.extract).toHaveBeenCalledTimes(1);
    expect(h.deps.store).not.toHaveBeenCalled();
    expect(probablyStored(existing)).toBe("Pravděpodobně už nahraný report (stejné datum a laboratoř): 1. 11. 2024, SPADIA LAB.");

    h.q.resolve("new-1", "skip");
    const after = await until(h, (s) => s.log.length === 1, "the skip logged");
    expect(after.running).toEqual([]);
    expect(after.log[0]).toEqual({ name: "export.pdf", status: "skipped", notes: [probablyStored(existing)], error: null });
    expect(h.deps.store).not.toHaveBeenCalled();
  });

  it("on Nahradit saves under the existing id", async () => {
    const file = pdf("export.pdf", [4, 5, 6]);
    const existing = stored("r-old", "2024-11-01", "SPADIA LAB");
    const h = harness([existing]);
    h.q.enqueue([file]);
    await until(h, (s) => s.stage.kind === "review", "the review screen");
    h.q.confirm([]);
    await until(h, (s) => s.running.some((r) => r.phase === "probable"), "the probable phase");
    h.q.resolve("new-1", "replace");
    const after = await until(h, (s) => s.log.length === 1, "the save logged");
    expect(vi.mocked(h.deps.store).mock.calls[0][0].id).toBe("r-old");
    expect(after.log[0]).toMatchObject({ status: "done", notes: ["Nahradil původní report (1. 11. 2024, SPADIA LAB)."] });
    expect(after.running).toEqual([]);
  });

  it("does not fire for a read without a date, or without a laboratory", async () => {
    for (const as of [{ reportDate: null, labName: "SPADIA LAB" }, { reportDate: "2024-11-01", labName: null }]) {
      const h = harness([stored("r-old", "2024-11-01", "SPADIA LAB")], as);
      h.q.enqueue([pdf("x.pdf", [7])]);
      await until(h, (s) => s.stage.kind === "review", "the review screen");
      h.q.confirm([]);
      await until(h, (s) => s.log.length === 1, "the save");
      expect(h.last().log[0].status).toBe("done");
      expect(h.deps.store).toHaveBeenCalledTimes(1);
    }
  });

  it("treats the worker's 409 as the same notice, and Nahradit retries under the id it named", async () => {
    const file = pdf("jinde.pdf", [8, 8]);
    const h = harness([], { reportDate: "2025-02-02", labName: "Lab" });
    vi.mocked(h.deps.store).mockRejectedValueOnce(new ApiError("Tento report už máte nahraný.", "duplicate", 409, undefined, "r-elsewhere"));
    h.q.enqueue([file]);
    await until(h, (s) => s.stage.kind === "review", "the review screen");
    h.q.confirm([]);
    const st = await until(h, (s) => s.running.some((r) => r.phase === "probable"), "the probable phase");
    expect(st.running[0].existing?.id).toBe("r-elsewhere");
    expect(st.log).toEqual([]);

    h.q.resolve("new-1", "replace");
    const after = await until(h, (s) => s.log.length === 1, "the save logged");
    expect(h.deps.store).toHaveBeenCalledTimes(2);
    expect(vi.mocked(h.deps.store).mock.calls[1][0].id).toBe("r-elsewhere");
    expect(after.log[0].status).toBe("done");
  });
});
