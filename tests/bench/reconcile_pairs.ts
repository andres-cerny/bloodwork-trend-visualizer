/**
 * Re-score stored bench:adapt reads through the APP's own `reconcile` and
 * `reviewOf`, not the bench's pairing (score.ts `pairStats` pairs by its own
 * rules, so a change to reconcile is invisible there). Free: persisted
 * outputs only. docs/plans/model-loop.md, round 2.
 *
 *   PYTHON_BIN=.venv/bin/python npx vite-node --root . tests/bench/reconcile_pairs.ts
 *   PAIRS=a+b,c+d   to choose
 *
 * Per pair, over pages with truth:
 *   rows       measurements reconcile returns
 *   ok         review level "ok" (what the reader is never asked about)
 *   review     unconfirmed + withheld (the human's work)
 *   UNCAUGHT   "ok" rows whose value is not the printed truth (must be 0)
 *   unmapped   rows the shipped catalog cannot name (the primary's name shown)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { reconcile, reviewOf, Registry, normKey, type RawRead } from "@bw/lab-core";

const R = dirname(fileURLToPath(import.meta.url));
const { loadClass } = await import(join(R, "corpora.ts"));
const { aliasedNameKey } = await import(join(R, "score.ts"));
const key = aliasedNameKey();

const registry = new Registry(JSON.parse(readFileSync(join(R, "../../apps/portal/public/registry.json"), "utf8")));
const pairs = (process.env.PAIRS ??
  "sonnet5+gemini38_ultra,sonnet5+haiku45,sonnet55+gemini38_ultra,sonnet55+haiku55,haiku55+sonnet55,haiku55+gemini38_ultra,gemini38_ultra+haiku55").split(",");

const read = (arm: string, slug: string): RawRead | null => {
  const f = join(R, "results/adapt", arm, `${slug}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, "utf8"));
  return j.call?.ok ? { model: j.call.model, measurements: j.call.extraction?.measurements ?? [] } : null;
};
const val = (v: string | undefined) => (v ?? "").replace(/[!*↑↓]/g, "").replace(/\s+/g, "").toLowerCase();

const out: Record<string, { pages: number; rows: number; ok: number; review: number; uncaught: string[]; unmapped: number }> = {};
for (const cls of (process.env.CLASSES ?? "synthetic,public").split(",")) {
  for (const p of await loadClass(cls as any)) {
    if (!p.truth) continue;
    const truth = new Map<string, string[]>();
    for (const t of p.truth) {
      for (const k of [key(t.raw_analyte_name), normKey(t.raw_analyte_name)]) {
        if (!truth.has(k)) truth.set(k, []);
        truth.get(k)!.push(val(t.value_raw));
      }
    }
    for (const pr of pairs) {
      const [a, b] = pr.split("+");
      const A = read(a, p.slug), B = read(b, p.slug);
      if (!A || !B) continue;
      const s = (out[pr] ??= { pages: 0, rows: 0, ok: 0, review: 0, uncaught: [], unmapped: 0 });
      s.pages++;
      for (const m of reconcile([A, B], { expected: 2 })) {
        // Out-of-scope rows (urine, helper rows) are not judged here.
        if (/^(u|fu|du|pt)[_/-]/i.test(m.rawAnalyteName)) continue;
        s.rows++;
        const level = reviewOf(m, () => null).level;
        if (level === "ok") s.ok++;
        else s.review++;
        if (!registry.match(m.rawAnalyteName)) s.unmapped++;
        if (level !== "ok") continue;
        const t = truth.get(key(m.rawAnalyteName)) ?? truth.get(normKey(m.rawAnalyteName));
        if (t && !t.includes(val(m.valueRaw))) s.uncaught.push(`${p.slug} ${m.rawAnalyteName}=${m.valueRaw} (truth ${t.join("|")})`);
      }
    }
  }
}
console.log("pair".padEnd(26), "pages  rows    ok review UNCAUGHT unmapped");
for (const [pr, s] of Object.entries(out)) {
  console.log(pr.padEnd(26), String(s.pages).padStart(5), String(s.rows).padStart(5), String(s.ok).padStart(5), String(s.review).padStart(6), String(s.uncaught.length).padStart(8), String(s.unmapped).padStart(8));
  for (const u of s.uncaught.slice(0, 5)) console.log("    uncaught:", u);
}
