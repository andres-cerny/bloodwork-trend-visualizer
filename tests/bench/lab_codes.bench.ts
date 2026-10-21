/**
 * The lab code table on printed names: how often a plain lookup lands on the
 * right NČLP code, how often a 20-row shortlist holds it, and — paid, opt-in —
 * how often Haiku picks it from that shortlist. docs/plans/lab-codes.md.
 *
 *   npm run bench:codes                                    free
 *   with-secrets bloodwork -- env BENCH_HAIKU=1 BENCH_MAX_USD=0.30 npm run bench:codes
 *
 * Two name sets, both committed facts (no patient values):
 *   - synthetic: the four labs under packages/lab-core/tests/fixtures/labs —
 *     a catalog answer is right when the code is one of that catalog entry's
 *     linked codes (codes/curation.json); NEW / NOT_BLOOD names are judged
 *     against lab_codes_truth.json.
 *   - public: every distinct (name, unit) on the public sample sheets
 *     (tests/bench/public_sheets), labelled independently with NČLP codes in
 *     lab_codes_truth.json.
 *
 * Two modes: NČLP's own names only (what the code list brings by itself), and
 * with the `common` names the catalog lends each linked component — the table
 * as shipped. A name without a prefix gets the material its section heading
 * states ("Moč…" → urine, "odpady"/"sběr" → collected urine), as matchRow
 * does at runtime from the heading above a row; nothing else is inferred.
 *
 * The model sees the printed name, unit, printed range and the shortlist,
 * nothing else; no value is sent.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { LabCodes, describeForModel, type LabCodeHit, type LabCodeTable } from "../../packages/lab-core/src/labCodes";
import { readerShape, toolFor } from "../../packages/extraction/src/models";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), "utf-8")) as T;

interface Case {
  set: string;
  name: string;
  unit: string;
  range?: string;
  section?: string;
  accept: string[];
  kind: "MEASURE" | "IGNORE" | "NONE";
}

type TruthRow = Case;

/** The material a section heading states, or null (normalize.ts codes). */
function headingMaterial(section: string | undefined): string | null {
  const s = (section ?? "").toLowerCase();
  if (/odpad|sběr/.test(s)) return "du";
  if (/\bmoč|\bmoc\b|urin|sediment/.test(s)) return "u";
  if (/punktát/.test(s)) return "x";
  return null;
}

function cases(): Case[] {
  const truth = read<TruthRow[]>("tests/bench/lab_codes_truth.json");
  const curation = read<{ catalog: Record<string, { nclp: string[] }> }>("packages/lab-core/codes/curation.json");
  const out: Case[] = [];
  const labelled = new Map(truth.map((t) => [`${t.set}|${t.name}|${t.unit}`, t]));
  const labs = join(ROOT, "packages/lab-core/tests/fixtures/labs");
  for (const lab of readdirSync(labs).sort()) {
    const t = read<Record<string, { answer: string; unit?: string }>>(`packages/lab-core/tests/fixtures/labs/${lab}/truth.json`);
    for (const [name, v] of Object.entries(t)) {
      if (name === "_about") continue;
      const unit = v.unit ?? "";
      const own = labelled.get(`synthetic:${lab}|${name}|${unit}`);
      if (own) {
        out.push({ ...own, unit });
        continue;
      }
      if (v.answer === "IGNORE") {
        out.push({ set: `synthetic:${lab}`, name, unit, accept: [], kind: "IGNORE" });
        continue;
      }
      const link = curation.catalog[v.answer];
      out.push({
        set: `synthetic:${lab}`, name, unit,
        accept: link?.nclp ?? [],
        kind: link?.nclp.length ? "MEASURE" : "NONE",
      });
    }
  }
  for (const t of truth) if (t.set.startsWith("public:")) out.push(t);
  return out;
}

interface Score {
  n: number; right: number; wrong: number; none: number; at5: number; at20: number;
  /** The right code exists in NČLP but the table left it out (drug levels, punctate fluids). */
  outside: number;
  misses: string[];
}

