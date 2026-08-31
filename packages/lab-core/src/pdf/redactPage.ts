/**
 * Painting identity out of a rendered page, in the browser.
 *
 * The detection half (`redact.ts`, root export) says where the name and the
 * number are; this half needs a canvas, so it lives behind the pdf subpath
 * with the rest of the browser-only code. What comes back is a page in the
 * same shape `pageAssets` produced — image, words, rows, text layer — with
 * the boxes painted black and every item under them, or still spelling an
 * identifier, gone from the text. Everything downstream (extraction, the
 * verification highlight, storage) reads this object and never the original.
 */
import type { Box } from "../models";
import { stripIdentity } from "../redact";
import type { PageAssets } from "./pdf";
import { buildRows } from "./rows";

export interface RedactedPage extends PageAssets {
  /** The painted image as a file, ready to upload. */
  blob: Blob;
  /** How many boxes were painted — zero is worth saying on the review screen. */
  boxCount: number;
}

/** Bleed around each box, in image pixels: glyph widths are approximate. */
const PAD = 3;

export async function paintRedactions(
  assets: PageAssets,
  boxes: Box[],
  strings: string[],
): Promise<RedactedPage> {
  const img = new Image();
  img.src = assets.imageUrl;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = assets.imageWidth;
  canvas.height = assets.imageHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (const b of boxes) {
    ctx.fillRect(b[0] - PAD, b[1] - PAD, b[2] - b[0] + PAD * 2, b[3] - b[1] + PAD * 2);
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))), "image/jpeg", 0.85),
  );

  const words = stripIdentity(assets.words, boxes.map((box) => ({ box })), strings);
  return {
    ...assets,
    imageBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mediaType: "image/jpeg",
    imageUrl: dataUrl,
    words,
    rows: buildRows(words),
    textLayer: words.map((w) => w.text).join(" "),
    blob,
    boxCount: boxes.length,
  };
}
