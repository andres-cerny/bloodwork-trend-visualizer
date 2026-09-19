// @vitest-environment happy-dom
/**
 * The upload queue steps the batch — driven as a person drives it.
 *
 * lib/batch.ts is the rule; this is the wiring: a pick of three opens a
 * batch of three, every file that ends steps it once whichever way it ended
 * — stored, failed, skipped at the review — and the last one closes it
 * after its report has been handed up, so the parent that switches on the
 * close switches with every report in hand. The pipeline (lib/upload.ts) is
 * replaced: pdf.js and the extractor have no place in a test of a counter,
 * and each file's read is a promise the test settles by hand, in the order
 * it wants.
 *
 * A DOM, because the review is a screen with a button on it, and the batch
 * is stepped by what happens after that button.
 */
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LabReport, Registry } from "@bw/lab-core";
import type { Batch } from "../src/lib/batch";
import type { PreparedFile } from "../src/lib/upload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** One read per file, settled by the test: `reads.get(name)` resolves or rejects it. */
const reads = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
/** Report ids whose store fails, with the worker's sentence — read, not stored. */
const storeFails = new Map<string, Error>();

vi.mock("../src/lib/upload", () => {
  const page = { pageNum: 1, imageUrl: "blob:p1", imageWidth: 100, imageHeight: 140, imageBase64: "", mediaType: "image/png", words: [], rows: [], hasTextLayer: true };
  return {
    prepareFile: async (file: File): Promise<PreparedFile> => ({ name: file.name, kind: "pdf", pages: [page as never], hits: [], scanPages: [], truncated: 0 }),
    redactFile: async () => [{ ...page, blob: new Blob() }],
    checkRedaction: () => [],
    newReportId: () => `id-${reads.size + 1}`,
    extractReport: (id: string, prepared: PreparedFile) =>
      new Promise<{ report: LabReport; notes: string[] }>((resolve, reject) => {
        reads.set(prepared.name, {
          resolve: () =>
            resolve({
              report: { id, sourceFile: "report.pdf", reportDate: "2026-09-19", labName: null, patientName: null, patientId: null, pages: [], measurements: [] },
              notes: [],
            }),
          reject,
        });
      }),
    storeReport: async (report: LabReport) => {
      const fail = storeFails.get(report.id);
      if (fail) throw fail;
      return report;
    },
  };
});

import UploadFlow, { storeFailedCopy } from "../src/ui/UploadFlow";
import { ApiError } from "../src/lib/api";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reads.clear();
  storeFails.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui: ReactElement) => act(() => root.render(ui));
/** Let the pipeline's awaited steps run: a few microtask turns, inside act. */
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

const file = (name: string) => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });

async function pickFiles(names: string[]) {
  const input = host.querySelector<HTMLInputElement>("label.drop input[type=file]")!;
  Object.defineProperty(input, "files", { value: names.map(file), configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

/** The review is up for `name`; confirm it, and let the read start. */
async function confirm(name: string) {
  expect(host.querySelector(".review .sub")?.textContent, `the review is for ${name}`).toContain(name);
  const yes = [...host.querySelectorAll("button")].find((b) => b.textContent === "Ano, nahrát")!;
  await act(async () => {
    yes.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
  expect(reads.has(name), `${name} is being read`).toBe(true);
}

async function cancel() {
  const no = [...host.querySelectorAll("button")].find((b) => b.textContent === "Zrušit")!;
  await act(async () => {
    no.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

async function lands(name: string) {
  await act(async () => reads.get(name)!.resolve());
  await flush();
}

async function fails(name: string) {
  await act(async () => reads.get(name)!.reject(new Error("čtečka odpověděla 500")));
  await flush();
}

function mount(holding: boolean) {
  const batches: Batch[] = [];
  const stored: string[] = [];
  /** What the parent saw, in order: a report handed up, or a batch step. */
  const order: string[] = [];
  const ui = (h: boolean) => (
    <UploadFlow
      registry={new Registry([])}
      maxPages={6}
      frozen={false}
      allowance={null}
      onAllowance={() => {}}
      onBuy={() => {}}
      onStored={(r) => {
        stored.push(r.id);
        order.push(`stored ${r.id}`);
      }}
      onBudget={() => {}}
      onBatch={(b) => {
        batches.push(b);
        order.push(`batch ${b.settled}/${b.total}`);
      }}
      holding={h}
    />
  );
  render(ui(holding));
  return { batches, stored, order, rerender: (h: boolean) => render(ui(h)) };
}

const line = () => host.querySelector(".batch-wait")?.textContent ?? null;

describe("the queue and its batch", () => {
  it("a pick of three opens a batch of three; each landing steps it; the last closes it after its report went up", async () => {
    const p = mount(true);
    await pickFiles(["a.pdf", "b.pdf", "c.pdf"]);
    expect(p.batches).toEqual([{ total: 3, settled: 0 }]);

    // The reader confirms each in turn; the reads run in the background.
    await confirm("a.pdf");
    await confirm("b.pdf");
    await confirm("c.pdf");
    expect(host.querySelectorAll("li.job.running")).toHaveLength(3);

    await lands("a.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 3, settled: 1 });
    await lands("c.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 3, settled: 2 });
    await lands("b.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 0, settled: 0 });

    // Three reports up, and the close came after the third — the parent
    // that switches on it has all three.
    expect(p.stored).toHaveLength(3);
    expect(p.order.at(-2)).toMatch(/^stored /);
    expect(p.order.at(-1)).toBe("batch 0/0");
    expect(host.querySelectorAll("li.job.done")).toHaveLength(3);
  });

  it("a failed read steps the batch like a stored one, and the file stays in the log with its message", async () => {
    const p = mount(true);
    await pickFiles(["a.pdf", "b.pdf", "c.pdf"]);
    await confirm("a.pdf");
    await confirm("b.pdf");
    await confirm("c.pdf");

    await lands("a.pdf");
    await fails("b.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 3, settled: 2 });
    expect(p.stored).toHaveLength(1);
    await lands("c.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 0, settled: 0 });
    expect(p.stored).toHaveLength(2);

    const failed = host.querySelector("li.job.failed");
    expect(failed?.textContent).toContain("b.pdf");
    expect(failed?.textContent).toContain("čtečka odpověděla 500");
    expect(host.querySelectorAll("li.job.done")).toHaveLength(2);
  });

  it("a store that fails after the read says so — read, not stored, the document spent — and steps the batch", async () => {
    // The worker refused the row (413 was the case on 2026-09-19: six pages
    // of data: URLs); the pages were read and paid for, so nothing is given
    // back, and the sentence must say which half failed rather than
    // „Nepodařilo se zpracovat PDF".
    storeFails.set("id-1", new ApiError("Report je příliš velký.", "too_large", 413));
    const p = mount(true);
    await pickFiles(["a.pdf", "b.pdf"]);
    await confirm("a.pdf");
    await confirm("b.pdf");
    await lands("a.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 2, settled: 1 });
    expect(p.stored).toHaveLength(0);
    const failed = host.querySelector("li.job.failed");
    expect(failed?.textContent).toContain("a.pdf");
    expect(failed?.querySelector(".job-note")?.textContent).toBe(storeFailedCopy("Report je příliš velký."));
    expect(storeFailedCopy("Report je příliš velký.")).toBe(
      "Report se přečetl, ale nepodařilo se ho uložit: Report je příliš velký. Dokument z nároku je využitý.",
    );
    await lands("b.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 0, settled: 0 });
    expect(p.stored).toHaveLength(1);
  });

  it("a file skipped at the review steps the batch too — nothing read, nothing stored, one file fewer to wait for", async () => {
    const p = mount(true);
    await pickFiles(["a.pdf", "b.pdf"]);
    await cancel();
    expect(p.batches.at(-1)).toEqual({ total: 2, settled: 1 });
    // The next review replaces the whole card, log included; it is back once
    // the reader is done looking.
    await confirm("b.pdf");
    await lands("b.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 0, settled: 0 });
    expect(p.stored).toHaveLength(1);
    expect(host.querySelector("li.job.skipped")?.textContent).toContain("a.pdf");
  });

  it("files added while the batch runs join it", async () => {
    const p = mount(true);
    await pickFiles(["a.pdf"]);
    await confirm("a.pdf");
    await pickFiles(["b.pdf"]);
    expect(p.batches.at(-1)).toEqual({ total: 2, settled: 0 });
    await confirm("b.pdf");
    await lands("a.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 2, settled: 1 });
    await lands("b.pdf");
    expect(p.batches.at(-1)).toEqual({ total: 0, settled: 0 });
  });
});

describe("the line under the queue", () => {
  it("says what the wait is for while the parent holds, and only then", async () => {
    const p = mount(true);
    expect(line()).toBeNull();
    await pickFiles(["a.pdf", "b.pdf", "c.pdf"]);
    await confirm("a.pdf");
    await confirm("b.pdf");
    await confirm("c.pdf");
    expect(line()).toBe("Souhrn se otevře až po přečtení všech 3 souborů.");
    await lands("a.pdf");
    await lands("b.pdf");
    expect(line(), "still two of three: the line stays").toBe("Souhrn se otevře až po přečtení všech 3 souborů.");
    await lands("c.pdf");
    // The batch closed; the parent lifts the hold on the same step.
    p.rerender(false);
    expect(line()).toBeNull();
  });

  it("is absent for a later upload, when the parent does not hold", async () => {
    mount(false);
    await pickFiles(["a.pdf", "b.pdf"]);
    await confirm("a.pdf");
    await confirm("b.pdf");
    expect(line()).toBeNull();
    expect(host.querySelectorAll("li.job.running")).toHaveLength(2);
  });
});