/** The truth's codes as table rows: a method-specific key counts as its generic row. */
function accepted(codes: LabCodes, c: Case): Set<string> {
  return new Set(c.accept.map((a) => codes.byId(a)?.id).filter((x): x is string => !!x));
}

function score(codes: LabCodes, cs: Case[]): Score {
  const s: Score = { n: 0, right: 0, wrong: 0, none: 0, at5: 0, at20: 0, outside: 0, misses: [] };
  for (const c of cs) {
    if (c.kind !== "MEASURE") continue;
    s.n++;
    const want = accepted(codes, c);
    if (!want.size) s.outside++;
    const mat = headingMaterial(c.section);
    const hits = codes.lookup(c.name, c.unit, mat);
    const ok = (h: LabCodeHit) => want.has(h.row.id);
    if (!hits.length) s.none++;
    else if (ok(hits[0])) s.right++;
    else {
      s.wrong++;
      s.misses.push(`${c.name} [${c.unit}] → ${hits[0].row.id} ${hits[0].row.names.cs.name} (want ${c.accept.join("/")})`);
    }
    const sl = codes.shortlist(c.name, c.unit, mat, 20);
    if (sl.slice(0, 5).some(ok)) s.at5++;
    if (sl.some(ok)) s.at20++;
    else s.misses.push(`  not in shortlist: ${c.name} [${c.unit}] (want ${c.accept.join("/")})`);
  }
  return s;
}

const pct = (a: number, n: number) => `${a}/${n} (${n ? Math.round((100 * a) / n) : 0} %)`;

function report(title: string, s: Score) {
  console.log(`\n${title}`);
  console.log(`  lookup right ${pct(s.right, s.n)} · wrong ${s.wrong} · no hit ${s.none} · right code outside the table ${s.outside}`);
  console.log(`  shortlist@5 ${pct(s.at5, s.n)} · shortlist@20 ${pct(s.at20, s.n)}`);
}

// ------------------------------------------------------------- paid: Haiku

const MODEL = process.env.BENCH_MODEL ?? "claude-haiku-5-5";
const PRICE: Record<string, [number, number]> = { "claude-haiku-5-5": [0.1, 0.5], "claude-haiku-4-5": [1, 5] };

const SYSTEM = [
  "Přiřazuješ názvy laboratorních vyšetření z českých a slovenských výsledkových listů ke kódům NČLP.",
  "Dostaneš název přesně jak je vytištěn, jednotku, referenční mez a krátký seznam kandidátů (kód | název NČLP | materiál | druh veličiny | jednotka).",
  "Vyber kód, který označuje totéž vyšetření ve stejném materiálu a se stejným druhem veličiny (procenta odpovídají podílu [1]).",
  "Prefix S_ je sérum, P_ plazma, B_ krev, U_ moč, dU_ sbíraná moč. Bez prefixu a bez oddílu, který říká jinak, vyber u biochemie sérum (S), u krevního obrazu krev (B) — sérum a plazma jsou zde rovnocenné, nejde o důvod k \"unknown\".",
  "Konvenční jednotka (mg/dl, µg/dl, ng/ml, pg/ml, U/l) je jen jiný zápis téhož vyšetření: když kandidát se stejnou jednotkou není, vyber totéž vyšetření ve stejném materiálu, přepočet jednotky se řeší jinde.",
  "Arteriální, žilní a kapilární varianty vybírej jen tehdy, když to název nebo oddíl říká.",
  "\"unknown\" odpověz jen tehdy, když mezi kandidáty to vyšetření opravdu není, nebo když by šlo o jiný analyt či jiný materiál (moč vs krev).",
].join(" ");

