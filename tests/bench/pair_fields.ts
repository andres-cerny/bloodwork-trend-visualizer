/**
 * Unit and range per reader, against truth and between the two reads of a pair
 * (docs/plans/model-loop.md, H1). `reconcile()` compares only the value string,
 * so this counts what it never compares. Free: reads the persisted bench:adapt
 * outputs only.
 *
 *   PYTHON_BIN=.venv/bin/python npx vite-node --root . tests/bench/pair_fields.ts
 *   ARMS=a,b PAIRS=a+b  to choose
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeUnit, parseRange } from "@bw/lab-core";
const R = dirname(fileURLToPath(import.meta.url));
const { loadClass } = await import(join(R, "corpora.ts"));
const { aliasedNameKey } = await import(join(R, "score.ts"));
const key = aliasedNameKey();
const arms = (process.env.ARMS ?? "sonnet5,haiku45,sonnet55,haiku55,gemini38_ultra").split(",");
const pairs = (process.env.PAIRS ?? "sonnet5+haiku45,sonnet5+gemini38_ultra,sonnet55+haiku55,sonnet55+gemini38_ultra,haiku55+sonnet55,haiku55+gemini38_ultra").split(",");
const u = (s?: string) => (canonicalizeUnit(s ?? "") ?? "").replace(/\s+/g, "").toLowerCase();
const rk = (s?: string) => { const r = parseRange(s ?? ""); return r.low !== null || r.high !== null ? `${r.low ?? ""}|${r.high ?? ""}` : (r.text ?? s ?? "").replace(/\s+/g, "").toLowerCase(); };
const read = (arm: string, slug: string) => {
  const f = join(R, "results/adapt", arm, `${slug}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, "utf8"));
  return j.call?.ok ? (j.call.extraction?.measurements ?? []) : null;
};
const per: Record<string, { rows: number; unitErr: number; rangeErr: number; ex: string[] }> = {};
const pairOut: Record<string, { unitErr: number; unitCaught: number; rangeErr: number; rangeCaught: number; unitDisagree: number; rangeDisagree: number; ex: string[] }> = {};
for (const cls of ["synthetic", "public"]) {
  for (const p of await loadClass(cls as any)) {
    if (!p.truth) continue;
    const tByName = new Map<string, any>();
    for (const t of p.truth) if (!tByName.has(key(t.raw_analyte_name))) tByName.set(key(t.raw_analyte_name), t);
    const hasRange = p.truth.some((t: any) => t.ref_range_raw !== undefined);
    const idx = (ms: any[]) => { const m = new Map<string, any>(); for (const x of ms) if (!m.has(key(x.raw_analyte_name))) m.set(key(x.raw_analyte_name), x); return m; };
    for (const arm of arms) {
      const ms = read(arm, p.slug); if (!ms) continue;
      const s = (per[arm] ??= { rows: 0, unitErr: 0, rangeErr: 0, ex: [] });
      for (const [k, x] of idx(ms)) { const t = tByName.get(k); if (!t) continue; s.rows++;
        if (u(x.unit_raw) !== u(t.unit_raw)) { s.unitErr++; if (s.ex.length < 8) s.ex.push(`${p.slug} ${x.raw_analyte_name}: unit "${x.unit_raw}" vs truth "${t.unit_raw}"`); }
        if (hasRange && t.ref_range_raw !== undefined && rk(x.ref_range_raw) !== rk(t.ref_range_raw)) { s.rangeErr++; if (s.ex.length < 8) s.ex.push(`${p.slug} ${x.raw_analyte_name}: range "${x.ref_range_raw}" vs truth "${t.ref_range_raw}"`); }
      }
    }
    for (const pr of pairs) {
      const [a, b] = pr.split("+"); const A = read(a, p.slug), B = read(b, p.slug); if (!A || !B) continue;
      const s = (pairOut[pr] ??= { unitErr: 0, unitCaught: 0, rangeErr: 0, rangeCaught: 0, unitDisagree: 0, rangeDisagree: 0, ex: [] });
      const bi = idx(B);
      for (const [k, x] of idx(A)) { const y = bi.get(k); const t = tByName.get(k); if (!y) continue;
        const ud = u(x.unit_raw) !== u(y.unit_raw), rd = rk(x.ref_range_raw) !== rk(y.ref_range_raw);
        if (ud) s.unitDisagree++; if (rd) s.rangeDisagree++;
        if (!t) continue;
        if (u(x.unit_raw) !== u(t.unit_raw)) { s.unitErr++; if (ud) s.unitCaught++; else if (s.ex.length < 6) s.ex.push(`${p.slug} ${x.raw_analyte_name}: both "${x.unit_raw}" / "${y.unit_raw}", truth "${t.unit_raw}"`); }
        if (hasRange && t.ref_range_raw !== undefined && rk(x.ref_range_raw) !== rk(t.ref_range_raw)) { s.rangeErr++; if (rd) s.rangeCaught++; else if (s.ex.length < 6) s.ex.push(`${p.slug} ${x.raw_analyte_name}: range both "${x.ref_range_raw}" / "${y.ref_range_raw}", truth "${t.ref_range_raw}"`); }
      }
    }
  }
}
console.log("# single arms: unit / range errors vs truth (primary-as-shown would be wrong)");
for (const [a, s] of Object.entries(per)) { console.log(a.padEnd(16), `rows ${s.rows} unitErr ${s.unitErr} rangeErr ${s.rangeErr}`); for (const e of s.ex) console.log("   ", e); }
console.log("# pairs: primary unit/range errors, how many a unit/range comparison would catch, and total disagreements (review cost)");
for (const [a, s] of Object.entries(pairOut)) { console.log(a.padEnd(26), `unitErr ${s.unitErr} caught ${s.unitCaught} | rangeErr ${s.rangeErr} caught ${s.rangeCaught} | disagree unit ${s.unitDisagree} range ${s.rangeDisagree}`); for (const e of s.ex) console.log("   ", e); }
