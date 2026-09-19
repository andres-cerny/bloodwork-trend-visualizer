/**
 * The shipped catalog over a lab's printed names, scored against a
 * hand-authored truth (docs/plans/lab-mapping.md Phase 0; docs/plans/multi-user.md
 * Goals 1 and 2).
 *
 *   npm run bench:mapping                    free — no call is made, no key is needed
 *   BENCH_FIXTURE=data/real_seed/biolab      one fixture
 *   BENCH_FIXTURE=a,b,c                      several, comma-separated
 *   BENCH_FIXTURE='packages/lab-core/tests/fixtures/labs/*'   a glob (last segment)
 *
 * With no BENCH_FIXTURE it runs the four synthetic labs under
 * packages/lab-core/tests/fixtures/labs/ and, when present, the git-ignored
 * BioLAB fixture under data/real_seed/biolab.
 *
 * A fixture directory holds either:
 *   - `report.pdf` + `truth.json` — a born-digital sheet, read through
 *     lab-core exactly as the portal's text path reads it (row builder,
 *     candidate rows, the name anchored on the value; see
 *     packages/lab-core/tests/labFixtures.ts), the material taken from the
 *     row's Materiál cell or the heading above it; or
 *   - `report_*.json` + `truth.json` — LabReport payloads as the portal stored
 *     them, one row per distinct printed name, the material read off the prefix.
 *
 * `truth.json` is either the flat form `{ "<name>": { answer, wrong?, unit,
 * note } }` or the older `{ names: { "<name>": "<answer>" } }`. An answer is a
 * canonical id, `NEW:<id>` for a test the catalog lacks, `NOT_BLOOD` for
 * urine, `IGNORE` for a printed row that is not a measurement; `wrong` lists
 * the ids a near-miss trap invites.
 *
 * Four columns, never averaged, per fixture and in total:
 *   matched    — the registry found the id the truth names
 *   wrong      — the registry found a different id (the only column that must
 *                stay at zero; a wrong mapping trends two tests as one). A
 *                match onto one of the truth's `wrong` ids is marked "trap".
 *   unmatched  — null where the truth names an id (NEW counts here until the
 *                catalog founds it)
 *   left out   — null where the truth says NOT_BLOOD or IGNORE, which is right
 *
 * Only the *shipped* registry is measured — what an account learned by hand is
 * deliberately not applied, because the question is what the next account
 * from this lab would get for free.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { it } from "vitest";
import { type AnalyteDef, type LabReport, Registry, parseValue } from "@bw/lab-core";
import { pdfPages, printedRows, readTruth, type Truth } from "../../packages/lab-core/tests/labFixtures";

const ROOT = new URL("../../", import.meta.url).pathname;
const SYNTHETIC = "packages/lab-core/tests/fixtures/labs/*";
const BIOLAB = "data/real_seed/biolab";

/** BENCH_FIXTURE, or the defaults; a `*` in the last segment expands to the matching directories. */
function fixtureDirs(): string[] {
  const spec = process.env.BENCH_FIXTURE ?? [SYNTHETIC, existsSync(join(ROOT, BIOLAB)) ? BIOLAB : ""].filter(Boolean).join(",");
  const out: string[] = [];
  for (const raw of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const path = isAbsolute(raw) ? raw : join(ROOT, raw);
    const pattern = basename(path);
    if (!pattern.includes("*")) {
      out.push(path);
      continue;
    }
    const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    const parent = dirname(path);
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent).sort()) {
      const dir = join(parent, name);
      if (re.test(name) && statSync(dir).isDirectory()) out.push(dir);
    }
  }
  return out;
}

/** Both truth forms, as the flat one. */
function loadTruth(dir: string): Truth {
  const raw = JSON.parse(readFileSync(join(dir, "truth.json"), "utf-8")) as { names?: Record<string, string> };
  if (raw.names) {
    return Object.fromEntries(Object.entries(raw.names).map(([k, v]) => [k, { answer: v, unit: "", note: "" }]));
  }
  return readTruth(dir);
}

interface Printed {
  name: string;
  /** The id the shipped registry gives this row. */
  got: string | null;
}

