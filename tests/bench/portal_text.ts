/**
 * Moje krev's text path, end to end as the portal runs it: the extract
 * Worker's reads (`extractPageText`), then `apps/portal/src/lib/interpret.ts`
 * (row-index repair, printed-name replacement, unclaimed-row surfacing) and
 * `reviewOf`. docs/plans/model-loop.md, round 2.
 *
 * Question: with interpret's deterministic checks, does Moje krev still need a
 * second text reader — and which model should read?
 *
 *   with-secrets bloodwork -- env PYTHON_BIN=.venv/bin/python PORTAL_TEXT_MAX_USD=0.5 \
 *     npx vite-node --root . tests/bench/portal_text.ts
 *
 * Pages: the 8 synthetic text fixtures (reads reused from bench:adapt) and the
 * Stod sample sheet's four results pages (the only public sheet with a text
 * layer; reads made here once and persisted under results/portal_text/).
 * PORTAL_TEXT_CLASSES=real adds the real corpus (Mac only);
 * PORTAL_TEXT_CONFIGS=haiku55 runs only the configs named.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractPageText } from "@bw/extraction";
import { priceUsd } from "@bw/agent-core";
import { Registry, reviewOf, rowsAsText, type RawRead, type TextRow } from "@bw/lab-core";

import { interpretPage } from "../../apps/portal/src/lib/interpret";
import { loadClass, PUBLIC_PDF_DIR } from "./corpora";
import { parsePdf } from "./corpus";
import { aliasedNameKey } from "./score";

const R = dirname(fileURLToPath(import.meta.url));
const OUT = join(R, "results/portal_text");
const MAX_USD = parseFloat(process.env.PORTAL_TEXT_MAX_USD ?? "0.5");
const key = aliasedNameKey();
const registry = new Registry(JSON.parse(readFileSync(join(R, "../../apps/portal/public/registry.json"), "utf8")));
const match = (n: string, mat?: string | null) => registry.match(n, mat);

const MODELS: Record<string, string> = {
  haiku45: "claude-haiku-4-5",
  haiku55: "claude-haiku-5-5",
  sonnet5: "claude-sonnet-5",
  sonnet55: "claude-sonnet-5-5",
};
const CONFIGS: Array<{ id: string; arms: string[]; note: string }> = [
  { id: "sonnet5+haiku45", arms: ["sonnet5", "haiku45"], note: "deployed (TEXT_READERS unset)" },
  { id: "haiku45", arms: ["haiku45"], note: "TEXT_READERS=cheap today" },
  { id: "sonnet55+haiku55", arms: ["sonnet55", "haiku55"], note: "both moved a generation" },
  { id: "haiku55", arms: ["haiku55"], note: "cheap, Haiku 5.5" },
  { id: "sonnet55", arms: ["sonnet55"], note: "one Sonnet 5.5 read" },
];

interface Page { slug: string; rows: TextRow[]; truth: Array<{ raw_analyte_name?: string; value_raw?: string }> }
const pages: Page[] = [];
// PORTAL_TEXT_CLASSES=real (on the Mac, where samples/ and data/reports exist)
// reads the real corpus's text pages instead; truth there is the accepted
// reports, so a disagreement is a row to adjudicate, not automatically an error.
const classes = (process.env.PORTAL_TEXT_CLASSES ?? "synthetic,stod").split(",");
const only = (process.env.PORTAL_TEXT_CONFIGS ?? "").split(",").filter(Boolean);
for (const cls of classes.filter((c) => c === "synthetic" || c === "real")) {
  for (const p of await loadClass(cls as "synthetic" | "real")) {
    if (p.kind === "text" && p.rows && p.truth) pages.push({ slug: `${cls === "real" ? "real_" : ""}${p.slug}`, rows: p.rows, truth: p.truth });
  }
}
const stodTruth = new Map((await loadClass("public")).filter((p) => p.slug.startsWith("stod_")).map((p) => [p.slug, p.truth!]));
const stodPdf = join(PUBLIC_PDF_DIR, "fetched/stod_p_loha_2_vzor_v_sledkov_ho_listu_f214.pdf");
if (classes.includes("stod") && existsSync(stodPdf)) {
  const { doc } = await parsePdf(stodPdf);
  for (const pg of doc.pages) {
    const slug = `stod_p${pg.pageNum}`;
    const t = stodTruth.get(slug);
    if (pg.hasTextLayer && t && t.length && slug !== "stod_p5") pages.push({ slug, rows: pg.rows, truth: t });
  }
}

let spent = 0;
async function readOf(arm: string, page: Page): Promise<RawRead | null> {
  const adapt = join(R, "results/adapt", arm, `${page.slug}.json`);
  if (!page.slug.startsWith("stod_") && !page.slug.startsWith("real_") && existsSync(adapt)) {
    const j = JSON.parse(readFileSync(adapt, "utf8"));
    return j.call?.ok ? { model: j.call.model, measurements: j.call.extraction.measurements } : null;
  }
  const f = join(OUT, arm, `${page.slug}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  if (spent > MAX_USD) throw new Error(`stopped at $${spent.toFixed(3)} (PORTAL_TEXT_MAX_USD=${MAX_USD})`);
  const t0 = performance.now();
  const x = await extractPageText(process.env.ANTHROPIC_API_KEY!, MODELS[arm], rowsAsText(page.rows));
  const usd = priceUsd(x.model, x.usage.inputTokens, x.usage.outputTokens, x.usage.cacheReadTokens, x.usage.cacheWriteTokens);
  spent += usd;
  console.log(`${arm.padEnd(9)} ${page.slug.padEnd(22)} ${((performance.now() - t0) / 1000).toFixed(1)} s  out=${x.usage.outputTokens}  $${usd.toFixed(4)}`);
  const read: RawRead = { model: x.model, measurements: x.measurements as any };
  mkdirSync(join(OUT, arm), { recursive: true });
  writeFileSync(f, JSON.stringify(read));
  return read;
}

const val = (v?: string) => (v ?? "").replace(/[!*↑↓]/g, "").replace(/\s+/g, "").toLowerCase();
console.log("config".padEnd(18), "truth found  miss  ok asked UNCAUGHT  unread unmapped  note");
for (const c of CONFIGS.filter((x) => !only.length || only.includes(x.id))) {
  let truthN = 0, found = 0, ok = 0, asked = 0, unread = 0, unmapped = 0;
  const uncaught: string[] = [];
  const missed: string[] = [];
  for (const page of pages) {
    const reads = (await Promise.all(c.arms.map((a) => readOf(a, page)))).filter((r): r is RawRead => !!r);
    const res = interpretPage(reads as any, page.rows, 1, false, match, c.arms.length);
    unread += res.unread.length;
    const byKey = new Map<string, (typeof res.measurements)[number][]>();
    for (const m of res.measurements) {
      if (!byKey.has(key(m.rawAnalyteName))) byKey.set(key(m.rawAnalyteName), []);
      byKey.get(key(m.rawAnalyteName))!.push(m);
      const level = reviewOf(m, () => null).level;
      if (level === "ok") ok++; else asked++;
      if (!m.canonicalId) unmapped++;
    }
    for (const t of page.truth) {
      truthN++;
      const ms = byKey.get(key(t.raw_analyte_name)) ?? [];
      const m = ms.find((x) => val(x.valueRaw) === val(t.value_raw)) ?? ms[0];
      if (!m) { missed.push(`${page.slug}:${t.raw_analyte_name}`); continue; }
      found++;
      if (val(m.valueRaw) !== val(t.value_raw) && reviewOf(m, () => null).level === "ok") uncaught.push(`${page.slug} ${t.raw_analyte_name}: ${m.valueRaw} vs ${t.value_raw}`);
    }
  }
  console.log(c.id.padEnd(18), String(truthN).padStart(5), String(found).padStart(6), String(truthN - found).padStart(5), String(ok).padStart(4), String(asked).padStart(5), String(uncaught.length).padStart(8), String(unread).padStart(7), String(unmapped).padStart(8), "", c.note);
  for (const u of uncaught.slice(0, 6)) console.log("    UNCAUGHT", u);
  for (const m of missed.slice(0, 6)) console.log("    miss", m);
}
console.log(`\nspent $${spent.toFixed(4)} on new reads`);
