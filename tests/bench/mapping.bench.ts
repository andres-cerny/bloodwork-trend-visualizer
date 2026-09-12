/**
 * Phase 0 of docs/plans/lab-mapping.md — the shipped catalog over a real
 * lab's printed names, scored against a hand-authored truth.
 *
 *   npm run bench:mapping                free — no call is made, no key is needed
 *   BENCH_FIXTURE=data/real_seed/biolab  which fixture (the default)
 *
 * The fixture is git-ignored patient data: `report_*.json` are LabReport
 * payloads exactly as the portal stored them, `truth.json` maps every distinct
 * printed name to the canonical id it belongs to, `NEW:<id>` for a test the
 * catalog lacked when the truth was written, `NOT_BLOOD` for urine, `IGNORE`
 * for a printed row that is not a measurement.
 *
 * Four columns, never averaged:
 *   matched    — the registry found the id the truth names
 *   wrong      — the registry found a different id (the only column that must
 *                stay at zero; a wrong mapping trends two tests as one)
 *   unmatched  — null where the truth names an id (NEW counts here until the
 *                catalog founds it)
 *   left out   — null where the truth says NOT_BLOOD or IGNORE, which is right
 *
 * Only the *shipped* registry is measured — what the account learned by hand is
 * deliberately not applied, because the question is what the next account
 * from this lab would get for free.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { type AnalyteDef, type LabReport, Registry, parseValue } from "@bw/lab-core";

const ROOT = new URL("../../", import.meta.url).pathname;
const FIXTURE = join(ROOT, process.env.BENCH_FIXTURE ?? "data/real_seed/biolab");

it("maps a real lab's names against the shipped catalog", () => {
  const defs = JSON.parse(readFileSync(join(ROOT, "apps/portal/public/registry.json"), "utf-8")) as AnalyteDef[];
  const registry = new Registry(defs);
  const truth = (JSON.parse(readFileSync(join(FIXTURE, "truth.json"), "utf-8")) as { names: Record<string, string> }).names;

  const reports = readdirSync(FIXTURE)
    .filter((f) => f.startsWith("report_") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FIXTURE, f), "utf-8")) as LabReport);

  // One row per distinct printed name, the material read off the prefix —
  // the stored payload carries no page rows, exactly as the portal reloads it.
  const names = new Map<string, { unit: string; numeric: boolean }>();
  for (const r of reports) {
    for (const m of r.measurements) {
      const e = names.get(m.rawAnalyteName) ?? { unit: m.unitRaw, numeric: false };
      if (parseValue(m.valueRaw) !== null) e.numeric = true;
      names.set(m.rawAnalyteName, e);
    }
  }

  const rows: Array<{ name: string; got: string | null; want: string; verdict: string }> = [];
  const tally = { matched: 0, wrong: 0, unmatched: 0, leftOut: 0 };
  const missingTruth: string[] = [];
  for (const [name] of names) {
    const want = truth[name];
    if (want === undefined) {
      missingTruth.push(name);
      continue;
    }
    const got = registry.match(name);
    let verdict: keyof typeof tally;
    if (want === "NOT_BLOOD" || want === "IGNORE") verdict = got === null ? "leftOut" : "wrong";
    else if (got === null) verdict = "unmatched";
    else if (got === want || `NEW:${got}` === want) verdict = "matched";
    else verdict = "wrong";
    tally[verdict] += 1;
    rows.push({ name, got, want, verdict });
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows.filter((x) => x.verdict !== "matched" && x.verdict !== "leftOut")) {
    console.log(`${r.verdict.padEnd(9)} ${r.name.padEnd(width)}  got ${String(r.got).padEnd(22)} want ${r.want}`);
  }
  console.log(
    `\n${names.size} names in ${reports.length} reports: ` +
      `matched ${tally.matched} · wrong ${tally.wrong} · unmatched ${tally.unmatched} · left out ${tally.leftOut}`,
  );
  if (missingTruth.length) console.log(`no truth for: ${missingTruth.join(", ")}`);
  if (tally.wrong > 0) throw new Error(`${tally.wrong} wrong mapping(s) — a wrong mapping trends two tests as one`);
});
