/**
 * Arm M's image: the OCR rows (arm T's adapter) drawn as thin boxes, each with
 * a number to its left ("set of marks"). The same image goes to a Claude
 * subagent and to Gemini, so the two M arms differ in the model only.
 */
import sharp from "sharp";

import { ocrRowsFor } from "./arm_t";
import type { View } from "./common";
import type { Box } from "./geometry";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Writes the marked JPEG to `out`; returns mark number -> OCR row box. */
export async function drawMarks(v: View, out: string): Promise<Record<number, Box>> {
  const rows = ocrRowsFor(v);
  const marks: Record<number, Box> = {};
  const parts: string[] = [];
  rows.forEach((r, i) => {
    const n = i + 1;
    marks[n] = r.box;
    const [x0, y0, x1, y1] = r.box;
    const h = Math.max(y1 - y0, 20);
    const fs = Math.round(Math.max(26, Math.min(44, h * 0.95)));
    const col = n % 2 ? "#d00000" : "#0040d0";
    const label = String(n);
    const lw = fs * 0.62 * label.length + 8;
    const lx = x0 - lw - 4 >= 0 ? x0 - lw - 4 : x0 + 2;
    const ly = (y0 + y1) / 2 - fs / 2 - 2;
    parts.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${col}" stroke-width="3"/>`);
    parts.push(`<rect x="${lx}" y="${ly}" width="${lw}" height="${fs + 4}" fill="#ffffff" fill-opacity="0.85" stroke="${col}" stroke-width="2"/>`);
    parts.push(`<text x="${lx + 4}" y="${ly + fs - 2}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${fs}" fill="${col}">${esc(label)}</text>`);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${v.size[0]}" height="${v.size[1]}">${parts.join("")}</svg>`;
  await sharp(v.path).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toFile(out);
  return marks;
}
