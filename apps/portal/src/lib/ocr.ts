/**
 * Local OCR for a photographed page (docs/plans/photo-capture.md, D1).
 *
 * Only ever reached through a dynamic `import("./ocr")` from the photo branch
 * of `prepareFile`, so it is its own chunk: a visit that only uploads PDFs
 * never downloads it (`check:bundle:portal` fails the build if it does).
 *
 * Tesseract runs in its own Web Worker (tesseract.js spawns one), from files
 * the portal serves itself — the worker script, the wasm core and the Czech
 * traineddata, copied from node_modules at build time by `ocrAssets` in
 * vite.config.ts. Nothing is fetched from a third party, and the picture never
 * leaves the tab: the worker gets pixels, returns words.
 *
 * Settings are the bench's (tests/bench/photo_ocr.ts): LSTM, `ces`
 * 4.0.0_best_int — `ces` alone scored within 2 % of `ces+eng` at half the
 * download.
 */
import Tesseract from "tesseract.js/dist/tesseract.esm.min.js";
import type { OcrLine } from "@bw/lab-core/photo";

/** Where `ocrAssets` puts the files; exported for the bundle check and tests. */
export const OCR_BASE = "/ocr";

type Worker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let worker: Promise<Worker> | null = null;

/** One worker for the tab, created on first use and kept: loading the
 *  traineddata is the slow part, and the next photo should not pay it again. */
function getWorker(): Promise<Worker> {
  if (!worker) {
    const create = (Tesseract as typeof import("tesseract.js")).createWorker;
    worker = create("ces", 1 /* OEM.LSTM_ONLY */, {
      workerPath: `${OCR_BASE}/worker.min.js`,
      corePath: `${OCR_BASE}/core`,
      langPath: `${OCR_BASE}/lang`,
      gzip: true,
      // A blob: URL wrapper would need worker-src blob:; the file is ours anyway.
      workerBlobURL: false,
      // Without a handler tesseract re-throws a rejected job inside its
      // message listener: an uncaught console error even though the caller
      // already handled the rejection.
      errorHandler: () => {},
    }).catch((e: unknown) => {
      worker = null;
      throw e;
    });
  }
  return worker;
}

/** Words with boxes, line by line, for the pixels given. */
export async function recognize(img: { rgba: Uint8ClampedArray; width: number; height: number }): Promise<OcrLine[]> {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  const w = await getWorker();
  let data: Awaited<ReturnType<Worker["recognize"]>>["data"];
  try {
    ({ data } = await w.recognize(canvas, {}, { blocks: true }));
  } catch (e) {
    // A worker that failed a job is not trusted with the next photo.
    worker = null;
    void w.terminate().catch(() => {});
    throw e;
  }
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        lines.push({ words: l.words.map((wd) => ({ text: wd.text, conf: wd.confidence, box: [wd.bbox.x0, wd.bbox.y0, wd.bbox.x1, wd.bbox.y1] })) });
  return lines;
}

/**
 * Start loading the worker and the Czech data now, before the photo needs
 * them: on a slow line the ~6 MB download used to eat the whole OCR budget.
 * Called when a photo is picked; nothing happens if it is already loading.
 */
export function preload(): void {
  void getWorker().catch(() => undefined);
}

/** Drop the worker — after a job that did not finish in time, whose next job would wait behind it. */
export function reset(): void {
  const w = worker;
  worker = null;
  void w?.then((x) => x.terminate()).catch(() => undefined);
}
