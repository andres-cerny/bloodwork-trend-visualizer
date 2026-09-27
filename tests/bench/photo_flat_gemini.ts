/**
 * C4, the Gemini half: the deployed Gemini reading call over the flattened
 * pages `photo_dump.ts` wrote (docs/plans/photo-capture.md, C4). **PAID.**
 * Run through `photo_flat_gemini.sh`, which names the modes and loads `.env`.
 *
 *   BENCH_MAX_USD=<cap> GEMINI_API_KEY=… npx vite-node tests/bench/photo_flat_gemini.ts [--only=slug,…] [--dry-run]
 *
 * The request is the deployed one — `callGemini` builds it with
 * `geminiImageRequest` from @bw/extraction: SYSTEM_EXTRACT, TOOL's schema,
 * media resolution GEMINI_MEDIA_RESOLUTION, temperature 0, thinking LOW — with
 * one attempt, as every bench does (a retry would read as latency).
 *
 * The cap is enforced here, not in the shell: before every call the recorded
 * spend of this arm (every answer file, failed calls included, all runs) plus
 * one call's ceiling must stay under BENCH_MAX_USD, or the run stops. A page
 * already answered is skipped, so `full` after `validate` pays only for what is
 * new, and a failed call is kept under another name so a rerun retries it.
 *
 * Writes, all git-ignored except the last:
 *   tests/bench/results/subagent/photo_flatlit/out/gemini_flatlit/<slug>.json
 *   tests/bench/results/photo_flat_spend.jsonl   one line per call
 *   tests/bench/photo-flat-spend-log.md          one row per run (committed)
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GEMINI_MEDIA_RESOLUTION, MODEL_GEMINI } from "@bw/extraction";

import { callGemini } from "./gemini";

const CLASS = "tests/bench/results/subagent/photo_flatlit";
const DIR = join(CLASS, "out", "gemini_flatlit");
const SPEND = "tests/bench/results/photo_flat_spend.jsonl";
const LOG = "tests/bench/photo-flat-spend-log.md";
/** The most one call has cost: ~2,550 input + ~4,500 output tokens at 0.75/3.75 per MTok is ≈ $0.019; 0.03 leaves room. */
export const CALL_CEILING_USD = 0.03;

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const dry = args.includes("--dry-run");
const cap = Number(process.env.BENCH_MAX_USD ?? "0");
const key = process.env.GEMINI_API_KEY ?? "";
if (!dry && !(cap > 0)) throw new Error("set BENCH_MAX_USD");
if (!dry && !key) throw new Error("GEMINI_API_KEY not set (the shell script sources .env)");
if (!existsSync(join(CLASS, "index.json"))) throw new Error(`no ${CLASS}/index.json — run photo_dump.ts first`);

mkdirSync(DIR, { recursive: true });
const index = JSON.parse(readFileSync(join(CLASS, "index.json"), "utf8")) as Array<{ slug: string; image: string }>;

/** Everything this arm has recorded spending, across runs. */
function spent(): number {
  let s = 0;
  for (const f of readdirSync(DIR)) if (f.endsWith(".json")) s += JSON.parse(readFileSync(join(DIR, f), "utf8")).call?.costUsd ?? 0;
  return s;
}

const todo = index.filter((p) => (!only || only.includes(p.slug)) && !existsSync(join(DIR, `${p.slug}.json`)));
const before = spent();
console.log(`gemini_flatlit: ${todo.length} pages to read; recorded spend ${before.toFixed(4)} USD; cap ${cap}; ≤ ${(todo.length * CALL_CEILING_USD).toFixed(2)} USD if all run`);
if (dry) {
  console.log(`model ${MODEL_GEMINI}, media resolution ${GEMINI_MEDIA_RESOLUTION}, first page ${todo[0]?.slug ?? "-"}`);
  process.exit(0);
}

const reader = { model: MODEL_GEMINI, provider: "google" as const, mediaResolution: GEMINI_MEDIA_RESOLUTION };
let total = before;
let calls = 0, failed = 0, stopped = false;
const queue = [...todo];
async function worker() {
  while (queue.length && !stopped) {
    if (total + CALL_CEILING_USD > cap) {
      stopped = true;
      console.log(`stopping: ${total.toFixed(4)} USD recorded, cap ${cap}`);
      break;
    }
    const p = queue.shift()!;
    const base64 = readFileSync(p.image).toString("base64");
    const call = await callGemini(key, reader, { kind: "image", base64, mediaType: "image/jpeg" });
    calls++;
    total += call.costUsd;
    if (!call.ok) failed++;
    const name = call.ok ? `${p.slug}.json` : `${p.slug}.failed-${Date.now()}.json`;
    writeFileSync(join(DIR, name), JSON.stringify({ slug: p.slug, at: new Date().toISOString(), call }));
    appendFileSync(SPEND, JSON.stringify({ at: new Date().toISOString(), slug: p.slug, ok: call.ok, usd: call.costUsd, usage: call.usage, ms: Math.round(call.ms) }) + "\n");
    console.log(`${p.slug}: ${call.ok ? "ok" : `FAIL ${call.error}`} ${Math.round(call.ms)} ms $${call.costUsd.toFixed(4)} (total ${total.toFixed(4)})`);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const run = total - before;
if (!existsSync(LOG))
  writeFileSync(LOG, "# Photo-capture C4: paid spend log\n\nGemini over the flattened photos (`photo_flat_gemini.sh`). Budget cap: USD 9 (Ondřej, 2026-09-26).\n\n| When | Pages | Failed | USD this run | USD total |\n|---|---|---|---|---|\n");
appendFileSync(LOG, `| ${new Date().toISOString().slice(0, 16).replace("T", " ")} | ${calls} | ${failed} | ${run.toFixed(4)} | ${total.toFixed(4)} |\n`);
console.log(`spent this run ${run.toFixed(4)} USD over ${calls} calls (${failed} failed); arm total ${total.toFixed(4)} USD${stopped ? " — STOPPED at the cap" : ""}`);
