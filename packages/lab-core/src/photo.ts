/**
 * A photograph of a paper lab sheet, prepared in the browser for the same two
 * readers a PDF page goes to.
 *
 * The file never leaves the tab as a file: what goes to the Worker is one
 * greyscale, contrast-stretched JPEG, exactly as `pageAssets` sends a rendered
 * PDF page. Everything here except `encodePhoto` is a pure function over a
 * pixel buffer, so the pipeline is unit-testable without a browser and only the
 * one canvas call needs a DOM.
 *
 * It lives here, behind `@bw/lab-core/photo`, because two apps now photograph
 * lab sheets — the demo (apps/bloodwork) and Moje krev (apps/portal) — and a
 * second copy of a contrast stretch is a second thing to measure. Browser-only,
 * so it is a subpath like `@bw/lab-core/pdf` and never reaches the root export,
 * which must stay free of DOM globals.
 *
 * ## One encode, not two — measured
 *
 * The plan (docs/plans/lab-adaptability.md, Phase E1) called for *two* encodes
 * of every shot: 2576 px for Sonnet's image tier, and the uncut original for
 * Gemini, on the reasoning that Gemini spends a fixed token budget per image
 * part whatever the pixels are, so a bigger picture is free detail. The Worker
 * still accepts that second encode (`imageFullBase64` in
 * workers/extract/src/index.ts) and this file never sends one, because the
 * reasoning did not survive being measured
 * (`tests/bench/photo_edge_gemini.bench.ts`, 2026-09-08, 30 calls, $0.48):
 *
 *     arm        pages calls truth match valERR miss extra  median input tokens
 *     tier2576       5    15   510   510      0    0     1                2,543
 *     full           5    15   510   510      0    0     3                2,543
 *
 * Identical on every column that matters, and the input-token count is the
 * mechanism in plain sight: a 5146 px page and a 2576 px page reach the model
 * as **the same 2,543 tokens**, because `ultra_high` is a budget, not a
 * resolution. Four times the pixels bought nothing — which is the same answer
 * the tiled arm gave when it spent twice the budget on the same pixels
 * (docs/lab-adaptability.md, "It bought nothing").
 *
 * So the extra encode would have cost the phone a second full-size canvas, the
 * uplink a body several times larger, and the reader nothing at all. One
 * encode, at the larger reader's edge, for both.
 *
 * ## No perspective correction, and this is not an omission
 *
 * The plan deferred browser-side de-skew "until the angle photos are scored".
 * They are scored, and the answer is no. On 133 photographed pages including
 * every `angle` shot, Sonnet 5 returned 3,585 of 3,585 rows with **zero value
 * errors**, and Gemini `ultra_high` zero as well (docs/lab-adaptability.md,
 * "The full corpus under the final prompt"). The one reader that sheared on
 * angle was `mistral_ocr`, and Mistral is not in the deployed pair. Rebuilding
 * a homography here would add a slow, failure-prone step in front of two
 * readers that do not need it. If a reader is ever swapped for one that does,
 * that measurement — not this comment — is what reopens the question.
 */

import type { PageAssets } from "./pdf/pdf";

/**
 * The long edge every photo is downscaled to.
 *
 * This is Sonnet 5's image tier, `SONNET_IMAGE_MAX_EDGE` in @bw/extraction, and
 * the two must stay equal: sending more than the tier only makes Anthropic
 * downscale it again, in a way we cannot see. It is restated rather than
 * imported because @bw/extraction pulls the Anthropic SDK, which has no
 * business in a browser bundle — `tests/photo.test.ts` imports both and pins
 * them together, so the duplication cannot drift silently.
 *
 * The PDF path's `MAX_EDGE` (1800, src/pdf/pdf.ts next door) is a different
 * number for a different reason and is not touched by this file.
 */
export const PHOTO_MAX_EDGE = 2576;

/** JPEG quality. Same as the PDF path's render, for the same reason. */
export const PHOTO_JPEG_QUALITY = 0.85;

/** The percentile window the contrast stretch maps onto 0–255. */
export const STRETCH_LOW = 0.02;
export const STRETCH_HIGH = 0.98;

/** Image types the upload input offers, and the drop target accepts. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"];

/**
 * A photo that could not be turned into pixels, carrying the Czech sentence the
 * panel shows. A thrown `Error` would surface as the generic
 * "Nepodařilo se zpracovat" line, which for HEIC is exactly the silent failure
 * the plan's risk list names.
 */
