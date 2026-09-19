/**
 * The mapping fallback: names the deterministic match left null, put to a
 * model with the whole catalog beside them.
 *
 * The registry is an exact lookup on a normalised name, and that is right for
 * the labs it has seen. For a lab it has not, the gap is vocabulary — "S_Na"
 * is sodium to anyone who has read a lab sheet, and to nothing in a bigram
 * similarity — and vocabulary is what a model has. So each unmatched name goes
 * out with its printed unit, interval and material, the catalog goes out as
 * id, name and unit, and the model files each name under one of four answers:
 * a catalog id, a new entry it proposes, "not blood", or "unknown".
 *
 * What the model says is a *suggestion*. The screen still runs the
 * deterministic evidence over it (unit, interval, material, magnitude) and
 * only an uncontradicted suggestion is applied without a click. The model
 * never sees a value — names, units and intervals only.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { clientFor, usageOf, type Usage } from "@bw/agent-core";
import { MODEL_ESCALATION } from "./extract";

/** One unmatched printed name, as the screen knows it. */
export interface NameToMap {
  rawName: string;
  unit: string;
  /** The printed reference interval, verbatim ("49,0 - 90,0", "< 1,12"). */
  refRange: string;
  /** Lowercase material code off the prefix (s, b, p, u…), or null. */
  material: string | null;
}

export interface CatalogEntry {
  id: string;
  name: string;
  unit: string;
}

export type MapDecision = "catalog" | "new" | "not_blood" | "unknown";

export interface MapSuggestion {
  rawName: string;
  decision: MapDecision;
  /** For `catalog`: an id from the list it was given, and nothing else. */
  canonicalId: string | null;
  /** For `new`: the entry it proposes. */
  proposed: { id: string; displayNameCs: string; unit: string } | null;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export interface MapResult {
  suggestions: MapSuggestion[];
  usage: Usage;
  model: string;
}

/** The mapping model. Vocabulary, not transcription — the cheaper reader is enough. */
export const MODEL_MAP = MODEL_ESCALATION;

export const SYSTEM_MAP = `Jsi klinický biochemik. Dostaneš názvy laboratorních vyšetření tak, jak je vytiskla jedna česká nebo slovenská laboratoř, a katalog parametrů, které aplikace zná. Pro každý název rozhodni, kam patří.

Čtyři možné odpovědi:
- "catalog": název je TOTÉŽ vyšetření jako jedna položka katalogu. Uveď její id přesně tak, jak je v katalogu. Předpona S_/B_/P_/V_ značí materiál nebo výpočet a není součástí názvu; chemická značka (Na, K, Ca, Fe) je totéž co český název prvku; "celk." je "celkový", "konjug." je "konjugovaný"; "- relativně" je podíl v %, "- abs.počet" je absolutní počet.
- "new": vyšetření v katalogu není. Navrhni id (malá písmena, číslice, podtržítka), český zobrazovaný název a jednotku.
- "not_blood": není to krevní vyšetření (moč, stolice, výtěr).
- "unknown": nejde rozhodnout.

Pravidla:
- Nikdy nepřiřazuj podle podobnosti názvu, když jde o jiné vyšetření: celkový T4 není volný T4, konjugovaný bilirubin není celkový bilirubin, sérová glukóza není glukóza v moči, IgG celkové není anti-EBV IgG.
- Jednotka a referenční rozmezí musí odpovídat položce katalogu (µmol/l a μmol/l je totéž; 1, - a prázdná jednotka znamenají bezrozměrné číslo). Když neodpovídají, není to totéž vyšetření.
- Materiál musí souhlasit: U_ je moč a do krevního katalogu nepatří.
- Nevymýšlej id, které v katalogu není. Pro "catalog" použij jen id ze seznamu.
- Odpovídej nástrojem, ke každému názvu právě jednou.

Jistota:
- Když si nejsi jistý, odpověz "unknown", nebo použij confidence "low" či "medium". "high" znamená, že bys na to vsadil klinické rozhodnutí. Co označíš "high" a "catalog", aplikace přiřadí bez kontroly člověkem; všechno ostatní člověku předloží.
- Tři případy, kdy je odpověď vždy "unknown":
  - název, který může být dvěma položkami katalogu;
  - jednotka, kterou nedokážeš sladit s jednotkou položky (mg/dl a mmol/l je JINÁ jednotka, ne totéž vyšetření; nepřepočítávej);
  - název, který vůbec nepoznáváš.`;

export const TOOL_MAP = {
  name: "file_names",
  description: "Zařaď každý vytištěný název vyšetření.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            raw_name: { type: "string", description: "Název přesně tak, jak byl zadán." },
            decision: { type: "string", enum: ["catalog", "new", "not_blood", "unknown"] },
            canonical_id: { type: ["string", "null"], description: "Pro catalog: id z katalogu. Jinak null." },
            new_id: { type: ["string", "null"], description: "Pro new: navržené id. Jinak null." },
            new_name_cs: { type: ["string", "null"], description: "Pro new: český zobrazovaný název. Jinak null." },
            new_unit: { type: ["string", "null"], description: "Pro new: jednotka. Jinak null." },
            reason: { type: "string", description: "Nejvýše deset slov česky: proč." },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["raw_name", "decision", "canonical_id", "new_id", "new_name_cs", "new_unit", "reason", "confidence"],
        },
      },
    },
    required: ["suggestions"],
  },
} as const;

