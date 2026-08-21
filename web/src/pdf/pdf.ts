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

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Matches the Python pipeline's RENDER_DPI so extraction sees the same thing. */
export const RENDER_DPI = 220;

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
}

export async function loadPdf(file: File) {
  const buf = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: buf }).promise;
}

export async function pageAssets(doc: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<PageAssets> {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1 });
  const dpiScale = RENDER_DPI / 72;
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

  const content = await page.getTextContent();
  const words: Array<{ text: string; box: Box }> = [];
  const parts: string[] = [];
  for (const item of content.items as any[]) {
    const str: string = item.str ?? "";
    if (!str.trim()) continue;
    parts.push(str);
    // pdf.js transform is [a,b,c,d,e,f]; e/f are the text origin in PDF units,
    // y measured from the bottom, so flip it into image space.
    const [, , , , e, f] = item.transform as number[];
    const h = (item.height ?? 10) * capped;
    const w = (item.width ?? str.length * 5) * capped;
    const x0 = e * capped;
    const y0 = canvas.height - f * capped - h;
    words.push({ text: str, box: [x0, y0, x0 + w, y0 + h] });
  }

  return {
    pageNum,
    imageBase64,
    mediaType: "image/jpeg",
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    imageUrl: dataUrl,
    textLayer: parts.join(" "),
    words,
  };
}

/**
 * Pixel bbox of a printed analyte name on the page — the pdf.js equivalent of
 * `search_for` in src/locate.py. Returns null on a scanned page with no text
 * layer, and the UI degrades to the plain full-page view.
 */
export function findRowBox(words: PageAssets["words"], rawName: string): Box | null {
  const needle = rawName.trim().toLowerCase();
  if (!needle) return null;
  let best: Box | null = null;
  for (const w of words) {
    const t = w.text.trim().toLowerCase();
    if (!t) continue;
    if (t === needle || t.startsWith(needle) || needle.startsWith(t)) {
      if (!best || w.box[1] < best[1]) best = w.box;
    }
  }
  return best;
}
