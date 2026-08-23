/**
 * Arm A10 evaluated over every real page — free, no API, no network.
 *
 *   npm run bench:x
 *
 * Scored against the same baseline and the same three columns as every paid
 * arm, so it is comparable rather than merely fast.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { parsePdf, realSamples } from "./corpus";
import { extractByX } from "./xcolumns";
import { fabrications, loadBaseline, rangeIntegrity, scoreAgainstBaseline } from "./score";

it("A10 — deterministic x-position columns, whole corpus", async () => {
  mkdirSync("bench/results", { recursive: true });
  const baseline = loadBaseline();
  const records: any[] = [];
  let totalMs = 0;

  console.log("page".padEnd(26) + "rows".padStart(6) + "base".padStart(6) +
    "match".padStart(7) + "miss".padStart(6) + "extra".padStart(7) +
    "valΔ".padStart(6) + "unitΔ".padStart(7) + "rangeΔ".padStart(8) +
    "fab".padStart(5) + "low".padStart(5) + "ms".padStart(7));

  for (const path of realSamples()) {
    const { doc } = await parsePdf(path);
    for (const page of doc.pages) {
      if (!page.hasTextLayer) continue;
      const key = `${doc.file}#${page.pageNum}`;
      const base = baseline.get(key) ?? [];
      if (!base.length) continue;
      const r = extractByX(page.rows);
      totalMs += r.ms;
      const s = scoreAgainstBaseline(base, r.measurements);
      const fab = fabrications(r.measurements, page.rows);
      const integ = rangeIntegrity(base, r.measurements);
      const low = r.measurements.filter((m) => m.confidence === "low").length;
      records.push({ stage: "A10", probe: key, ms: r.ms, armRows: s.armRows,
        baselineRows: s.baselineRows, matched: s.matched, missing: s.missing,
        extra: s.extra, valueMismatch: s.valueMismatch, unitMismatch: s.unitMismatch,
        rangeMismatch: s.rangeMismatch, fabrications: fab,
        collapsedRanges: integ.collapsed, decensored: integ.decensored, lowConfidence: low,
        columns: r.columns.map((c) => ({ x: Math.round(c.x), role: c.role, support: c.support })) });
      console.log(key.padEnd(26) + String(s.armRows).padStart(6) + String(s.baselineRows).padStart(6) +
        String(s.matched).padStart(7) + String(s.missing.length).padStart(6) +
        String(s.extra.length).padStart(7) + String(s.valueMismatch.length).padStart(6) +
        String(s.unitMismatch.length).padStart(7) + String(s.rangeMismatch.length).padStart(8) +
        String(fab.length).padStart(5) + String(low).padStart(5) + r.ms.toFixed(1).padStart(7));
    }
  }

  const sum = (f: (r: any) => number) => records.reduce((n, r) => n + f(r), 0);
  console.log("\n" + "TOTAL".padEnd(26) + String(sum((r) => r.armRows)).padStart(6) +
    String(sum((r) => r.baselineRows)).padStart(6) + String(sum((r) => r.matched)).padStart(7) +
    String(sum((r) => r.missing.length)).padStart(6) + String(sum((r) => r.extra.length)).padStart(7) +
    String(sum((r) => r.valueMismatch.length)).padStart(6) +
    String(sum((r) => r.unitMismatch.length)).padStart(7) +
    String(sum((r) => r.rangeMismatch.length)).padStart(8) +
    String(sum((r) => r.fabrications.length)).padStart(5) +
    String(sum((r) => r.lowConfidence)).padStart(5) + totalMs.toFixed(1).padStart(7));
  console.log(`\n${records.length} pages in ${totalMs.toFixed(1)} ms total — ` +
    `${(totalMs / records.length).toFixed(2)} ms/page, $0.00`);

  const worst = [...records].sort((a, b) => b.valueMismatch.length - a.valueMismatch.length)[0];
  if (worst?.valueMismatch.length) {
    console.log(`\nworst page for values: ${worst.probe}`);
    for (const m of worst.valueMismatch.slice(0, 8))
      console.log(`  ${m.name.slice(0, 26).padEnd(28)} "${m.baseline}" -> "${m.arm}"`);
  }
  writeFileSync("bench/results/xcolumns.jsonl", records.map((r) => JSON.stringify(r)).join("\n") + "\n");
});
