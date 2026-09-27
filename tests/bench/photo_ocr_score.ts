/**
 * Score `photo_ocr.ts` output (docs/plans/photo-capture.md, C3 and D4). Free.
 *
 *   BW_MAIN=<checkout with data> npx vite-node tests/bench/photo_ocr_score.ts [variant ...]
 *
 * Variants default to `orig flat`. Any other name is a directory beside them
 * (e.g. `oracle`: the photo-highlight bench's OCR of the simulator's own
 * inverse transform, converted) and falls back to `orig` where it has no file.
 *
 * 1. Identity recall, per condition, `orig` against `flat`. Truth is
 *    `findIdentity` on the source PDF's own text layer, for the pages the photo
 *    shows — the experiment's ground truth. A truth item counts as found when a
 *    hit on the photo matches it in any spelling `identityVariants` knows. A hit
 *    matching no truth item is a false hit. The photo side is exactly what the
 *    portal runs: `ocrPhrases` → `findIdentity`.
 * 2. The lab-sheet score on every photo, from the last variant named (the
 *    portal computes it on `flatlit`), by set, against `LAB_SHEET_MIN`.
 *
 * Prints counts only — never identity text.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findIdentity, fold, identityVariants, type PageWords } from "../../packages/lab-core/src/redact";
import { labSheetScore, LAB_SHEET_MIN, ocrPhrases, type OcrLine } from "../../packages/lab-core/src/photoOcr";
import { loadCorpus, MAIN } from "./photo_corpus";

const OCR = join(MAIN, "tests/bench/results/photo_ocr");
const slugOf = (id: string) => id.replace(/[/.]/g, "_");
const norm = (s: string) => fold(s).replace(/\s+/g, " ").trim();
const vset = (s: string) => new Set([norm(s), ...identityVariants(s).map(norm)]);

const VARIANTS = process.argv.slice(2).length ? process.argv.slice(2) : ["orig", "flat"];

function readOcr(variant: string, id: string): { lines: OcrLine[]; ms: number } | null {
  const own = join(OCR, variant, `${slugOf(id)}.json`);
  if (existsSync(own)) return JSON.parse(readFileSync(own, "utf8"));
  // The finder left this photo alone: its flattened image is the original.
  if (variant !== "orig") return readOcr("orig", id);
  return null;
}

/* ------------------------------------------------------------ PDF truth */

const truthCache = new Map<string, Map<number, { kind: string; text: string }[]>>();
async function pdfTruth(file: string): Promise<Map<number, { kind: string; text: string }[]>> {
  if (truthCache.has(file)) return truthCache.get(file)!;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(MAIN, "samples", file))), verbosity: 0 }).promise;
  const pages: PageWords[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const words: PageWords["words"] = [];
    for (const it of (await page.getTextContent()).items as any[]) {
      const str: string = it.str ?? "";
      if (!str.trim()) continue;
      const [, , , , e, f] = it.transform;
      const w = it.width ?? str.length * 5, h = it.height ?? 10;
      const y0 = vp.height - f - h;
      words.push({ text: str, box: [e, y0, e + w, y0 + h] });
    }
    pages.push({ pageNum: p, words });
  }
  const { hits } = findIdentity(pages);
  const out = new Map<number, { kind: string; text: string }[]>();
  for (const p of pages) out.set(p.pageNum, hits.filter((h) => h.pageNum === p.pageNum).map((h) => ({ kind: h.kind, text: h.text })));
  truthCache.set(file, out);
  return out;
}

/* ------------------------------------------------------------ identity */

type Tally = { items: number; found: number; photos: number; allFound: number; falseHits: number; ms: number[] };
const tally = () => ({ items: 0, found: 0, photos: 0, allFound: 0, falseHits: 0, ms: [] }) as Tally;
const byCond = new Map<string, Record<string, Tally>>();
const corpus = loadCorpus();

