/**
 * A first guess at what went wrong, before Ondřej reads the message.
 *
 * A help-desk message or an ops alert is handed to a small model with what
 * the server itself knows — the account's last refusals (src/events.ts), the
 * extractor's status and spend, and a fixed list of the ways this app is
 * known to fail — and the model answers five fields: the probable cause,
 * where, how sure, what to do, and up to two questions to ask the person
 * when their description is thin. It is posted to Telegram *under* the raw
 * message, prefixed „Odhad (GLM): ", so nobody mistakes a guess for a fact.
 *
 * The model is Workers AI's GLM 5.3 Flash through the `AI` binding: the same
 * host as everything else, so no new sub-processor on /soukromi, and the
 * free tier covers the volume (10 000 neurons a day; a triage is a few
 * hundred). Without the binding — tests, a local `wrangler dev` without
 * `ai` in its config, or the day it is removed — `triage` answers null and
 * the raw message goes alone.
 *
 * What reaches the model: the person's own words (they wrote them to be
 * read), routes, statuses and codes, and the extractor's two numbers. Never
 * a value, a page, a printed name or an e-mail — the events carry none, and
 * the message text is clipped, not enriched.
 */
import { SQL, type EventRow } from "./db";

/** The id tests/bench/openai_compat.ts measured; the `@cf/` prefix is the binding's too. */
export const TRIAGE_MODEL = "@cf/zai-org/glm-5.3-flash";

/** The one method this module needs of the binding. */
export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface TriageEnv {
  DB: D1Database;
  AI?: AiBinding;
}

export interface Triage {
  cause: string;
  where: string;
  confidence: "high" | "medium" | "low";
  action: string;
  questions: string[];
}

export interface ExtractorState {
  /** HTTP status of GET /api/status, or null when it did not answer. */
  status: number | null;
  spentUsd: number | null;
  budgetUsd: number | null;
  frozen: boolean | null;
}

export interface TriageInput {
  kind: "helpdesk" | "ops";
  text: string;
  /** The account's hash when the message came from a session; null when not. */
  userHash: string | null;
  reportId?: string | null;
  extractor: ExtractorState | null;
}

/** What the model may read of the message. */
const MAX_TEXT = 2000;

