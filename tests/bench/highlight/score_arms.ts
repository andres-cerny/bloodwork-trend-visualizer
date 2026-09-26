/**
 * The table (docs/plans/photo-highlight.md, Order step 6): arm x condition x
 * {wrong, coverage}. Never averaged; `wrong` is the column that decides.
 *
 *   BW_ROOT=<checkout with data> npx tsx tests/bench/highlight/score_arms.ts [arm ...] [--only=<photo,...>] [--pair=A+B]
 *
 * Reads $RESULTS/truth.json and $RESULTS/pred/<arm>/<photo id>.<orig|flat>.json
 * (index-aligned with the reader's rows: null or { view, box }). A pred file
 * that does not exist is skipped, so an arm run on a subset scores that subset.
 * `--only` restricts every arm to the same photos, for a like-for-like table.
 * `--pair=A+B` adds arm V: a box only where A and B both give one and both are
 * judged to sit on the same printed row as each other (A's box is kept).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RESULTS, loadTransforms, views, type View } from "./common";
import { judge, mapBox, pointInConvex, type Box, type Quad } from "./geometry";
import type { PhotoTruth } from "./truth";

type Pred = Array<{ view: string; box: Box } | null>;

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const pairs = args.filter((a) => a.startsWith("--pair=")).map((a) => a.slice(7).split("+") as [string, string]);
const arms = args.filter((a) => !a.startsWith("--"));
if (!arms.length) arms.push("T");

const truth: Record<string, PhotoTruth> = JSON.parse(readFileSync(join(RESULTS, "truth.json"), "utf8"));
const allViews = views(loadTransforms());
const viewById = new Map<string, View>();
for (const v of allViews) viewById.set(`${v.id}|${v.variant}`, v);

/** Every printed row on a view, as quads in its pixels, tagged with page and row index. */
function viewRows(v: View): Array<{ page: number; row: number; quad: Quad }> {
  const t = truth[v.photo];
  return v.pages.flatMap((vp) => {
    const pt = t.pages.find((p) => p.page === vp.page)!;
    return pt.rows.map((r, row) => ({ page: vp.page, row, quad: mapBox(vp.H, r.box) }));
  });
}

interface Cell {
  rows: number;
  right: number;
  wrong: number;
  wrongStrict: number;
  photos: Set<string>;
  cases: string[];
}
const cells = new Map<string, Cell>();
const cell = (k: string) => {
  if (!cells.has(k)) cells.set(k, { rows: 0, right: 0, wrong: 0, wrongStrict: 0, photos: new Set(), cases: [] });
  return cells.get(k)!;
};

function loadPred(arm: string, photo: string, variant: string): Pred | null {
  const f = join(RESULTS, "pred", arm, `${photo.replace(/\.jpg$/, "")}.${variant}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  // flat/dark/glare/crop: the flattened view is the original image, so an arm
  // asked once (on the original) has answered for both.
  const geo = ["angle", "twopage"].includes(truth[photo]?.condition ?? "");
  if (variant === "flat" && !geo) return loadPred(arm, photo, "orig");
  return null;
}

/** Which printed row (global index into viewRows) a box's centre sits on, or -1. */
function centreRowOf(v: View, box: Box): number {
  const c: [number, number] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  return viewRows(v).findIndex((r) => pointInConvex(c, r.quad));
}

function score(arm: string, getPred: (photo: string, variant: string) => Pred | null) {
  for (const [photo, t] of Object.entries(truth)) {
    if (only && !only.some((o) => photo.startsWith(o))) continue;
    for (const variant of ["orig", "flat"] as const) {
      const pred = getPred(photo, variant);
      if (!pred) continue;
      const c = cell(`${arm}|${t.condition}|${variant}`);
      c.photos.add(photo);
      t.readerTruth.forEach((tr, i) => {
        if (!tr) return;
        c.rows++;
        const p = pred[i];
        if (!p) return;
        const v = viewById.get(`${p.view}|${variant}`);
        if (!v) throw new Error(`unknown view ${p.view} ${variant}`);
        const rows = viewRows(v);
        const ti = rows.findIndex((r) => r.page === tr.page && r.row === tr.row);
        if (ti < 0) {
          c.wrong++;
          c.wrongStrict++;
          c.cases.push(`${photo} ${variant} row#${i}: truth page not on this view`);
          return;
        }
        const verdict = judge(p.box, ti, rows.map((r) => r.quad));
        if (verdict.rightStrict) c.right++;
        if (!verdict.right) c.wrong++;
        if (!verdict.rightStrict) {
          c.wrongStrict++;
          c.cases.push(`${photo} ${variant} row#${i}: ${verdict.why}`);
        }
      });
    }
  }
}

