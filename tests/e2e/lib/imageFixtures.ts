/**
 * Pictures made by hand, for the two upload suites.
 *
 * A photograph fixture has to be a real encoded image or the browser will not
 * decode it, and PNG is the only format Node can produce without a dependency.
 * The demo and Moje krev both photograph lab sheets now and both have to prove
 * it in a browser, so these live here rather than twice.
 */
import { deflateSync } from "node:zlib";

/**
 * A PNG: one IHDR, one zlib-deflated IDAT of filter-0 scanlines, one IEND.
 * The content is a light page with dark bands, so the contrast stretch has
 * something to do.
 */
export function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const ink = y % 40 < 6 && x > width * 0.1 && x < width * 0.9;
      const v = ink ? 70 : 190;
      raw[o++] = v;
      raw[o++] = v;
      raw[o++] = v;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * A file that claims to be HEIC and is: an ISO base-media `ftyp` box with the
 * `heic` major brand, followed by nothing Chromium can decode. Which is the
 * situation exactly — the brand is real, the decoder is missing.
 */
export const heic = (): Buffer =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypheic", "ascii"),
    Buffer.from("mif1heic", "ascii"),
    Buffer.alloc(64),
  ]);

/** Width and height out of a JPEG's SOF marker — what the reader will see. */
export function jpegSize(buf: Buffer): { width: number; height: number } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, excluding the four that are not frame headers.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  throw new Error("no SOF marker: not a JPEG");
}