export const SYSTEM_TRIAGE = `Jsi technik podpory aplikace Moje krev. Je to česká webová aplikace: člověk nahraje PDF nebo fotku laboratorního výsledku, prohlížeč začerní jméno a rodné číslo, server pošle řádky dvěma modelům k přepisu, hodnoty se uloží k účtu a kreslí v čase. Účet má zdarma 5 dokumentů, další se přikupují.

Dostaneš zprávu od uživatele nebo provozní hlášení, poslední odmítnutí serveru k danému účtu (cesta, stav, kód — bez hodnot a bez jmen) a stav extraktoru. Odhadni pravděpodobnou příčinu.

Známé poruchy a jejich příznaky:
- vyčerpaný počet dokumentů → 402 no_documents na POST /api/extract; nahrávání odmítnuto, tlačítko „Přikoupit"
- zamrzlá osobní měsíční USD pojistka → 402 budget_exhausted; hláška „Měsíční limit zpracování … je vyčerpán"
- zamrzlá společná pojistka extraktoru → 402 budget_exhausted z extraktoru; hláška „společný limit je vyčerpán"; extraktor hlásí zamrzlý: ano
- stránku nepřečetl žádný model → 502 extraction_failed; „Stránku se nepodařilo přečíst"
- jeden ze dvou modelů odmítl → stránka projde bez chyby, řádky jsou „nejistá hodnota" / nepotvrzené
- po začernění zbyla identita → prohlížeč nahrávání zastaví, na server nic nejde, v záznamech nic není
- nastavení účtu příliš velké → 413 too_large na PUT /api/settings; přiřazení se neukládají
- odhlášení nebo nové heslo posunulo generaci sezení → 401 unauthorized po resetu hesla; řeší nové přihlášení
- příliš mnoho pokusů → 429 locked (přihlášení) nebo 429 rate_limited
- Turnstile neprošel → 400 turnstile_failed / turnstile_required
- neplatný nebo spotřebovaný odkaz → 403/404 invite_invalid

Odpověz česky, stručně, přesně v požadovaném JSON: cause (jedna věta), where (cesta nebo modul), confidence (high/medium/low), action (jedna věta, co má udělat operátor nebo uživatel), questions (nejvýše dvě otázky pro uživatele, když je popis chudý; jinak prázdné pole). Nic si nevymýšlej: když záznamy nic neukazují, řekni to a ptej se.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    cause: { type: "string" },
    where: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    action: { type: "string" },
    questions: { type: "array", items: { type: "string" }, maxItems: 2 },
  },
  required: ["cause", "where", "confidence", "action", "questions"],
  additionalProperties: false,
} as const;

const iso = (s: number) => new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

/** Czech money, two decimals, decimal comma: "12,30". */
const czUsd = (n: number) => n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The user turn, exactly as the model reads it. Exported for the test that pins it. */
export function triagePrompt(input: TriageInput, events: EventRow[]): string {
  const who =
    input.kind === "ops"
      ? "Provozní hlášení (od hlídače, ne od uživatele):"
      : input.userHash
        ? "Zpráva od přihlášeného uživatele:"
        : "Zpráva od nepřihlášeného návštěvníka (bez účtu, tedy bez záznamů k účtu):";
  const lines = [who, '"""', input.text.slice(0, MAX_TEXT), '"""'];
  if (input.kind === "helpdesk") lines.push(`Report: ${input.reportId ?? "—"}`);
  lines.push(
    input.kind === "ops"
      ? "Poslední odmítnutí serveru, všechny účty (nejnovější první; čas, cesta, stav, kód):"
      : "Poslední odmítnutí serveru k tomuto účtu (nejnovější první; čas, cesta, stav, kód):",
  );
  if (events.length === 0) lines.push("(žádné)");
  for (const e of events) lines.push(`${iso(e.at)} ${e.route} ${e.status} ${e.code ?? "—"}`);
  const x = input.extractor;
  lines.push(
    !x || x.status === null
      ? "Extraktor: nedostupný (GET /api/status neodpověděl)"
      : x.spentUsd !== null && x.budgetUsd !== null
        ? `Extraktor: /api/status ${x.status}, útrata ${czUsd(x.spentUsd)} z ${czUsd(x.budgetUsd)} USD, zamrzlý: ${x.frozen ? "ano" : "ne"}`
        : `Extraktor: /api/status ${x.status}`,
  );
  return lines.join("\n");
}

/**
 * The text the model produced, whichever shape the binding answered in:
 * `{ response }` for the chat models, `{ choices[0].message.content }` for
 * the OpenAI-shaped ones, or the object itself when the runtime has already
 * parsed the JSON schema's output.
 */
function textOf(out: unknown): unknown {
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  if (typeof o.response === "string") return o.response;
  if (o.response && typeof o.response === "object") return o.response;
  const choices = o.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string" || (content && typeof content === "object")) return content;
  return o.cause !== undefined ? o : null;
}

const CONF = new Set(["high", "medium", "low"]);
const one = (v: unknown, n: number) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "");

/** The five fields out of whatever the model wrote, or null when it is not an answer. */
export function parseTriage(raw: unknown): Triage | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    const s = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try {
      o = JSON.parse(s);
    } catch {
      return null;
    }
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const cause = one(r.cause, 300);
  const action = one(r.action, 300);
  if (!cause || !action) return null;
  const confidence = CONF.has(r.confidence as string) ? (r.confidence as Triage["confidence"]) : "low";
  const questions = Array.isArray(r.questions)
    ? r.questions
        .map((q) => one(q, 200))
        .filter(Boolean)
        .slice(0, 2)
    : [];
  return { cause, where: one(r.where, 120) || "—", confidence, action, questions };
}

const CZ_CONF: Record<Triage["confidence"], string> = { high: "vysoká", medium: "střední", low: "nízká" };

/** The second Telegram message. The prefix is the promise that this is a guess. */
export function formatTriage(t: Triage): string {
  const lines = [`Odhad (GLM): ${t.cause}`, `Kde: ${t.where}`, `Jistota: ${CZ_CONF[t.confidence]}`, `Co udělat: ${t.action}`];
  if (t.questions.length) lines.push(`Otázky pro uživatele: ${t.questions.map((q, i) => `${i + 1}) ${q}`).join(" ")}`);
  return lines.join("\n");
}

/**
 * Gather, ask, parse. Null whenever there is no binding, the model did not
 * answer, or the answer was not the five fields — and never a throw: the
 * raw message has already been sent and this must not undo a 200.
 */
export async function triage(env: TriageEnv, input: TriageInput): Promise<Triage | null> {
  if (!env.AI) return null;
  try {
    const stmt = input.kind === "ops" ? env.DB.prepare(SQL.recentEvents) : input.userHash ? env.DB.prepare(SQL.eventsForUser).bind(input.userHash) : null;
    const events = stmt ? ((await stmt.all<EventRow>()).results ?? []) : [];
    const out = await env.AI.run(TRIAGE_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_TRIAGE },
        { role: "user", content: triagePrompt(input, events) },
      ],
      response_format: { type: "json_schema", json_schema: { name: "triage", schema: RESPONSE_SCHEMA } },
      // Thinking is billed as output and adds nothing a five-field answer
      // needs — the bench measured GLM at 380 → 159 completion tokens.
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0,
      max_tokens: 600,
    });
    const parsed = parseTriage(textOf(out));
    if (!parsed) console.warn("triage: the model's answer was not the five fields");
    return parsed;
  } catch (e) {
    console.warn(`triage failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`.slice(0, 200));
    return null;
  }
}