for (const arm of arms) score(arm, (photo, variant) => loadPred(arm, photo, variant));
for (const [a, b] of pairs) {
  score(`V(${a}+${b})`, (photo, variant) => {
    const pa = loadPred(a, photo, variant);
    const pb = loadPred(b, photo, variant);
    if (!pa || !pb) return null;
    return pa.map((x, i) => {
      const y = pb[i];
      if (!x || !y || x.view !== y.view) return null;
      const v = viewById.get(`${x.view}|${variant}`)!;
      const ra = centreRowOf(v, x.box);
      const rb = centreRowOf(v, y.box);
      // The two arms agree when their centres land on the same printed row —
      // judged on the image, which the app can do with the OCR rows alone.
      return ra >= 0 && ra === rb ? x : null;
    });
  });
}

const order = ["flat", "dark", "glare", "crop", "angle", "twopage"];
const lines: string[] = [];
const allArms = [...arms, ...pairs.map(([a, b]) => `V(${a}+${b})`)];
lines.push(`| arm | condition | view | photos | rows | wrong (plan) | wrong (strict) | right | coverage |`);
lines.push(`|---|---|---|---|---|---|---|---|---|`);
for (const arm of allArms) {
  const tot = { rows: 0, right: 0, wrong: 0, wrongStrict: 0 };
  for (const variant of ["orig", "flat"]) {
    for (const cond of order) {
      const c = cells.get(`${arm}|${cond}|${variant}`);
      if (!c) continue;
      // flat/dark/glare/crop have no geometry: the flat view is the same image,
      // so it is shown once (under orig) and not double-counted in the total.
      const same = variant === "flat" && !["angle", "twopage"].includes(cond);
      if (same) continue;
      lines.push(
        `| ${arm} | ${cond} | ${variant} | ${c.photos.size} | ${c.rows} | ${c.wrong} | ${c.wrongStrict} | ${c.right} | ${((100 * c.right) / Math.max(c.rows, 1)).toFixed(1)} % |`,
      );
      if (variant === "orig" || ["angle", "twopage"].includes(cond)) {
        // Totals: "orig" = every photo as shot; "flat" = angle/twopage flattened, others as shot.
      }
    }
  }
  for (const variant of ["orig", "flat"]) {
    const t2 = { rows: 0, right: 0, wrong: 0, wrongStrict: 0 };
    for (const cond of order) {
      const c = cells.get(`${arm}|${cond}|${variant}`);
      if (!c) continue;
      t2.rows += c.rows;
      t2.right += c.right;
      t2.wrong += c.wrong;
      t2.wrongStrict += c.wrongStrict;
    }
    if (t2.rows)
      lines.push(
        `| **${arm}** | **all** | ${variant} | | ${t2.rows} | **${t2.wrong}** | **${t2.wrongStrict}** | ${t2.right} | **${((100 * t2.right) / t2.rows).toFixed(1)} %** |`,
      );
  }
  void tot;
}
console.log(lines.join("\n"));
const cases: Record<string, string[]> = {};
for (const [k, c] of cells) if (c.cases.length) cases[k] = c.cases;
writeFileSync(join(RESULTS, `score_${allArms.join("_").replace(/[^A-Za-z0-9_+]/g, "")}${only ? "_subset" : ""}.json`), JSON.stringify({ table: lines, cases }, null, 1));
for (const [k, cs] of Object.entries(cases)) console.log(`${k}: ${cs.length} wrong(strict) — ${cs.slice(0, 4).join("; ")}`);
