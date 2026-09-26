/**
 * Arm T (docs/plans/photo-highlight.md): Tesseract -> phrase adapter -> rows;
 * a box only when one OCR row carries the reader's name and value.
 *
 *   BW_ROOT=<checkout with data> npx tsx tests/bench/highlight/arm_t.ts
 *
 * Reads $RESULTS/ocr/, writes $RESULTS/pred/T/<photo id>.<orig|flat>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { matchRows, ocrRows, type OcrRow, type OcrWord } from "./adapter";
import { RESULTS, loadTransforms, readerRows, views, type View } from "./common";

export type Pred = Array<{ view: string; box: [number, number, number, number] } | null>;

export function ocrRowsFor(v: View): OcrRow[] {
  const o = JSON.parse(readFileSync(join(RESULTS, "ocr", `${v.id}.json`), "utf8")) as { words: OcrWord[] };
  return ocrRows(o.words);
}

function main() {
  const t = loadTransforms();
  const dir = join(RESULTS, "pred", "T");
  mkdirSync(dir, { recursive: true });
  const groups = new Map<string, View[]>();
  for (const v of views(t)) {
    const k = `${v.photo.replace(/\.jpg$/, "")}.${v.variant}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  for (const [k, vs] of groups) {
    const reads = readerRows(vs[0].photo);
    // A two-page flat photo is two images; the search runs over both at once,
    // so a row found on both is ambiguous and gets nothing.
    const all: Array<{ view: string; row: OcrRow }> = vs.flatMap((v) => ocrRowsFor(v).map((row) => ({ view: v.id, row })));
    const idx = matchRows(reads, all.map((a) => a.row));
    const pred: Pred = idx.map((i) => (i < 0 ? null : { view: all[i].view, box: all[i].row.box }));
    writeFileSync(join(dir, `${k}.json`), JSON.stringify(pred));
  }
  console.log(`arm T: ${groups.size} photo views -> ${dir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