/** The user turn: the names, then the catalog. Exported so the eval can hand it to a subagent verbatim. */
export function mapPrompt(names: NameToMap[], catalog: CatalogEntry[]): string {
  // The name in quotes, the evidence after a dash: a model asked to copy the
  // name "exactly as given" once copied the whole line, evidence and all.
  const rows = names
    .map((n) => `- název: "${n.rawName}" — jednotka: ${n.unit || "(žádná)"}; rozmezí: ${n.refRange || "(neuvedeno)"}; materiál: ${n.material ?? "(neuveden)"}`)
    .join("\n");
  const cat = catalog.map((c) => `${c.id} | ${c.name} | ${c.unit || "(bezrozměrné)"}`).join("\n");
  return `Názvy k zařazení (raw_name je jen text v uvozovkách):\n${rows}\n\nKatalog (id | název | jednotka):\n${cat}`;
}

const ID = /^[a-z0-9_]{1,64}$/;

/**
 * The asked name a returned `raw_name` refers to, or null.
 *
 * Exact first. Then the ways a model restates a name it was told to copy:
 * quoted, or with the evidence line it was shown still attached ("S_Na —
 * jednotka: …", "S_Na | jednotka: …"). A name that is none of these was not
 * asked, and its suggestion is dropped rather than guessed at.
 */
export function resolveAskedName(returned: unknown, asked: Set<string>): string | null {
  if (typeof returned !== "string") return null;
  const t = returned.trim();
  if (asked.has(t)) return t;
  const unquoted = t.replace(/^["'„“]+|["'“”]+$/g, "").trim();
  if (asked.has(unquoted)) return unquoted;
  const head = unquoted.split(/\s+(?:—|\||–)\s+/)[0].replace(/^["'„“]+|["'“”]+$/g, "").trim();
  return asked.has(head) ? head : null;
}

/** Shape the tool's answer, refusing an id the catalog does not hold. */
export function toSuggestions(input: Record<string, unknown>, names: NameToMap[], catalog: CatalogEntry[]): MapSuggestion[] {
  const ids = new Set(catalog.map((c) => c.id));
  const asked = new Set(names.map((n) => n.rawName));
  const raw = Array.isArray(input.suggestions) ? (input.suggestions as Array<Record<string, unknown>>) : [];
  const out: MapSuggestion[] = [];
  const seen = new Set<string>();
  for (const s of raw) {
    const rawName = resolveAskedName(s.raw_name, asked);
    if (rawName === null || seen.has(rawName)) continue;
    seen.add(rawName);
    let decision: MapDecision = s.decision === "catalog" || s.decision === "new" || s.decision === "not_blood" ? s.decision : "unknown";
    let canonicalId: string | null = null;
    let proposed: MapSuggestion["proposed"] = null;
    if (decision === "catalog") {
      // An id it made up is not a suggestion, it is a guess with a label.
      canonicalId = typeof s.canonical_id === "string" && ids.has(s.canonical_id) ? s.canonical_id : null;
      if (!canonicalId) decision = "unknown";
    } else if (decision === "new") {
      const id = typeof s.new_id === "string" && ID.test(s.new_id) && !ids.has(s.new_id) ? s.new_id : null;
      const name = typeof s.new_name_cs === "string" ? s.new_name_cs.trim() : "";
      if (id && name) proposed = { id, displayNameCs: name.slice(0, 80), unit: typeof s.new_unit === "string" ? s.new_unit.trim().slice(0, 20) : "" };
      else decision = "unknown";
    }
    const confidence = s.confidence === "high" || s.confidence === "medium" || s.confidence === "low" ? s.confidence : "low";
    out.push({ rawName, decision, canonicalId, proposed, reason: typeof s.reason === "string" ? s.reason.slice(0, 300) : "", confidence });
  }
  return out;
}

/**
 * Names per call. A real sheet's 93 names answered at once ran past 8 000
 * output tokens and the cut-off tool call decoded to nothing at all — zero
 * suggestions, no error. Smaller batches keep each answer well inside the
 * budget, and the catalog prefix is cached across them.
 */
export const MAP_BATCH = 30;

export class MapTruncatedError extends Error {
  constructor(public readonly usage: Usage, public readonly model: string) {
    super("the mapping answer ran past max_tokens");
    this.name = "MapTruncatedError";
  }
}

async function mapBatch(client: Anthropic, model: string, names: NameToMap[], catalog: CatalogEntry[]): Promise<MapResult> {
  const message = await client.messages.create({
    model,
    max_tokens: 8000,
    system: [{ type: "text", text: SYSTEM_MAP, cache_control: { type: "ephemeral" } }],
    tools: [TOOL_MAP as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: TOOL_MAP.name },
    messages: [{ role: "user", content: mapPrompt(names, catalog) }],
  });
  const usage = usageOf(message.usage);
  // A tool call cut off mid-JSON is not an empty answer; saying so is what
  // lets the caller bill it and refuse, instead of mapping nothing quietly.
  if (message.stop_reason === "max_tokens") throw new MapTruncatedError(usage, model);
  const block = message.content.find((b) => b.type === "tool_use");
  const input = block && block.type === "tool_use" ? (block.input as Record<string, unknown>) : {};
  return { suggestions: toSuggestions(input, names, catalog), usage, model };
}

export async function suggestCanonical(apiKey: string, model: string, names: NameToMap[], catalog: CatalogEntry[]): Promise<MapResult> {
  const client = clientFor(apiKey);
  const batches: NameToMap[][] = [];
  for (let i = 0; i < names.length; i += MAP_BATCH) batches.push(names.slice(i, i + MAP_BATCH));
  const results = await Promise.all(batches.map((b) => mapBatch(client, model, b, catalog)));
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const r of results) {
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
    usage.cacheReadTokens += r.usage.cacheReadTokens;
    usage.cacheWriteTokens += r.usage.cacheWriteTokens;
  }
  return { suggestions: results.flatMap((r) => r.suggestions), usage, model };
}
