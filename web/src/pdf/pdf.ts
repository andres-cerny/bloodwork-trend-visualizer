/**
 * Browser-side PDF handling. The file never leaves the tab as a file — only
 * rendered page images (and the page's own text) go to the Worker.
 *
 * Two things come off each page: the embedded text layer, and a rendered
 * image. The text layer is passed to the model as a digit-verification hint
 * exactly as the Python pipeline does, and it also gives us row coordinates
 * for the verification highlight without a second pass.
 */
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Box } from "../lib/models";
import { buildRows, type TextRow } from "./rows";

export * from "./rows";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Matches the Python pipeline's RENDER_DPI — used only when a page must be
 *  sent to a vision model (i.e. it is a scan). */
export const RENDER_DPI = 220;

/** Enough for a human to read the page beside the table, and far cheaper in
 *  memory than a model-grade render. */
export const DISPLAY_DPI = 110;

/**
 * Cap the long edge before upload. A 220 DPI A4 page is ~1800×2570, which is
 * more than the model needs and enough to strain a phone's memory across a
 * long report.
 */
const MAX_EDGE = 1800;

export interface PageAssets {
  pageNum: number;
  imageBase64: string;
  mediaType: string;
  imageWidth: number;
  imageHeight: number;
  /** Object URL for display in the verification tab. */
  imageUrl: string;
  textLayer: string;
  /** Printed text with pixel bboxes, for locating a row on the page image. */
  words: Array<{ text: string; box: Box }>;
  /** Visual rows reconstructed from item coordinates. Empty on a scan. */
  rows: TextRow[];
  /** True when the page carries enough text to skip vision entirely. */
  hasTextLayer: boolean;
}

export async function loadPdf(file: File) {
  const buf = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: buf }).promise;
}

export async function pageAssets(doc: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<PageAssets> {
  const page = await doc.getPage(pageNum);

  // Read the text layer first — it decides how much page we need to render.
  const content = await page.getTextContent();
  const rawItems: Array<{ text: string; x: number; y: number; w: number; h: number }> = [];
  const parts: string[] = [];
  for (const item of content.items as any[]) {
    const str: string = item.str ?? "";
    if (!str.trim()) continue;
    parts.push(str);
    // pdf.js transform is [a,b,c,d,e,f]; e/f are the text origin in PDF units.
    const [, , , , e, f] = item.transform as number[];
    rawItems.push({
      text: str,
      x: e,
      y: f,
      w: item.width ?? str.length * 5,
      h: item.height ?? 10,
    });
  }

  // A lab page with a real text layer yields dozens of positioned items; a
  // scan yields none or a handful of stray artefacts.
  const hasTextLayer = rawItems.length >= 20;

  // When the text layer carries the data, the image is only ever shown to a
  // human in the verification tab — so render it for a screen, not for a
  // model. That avoids the 220 DPI render entirely on the common path, which
  // is the single biggest memory cost of processing a long report on a phone.
  const base = page.getViewport({ scale: 1 });
  const targetDpi = hasTextLayer ? DISPLAY_DPI : RENDER_DPI;
  const dpiScale = targetDpi / 72;
  const capped = Math.min(dpiScale, MAX_EDGE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale: capped });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d")!;
  // Lab pages are mostly white; painting the ground avoids a black background
  // wherever the PDF has no explicit fill.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

  // Scale text coordinates into the rendered image's pixel space, flipping y
  // (PDF measures from the bottom).
  const words = rawItems.map((it) => {
    const h = it.h * capped;
    const x0 = it.x * capped;
    const y0 = canvas.height - it.y * capped - h;
    return { text: it.text, box: [x0, y0, x0 + it.w * capped, y0 + h] as Box };
  });

  const rows = buildRows(words);

  return {
    pageNum,
    imageBase64,
    mediaType: "image/jpeg",
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    imageUrl: dataUrl,
    textLayer: parts.join(" "),
    words,
    rows,
    hasTextLayer: hasTextLayer && rows.length >= 5,
  };
}