/** The sheet's printed names with the registry's answer, for either fixture form. */
async function readFixture(dir: string, registry: Registry): Promise<{ printed: Printed[]; source: string }> {
  const pdf = join(dir, "report.pdf");
  if (existsSync(pdf)) {
    const pages = await pdfPages(pdf);
    const printed = printedRows(pages).map((r) => ({ name: r.name, got: registry.matchRow(r.name, r.rows, r.index) }));
    return { printed, source: `${pages.length} page(s)` };
  }
  const reports = readdirSync(dir)
    .filter((f) => f.startsWith("report_") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as LabReport);
  // One row per distinct printed name — the stored payload carries no page
  // rows, exactly as the portal reloads it, so the prefix is the material.
  const names = new Map<string, { numeric: boolean }>();
  for (const r of reports) {
    for (const m of r.measurements) {
      const e = names.get(m.rawAnalyteName) ?? { numeric: false };
      if (parseValue(m.valueRaw) !== null) e.numeric = true;
      names.set(m.rawAnalyteName, e);
    }
  }
  const printed = [...names.keys()].map((name) => ({ name, got: registry.match(name) }));
  return { printed, source: `${reports.length} report(s)` };
}

type Verdict = "matched" | "wrong" | "unmatched" | "leftOut";
interface Tally {
  matched: number;
  wrong: number;
  unmatched: number;
  leftOut: number;
}
const zero = (): Tally => ({ matched: 0, wrong: 0, unmatched: 0, leftOut: 0 });
const bare = (id: string) => id.replace(/^NEW:/, "");

function verdictOf(got: string | null, want: { answer: string; wrong?: string[] }): Verdict {
  if (want.answer === "NOT_BLOOD" || want.answer === "IGNORE") return got === null ? "leftOut" : "wrong";
  if (got === null) return "unmatched";
  return got === bare(want.answer) ? "matched" : "wrong";
}

const line = (label: string, t: Tally, n: number) =>
  `${label}: ${n} names — matched ${t.matched} · wrong ${t.wrong} · unmatched ${t.unmatched} · left out ${t.leftOut}`;

it("maps each lab's printed names against the shipped catalog", async () => {
  const defs = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf-8")) as AnalyteDef[];
  const registry = new Registry(defs);
  const dirs = fixtureDirs();
  if (dirs.length === 0) throw new Error("no fixture directory — set BENCH_FIXTURE");

  const total = zero();
  let totalNames = 0;
  const summary: string[] = [];
  for (const dir of dirs) {
    const label = relative(ROOT, dir) || dir;
    const truth = loadTruth(dir);
    const { printed, source } = await readFixture(dir, registry);

    const tally = zero();
    const rows: Array<{ name: string; got: string | null; want: string; verdict: Verdict; trap: boolean }> = [];
    const missingTruth: string[] = [];
    const seen = new Set<string>();
    for (const { name, got } of printed) {
      seen.add(name);
      const want = truth[name];
      if (want === undefined) {
        missingTruth.push(name);
        continue;
      }
      const verdict = verdictOf(got, want);
      tally[verdict] += 1;
      rows.push({ name, got, want: want.answer, verdict, trap: got !== null && (want.wrong ?? []).map(bare).includes(got) });
    }
    const neverPrinted = Object.keys(truth).filter((k) => !seen.has(k));

    console.log(`\n== ${label} (${source})`);
    const width = Math.max(0, ...rows.map((r) => r.name.length));
    for (const r of rows.filter((x) => x.verdict !== "matched" && x.verdict !== "leftOut")) {
      const mark = r.trap ? " (trap)" : "";
      console.log(`${(r.verdict + mark).padEnd(16)} ${r.name.padEnd(width)}  got ${String(r.got).padEnd(22)} want ${r.want}`);
    }
    console.log(line(label, tally, rows.length));
    if (missingTruth.length) console.log(`no truth for: ${missingTruth.join(", ")}`);
    if (neverPrinted.length) console.log(`truth never printed: ${neverPrinted.join(", ")}`);

    summary.push(line(label, tally, rows.length));
    for (const k of Object.keys(total) as Array<keyof Tally>) total[k] += tally[k];
    totalNames += rows.length;
  }

  console.log("\n== summary");
  for (const s of summary) console.log(s);
  if (dirs.length > 1) console.log(line("total", total, totalNames));
  if (total.wrong > 0) throw new Error(`${total.wrong} wrong mapping(s) — a wrong mapping trends two tests as one`);
});
