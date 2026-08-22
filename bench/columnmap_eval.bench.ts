/**
 * Scores a column map that was produced elsewhere — free, no API call.
 *
 *   npm run bench:colmap
 *
 * `rebuild()` reads every character out of the client's own `rows` array, so
 * this measures exactly what the demo would show if it adopted arm A9: not
 * what a model *said*, but what the page would actually render.
 *
 * Reads bench/results/subagent_colmap.json — whatever produced that file (a
 * subagent, a paid API run, a hand-written map) is scored the same way.
 */
import { existsSync, readFileSync } from "node:fs";

import { it } from "vitest";

import { parsePdf } from "./corpus";
import { rebuild, type ColumnMap } from "./columnmap";
import { fabrications, loadBaseline, rangeIntegrity, scoreAgainstBaseline } from "./score";

const MAP_FILE = "bench/results/subagent_colmap.json";

it("column map — what the page would actually render", async () => {
  if (!existsSync(MAP_FILE)) {
    console.log(`${MAP_FILE} not present — nothing to score`);
    return;
  }
  const maps = JSON.parse(readFileSync(MAP_FILE, "utf8")) as Record<string, ColumnMap>;
  const baseline = loadBaseline();

  for (const [key, map] of Object.entries(maps)) {
    const [file, pageStr] = key.split("#");
    const { doc } = await parsePdf(`samples/${file}`);
    const page = doc.pages.find((p) => p.pageNum === parseInt(pageStr, 10))!;

    const arm = rebuild(map, page.rows);
    const base = baseline.get(key) ?? [];
    const score = scoreAgainstBaseline(base, arm);
    const fab = fabrications(arm, page.rows);
    const integ = rangeIntegrity(base, arm);
    const lowConf = arm.filter((m) => m.confidence === "low").length;

    console.log(`\n=== ${key} ===`);
    console.log(
      `  rows returned   ${arm.length}   (baseline ${base.length})\n` +
        `  overrides       ${map.overrides?.length ?? 0} of ${map.measurement_rows.length} rows ` +
        `(${(((map.overrides?.length ?? 0) / map.measurement_rows.length) * 100).toFixed(0)}% ragged)\n` +
        `  matched         ${score.matched}\n` +
        `  missing         ${score.missing.length}\n` +
        `  extra           ${score.extra.length}\n` +
        `  value  Δ        ${score.valueMismatch.length}\n` +
        `  unit   Δ        ${score.unitMismatch.length}\n` +
        `  range  Δ        ${score.rangeMismatch.length}\n` +
        `  fabrications    ${fab.length}   <- structurally impossible; non-zero means a bug\n` +
        `  collapsed range ${integ.collapsed.length}\n` +
        `  de-censored     ${integ.decensored.length}\n` +
        `  flagged low     ${lowConf}  (derived, would land in "jen sporné řádky")`,
    );

    if (score.valueMismatch.length) {
      console.log("\n  value disagreements (baseline -> column map):");
      for (const m of score.valueMismatch.slice(0, 12)) {
        console.log(`    ${m.name.slice(0, 28).padEnd(30)} "${m.baseline}"  ->  "${m.arm}"`);
      }
      if (score.valueMismatch.length > 12) console.log(`    ... ${score.valueMismatch.length - 12} more`);
    }
    if (score.missing.length) {
      console.log(`\n  rows the map did not return: ${score.missing.slice(0, 12).join(", ")}` +
        (score.missing.length > 12 ? ` ... +${score.missing.length - 12}` : ""));
    }
    if (score.extra.length) {
      console.log(`\n  rows returned that the baseline does not have: ` +
        `${score.extra.slice(0, 12).join(", ")}` +
        (score.extra.length > 12 ? ` ... +${score.extra.length - 12}` : ""));
    }
  }
});
