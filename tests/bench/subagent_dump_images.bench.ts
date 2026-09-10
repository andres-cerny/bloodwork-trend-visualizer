/**
 * Subagent benchmark for the image classes, step 1 — dump each page as the
 * vision model would see it.
 *
 *   PYTHON_BIN=<venv>/bin/python npx vitest run --config tests/bench/vitest.config.ts tests/bench/subagent_dump_images.bench.ts
 *
 * Tier 1 of docs/plans/lab-adaptability.md Phase C: Claude arms run as
 * subagents, not on the API. For the synthetic, public and photo classes
 * (BENCH_CLASSES to narrow, `real` allowed for the scanned pages) this
 * writes, under results/subagent/<class>/:
 *
 *   pages/<slug>.png         the 220 DPI render (photos: the 2576 px Claude
 *                            tier as .claude.jpg — what the app would send)
 *   pages/<slug>.rows.txt    the text layer as a hint, where one exists
 *   prompts/system_vision.txt  SYSTEM_EXTRACT, imported, verbatim
 *   prompts/tool_vision.json   TOOL, imported, verbatim
 *   index.json               slug, key, image path, truth rows, condition
 *
 * A subagent standing in for a reader is given the system prompt, the tool
 * schema and the image path, reads the image, and writes the tool input JSON
 * to results/subagent/<class>/out/<variant>/<slug>.json. Step 2
 * (subagent_score_images.bench.ts) scores those against the truth with
 * `valueErrors` and every pair of variants with `pairStats`.
 *
 * Everything written derives from git-ignored PDFs and photos and lands under
 * the git-ignored results/ directory.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { SYSTEM_EXTRACT, TOOL } from "@bw/extraction";
import { rowsAsText } from "@bw/lab-core";

import { loadClass, pythonWithFitz, renderFor, type CorpusClass } from "./corpora";

const BASE = "tests/bench/results/subagent";
const DEFAULT: CorpusClass[] = ["synthetic", "public", "photo"];

it("subagent bench (images) — dump renders, prompts and truth per class", async () => {
  const classes = ((process.env.BENCH_CLASSES ?? "").split(",").map((s) => s.trim()).filter(Boolean) as CorpusClass[]);
  const python = pythonWithFitz();
  if (!python) throw new Error("no Python with PyMuPDF — set PYTHON_BIN to the scratch venv's python");

  for (const cls of classes.length ? classes : DEFAULT) {
    const dir = join(BASE, cls);
    mkdirSync(join(dir, "pages"), { recursive: true });
    mkdirSync(join(dir, "prompts"), { recursive: true });
    mkdirSync(join(dir, "out"), { recursive: true });
    writeFileSync(join(dir, "prompts", "system_vision.txt"), SYSTEM_EXTRACT);
    writeFileSync(join(dir, "prompts", "tool_vision.json"), JSON.stringify(TOOL, null, 1));

    const index: any[] = [];
    for (const page of await loadClass(cls)) {
      if (page.meta.available === false) {
        console.log(`${cls}/${page.slug}: source missing, skipped`);
        continue;
      }
      let image: string;
      try {
        image = renderFor(page, "anthropic", join(dir, "pages"), python).path;
      } catch (e: any) {
        console.log(`${cls}/${page.slug}: render failed — ${e?.message ?? e}`);
        continue;
      }
      if (page.rows) writeFileSync(join(dir, "pages", `${page.slug}.rows.txt`), rowsAsText(page.rows));
      index.push({
        slug: page.slug,
        key: page.key,
        kind: page.kind,
        image,
        rowsHint: page.rows ? join(dir, "pages", `${page.slug}.rows.txt`) : null,
        truth: page.truth,
        truthSource: page.truthSource,
        meta: page.meta,
      });
      console.log(`${cls.padEnd(10)} ${page.slug.padEnd(40)} truth=${String(page.truth?.length ?? "-").padStart(3)}  ${image}`);
    }
    writeFileSync(join(dir, "index.json"), JSON.stringify(index, null, 1));
    console.log(`\nwrote ${dir}/index.json (${index.length} pages); prompts in ${dir}/prompts; subagent outputs go to ${dir}/out/<variant>/<slug>.json\n`);
  }
});
