/**
 * The mapping fallback through the lab-code table (docs/plans/lab-codes.md,
 * docs/plans/model-loop.md round 5) — the order after the catalog and the
 * saved (lab, name, unit) decisions have both said nothing:
 *
 *   1. code lookup — an exact name key in the NČLP table (catalog vocabulary
 *      lent). A best hit (or an S/P pair) linked to exactly one catalog entry
 *      IS that entry, no model. A best hit on a row the catalog does not link
 *      is a known test the catalog lacks: a "new" proposal pre-filled from
 *      the code (Czech name, unit), no model.
 *   2. the model — by default today's whole-catalog call for the names the
 *      lookup left, with a code attached where the answer's entry links one
 *      (`codeForCatalog`); or, with step "shortlist", the 20 rows most like the name: Haiku picks one
 *      code from exactly those (enum) or "unknown". The pick's specimen must
 *      agree with the printed prefix, else its confidence drops to "low" (so
 *      the portal never files it unasked). The picked row then maps through
 *      its catalog link like a lookup hit.
 *   3. unknown.
 *
 * The answer has today's `MapSuggestion` shape plus the NČLP `code`, so the
 * portal's gate (`catalog` + `high` + `canApplyUnasked`) is unchanged. The
 * model never sees the whole catalog, only the shortlist — and never a value.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { clientFor, usageOf, type Usage } from "@bw/agent-core";
import { LabCodes, MATERIAL_CODES, describeForModel, materialPrefix, type LabCodeHit, type LabCodeRow } from "@bw/lab-core";

import { suggestCanonical, type CatalogEntry, type MapResult, type MapSuggestion, type NameToMap } from "./map";
import { readerShape, toolFor } from "./models";

/** The shortlist prompt, measured in tests/bench/lab_codes.bench.ts (sharpened run: 90 % right). */
export const SYSTEM_PICK = [
  "Přiřazuješ názvy laboratorních vyšetření z českých a slovenských výsledkových listů ke kódům NČLP.",
  "Dostaneš název přesně jak je vytištěn, jednotku, referenční mez a krátký seznam kandidátů (kód | název NČLP | materiál | druh veličiny | jednotka).",
  "Vyber kód, který označuje totéž vyšetření ve stejném materiálu a se stejným druhem veličiny (procenta odpovídají podílu [1]).",
  "Prefix S_ je sérum, P_ plazma, B_ krev, U_ moč, dU_ sbíraná moč. Bez prefixu a bez oddílu, který říká jinak, vyber u biochemie sérum (S), u krevního obrazu krev (B) — sérum a plazma jsou zde rovnocenné, nejde o důvod k \"unknown\".",
  "Konvenční jednotka (mg/dl, µg/dl, ng/ml, pg/ml, U/l) je jen jiný zápis téhož vyšetření: když kandidát se stejnou jednotkou není, vyber totéž vyšetření ve stejném materiálu, přepočet jednotky se řeší jinde.",
  "Arteriální, žilní a kapilární varianty vybírej jen tehdy, když to název nebo oddíl říká.",
  "\"unknown\" odpověz jen tehdy, když mezi kandidáty to vyšetření opravdu není, nebo když by šlo o jiný analyt či jiný materiál (moč vs krev).",
  "Název s časovým údajem nebo zátěží (po zátěži, 60 min, nalačno, po jídle) nebo s jiným materiálem v názvu (v erytrocytech, v moči, v punktátu) je jiné vyšetření než kandidát bez toho údaje: pokud takový kandidát není, odpověz \"unknown\".",
  "Confidence \"high\" jen tehdy, když název, materiál i druh veličiny jednoznačně sedí.",
].join(" ");

const PICK = "pick_code";
const SHORTLIST = 20;
/** Names asked at once; each is its own small call. */
const IN_FLIGHT = 6;

/** The best hits: those sharing the top score. */
function best(hits: LabCodeHit[]): LabCodeRow[] {
  if (hits.length === 0) return [];
  const top = hits[0].score;
  return hits.filter((h) => Math.abs(h.score - top) < 1e-9).map((h) => h.row);
}

