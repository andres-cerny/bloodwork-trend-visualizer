/**
 * Calibrate the photo checks (docs/plans/photo-capture.md, A4 + B) on the
 * whole corpus. Free: no model call, nothing leaves the machine.
 *
 *   npx vite-node tests/bench/photo_checks.ts            # table
 *   PHOTO_CHECKS_DUMP=1 npx vite-node tests/bench/photo_checks.ts   # + metrics JSONL
 *
 * The rule it enforces, from the plan: **no photo the readers read in full is
 * refused**; warn fires on as many as possible of the ones they did not. A
 * refused photo whose `readersFull` is true fails the run (exit 1).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assessPhoto, findPage, lumaFromRgba, measurePhoto, withPageChecks } from "../../packages/lab-core/src/photo";
import { decodeForChecks, loadCorpus, MAIN } from "./photo_corpus";

const corpus = loadCorpus();
const rows: any[] = [];
for (const p of corpus) {
  const d = await decodeForChecks(p.path);
  const grey = lumaFromRgba(d.rgba, d.width, d.height);
  const t0 = performance.now();
  const metrics = measurePhoto(grey, d.longEdge);
  const ms = performance.now() - t0;
  // The page check too (C2): a sheet running off the frame warns. The
  // lab-sheet score needs OCR and is calibrated in photo_ocr_score.ts.
  const verdict = withPageChecks(assessPhoto(metrics), findPage(grey), null);
  rows.push({ id: p.id, set: p.set, condition: p.condition, expected: p.expected, readersFull: p.readersFull, ms, metrics, ...verdict });
}

if (process.env.PHOTO_CHECKS_DUMP) {
  const dir = join(MAIN, "tests/bench/results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "photo_checks.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const by = new Map<string, any[]>();
for (const r of rows) by.set(`${r.set}/${r.condition}`, [...(by.get(`${r.set}/${r.condition}`) ?? []), r]);
console.log("condition            n  expected   ok warn refuse  match  reasons");
let failures = 0;
for (const [k, rs] of by) {
  const n = (o: string) => rs.filter((r) => r.outcome === o).length;
  const match = rs.filter((r) => r.outcome === r.expected).length;
  const reasons: Record<string, number> = {};
  for (const r of rs) for (const why of r.reasons) reasons[why] = (reasons[why] ?? 0) + 1;
  console.log(
    `${k.padEnd(20)} ${String(rs.length).padStart(2)}  ${rs[0].expected.padEnd(8)} ${String(n("ok")).padStart(4)} ${String(n("warn")).padStart(4)} ${String(n("refuse")).padStart(6)}  ${String(match).padStart(2)}/${rs.length}  ${JSON.stringify(reasons)}`,
  );
  failures += rs.filter((r) => r.outcome === "refuse" && r.readersFull).length;
}
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(`measure: median ${ms[ms.length >> 1].toFixed(1)} ms, max ${ms[ms.length - 1].toFixed(1)} ms (node, M-series)`);
console.log(failures ? `FAIL: ${failures} refused photo(s) the readers read in full` : "rule holds: no fully read photo refused");
process.exit(failures ? 1 : 0);
