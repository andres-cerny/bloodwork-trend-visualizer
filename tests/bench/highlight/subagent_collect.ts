/**
 * Subagent answers -> pred files for arms C and M (see subagent_dump.ts).
 *
 *   BW_ROOT=<checkout with data> npx tsx tests/bench/highlight/subagent_collect.ts
 *
 * C: box_2d [ymin, xmin, ymax, xmax] on 0-1000 -> pixels of the view it was asked on.
 * M: mark -> the OCR row box that mark was drawn around.
 * A flattened two-page photo is two images: a row boxed on both is ambiguous
 * and gets nothing, the same rule arm T applies. A missing or unparseable
 * answer leaves the photo out of the arm (it is reported, never scored as
 * "no box").
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RESULTS, readerRows } from "./common";
import type { Box } from "./geometry";

type Pred = Array<{ view: string; box: Box } | null>;

function parse(path: string): Array<Record<string, unknown>> | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : null;
  } catch {
    return null;
  }
}

for (const arm of ["C", "M"] as const) {
  const base = join(RESULTS, "subagent", arm);
  if (!existsSync(base)) continue;
  const groups = new Map<string, Array<{ id: string; dir: string; size: [number, number]; photo: string }>>();
  for (const d of readdirSync(base)) {
    const view = JSON.parse(readFileSync(join(base, d, "view.json"), "utf8"));
    const k = `${view.photo.replace(/\.jpg$/, "")}.${view.variant}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push({ id: view.id, dir: join(base, d), size: view.size, photo: view.photo });
  }
  const out = join(RESULTS, "pred", arm);
  mkdirSync(out, { recursive: true });
  const missing: string[] = [];
  let n = 0;
  for (const [k, vs] of groups) {
    const reads = readerRows(vs[0].photo);
    const per: Pred[] = [];
    let ok = true;
    for (const v of vs) {
      const ans = parse(join(v.dir, "answer.json"));
      if (!ans) {
        ok = false;
        missing.push(`${v.id}`);
        break;
      }
      const marks = arm === "M" ? (JSON.parse(readFileSync(join(v.dir, "marks.json"), "utf8")) as Record<string, Box>) : {};
      const pred: Pred = reads.map(() => null);
      for (const a of ans) {
        const i = Number(a.i);
        if (!Number.isInteger(i) || i < 0 || i >= reads.length) continue;
        if (arm === "C") {
          const b = a.box_2d as number[] | null;
          if (!Array.isArray(b) || b.length !== 4 || b.some((x) => typeof x !== "number")) continue;
          const [ymin, xmin, ymax, xmax] = b;
          const [W, H] = v.size;
          pred[i] = { view: v.id, box: [(xmin / 1000) * W, (ymin / 1000) * H, (xmax / 1000) * W, (ymax / 1000) * H] };
        } else {
          const m = a.mark;
          if (typeof m !== "number" || !marks[String(m)]) continue;
          pred[i] = { view: v.id, box: marks[String(m)] };
        }
      }
      per.push(pred);
    }
    if (!ok) continue;
    const merged: Pred = reads.map((_, i) => {
      const hits = per.map((p) => p[i]).filter(Boolean);
      return hits.length === 1 ? hits[0] : null;
    });
    writeFileSync(join(out, `${k}.json`), JSON.stringify(merged));
    n++;
  }
  console.log(`arm ${arm}: ${n} photo views collected; missing or unparseable answers: ${missing.length ? missing.join(", ") : "none"}`);
}
