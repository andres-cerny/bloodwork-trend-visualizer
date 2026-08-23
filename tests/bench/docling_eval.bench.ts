/**
 * Scores arm A7 (Docling) against the same baseline as every other arm.
 *
 *   npm run bench:docling      (after bench/docling_arm.py has run)
 *
 * Docling returns *text*, not indices, so unlike the column-map arm its values
 * can be fabricated in principle — and `fabrications` is checked here for the
 * same reason it is checked everywhere else. In practice a layout parser reads
 * cells out of the file, so a non-zero count would mean the row was assembled
 * wrongly rather than invented.
 */
import { existsSync, readFileSync } from "node:fs";
import { it } from "vitest";
import { parsePdf, realSamples } from "./corpus";
import { fabrications, loadBaseline, rangeIntegrity, scoreAgainstBaseline, type RawMeasurement } from "./score";

const FILE = "bench/results/docling.json";

it("A7 — Docling scored against the baseline", async () => {
  if (!existsSync(FILE)) {
    console.log(`${FILE} missing — run: .venv-mac/bin/python bench/docling_arm.py`);
    return;
  }
  const byPage = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, RawMeasurement[]>;
  const baseline = loadBaseline();

  // Rows are needed only for the fabrication check.
  const rowsFor = new Map<string, any[]>();
  for (const path of realSamples()) {
    const { doc } = await parsePdf(path);
    for (const p of doc.pages) rowsFor.set(`${doc.file}#${p.pageNum}`, p.rows);
  }

  let bRows = 0, aRows = 0, matched = 0, missing = 0, extra = 0;
  let valΔ = 0, unitΔ = 0, rangeΔ = 0, fab = 0, collapsed = 0;
  const worst: Array<{ page: string; miss: number }> = [];

  console.log("page".padEnd(26) + "rows".padStart(6) + "base".padStart(6) +
    "match".padStart(7) + "miss".padStart(6) + "extra".padStart(7) + "valΔ".padStart(6));

  for (const [key, base] of baseline) {
    const arm = byPage[key] ?? [];
    const rows = rowsFor.get(key) ?? [];
    const s = scoreAgainstBaseline(base, arm);
    const f = fabrications(arm, rows);
    const integ = rangeIntegrity(base, arm);
    bRows += s.baselineRows; aRows += s.armRows; matched += s.matched;
    missing += s.missing.length; extra += s.extra.length;
    valΔ += s.valueMismatch.length; unitΔ += s.unitMismatch.length;
    rangeΔ += s.rangeMismatch.length; fab += f.length; collapsed += integ.collapsed.length;
    worst.push({ page: key, miss: s.missing.length });
    console.log(key.padEnd(26) + String(s.armRows).padStart(6) + String(s.baselineRows).padStart(6) +
      String(s.matched).padStart(7) + String(s.missing.length).padStart(6) +
      String(s.extra.length).padStart(7) + String(s.valueMismatch.length).padStart(6));
  }

  console.log("\n" + "TOTAL".padEnd(26) + String(aRows).padStart(6) + String(bRows).padStart(6) +
    String(matched).padStart(7) + String(missing).padStart(6) + String(extra).padStart(7) +
    String(valΔ).padStart(6));
  console.log(`\n  recall ${(matched / bRows * 100).toFixed(0)}% of baseline rows`);
  console.log(`  unitΔ ${unitΔ}   rangeΔ ${rangeΔ}   fabrications ${fab}   collapsed ranges ${collapsed}`);
});
