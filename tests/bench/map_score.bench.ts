/**
 * Mapping eval, step 2 — score the model's answers with the portal's gate.
 *
 *   MAP_ARM=subagent npx vitest run --config tests/bench/vitest.config.ts tests/bench/map_score.bench.ts
 *
 * Reads results/map_eval/out/<arm>/<fixture>.<batch>[.<rep>].json — each the
 * tool input the model returned for one batch — shapes it with
 * `toSuggestions` (an id the catalog lacks becomes `unknown`, as on the
 * wire), runs the portal's `judge` (applied = catalog + high + the evidence
 * gate) and scores every asked name against the fixture's truth. Prints a
 * table per fixture and per rep, then the total; throws when anything was
 * applied wrong. See map_eval.ts for the columns.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { it } from "vitest";

import { toSuggestions } from "@bw/extraction";

import { judge } from "../../apps/portal/src/lib/aiMapping";
import { OUT, catalogOf, dumpOf, fixtures, reportsOf, shippedRegistry, truthOf } from "./map_eval";

const ARM = process.env.MAP_ARM ?? "subagent";

type Col = "appliedWrong" | "appliedRight" | "shownRight" | "shownWrong" | "leftAlone" | "parkedRight" | "trap";
const COLS: Col[] = ["appliedWrong", "appliedRight", "shownRight", "shownWrong", "leftAlone", "parkedRight", "trap"];
type Tally = Record<Col, number>;
const zero = (): Tally => Object.fromEntries(COLS.map((c) => [c, 0])) as Tally;
const add = (a: Tally, b: Tally) => { for (const c of COLS) a[c] += b[c]; };
const line = (label: string, t: Tally, n: number) =>
  `${label.padEnd(18)} ${String(n).padStart(3)} names — applied wrong ${t.appliedWrong} · applied right ${t.appliedRight} · shown right ${t.shownRight} · shown wrong ${t.shownWrong} · left alone ${t.leftAlone} · parked/new right ${t.parkedRight} · traps taken ${t.trap}`;

it("map eval — score the answers", async () => {
  const registry = shippedRegistry();
  const catalog = catalogOf(registry);
  const dir = join(OUT, "out", ARM);
  if (!existsSync(dir)) throw new Error(`no answers under ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const total = zero();
  let totalNames = 0;
  const wrongLines: string[] = [];
  for (const f of fixtures()) {
    const reports = await reportsOf(f.dir, registry);
    const { dump, unmapped, stats } = dumpOf(f.slug, reports, catalog);
    const truth = truthOf(f.dir);
    const reps = new Set(files.filter((x) => x.startsWith(`${f.slug}.`)).map((x) => x.split(".")[2] === "json" ? "1" : x.split(".")[2]));
    for (const rep of [...reps].sort()) {
      const suggestions = dump.batches.flatMap((b) => {
        const name = rep === "1" && existsSync(join(dir, `${f.slug}.${b.n}.json`)) ? `${f.slug}.${b.n}.json` : `${f.slug}.${b.n}.${rep}.json`;
        const path = join(dir, name);
        if (!existsSync(path)) { console.log(`  missing ${name}`); return []; }
        const input = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
        return toSuggestions(input, b.names, catalog);
      });
      const judged = judge({ suggestions, model: ARM, budget: { spentUsd: 0, budgetUsd: 0, frozen: false, remainingUsd: 0, month: "" } }, unmapped, registry, stats, "2026-09-19");
      const t = zero();
      for (const a of unmapped) {
        const e = judged.entries[a.rawName];
        const want = truth[a.rawName];
        if (!want) { console.log(`  no truth for "${a.rawName}"`); continue; }
        const wantId = want.answer.startsWith("NEW:") ? null : want.answer;
        const isBlood = want.answer !== "NOT_BLOOD" && want.answer !== "IGNORE";
        const trapIds = new Set(want.wrong ?? []);
        const named = e.decision === "catalog" ? e.canonicalId : null;
        if (named && trapIds.has(named)) t.trap++;
        if (e.applied) {
          if (named === wantId) t.appliedRight++;
          else { t.appliedWrong++; wrongLines.push(`  ${f.slug} r${rep}: "${a.rawName}" applied → ${named}, truth ${want.answer} (${e.reason})`); }
        } else if (e.decision === "catalog") {
          if (named === wantId) t.shownRight++;
          else t.shownWrong++;
        } else if (e.decision === "not_blood") {
          if (!isBlood) t.parkedRight++; else t.leftAlone++;
        } else if (e.decision === "new") {
          if (want.answer.startsWith("NEW:")) t.parkedRight++; else t.leftAlone++;
        } else {
          t.leftAlone++;
        }
      }
      console.log(line(`${f.slug} r${rep}`, t, unmapped.length));
      add(total, t);
      totalNames += unmapped.length;
    }
  }
  console.log(line("total", total, totalNames));
  for (const l of wrongLines) console.log(l);
  if (total.appliedWrong > 0) throw new Error(`${total.appliedWrong} name(s) applied wrong — the gate let a wrong mapping through`);
});