for (const p of corpus) {
  if (!p.source_file || !p.pages?.length) continue;
  if (!existsSync(join(MAIN, "samples", p.source_file))) continue;
  const truthPages = await pdfTruth(p.source_file);
  const seen = new Set<string>();
  const items = p.pages.flatMap((n) => truthPages.get(n) ?? []).filter((t) => {
    const k = `${t.kind}|${norm(t.text)}`;
    return !seen.has(k) && (seen.add(k), true);
  });
  const t = byCond.get(p.condition) ?? Object.fromEntries(VARIANTS.map((v) => [v, tally()]));
  byCond.set(p.condition, t);
  for (const variant of VARIANTS) {
    const o = readOcr(variant, p.id);
    if (!o) continue;
    const { hits } = findIdentity([{ pageNum: 1, words: ocrPhrases(o.lines) }]);
    const hv = hits.map((h) => vset(h.text));
    const tv = items.map((it) => vset(it.text));
    const found = items.filter((it, i) => hits.some((h, j) => hv[j].has(norm(it.text)) || tv[i].has(norm(h.text))));
    const falseHits = hits.filter((h, j) => !items.some((it, i) => hv[j].has(norm(it.text)) || tv[i].has(norm(h.text))));
    const s = t[variant];
    s.items += items.length;
    s.found += found.length;
    s.falseHits += falseHits.length;
    s.ms.push(o.ms);
    if (items.length) {
      s.photos++;
      if (found.length === items.length) s.allFound++;
    }
  }
}

const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);
console.log("identity recall (items found / truth items; photos with every item; false hits)");
console.log(`condition      ${VARIANTS.map((v) => v.padEnd(29)).join("")}`);
const total: Record<string, Tally> = Object.fromEntries(VARIANTS.map((v) => [v, tally()]));
const f = (s: Tally) => `${String(s.found).padStart(3)}/${String(s.items).padEnd(3)} all ${String(s.allFound).padStart(2)}/${String(s.photos).padEnd(2)} fp ${String(s.falseHits).padStart(2)}   `;
for (const [c, t] of [...byCond].sort()) {
  console.log(`${c.padEnd(14)} ${VARIANTS.map((v) => f(t[v])).join("")}`);
  for (const v of VARIANTS) {
    for (const k of ["items", "found", "falseHits", "photos", "allFound"] as const) total[v][k] += t[v][k];
    total[v].ms.push(...t[v].ms);
  }
}
console.log(`total          ${VARIANTS.map((v) => f(total[v])).join("")}`);
console.log(`OCR ms/page (8 in parallel) median ${VARIANTS.map((v) => `${v} ${Math.round(med(total[v].ms))}`).join(", ")}`);

/* ------------------------------------------------------------ lab sheet */

console.log(`\nlab-sheet score (warn below ${LAB_SHEET_MIN}), OCR variant ${VARIANTS[VARIANTS.length - 1]}`);
const bySet = new Map<string, number[]>();
const low: string[] = [];
for (const p of corpus) {
  const o = readOcr(VARIANTS[VARIANTS.length - 1], p.id);
  if (!o) continue;
  const s = labSheetScore(o.lines.map((l) => l.words.map((w) => w.text).join(" ")));
  const key = p.set === "sim" || p.set === "public" ? p.set : p.set === "bad" ? `bad:${p.expected}` : "notlab";
  bySet.set(key, [...(bySet.get(key) ?? []), s.score]);
  // Only what the score is for: a readable photo of a lab sheet warned as not
  // one, or a non-lab picture passed. Photos the quality checks already warn
  // on or refuse (blur, motion, tiny, blown, micro, blanks) are not its job.
  const isLab = p.set !== "notlab" && p.condition !== "sheet";
  const judged = p.set === "notlab" || p.condition === "sheet" || p.expected === "ok";
  if (judged && isLab !== s.lab) low.push(`${p.id} (${p.condition}) score ${s.score.toFixed(1)} u${s.units} r${s.ranges} h${s.headers} v${s.valueRows}`);
}
for (const [k, xs] of [...bySet].sort()) {
  const s = [...xs].sort((a, b) => a - b);
  console.log(`${k.padEnd(12)} n ${String(s.length).padStart(3)}  min ${s[0].toFixed(1).padStart(5)}  median ${s[s.length >> 1].toFixed(1).padStart(5)}  max ${s[s.length - 1].toFixed(1).padStart(5)}  below ${s.filter((x) => x < LAB_SHEET_MIN).length}`);
}
console.log(`misjudged (${low.length}):\n  ${low.join("\n  ")}`);
