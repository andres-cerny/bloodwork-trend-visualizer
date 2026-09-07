/**
 * Subagent benchmark for the image classes, step 2 — score what the
 * subagents wrote.
 *
 *   npx vitest run --config tests/bench/vitest.config.ts tests/bench/subagent_score_images.bench.ts
 *
 * Reads results/subagent/<class>/out/<variant>/<slug>.json (one tool input
 * per page, written by a subagent standing in for a reader) and scores each
 * variant against the truth the dump recorded in index.json:
 *
 *   valERR   value errors against hand-verified truth — column 2 for images
 *   miss     truth rows the variant did not return
 *   extra    rows the variant returned that the truth does not have
 *   marker   truth rows dropped as bare markers (a panel line's `#`)
 *   scope    truth rows D0 puts out of scope — urine and other non-blood
 *            materials, specimen receipts, anthropometrics, toxicology,
 *            auxiliary rows. Dropped from the READ as well, so a reader is
 *            charged neither a miss nor an extra for them (score.ts,
 *            `scopeExclusion` and `inScopeReads`)
 *   decens   a censored value (`<1,0`) that came back as a number
 *
 * Two scorer rules do the adjudicating that used to be done by hand: a truth
 * row whose value is a bare marker (`#`) is not a measurement and is not
 * charged to anyone, and `tests/bench/truth_aliases.json` lets one page's
 * clipped printed name match the full name in the truth. Both are keyed off
 * the page key the dump recorded, so a Gemini result set dropped into
 * out/<variant>/ is scored by the same rules as a subagent's.
 *
 * and every pair of variants with `pairStats`: confirmed, flagged, UNCAUGHT
 * (both wrong the same way — must be 0), caught, and single-reader pages
 * (one file missing — every row flagged). A Gemini result set persisted by
 * adapt.bench.ts can be dropped into out/<variant>/ under the same slugs to
 * put a tier-2 read beside the tier-1 ones; the tables never mix the tiers
 * silently because the variant name says which it is.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { type CorpusClass } from "./corpora";
import { pairStats, rangeIntegrity, valueErrors, type RawMeasurement } from "./score";

const BASE = "tests/bench/results/subagent";
const DEFAULT: CorpusClass[] = ["synthetic", "public", "photo"];

function readJson(path: string): any | null {
  try {
    let txt = readFileSync(path, "utf8").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const data = JSON.parse(txt);
    // adapt.bench.ts persists { call: { extraction: { measurements } } }; a
    // subagent writes the bare tool input. Accept both.
    return data?.call?.extraction ?? data;
  } catch {
    return null;
  }
}

const pad = (s: string | number, n: number) => String(s).padStart(n);

it("subagent bench (images) — score the variants against truth", () => {
  const classes = ((process.env.BENCH_CLASSES ?? "").split(",").map((s) => s.trim()).filter(Boolean) as CorpusClass[]);
  const all: any[] = [];

  for (const cls of classes.length ? classes : DEFAULT) {
    const dir = join(BASE, cls);
    if (!existsSync(join(dir, "index.json"))) {
      console.log(`${cls}: no index.json — run subagent_dump_images.bench.ts first`);
      continue;
    }
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as any[];
    const outDir = join(dir, "out");
    const variants = existsSync(outDir) ? readdirSync(outDir).filter((v) => readdirSync(join(outDir, v)).some((f) => f.endsWith(".json"))) : [];
    if (!variants.length) {
      console.log(`${cls}: nothing under ${outDir}/<variant>/ yet`);
      continue;
    }

    const reads = new Map<string, Map<string, RawMeasurement[] | null>>();
    const broken: string[] = [];
    for (const v of variants) {
      const m = new Map<string, RawMeasurement[] | null>();
      for (const p of index) {
        const f = join(outDir, v, `${p.slug}.json`);
        if (!existsSync(f)) {
          m.set(p.slug, null);
          continue;
        }
        const data = readJson(f);
        if (!data || !Array.isArray(data.measurements)) {
          broken.push(`${v}/${p.slug}`);
          m.set(p.slug, null);
          continue;
        }
        m.set(p.slug, data.measurements);
      }
      reads.set(v, m);
    }
    if (broken.length) console.log(`${cls}: unparseable outputs: ${broken.join(", ")}`);

    console.log(`\n## ${cls} — variants against ${[...new Set(index.map((p) => p.truthSource))].join(", ")}`);
    console.log("variant".padEnd(22) + pad("pages", 6) + pad("read", 5) + pad("truth", 6) + pad("rows", 6) + pad("match", 6) + pad("miss", 6) + pad("extra", 6) + pad("marker", 7) + pad("scope", 6) + pad("valERR", 7) + pad("decens", 7));
    for (const v of variants) {
      const rows = index.filter((p) => p.truth);
      const scored = rows.map((p) => {
        const read = reads.get(v)!.get(p.slug);
        if (!read) return null;
        const s = valueErrors(read, p.truth, { pageKey: p.key });
        const d = rangeIntegrity(p.truth, read).decensored.length;
        all.push({ cls, variant: v, slug: p.slug, ...s, decensored: d });
        return { ...s, decensored: d, slug: p.slug };
      });
      const ok = scored.filter((s): s is NonNullable<typeof s> => !!s);
      const sum = (f: (s: (typeof ok)[number]) => number) => ok.reduce((n, s) => n + f(s), 0);
      console.log(
        v.padEnd(22) + pad(rows.length, 6) + pad(ok.length, 5) + pad(sum((s) => s.truthRows), 6) + pad(sum((s) => s.readRows), 6) + pad(sum((s) => s.matched), 6) +
          pad(sum((s) => s.missing.length), 6) + pad(sum((s) => s.extra.length), 6) + pad(sum((s) => s.markerRows), 7) + pad(sum((s) => s.scopeRows), 6) + pad(sum((s) => s.errors.length), 7) + pad(sum((s) => s.decensored), 7),
      );
      for (const s of ok) {
        const bits: string[] = [];
        if (s.errors.length) bits.push(`valERR: ${s.errors.map((e) => `${e.name} ${e.truth}→${e.read}`).join("; ")}`);
        if (s.missing.length) bits.push(`missing: ${s.missing.join("; ")}`);
        if (s.extra.length) bits.push(`extra: ${s.extra.join("; ")}`);
        if (s.decensored) bits.push(`decensored: ${s.decensored}`);
        if (bits.length) console.log(`   ${s.slug}\n      ${bits.join("\n      ")}`);
      }
    }

    if (variants.length > 1) {
      console.log(`\n## ${cls} — pairs (two numbers, never merged)`);
      console.log("pair".padEnd(34) + pad("pages", 6) + pad("single", 7) + pad("confirmed", 10) + pad("flagged", 8) + pad("UNCAUGHT", 9) + pad("caught", 7) + pad("1-rdr ERR", 10));
      for (let i = 0; i < variants.length; i++) {
        for (let j = i + 1; j < variants.length; j++) {
          const [a, b] = [variants[i], variants[j]];
          const stats = index
            .filter((p) => p.truth)
            .map((p) => {
              const ra = reads.get(a)!.get(p.slug) ?? null;
              const rb = reads.get(b)!.get(p.slug) ?? null;
              if (!ra && !rb) return null;
              const s = pairStats(ra, rb, p.truth, { pageKey: p.key });
              all.push({ cls, pair: `${a}+${b}`, slug: p.slug, condition: p.meta?.condition ?? null, ...s });
              return { ...s, slug: p.slug };
            })
            .filter((s): s is NonNullable<typeof s> => !!s);
          if (!stats.length) continue;
          const sum = (f: (s: (typeof stats)[number]) => number) => stats.reduce((n, s) => n + f(s), 0);
          console.log(
            `${a}+${b}`.padEnd(34) + pad(stats.length, 6) + pad(stats.filter((s) => s.singleReader).length, 7) + pad(sum((s) => s.confirmedRows), 10) +
              pad(sum((s) => s.flaggedRows), 8) + pad(sum((s) => s.uncaughtValueErrors.length), 9) + pad(sum((s) => s.caughtValueErrors), 7) + pad(sum((s) => s.singleReaderErrors.length), 10),
          );
          for (const s of stats) {
            if (s.uncaughtValueErrors.length) console.log(`   ${s.slug}: UNCAUGHT ${s.uncaughtValueErrors.map((e) => `${e.name} ${e.truth || "∅"}→${e.read}`).join("; ")}`);
            if (s.singleReader) console.log(`   ${s.slug}: single reader — every row flagged`);
          }
        }
      }
    }
  }
  writeFileSync(join(BASE, "scores_images.jsonl"), all.map((r) => JSON.stringify(r)).join("\n") + "\n");
});