async function pick(client: Anthropic, c: Case, shortlist: LabCodeHit[]) {
  const ids = shortlist.map((h) => h.row.id);
  const tool = {
    name: "pick_code",
    description: "Kód NČLP pro vytištěný název, nebo unknown.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", enum: [...ids, "unknown"] },
        reason: { type: "string" },
      },
      required: ["code", "reason"],
      additionalProperties: false,
    },
  };
  const shape = readerShape(MODEL, tool.name);
  const lines = [
    `Název: ${c.name}`,
    `Jednotka: ${c.unit || "(žádná)"}`,
    `Referenční mez: ${c.range || "(nevytištěna)"}`,
    `Oddíl listu: ${c.section || "(neuveden)"}`,
    "Kandidáti:",
    ...shortlist.map((h) => describeForModel(h.row)),
  ];
  if (shape.nudge) lines.push(shape.nudge);
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: SYSTEM,
    tools: [toolFor(MODEL, tool) as Anthropic.Tool],
    tool_choice: shape.tool_choice,
    ...shape.extra,
    messages: [{ role: "user", content: lines.join("\n") }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  const block = msg.content.find((b) => b.type === "tool_use");
  const input = block && block.type === "tool_use" ? (block.input as { code?: string; reason?: string }) : {};
  const [pin, pout] = PRICE[MODEL] ?? [1, 5];
  const usd = (msg.usage.input_tokens * pin + msg.usage.output_tokens * pout) / 1e6;
  return { code: typeof input.code === "string" && (ids.includes(input.code) || input.code === "unknown") ? input.code : "unknown", reason: String(input.reason ?? ""), usd };
}

async function haiku(codes: LabCodes, cs: Case[]) {
  const max = Number(process.env.BENCH_MAX_USD ?? "0.30");
  const client = new Anthropic();
  let spent = 0;
  const s = { n: 0, right: 0, wrong: 0, unknown: 0, notOffered: 0, skipped: 0 };
  const wrong: string[] = [];
  const todo = cs.filter((c) => c.kind === "MEASURE").slice(0, Number(process.env.BENCH_LIMIT ?? "100000"));
  const queue = [...todo];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (spent >= max) {
        s.skipped++;
        continue;
      }
      const sl = codes.shortlist(c.name, c.unit, headingMaterial(c.section), 20);
      const { code, reason, usd } = await pick(client, c, sl);
      spent += usd;
      s.n++;
      const want = accepted(codes, c);
      if (!sl.some((h) => want.has(h.row.id))) s.notOffered++;
      if (code === "unknown") {
        s.unknown++;
        if (process.env.BENCH_VERBOSE) console.log(`  unknown: ${c.name} [${c.unit}] (offered: ${sl.some((h) => want.has(h.row.id))}) — ${reason}`);
      } else if (want.has(code)) s.right++;
      else {
        s.wrong++;
        wrong.push(`${c.name} [${c.unit}] → ${code} ${codes.byId(code)?.names.cs.name} (want ${c.accept.join("/")})`);
      }
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  console.log(`\n${MODEL} picking from the 20-row shortlist (shipped table, all measured names)`);
  console.log(`  right ${pct(s.right, s.n)} · wrong ${s.wrong} · unknown ${s.unknown} · right code not offered ${s.notOffered} · skipped (cap) ${s.skipped}`);
  console.log(`  spent $${spent.toFixed(4)} (cap $${max})`);
  for (const w of wrong) console.log(`  wrong: ${w}`);
}

it("lab codes: lookup and shortlist on printed names", async () => {
  const table = read<LabCodeTable>("packages/lab-core/codes/lab-codes.json");
  const all = cases();
  const nclp = new LabCodes(table, { nclpOnly: true });
  const shipped = new LabCodes(table);
  const sets = [...new Set(all.map((c) => c.set.split(":")[0]))];
  const kinds = all.reduce<Record<string, number>>((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {});
  console.log(`${all.length} printed names · ${JSON.stringify(kinds)} · ${table.rows.length} code rows`);
  for (const set of sets) {
    const cs = all.filter((c) => c.set.startsWith(set + ":"));
    const a = score(nclp, cs);
    const w = score(shipped, cs);
    report(`${set} — NČLP names only`, a);
    report(`${set} — with the catalog's common names (as shipped)`, w);
    if (process.env.BENCH_VERBOSE) for (const m of w.misses) console.log("   ", m);
  }
  if (process.env.BENCH_HAIKU) await haiku(shipped, all);
});