/** The single catalog entry these rows link to (within the client's catalog), or null. */
function catalogOf(rows: LabCodeRow[], ids: Set<string>): string | null | "many" {
  const linked = new Set(rows.flatMap((r) => (r.catalog ?? []).filter((c) => ids.has(c))));
  if (linked.size === 1) return [...linked][0];
  return linked.size === 0 ? null : "many";
}

/** Does the row's specimen agree with what the name's prefix says? Unknown prefix = no evidence. */
export function specimenAgrees(rawName: string, row: LabCodeRow): boolean {
  const p = materialPrefix(rawName);
  if (!p) return true;
  const want = p === "sp" || p === "s,p" ? ["s", "p"] : p === "fu" || p === "su" ? ["du"] : [p];
  if (["s", "p", "b", "u", "du", "sp", "s,p", "fu", "su"].includes(p)) return want.includes(row.mat);
  // A specimen the table has no rows for (PE_ erythrocytes, X_ punctate, L_
  // liquor…): no row of the table can be the same test, so a pick never
  // agrees. An unreadable prefix (xxx_) is no evidence either way.
  return !MATERIAL_CODES.has(p);
}

/** A proposal for a catalog entry from an NČLP row the catalog does not link. */
function proposal(row: LabCodeRow): MapSuggestion["proposed"] {
  return { id: `nclp_${row.id}`, displayNameCs: row.names.cs?.name.slice(0, 80) ?? row.id, unit: row.unit === "1" || row.unit === "-" ? "" : row.unit, material: row.mat };
}

/** A decision from the code rows a name resolved to: their single catalog entry, a "new" draft, or unknown. */
export function fromRows(n: NameToMap, rows: LabCodeRow[], ids: Set<string>, confidence: MapSuggestion["confidence"], how: string): MapSuggestion {
  const cid = catalogOf(rows, ids);
  const code = rows[0].id;
  if (typeof cid === "string") return { rawName: n.rawName, decision: "catalog", canonicalId: cid, proposed: null, reason: `NČLP ${code} (${how})`, confidence, code };
  if (cid === "many") return { rawName: n.rawName, decision: "unknown", canonicalId: null, proposed: null, reason: `NČLP ${code} odpovídá více položkám katalogu`, confidence: "low", code };
  return { rawName: n.rawName, decision: "new", canonicalId: null, proposed: proposal(rows[0]), reason: `NČLP ${code}: ${rows[0].names.cs?.name ?? ""}`.slice(0, 300), confidence, code };
}

/** One model pick from a shortlist: an enum of its codes + "unknown". */
export async function pick(client: Anthropic, model: string, n: NameToMap, shortlist: LabCodeHit[]): Promise<{ code: string; confidence: MapSuggestion["confidence"]; reason: string; usage: Usage }> {
  const ids = shortlist.map((h) => h.row.id);
  const tool = {
    name: PICK,
    description: "Kód NČLP pro vytištěný název, nebo unknown.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string", enum: [...ids, "unknown"] },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        reason: { type: "string", description: "Nejvýše deset slov česky." },
      },
      required: ["code", "confidence", "reason"],
    },
  };
  const shape = readerShape(model, PICK);
  const lines = [
    `Název: ${n.rawName}`,
    `Jednotka: ${n.unit || "(žádná)"}`,
    `Referenční mez: ${n.refRange || "(nevytištěna)"}`,
    `Materiál podle listu: ${n.material ?? "(neuveden)"}`,
    "Kandidáti:",
    ...shortlist.map((h) => describeForModel(h.row)),
  ];
  if (shape.nudge) lines.push(shape.nudge);
  const msg = await client.messages.create({
    model,
    max_tokens: 400,
    system: SYSTEM_PICK,
    tools: [toolFor(model, tool as unknown as Anthropic.Tool)],
    tool_choice: shape.tool_choice,
    ...shape.extra,
    messages: [{ role: "user", content: lines.join("\n") }],
  } as Anthropic.MessageCreateParamsNonStreaming);
  const usage = usageOf(msg.usage);
  const block = msg.content.find((b) => b.type === "tool_use");
  const input = (block && block.type === "tool_use" ? block.input : {}) as { code?: unknown; confidence?: unknown; reason?: unknown };
  // The enum is the contract; anything outside it is "unknown", never a guess.
  const code = typeof input.code === "string" && (ids.includes(input.code) || input.code === "unknown") ? input.code : "unknown";
  const confidence = input.confidence === "high" || input.confidence === "medium" ? input.confidence : "low";
  return { code, confidence, reason: typeof input.reason === "string" ? input.reason.slice(0, 200) : "", usage };
}