export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

/* ------------------------------------------------------------- recognition */

const PHOTO_EXT = /\.(jpe?g|png|heic|heif)$/i;

/** Is this file a photograph rather than a PDF? Type first, name as fallback:
 *  a file dropped from some Android file managers arrives with `type` "". */
export function isPhotoFile(file: { name: string; type: string }): boolean {
  if (file.type.startsWith("image/")) return true;
  return !file.type && PHOTO_EXT.test(file.name);
}

/** Does the name or MIME type claim HEIC/HEIF? Weak — see `isHeicBytes`. */
export function looksHeicByName(file: { name: string; type: string }): boolean {
  return /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

/**
 * The authoritative HEIC test: the ISO base-media `ftyp` brand.
 *
 * An iPhone photo that arrives by AirDrop or through a file manager often has
 * an empty `type` and sometimes a `.jpg` name, so the name is not evidence. The
 * bytes are: box size, `ftyp`, then a four-character major brand.
 */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

export function isHeicBytes(head: Uint8Array): boolean {
  if (head.length < 12) return false;
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...head.subarray(at, at + n));
  if (ascii(4, 4) !== "ftyp") return false;
  if (HEIC_BRANDS.has(ascii(8, 4).toLowerCase())) return true;
  // Some encoders put a generic major brand and list `heic` among the compatible
  // brands that follow, four bytes at a time to the end of the box.
  const size = Math.min((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3], head.length);
  for (let i = 16; i + 4 <= size; i += 4) {
    if (HEIC_BRANDS.has(ascii(i, 4).toLowerCase())) return true;
  }
  return false;
}

/* -------------------------------------------------------------- pure pixels */

export interface Size {
  width: number;
  height: number;
}

/**
 * The size a photo is drawn at: the long edge capped, aspect kept, never
 * enlarged. A small photo is sent as it is — upscaling invents nothing a
 * reader can use and costs a bigger body.
 */
export function fitWithin(width: number, height: number, maxEdge = PHOTO_MAX_EDGE): Size {
  const long = Math.max(width, height);
  if (long <= maxEdge || long === 0) return { width, height };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Rec. 601 luma, in place, leaving the buffer as valid RGBA.
 *
 * Greyscale before the stretch, not instead of it: a lamp reflection on glossy
 * paper is a colour cast as much as a brightness one, and stretching three
 * channels independently would tint the page rather than flatten the cast.
 */
export function toGreyscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const y = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    data[i] = data[i + 1] = data[i + 2] = y;
  }
}

/** 256-bin histogram of the red channel — which after `toGreyscale` is luma. */
export function histogram(data: Uint8ClampedArray): Uint32Array {
  const h = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) h[data[i]]++;
  return h;
}

export interface Window {
  lo: number;
  hi: number;
}

/**
 * The `low`–`high` percentile window of a histogram.
 *
 * Percentiles rather than min/max because one blown-out highlight or one dark
 * speck would otherwise define the whole range and the stretch would do
 * nothing. Two per cent at each end is enough to ignore a glare spot and a
 * shadowed corner while leaving the printed ink and the paper where they are.
 */
export function percentileWindow(
  hist: Uint32Array,
  low = STRETCH_LOW,
  high = STRETCH_HIGH,
): Window {
  let total = 0;
  for (const n of hist) total += n;
  if (total === 0) return { lo: 0, hi: 255 };

  const at = (fraction: number): number => {
    const want = fraction * total;
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += hist[v];
      if (seen >= want) return v;
    }
    return 255;
  };
  return { lo: at(low), hi: at(high) };
}

/**
 * The 256-entry lookup that maps `lo`–`hi` onto 0–255.
 *
 * A degenerate window — a blank sheet, a photo of a wall — yields identity
 * rather than a division by zero, so an unreadable picture stays unreadable
 * instead of becoming a field of noise the reader would try to transcribe.
 */
export function stretchLut(win: Window): Uint8Array {
  const lut = new Uint8Array(256);
  const span = win.hi - win.lo;
  for (let v = 0; v < 256; v++) {
    lut[v] = span <= 0 ? v : Math.max(0, Math.min(255, Math.round(((v - win.lo) * 255) / span)));
  }
  return lut;
}

