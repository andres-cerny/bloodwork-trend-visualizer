/**
 * Subagent benchmark, step 1 — dump every page's model input to disk.
 *
 *   npx vitest run --config tests/bench/vitest.config.ts tests/bench/subagent_dump.bench.ts
 *
 * The reads themselves are then done by spawned subagents (no API spend),
 * each given exactly the prompt the worker sends and one page's rows, and
 * writing the tool input JSON back into results/subagent/out/<variant>/.
 * Step 2 (subagent_score.bench.ts) scores those files.
 *
 * Also computes the deterministic checks this benchmark exists to evaluate:
 *   - candidate rows: rows that look like a measurement (a value and a unit or
 *     a range), the set an "unclaimed row" completeness check would consult;
 *   - qualitative rows: an analyte-like name with a non-numeric result;
 *   - empty pages: no candidates at all, so a model call could be skipped.
 *
 * Everything written is derived from real lab PDFs and lands under the
 * gitignored results/ directory.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { it } from "vitest";

import { rowsAsText } from "@bw/lab-core";

import { candidateRows, NUM } from "./candidates";
import { SYSTEM_EXTRACT, SYSTEM_EXTRACT_TEXT, TOOL } from "@bw/extraction";

import { parsePdf, realSamples } from "./corpus";
import { loadBaseline } from "./score";

const OUT = "tests/bench/results/subagent";

it("subagent bench — dump page inputs and deterministic checks", async () => {
  mkdirSync(`${OUT}/pages`, { recursive: true });
  mkdirSync(`${OUT}/prompts`, { recursive: true });
  const baseline = loadBaseline();

  const index: any[] = [];
  for (const path of realSamples()) {
    const { doc } = await parsePdf(path);
    for (const p of doc.pages) {
      const key = `${p.file}#${p.pageNum}`;
      const slug = `${p.file.replace(/\.pdf$/, "")}__p${p.pageNum}`;
      const cands = candidateRows(p.rows);
      const base = baseline.get(key) ?? [];
      if (p.hasTextLayer) {
        writeFileSync(`${OUT}/pages/${slug}.rows.txt`, rowsAsText(p.rows));
        writeFileSync(`${OUT}/pages/${slug}.rows.json`, JSON.stringify(p.rows));
      }
      index.push({
        key,
        slug,
        file: p.file,
        pageNum: p.pageNum,
        hasTextLayer: p.hasTextLayer,
        hasImage: p.hasImage,
        rowCount: p.rows.length,
        textLength: p.textLength,
        candidates: cands,
        numericCandidates: cands.filter((c) => c.kind === "numeric").length,
        qualitativeCandidates: cands.filter((c) => c.kind === "qualitative").length,
        baselineRows: base.length,
        baselineQualitative: base.filter((m) => !NUM.test((m.value_raw ?? "").trim())).length,
      });
      console.log(
        `${key.padEnd(26)} text=${p.hasTextLayer ? "y" : "n"} img=${p.hasImage ? "y" : "n"} ` +
          `rows=${String(p.rows.length).padStart(3)} cand=${String(cands.length).padStart(3)} ` +
          `base=${String(base.length).padStart(3)}`,
      );
    }
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));

  // The exact prompts the worker sends, for the subagents to follow.
  const toolText = JSON.parse(JSON.stringify(TOOL)) as any;
  const item = toolText.input_schema.properties.measurements.items;
  delete item.properties.source_snippet;
  item.required = item.required.filter((k: string) => k !== "source_snippet");
  item.properties.row_index = {
    type: "integer",
    description: "Pořadové číslo řádku vstupu, ze kterého tento výsledek pochází.",
  };
  item.required.push("row_index");

  const toolNoName = JSON.parse(JSON.stringify(toolText)) as any;
  delete toolNoName.input_schema.properties.measurements.items.properties.raw_analyte_name;
  toolNoName.input_schema.properties.measurements.items.required =
    toolNoName.input_schema.properties.measurements.items.required.filter((k: string) => k !== "raw_analyte_name");

  writeFileSync(`${OUT}/prompts/system_text.txt`, SYSTEM_EXTRACT_TEXT);
  writeFileSync(
    `${OUT}/prompts/system_text_noname.txt`,
    SYSTEM_EXTRACT_TEXT +
      " Název analytu NEVRACEJ — klient si ho vezme z řádku podle 'row_index'. Vracej jen hodnotu, jednotku, referenční interval, row_index a confidence.",
  );
  writeFileSync(`${OUT}/prompts/system_vision.txt`, SYSTEM_EXTRACT);
  writeFileSync(`${OUT}/prompts/tool_text.json`, JSON.stringify(toolText, null, 1));
  writeFileSync(`${OUT}/prompts/tool_text_noname.json`, JSON.stringify(toolNoName, null, 1));
  writeFileSync(`${OUT}/prompts/tool_vision.json`, JSON.stringify(TOOL, null, 1));
  console.log(`\nwrote ${OUT}/index.json and ${index.filter((p) => p.hasTextLayer).length} text-layer pages`);
});