/**
 * The NČLP code of a catalog answer, when the entry links exactly one row for
 * the printed specimen (serum when nothing is printed). Null when the entry
 * links none or the specimen leaves a choice — a code is attached only when
 * it is unambiguous.
 */
export function codeForCatalog(codes: LabCodes, canonicalId: string, n: NameToMap): string | null {
  const rows = codes.forCatalog(canonicalId);
  if (rows.length === 0) return null;
  const p = materialPrefix(n.rawName) ?? n.material ?? null;
  const want = p === "sp" || p === "s,p" ? "s" : p && ["s", "p", "b", "u", "du"].includes(p) ? p : "s";
  const same = rows.filter((r) => r.mat === want);
  const pick = same.length ? same : rows.length === 1 ? rows : [];
  return pick.length === 1 ? pick[0].id : null;
}

/**
 * Which model step follows the lookup: "catalog" (default) sends the names
 * the lookup did not settle to today's whole-catalog call (`suggestCanonical`)
 * and attaches a code where the answer's entry links one; "shortlist" asks the
 * model to pick from 20 NČLP rows per name. Round 5 measured the catalog step
 * as more accurate and cheaper on names the catalog has never seen (held-out:
 * 123 vs 111 of 133 right, 0 vs 1 confident wrong, $0.008 vs $0.029), so the
 * shortlist step stays opt-in. "catalog+shortlist" (round 6, the winner of
 * six arms): the catalog call first, and only its "unknown" answers get a
 * second try from the shortlist — 131/133 unseen spellings, 11/11 public
 * misses, 33/40 tests not in the catalog, 0 confidently wrong.
 */
export type CodeMapStep = "catalog" | "catalog+shortlist" | "shortlist";

