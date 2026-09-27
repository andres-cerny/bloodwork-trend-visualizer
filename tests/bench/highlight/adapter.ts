/**
 * OCR words -> printed rows, and a reader row -> one OCR row. Pure.
 *
 * The phrase adapter is the 2026-09-26 identity experiment's (photo-capture.md,
 * "OCR words cannot go into findIdentity raw"): inside one Tesseract line,
 * neighbours closer than 1.2x the median word height merge into one phrase,
 * the phrase's y is normalised to the line's median top/bottom, and a stray
 * border glyph (`i`, `l`, `|`, `!`, `[`, `]` before a capitalised word) is
 * dropped. Phrases then go through `buildRows`, exactly as pdf.js words do.
 *
 * The match rule is photo-capture.md's invariant: **a box only when the OCR
 * row carries both the value and the name the reader returned** — and only
 * when exactly one OCR row does.
 */
import { buildRows } from "@bw/lab-core";

import { nameKey, valKey } from "../score";
import type { Box } from "./geometry";

export interface OcrWord {
  text: string;
  conf: number;
  box: number[];
  line: number;
}

export interface OcrRow {
  text: string;
  cells: string[];
  box: Box;
}

const STRAY = /^[iIl|!\[\]]+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž])/;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

export function phrases(words: OcrWord[]): Array<{ text: string; box: Box }> {
  const byLine = new Map<number, OcrWord[]>();
  for (const w of words) {
    if (!w.text.trim()) continue;
    if (!byLine.has(w.line)) byLine.set(w.line, []);
    byLine.get(w.line)!.push({ ...w, text: w.text.replace(STRAY, "") });
  }
  const out: Array<{ text: string; box: Box }> = [];
  for (const ws0 of byLine.values()) {
    const ws = ws0.filter((w) => w.text.trim()).sort((a, b) => a.box[0] - b.box[0]);
    if (!ws.length) continue;
    const h = median(ws.map((w) => w.box[3] - w.box[1])) || 20;
    const ly0 = median(ws.map((w) => w.box[1]));
    const ly1 = median(ws.map((w) => w.box[3]));
    let cur = [ws[0]];
    const flush = () => {
      out.push({
        text: cur.map((w) => w.text).join(" "),
        box: [Math.min(...cur.map((w) => w.box[0])), ly0, Math.max(...cur.map((w) => w.box[2])), ly1],
      });
    };
    for (let i = 1; i < ws.length; i++) {
      if (ws[i].box[0] - ws[i - 1].box[2] < 1.2 * h) cur.push(ws[i]);
      else {
        flush();
        cur = [ws[i]];
      }
    }
    flush();
  }
  return out;
}

export function ocrRows(words: OcrWord[]): OcrRow[] {
  return buildRows(phrases(words)).map((r) => ({ text: r.cells.join(" "), cells: r.cells, box: r.box as Box }));
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

/** The name, allowing OCR typos: some window of the row's key within 20 % edits of the name's key. */
export function hasName(rowText: string, name: string | undefined): boolean {
  const n = nameKey(name);
  if (!n) return false;
  const r = nameKey(rowText);
  if (r.includes(n)) return true;
  const budget = Math.floor(n.length * 0.2);
  if (budget === 0) return false;
  for (let len = n.length - budget; len <= n.length + budget; len++) {
    for (let i = 0; i + len <= r.length; i++) if (lev(n, r.slice(i, i + len)) <= budget) return true;
  }
  return false;
}

/** The value, exactly (markers aside): as one token or up to three joined (`< 0,5`). */
export function hasValue(rowText: string, value: string | undefined): boolean {
  const v = valKey(value);
  if (!v) return false;
  const toks = rowText.split(/\s+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    let s = "";
    for (let k = i; k < Math.min(toks.length, i + 3); k++) {
      s += toks[k];
      if (valKey(s) === v) return true;
    }
  }
  return false;
}

/**
 * For each reader row, the index of the one OCR row carrying its name and
 * value, or -1. Two reader rows claiming one OCR row both get -1.
 */
export function matchRows(reads: Array<{ raw_analyte_name?: string; value_raw?: string }>, rows: OcrRow[]): number[] {
  const pick = reads.map((r) => {
    const hits = rows.flatMap((row, i) => (hasValue(row.text, r.value_raw) && hasName(row.text, r.raw_analyte_name) ? [i] : []));
    return hits.length === 1 ? hits[0] : -1;
  });
  const count = new Map<number, number>();
  for (const p of pick) if (p >= 0) count.set(p, (count.get(p) ?? 0) + 1);
  return pick.map((p) => (p >= 0 && count.get(p) === 1 ? p : -1));
}
