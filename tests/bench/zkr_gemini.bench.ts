/**
 * Does Gemini fold a `Zkr.` abbreviation column into the analyte name — and
 * does it do so *consistently*?
 *
 * Phase D dropped the abbreviation-column sentence because it changed nothing
 * for Sonnet and its only evidence was a single Gemini read of Břeclav p122.
 * The deployed-call confirmation then found the same page coming back 28 rows
 * all-flagged on one attempt and 14 rows none-flagged on a repeat, so the
 * question is a rate, not an anecdote: five calls on each of the three
 * abbreviation-column pages, under the prompt as it stands.
 *
 *   set -a; source .env; set +a
 *   PYTHON_BIN=.venv-mac/bin/python ZKR_ARM=before \
 *     npx vitest run --config tests/bench/vitest.config.ts tests/bench/zkr_gemini.bench.ts
 *
 * Calls the deployed `extractPageGemini` — same prompt, same schema, same
 * media resolution as the Worker — with no text-layer hint, so the reader has
 * only the image and the abbreviation question is actually asked. Fifteen
 * calls, roughly twenty cents. Writes results/zkr_<arm>.json (git-ignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { extractPageGemini, MODEL_GEMINI } from "@bw/extraction";

import { loadClass, pythonWithFitz, renderFor, type CorpusPage } from "./corpora";
import { priceUsd } from "./extract";

const OUT = "tests/bench/results";
const REPEATS = Number(process.env.ZKR_REPEATS ?? 5);
/** Narrow to one page when a single layout is worth more calls than the rest. */
const ONLY = (process.env.ZKR_PAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** `Zkr.` code → full printed name, per page. */
type Pair = { abbr: string; name: string };

const ZKR_COLUMN: Pair[] = [
  { abbr: "URE", name: "urea" },
  { abbr: "KREA", name: "kreatinin" },
  { abbr: "KM", name: "kyselina močová" },
  { abbr: "GLU", name: "glukóza" },
  { abbr: "CHOL", name: "cholesterol" },
];

function publicPairs(slug: string): Pair[] {
  const sheet = JSON.parse(readFileSync(join("tests/bench/public_sheets", `${slug}.json`), "utf8"));
  return sheet.rows
    .filter((r: any) => r.abbr)
    .map((r: any) => ({ abbr: r.abbr as string, name: r.raw_analyte_name as string }));
}

const norm = (s: string) =>
  (s ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase().replace(/^[*\s]+/, "");

/** How one returned name relates to the printed pair. */
function classify(name: string, pairs: Pair[]): "full" | "folded" | "abbr" | "other" {
  const n = norm(name);
  for (const p of pairs) {
    const full = norm(p.name);
    const a = norm(p.abbr);
    if (n === full) return "full";
    if (n === `${a} ${full}` || n === `${a}${full}` || n === `${a} - ${full}` || n === `${a}: ${full}`) return "folded";
    if (n.startsWith(`${a} `) && n.includes(full)) return "folded";
    if (n === a) return "abbr";
  }
  return "other";
}

it("Gemini on the three abbreviation-column pages, five calls each", async () => {
  const arm = process.env.ZKR_ARM ?? "unnamed";
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const python = pythonWithFitz();

  const pub = (await loadClass("public")).filter((p) => ["breclav_p121", "breclav_p122"].includes(p.slug));
  const syn = (await loadClass("synthetic")).filter((p) => p.slug === "zkr_column");
  const targets: Array<{ page: CorpusPage; pairs: Pair[] }> = [
    ...pub.map((page) => ({ page, pairs: publicPairs(page.slug) })),
    ...syn.map((page) => ({ page, pairs: ZKR_COLUMN })),
  ];
  if (targets.length !== 3) throw new Error(`expected 3 pages, got ${targets.map((t) => t.page.slug).join(",")}`);
  const chosen = ONLY.length ? targets.filter((t) => ONLY.includes(t.page.slug)) : targets;

  const log: any[] = [];
  let usd = 0;
  for (const { page, pairs } of chosen) {
    const img = renderFor(page, "google", join(OUT, "zkr_pages"), python);
    const b64 = readFileSync(img.path).toString("base64");
    for (let i = 1; i <= REPEATS; i++) {
      const t0 = Date.now();
      const ex = await extractPageGemini(key, MODEL_GEMINI, b64, img.mediaType, null);
      const names = ex.measurements.map((m) => m.raw_analyte_name);
      const kinds = names.map((n) => classify(n, pairs));
      const count = (k: string) => kinds.filter((x) => x === k).length;
      const cost = priceUsd(MODEL_GEMINI, ex.usage);
      usd += cost;
      const rec = {
        arm,
        slug: page.slug,
        call: i,
        rows: names.length,
        full: count("full"),
        folded: count("folded"),
        abbr: count("abbr"),
        other: count("other"),
        verdict: count("folded") + count("abbr") > 0 ? "FOLDED" : "full",
        ms: Date.now() - t0,
        usd: Number(cost.toFixed(4)),
        names,
      };
      log.push(rec);
      console.log(
        `${arm} ${page.slug} #${i}: ${rec.rows} rows  full ${rec.full}  folded ${rec.folded}  abbr ${rec.abbr}  other ${rec.other}  → ${rec.verdict}  ${(rec.ms / 1000).toFixed(1)}s  $${rec.usd}`,
      );
      if (rec.other > 0) console.log(`    other: ${names.filter((n) => classify(n, pairs) === "other").join(" · ")}`);
    }
  }

  console.log(`\n${arm}: folded on ${log.filter((r) => r.verdict === "FOLDED").length} of ${log.length} calls, $${usd.toFixed(3)}`);
  for (const slug of [...new Set(log.map((r) => r.slug))]) {
    const rows = log.filter((r) => r.slug === slug);
    console.log(`  ${slug}: ${rows.filter((r) => r.verdict === "FOLDED").length}/${rows.length} folded`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `zkr_${arm}.json`), JSON.stringify({ arm, usd, log }, null, 1));
});
