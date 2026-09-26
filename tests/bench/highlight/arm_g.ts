/**
 * Arms G and MG (docs/plans/photo-highlight.md): the locate asks from
 * locate_prompts.ts sent to Gemini 3.8 Flash. **Paid.** A separate call after
 * reading; the deployed reading call is not touched.
 *
 * Settings mirror the deployed Gemini reader (tests/bench/gemini.ts header):
 * temperature 0, thinking LOW (MINIMAL is rejected by 3.8 Flash), the image as
 * one part at ultra_high media resolution, JSON structured output, one attempt.
 *
 *   set -a; source .env; set +a
 *   BENCH_MAX_USD=<what is left> BW_ROOT=<checkout with data> \
 *     npx tsx tests/bench/highlight/arm_g.ts <G|MG> <flat|orig-geo> [--only=a,b] [--limit=N] [--dry-run]
 *
 *   flat     every photo's flattened view (the original for flat/dark/glare/crop,
 *            the oracle flattening for angle and twopage) — 133 photo views
 *   orig-geo the unflattened angle and twopage photos — 33
 *
 * A view already answered is skipped, so a rerun only pays for what failed.
 * The run stops before a call that would take the arm's recorded spend (all
 * runs, from the answer files) past BENCH_MAX_USD. After the calls it writes
 * pred files for every answered photo view, like subagent_collect.ts.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GoogleGenAI, PartMediaResolutionLevel, ThinkingLevel, Type, type GenerateContentParameters, type Schema } from "@google/genai";

import { MODEL_GEMINI } from "@bw/extraction";

import { priceUsd } from "../extract";
import { RESULTS, loadTransforms, readerRows, views, type View } from "./common";
import type { Box } from "./geometry";
import { LOCATE_BOX, LOCATE_MARK, rowList } from "./locate_prompts";
import { drawMarks } from "./marks";

const args = process.argv.slice(2);
const arm = args[0] as "G" | "MG";
const set = args[1] as "flat" | "orig-geo";
if (!["G", "MG"].includes(arm) || !["flat", "orig-geo"].includes(set)) throw new Error("usage: arm_g.ts <G|MG> <flat|orig-geo>");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice(8) ?? Infinity);
const dry = args.includes("--dry-run");
const cap = Number(process.env.BENCH_MAX_USD ?? "0");
if (!dry && !(cap > 0)) throw new Error("set BENCH_MAX_USD to what is left of the budget");
const key = process.env.GEMINI_API_KEY ?? "";
if (!dry && !key) throw new Error("GEMINI_API_KEY not set (source .env)");

const dir = join(RESULTS, "gemini", arm);
mkdirSync(dir, { recursive: true });

const GEO = new Set(["angle", "twopage"]);
const t = loadTransforms();
const all = views(t);

/** The images this run asks about, one call each. */
function pick(): View[] {
  const out: View[] = [];
  const seen = new Set<string>();
  for (const v of all) {
    const geo = GEO.has(t[v.photo].condition);
    if (set === "flat" && v.variant !== "flat") continue;
    if (set === "orig-geo" && (v.variant !== "orig" || !geo)) continue;
    if (only && !only.some((o) => v.photo.startsWith(o))) continue;
    // flat/dark/glare/crop: the flat view is the original file; ask about it once, as "orig".
    const tag = set === "flat" && !geo ? `${v.id}.orig` : `${v.id}.${v.variant}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push({ ...v, variant: set === "flat" && !geo ? "orig" : v.variant });
  }
  return out;
}

const boxSchema: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      i: { type: Type.INTEGER },
      box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER }, nullable: true },
    },
    required: ["i", "box_2d"],
    propertyOrdering: ["i", "box_2d"],
  },
};
const markSchema: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: { i: { type: Type.INTEGER }, mark: { type: Type.INTEGER, nullable: true } },
    required: ["i", "mark"],
    propertyOrdering: ["i", "mark"],
  },
};

function request(image: Buffer, rows: string): GenerateContentParameters {
  return {
    model: MODEL_GEMINI,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: image.toString("base64"), mimeType: "image/jpeg" }, mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH } },
          { text: `Řádky:\n${rows}` },
        ],
      },
    ],
    config: {
      systemInstruction: arm === "G" ? LOCATE_BOX : LOCATE_MARK,
      temperature: 0,
      maxOutputTokens: 12000,
      responseMimeType: "application/json",
      responseSchema: arm === "G" ? boxSchema : markSchema,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      httpOptions: { retryOptions: { attempts: 1 } },
    },
  };
}

function spent(): number {
  let s = 0;
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) s += JSON.parse(readFileSync(join(dir, f), "utf8")).costUsd ?? 0;
  return s;
}

async function main() {
  const todo = pick().filter((v) => !existsSync(join(dir, `${v.id}.${v.variant}.json`))).slice(0, limit);
  const before = spent();
  console.log(`${arm} ${set}: ${todo.length} calls to make; recorded spend so far ${before.toFixed(4)} USD; cap ${cap}`);
  if (dry) {
    const v = todo[0];
    if (v) {
      const r = request(Buffer.from(""), rowList(readerRows(v.photo)));
      console.log(JSON.stringify({ ...r, contents: "<image + rows>" }, null, 1).slice(0, 1500));
    }
    return;
  }
  const ai = new GoogleGenAI({ apiKey: key });
  let total = before;
  let stop = false;
  const queue = [...todo];
  async function worker() {
    while (queue.length && !stop) {
      const v = queue.shift()!;
      // Stop when the next call could cross the cap (a call costs ~1-2 cents).
      if (total + 0.03 > cap) {
        stop = true;
        console.log(`stopping: ${total.toFixed(4)} USD spent, cap ${cap}`);
        break;
      }
      let image: Buffer;
      let marks: Record<number, Box> | undefined;
      if (arm === "MG") {
        const mdir = join(RESULTS, "gemini", "MG-images");
        mkdirSync(mdir, { recursive: true });
        const img = join(mdir, `${v.id}.${v.variant}.jpg`);
        marks = await drawMarks(v, img);
        image = readFileSync(img);
      } else {
        image = readFileSync(v.path);
      }
      const t0 = performance.now();
      const rec: Record<string, unknown> = { arm, id: v.id, variant: v.variant, photo: v.photo, size: v.size };
      try {
        const r = await ai.models.generateContent(request(image, rowList(readerRows(v.photo))));
        const u = r.usageMetadata;
        const usage = {
          inputTokens: u?.promptTokenCount ?? 0,
          outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
          cacheReadTokens: u?.cachedContentTokenCount ?? 0,
          cacheWriteTokens: 0,
        };
        rec.usage = usage;
        rec.costUsd = priceUsd(MODEL_GEMINI, usage);
        rec.ms = performance.now() - t0;
        rec.finish = r.candidates?.[0]?.finishReason ?? null;
        try {
          rec.answer = JSON.parse((r.text ?? "").trim());
          rec.ok = Array.isArray(rec.answer);
        } catch (e: any) {
          rec.ok = false;
          rec.error = `unparseable: ${e?.message ?? e}`;
        }
      } catch (e: any) {
        rec.ok = false;
        rec.costUsd = 0;
        rec.ms = performance.now() - t0;
        rec.error = `${e?.status ?? ""} ${e?.message ?? String(e)}`.slice(0, 300);
      }
      if (marks) rec.marks = marks;
      total += (rec.costUsd as number) ?? 0;
      // A failed call is recorded under another name so a rerun retries it, while its cost still counts.
      const name = rec.ok ? `${v.id}.${v.variant}.json` : `${v.id}.${v.variant}.failed-${Date.now()}.json`;
      writeFileSync(join(dir, name), JSON.stringify(rec));
      console.log(`${v.id}.${v.variant}: ${rec.ok ? "ok" : "FAIL " + rec.error} ${Math.round(rec.ms as number)} ms $${((rec.costUsd as number) ?? 0).toFixed(4)} (total ${total.toFixed(4)})`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`${arm} ${set}: spent this run ${(total - before).toFixed(4)} USD, arm total ${total.toFixed(4)} USD`);
  collect();
}

/** Answers -> pred files, keyed like arm T's. */
function collect() {
  const out = join(RESULTS, "pred", arm);
  mkdirSync(out, { recursive: true });
  const groups = new Map<string, any[]>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.includes(".failed-")) continue;
    const rec = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const k = `${rec.photo.replace(/\.jpg$/, "")}.${rec.variant}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(rec);
  }
  // A two-page photo's flat view is two images; only collect it when both answered.
  const flatPages = (photo: string) => all.filter((v) => v.photo === photo && v.variant === "flat").length;
  let n = 0;
  for (const [k, recs] of groups) {
    const photo = recs[0].photo;
    if (recs[0].variant === "flat" && recs.length < flatPages(photo)) continue;
    const reads = readerRows(photo);
    const per = recs.map((rec) => {
      const pred: Array<{ view: string; box: Box } | null> = reads.map(() => null);
      for (const a of rec.answer as any[]) {
        const i = Number(a.i);
        if (!Number.isInteger(i) || i < 0 || i >= reads.length) continue;
        if (arm === "G") {
          const b = a.box_2d;
          if (!Array.isArray(b) || b.length !== 4) continue;
          const [ymin, xmin, ymax, xmax] = b;
          const [W, H] = rec.size;
          pred[i] = { view: rec.id, box: [(xmin / 1000) * W, (ymin / 1000) * H, (xmax / 1000) * W, (ymax / 1000) * H] };
        } else if (typeof a.mark === "number" && rec.marks[String(a.mark)]) {
          pred[i] = { view: rec.id, box: rec.marks[String(a.mark)] };
        }
      }
      return pred;
    });
    const merged = reads.map((_, i) => {
      const hits = per.map((p) => p[i]).filter(Boolean);
      return hits.length === 1 ? hits[0] : null;
    });
    writeFileSync(join(out, `${k}.json`), JSON.stringify(merged));
    n++;
  }
  console.log(`collected ${n} photo views -> ${out}`);
}

await main();