/** Apply a luma LUT to an RGBA buffer, in place. Alpha untouched. */
export function applyLut(data: Uint8ClampedArray, lut: Uint8Array): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = lut[data[i]];
  }
}

/**
 * The whole pixel pipeline, as one pure function over an RGBA buffer.
 *
 * `encodePhoto` is this plus a canvas. Anything that changes what a reader
 * sees changes here, where a test can watch it.
 */
export function enhanceRgba(data: Uint8ClampedArray): void {
  toGreyscale(data);
  applyLut(data, stretchLut(percentileWindow(histogram(data))));
}

/* ------------------------------------------------------- the canvas boundary */

export interface EncodedPhoto {
  /** Raw base64, no data: prefix — what `extract()` posts. */
  imageBase64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  /** Object URL of the same bytes, for the verification tab's page image. */
  imageUrl: string;
}

export const HEIC_MESSAGE =
  "Fotku ve formátu HEIC (iPhone) tento prohlížeč neotevře. " +
  "Uložte ji jako JPEG a nahrajte znovu.";

export const DECODE_MESSAGE = "Fotku se nepodařilo otevřít — použijte JPEG nebo PNG.";

/**
 * Decode, downscale, greyscale, stretch, encode. The only function here that
 * needs a DOM, kept to that and nothing else.
 *
 * `imageOrientation: "from-image"` is why this is `createImageBitmap` and not
 * an `<img>`: a phone writes the frame in sensor order and records the rotation
 * in EXIF, so without it a portrait shot of a lab sheet arrives on its side and
 * both readers transcribe a sideways page.
 *
 * HEIC is the one failure worth naming. Safari decodes it here; Chrome throws,
 * and an unnamed throw would reach the queue as "Nepodařilo se zpracovat", i.e.
 * the app looks broken to someone holding a perfectly good photograph. So the
 * bytes are sniffed and the person is told what to send instead.
 */
export async function encodePhoto(file: Blob): Promise<EncodedPhoto> {
  const buf = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError(isHeicBytes(buf) ? HEIC_MESSAGE : DECODE_MESSAGE);
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    // Paper is white; painting the ground first means a photo with an alpha
    // channel does not composite onto black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const img = ctx.getImageData(0, 0, width, height);
    enhanceRgba(img.data);
    ctx.putImageData(img, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
    const imageBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return {
      imageBase64,
      mediaType: "image/jpeg",
      width,
      height,
      imageUrl: URL.createObjectURL(base64ToBlob(imageBase64)),
    };
  } finally {
    // The decoded frame is the largest allocation on this path — a 12 MP shot
    // is ~48 MB of RGBA — and 64 pages may be in flight.
    bitmap.close?.();
  }
}

/** The encoded JPEG as a Blob, so the verification tab shows the same bytes
 *  the reader saw rather than the original file. */
function base64ToBlob(base64: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}


/* --------------------------------------------------------- a photo as a page */

/**
 * A photograph in the shape both upload pipelines already speak.
 *
 * This is the whole reason a photo needed no new pipeline in either app: it
 * arrives as a `PageAssets` with **no text layer**, which is exactly what a
 * scanned PDF page already is. Everything downstream — `canRedact`, the review
 * screen's manual boxes, the vision route in the extractor, the verification
 * highlight — reads those three fields and routes itself.
 *
 * `textLayer: ""`, `words: []` and `rows: []` are empty rather than absent on
 * purpose: `canRedact([])` is then `false` and `findIdentity` returns nothing,
 * so detection *reports that it could not look* instead of reporting a clean
 * page. An `undefined` here would be a page nobody asked the question about.
 */
export function photoPage(shot: EncodedPhoto, pageNum = 1): PageAssets {
  return {
    pageNum,
    imageBase64: shot.imageBase64,
    mediaType: shot.mediaType,
    imageWidth: shot.width,
    imageHeight: shot.height,
    imageUrl: shot.imageUrl,
    textLayer: "",
    words: [],
    rows: [],
    hasTextLayer: false,
  };
}

/** `encodePhoto` and `photoPage`, which is all either app needs of this file.
 *  Split only so the shaping above can be proven without a canvas. */
export async function photoAssets(file: Blob, pageNum = 1): Promise<PageAssets> {
  return photoPage(await encodePhoto(file), pageNum);
}