export async function mapByCodes(
  apiKey: string,
  model: string,
  names: NameToMap[],
  catalog: CatalogEntry[],
  codes: LabCodes,
  step: CodeMapStep = "catalog",
): Promise<MapResult & { asked: number }> {
  const ids = new Set(catalog.map((c) => c.id));
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const out: MapSuggestion[] = new Array(names.length);
  const toAsk: number[] = [];
  const drafts = new Map<number, MapSuggestion>();
  const toConfirm: number[] = [];

  names.forEach((n, i) => {
    const hits = codes.lookup(n.rawName, n.unit, n.material);
    const rows = best(hits);
    // A unique best hit, or an S/P pair, that names one catalog entry: no model.
    const sameComp = rows.length > 0 && rows.every((r) => r.comp === rows[0].comp && r.prop === rows[0].prop);
    if (rows.length > 0 && sameComp && rows.every((r) => specimenAgrees(n.rawName, r))) {
      // A hit the catalog links is that entry ("high"). A hit it does not link
      // is a "new" draft: "high" only when the printed unit is the row's own
      // and the printed specimen is the row's — the bar for adding it to the
      // catalog without a person (VITE_AUTO_ENTRIES).
      const linked = rows.some((r) => (r.catalog ?? []).some((c) => ids.has(c)));
      const exact = hits[0].unit === 2 && hits[0].material === 2;
      const s = fromRows(n, rows, ids, linked || exact ? "high" : "medium", "vyhledání");
      if (s.decision === "catalog") {
        out[i] = s;
        return;
      }
      // An unlinked hit is a draft, not yet an answer: the catalog may still
      // hold the test under a name the code table does not lend it
      // ("Granulocyty" → neutrofily_abs, round 6). The catalog call decides
      // first; the draft stands only where it finds nothing.
      if (s.decision === "new") {
        drafts.set(i, s);
        if (step === "shortlist") {
          out[i] = s;
          return;
        }
      }
    }
    toAsk.push(i);
  });

  let asked = 0;
  let shortlistFor = toAsk;
  if (step === "catalog" || step === "catalog+shortlist") {
    if (toAsk.length === 0) return { suggestions: out, usage, model, asked: 0 };
    const rest = toAsk.map((i) => names[i]);
    const r = await suggestCanonical(apiKey, model, rest, catalog);
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
    usage.cacheReadTokens += r.usage.cacheReadTokens;
    usage.cacheWriteTokens += r.usage.cacheWriteTokens;
    asked += rest.length;
    const by = new Map(r.suggestions.map((x) => [x.rawName, x]));
    toAsk.forEach((i) => {
      const n = names[i];
      const x = by.get(n.rawName) ?? { rawName: n.rawName, decision: "unknown" as const, canonicalId: null, proposed: null, reason: "Model tento název nezařadil.", confidence: "low" as const };
      const draft = drafts.get(i);
      if (draft && x.decision !== "catalog") {
        // Standing drafts are "high" only after the model agrees (below).
        out[i] = draft.confidence === "high" ? { ...draft, confidence: "medium" } : draft;
        if (draft.confidence === "high") toConfirm.push(i);
        return;
      }
      out[i] = { ...x, code: x.decision === "catalog" && x.canonicalId ? codeForCatalog(codes, x.canonicalId, n) : null };
    });
    if (step === "catalog") return { suggestions: out, usage, model: r.model, asked };
    // The second try: only what the catalog call could not place.
    // "new" without a code is the model's own proposal for a test the
    // catalog lacks: the shortlist may still find its code.
    shortlistFor = toAsk.filter((i) => out[i].decision === "unknown" || (out[i].decision === "new" && !out[i].code));
  }

  const client = clientFor(apiKey);
  // An exact code hit the catalog lacks becomes a "high" draft (the bar for
  // VITE_AUTO_ENTRIES) only when the model, shown the shortlist around it,
  // picks the same code.
  await Promise.all(
    toConfirm.map(async (i) => {
      const n = names[i];
      const sl = codes.shortlist(n.rawName, n.unit, n.material, SHORTLIST);
      if (!sl.some((h) => h.row.id === out[i].code)) return;
      const p = await pick(client, model, n, sl);
      usage.inputTokens += p.usage.inputTokens;
      usage.outputTokens += p.usage.outputTokens;
      usage.cacheReadTokens += p.usage.cacheReadTokens;
      usage.cacheWriteTokens += p.usage.cacheWriteTokens;
      asked++;
      if (p.code === out[i].code && p.confidence === "high") out[i] = { ...out[i], confidence: "high", reason: `${out[i].reason}; model souhlasí` };
    }),
  );

  let next = 0;
  const worker = async () => {
    for (let k = next++; k < shortlistFor.length; k = next++) {
      const i = shortlistFor[k];
      const n = names[i];
      const sl = codes.shortlist(n.rawName, n.unit, n.material, SHORTLIST);
      if (sl.length === 0) {
        out[i] = { rawName: n.rawName, decision: "unknown", canonicalId: null, proposed: null, reason: "Žádný podobný kód NČLP.", confidence: "low", code: null };
        continue;
      }
      asked++;
      const p = await pick(client, model, n, sl);
      usage.inputTokens += p.usage.inputTokens;
      usage.outputTokens += p.usage.outputTokens;
      usage.cacheReadTokens += p.usage.cacheReadTokens;
      usage.cacheWriteTokens += p.usage.cacheWriteTokens;
      if (p.code === "unknown") {
        // The catalog call's own "new" proposal stays; otherwise unknown.
        if (out[i]?.decision !== "new") out[i] = { rawName: n.rawName, decision: "unknown", canonicalId: null, proposed: null, reason: p.reason, confidence: "low", code: null };
        continue;
      }
      const row = codes.byId(p.code)!;
      // The specimen check the model's pick must pass (lab-codes.md: B_Glukóza picked as serum).
      const agrees = specimenAgrees(n.rawName, row);
      const s = fromRows(n, [row], ids, agrees ? p.confidence : "low", "model");
      out[i] = { ...s, reason: (agrees ? p.reason || s.reason : `materiál kódu nesedí s prefixem; ${p.reason}`).slice(0, 300) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(IN_FLIGHT, shortlistFor.length) }, worker));
  return { suggestions: out, usage, model, asked };
}
