/**
 * H9, free: could the text reader point at cells instead of re-typing them?
 *
 * Over stored text-path reads (bench:adapt synthetic pages, portal_text's Stod
 * pages): for each returned field, is it exactly one cell — or 2-3 adjacent
 * cells joined — of the row its `row_index` names? Where it is, a schema that
 * returns cell indices would rebuild the same string from the page, and the
 * model would stop writing it. Also estimates the output it would save.
 * docs/plans/model-loop.md, round 3.
 *
 *   PYTHON_BIN=.venv/bin/python npx vite-node --root . tests/bench/cell_index_check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TextRow } from "@bw/lab-core";

import { loadClass, PUBLIC_PDF_DIR } from "./corpora";
import { parsePdf } from "./corpus";

const R = dirname(fileURLToPath(import.meta.url));
const clean = (s: string) => (s ?? "").replace(/\s+/g, "");

/** How a field sits in its row: one cell, joined adjacent cells, a split cell, or not at all. */
function locate(field: string, row: TextRow | undefined): "empty" | "cell" | "joined" | "inside" | "elsewhere" {
  const f = clean(field);
  if (!f) return "empty";
  if (!row) return "elsewhere";
  const cells = row.cells.map(clean);
  if (cells.includes(f)) return "cell";
  for (let i = 0; i < cells.length; i++) {
    let j = cells[i];
    for (let k = i + 1; k < Math.min(cells.length, i + 4); k++) {
      j += cells[k];
      if (j === f) return "joined";
    }
  }
  if (cells.some((c) => c.includes(f))) return "inside";
  return "elsewhere";
}

const pages: Array<{ slug: string; rows: TextRow[]; dir: string }> = [];
for (const p of await loadClass("synthetic")) if (p.kind === "text" && p.rows) pages.push({ slug: p.slug, rows: p.rows, dir: "adapt" });
const stod = join(PUBLIC_PDF_DIR, "fetched/stod_p_loha_2_vzor_v_sledkov_ho_listu_f214.pdf");
if (existsSync(stod)) {
  const { doc } = await parsePdf(stod);
  for (const pg of doc.pages) if (pg.hasTextLayer && pg.pageNum <= 4) pages.push({ slug: `stod_p${pg.pageNum}`, rows: pg.rows, dir: "portal_text" });
}

for (const arm of ["sonnet5", "haiku45", "sonnet55", "haiku55"]) {
  const tally: Record<string, Record<string, number>> = {};
  let chars = 0, rowsN = 0;
  const odd: string[] = [];
  for (const p of pages) {
    const f = join(R, "results", p.dir, arm, `${p.slug}.json`);
    if (!existsSync(f)) continue;
    const j = JSON.parse(readFileSync(f, "utf8"));
    const ms = j.call ? j.call.extraction?.measurements ?? [] : j.measurements ?? [];
    for (const m of ms) {
      rowsN++;
      const row = p.rows[m.row_index];
      for (const field of ["raw_analyte_name", "value_raw", "unit_raw", "ref_range_raw"]) {
        const where = locate(m[field] ?? "", row);
        (tally[field] ??= {})[where] = ((tally[field] ??= {})[where] ?? 0) + 1;
        if (field !== "raw_analyte_name") chars += (m[field] ?? "").length;
        if ((where === "elsewhere" || where === "inside") && field !== "raw_analyte_name" && odd.length < 6) odd.push(`${p.slug} r${m.row_index} ${field}="${m[field]}" cells=${JSON.stringify(row?.cells)}`);
      }
    }
  }
  if (!rowsN) continue;
  console.log(`\n== ${arm}: ${rowsN} rows; value+unit+range typed = ${chars} chars (~${Math.round(chars / 3)} tokens) that indices would replace`);
  for (const [field, t] of Object.entries(tally)) console.log(`  ${field.padEnd(17)} ${JSON.stringify(t)}`);
  for (const o of odd) console.log("   ", o);
}
