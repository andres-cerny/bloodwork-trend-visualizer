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
/** Photos by name, with the verdict their checks give. */
const photoVerdicts = new Map<string, { outcome: "ok" | "warn" | "refuse"; reasons: string[] }>();

vi.mock("../src/lib/upload", () => {
  const page = { pageNum: 1, imageUrl: "blob:p1", imageWidth: 100, imageHeight: 140, imageBase64: "", mediaType: "image/png", words: [], rows: [], hasTextLayer: true };
  class ReadFailed extends Error {
    constructor(message: string, readonly released: boolean) {
      super(message);
    }
  }
  return {
    ReadFailed,
    prepareFile: async (file: File): Promise<PreparedFile> => {
      const verdict = photoVerdicts.get(file.name);
      if (verdict)
        return { name: file.name, kind: "photo", pages: [page as never], hits: [], scanPages: [1], truncated: 0, photo: { verdict: verdict as never, ocr: "done" } };
      return { name: file.name, kind: "pdf", pages: [page as never], hits: [], scanPages: [], truncated: 0 };
    },
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
  photoVerdicts.clear();
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

describe("what a failure keeps", () => {
  const click = async (label: string) => {
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label)!;
    expect(b, label).toBeTruthy();
    await act(async () => {
      b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
  };

  it("a failed save keeps the read report, and „Uložit znovu“ saves it without reading again", async () => {
    storeFails.set("id-1", new ApiError("Požadavek se nepodařilo vyřídit.", "unknown", 500));
    const p = mount(false);
    await pickFiles(["a.pdf"]);
    await confirm("a.pdf");
    await lands("a.pdf");
    expect(p.stored).toHaveLength(0);
    storeFails.clear();
    const readsBefore = reads.size;
    await click("Uložit znovu");
    expect(p.stored).toEqual(["id-1"]);
    expect(reads.size).toBe(readsBefore);
    expect(host.querySelectorAll("li.job.failed")).toHaveLength(0);
    expect(host.querySelectorAll("li.job.done")).toHaveLength(1);
    expect(p.batches.at(-1)).toEqual({ total: 0, settled: 0 });
  });

  it("a failed read offers „Zkusit znovu“, which reads the redacted pages again without a new review", async () => {
    const p = mount(false);
    await pickFiles(["a.pdf"]);
    await confirm("a.pdf");
    await act(async () => reads.get("a.pdf")!.reject(new ApiError("Server neodpovídá.", "timeout", 0)));
    await flush();
    expect(host.querySelector("li.job.failed")?.textContent).toContain("Server neodpovídá.");
    reads.delete("a.pdf");
    await click("Zkusit znovu");
    expect(reads.has("a.pdf")).toBe(true);
    expect(host.querySelector(".review")).toBeNull();
    await lands("a.pdf");
    expect(p.stored).toHaveLength(1);
  });

  it("asks before the tab is closed while a file is being read, and not once it is done", async () => {
    mount(false);
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await pickFiles(["a.pdf"]);
    await confirm("a.pdf");
    expect(unload()).toBe(true);
    await lands("a.pdf");
    expect(unload()).toBe(false);
  });
});

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
      "Report se přečetl, ale nepodařilo se ho uložit: Report je příliš velký. Přečtené hodnoty držíme — zkuste uložit znovu, dokud je okno otevřené.",
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

describe("a photo the checks did not pass", () => {
  const click = async (label: string) => {
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent === label)!;
    await act(async () => {
      b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
  };

  it("stops before the review; 'Nahrát i tak' goes on to it", async () => {
    photoVerdicts.set("rozmazana.jpg", { outcome: "warn", reasons: ["blurred"] });
    mount(false);
    await pickFiles(["rozmazana.jpg"]);
    expect(host.querySelector(".photo-check")?.textContent).toContain("Fotka je rozmazaná.");
    expect(host.querySelector(".review")).toBeNull();
    await click("Nahrát i tak");
    await confirm("rozmazana.jpg");
  });

  it("'Vyfotit znovu' drops the photo unsent and reviews the new one", async () => {
    photoVerdicts.set("tma.jpg", { outcome: "warn", reasons: ["dark"] });
    photoVerdicts.set("znovu.jpg", { outcome: "ok", reasons: [] });
    const p = mount(false);
    await pickFiles(["tma.jpg"]);
    const input = host.querySelector<HTMLInputElement>(".photo-retake input[type=file]")!;
    Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1])], "znovu.jpg", { type: "image/jpeg" })], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(host.querySelector(".review .sub")?.textContent).toContain("znovu.jpg");
    expect(reads.has("tma.jpg")).toBe(false);
    // The new photo joined the batch before the dropped one settled: the
    // batch never closed in between (a close is what switches the parent).
    expect(p.batches.map((b) => `${b.settled}/${b.total}`)).toEqual(["0/1", "0/2", "1/2"]);
  });

  it("a refused photo cannot be sent at all", async () => {
    photoVerdicts.set("cerna.jpg", { outcome: "refuse", reasons: ["blank"] });
    mount(false);
    await pickFiles(["cerna.jpg"]);
    const labels = [...host.querySelectorAll(".photo-check button, .photo-check label")].map((b) => b.textContent);
    expect(labels).toEqual(["Zrušit", "Vyfotit znovu"]);
    await cancel();
    expect(host.querySelector("li.job.skipped")?.textContent).toContain("cerna.jpg");
  });
});
