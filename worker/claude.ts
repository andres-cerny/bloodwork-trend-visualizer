/**
 * Claude calls, server-side. The API key lives as a Worker secret and never
 * reaches the browser.
 *
 * Uses the official SDK rather than raw fetch, which brings retry with
 * exponential backoff on 408/409/429/5xx and connection errors — the Python
 * pipeline retries transient API failures and this had no equivalent, so one
 * blip lost a page.
 *
 * The extraction prompt and tool schema are lifted verbatim from
 * src/extract.py — the model's only job is verbatim transcription, and every
 * number is computed afterwards by normalize.ts. Keep the two in sync: if the
 * Czech prompt drifts between the Python and this file, the demo and the local
 * tool stop extracting the same way.
 */

import Anthropic from "@anthropic-ai/sdk";

export const MODEL_PRIMARY = "claude-sonnet-5";
export const MODEL_ESCALATION = "claude-opus-4-8";
export const MODEL_CHAT = "claude-sonnet-5";

const SYSTEM_EXTRACT =
  "Jsi přesný přepisovač českých laboratorních výsledků z obrázku. " +
  "Tvým jediným úkolem je VĚRNĚ PŘEPSAT to, co je vytištěno — nic nepočítej, " +
  "nepřeváděj jednotky, needituj čísla. Zachovej desetinnou čárku přesně tak, " +
  "jak je (např. '5,4', '<1,0'). Přepiš každý měřený řádek zvlášť; řádky " +
  "neslučuj ani nerozděluj. U každého řádku uveď název analytu přesně jak je " +
  "vytištěn (včetně předpony jako 'S_' nebo 'B_'), hodnotu, jednotku a " +
  "referenční interval. Pokud je jednotka nebo interval ve zvláštním sloupci, " +
  "přiřaď je ke správnému řádku. Confidence nastav 'low' u čehokoli, co je " +
  "špatně čitelné nebo nejednoznačné.";

/**
 * Prompt for the text-layer path.
 *
 * The model is doing column assignment, not character recognition — the rows
 * arrive already reconstructed from the PDF's own text coordinates. Copying
 * cells verbatim is therefore not a plea for accuracy but a checkable rule:
 * the client verifies every returned value against the printed page and
 * rejects anything that is not there.
 */
const SYSTEM_EXTRACT_TEXT =
  "Jsi přesný extraktor českých laboratorních výsledků. Dostaneš řádky " +
  "vytištěné na stránce, tak jak jsou v PDF, buňky oddělené znakem '|'. " +
  "Tvým úkolem je rozhodnout, které řádky jsou naměřené výsledky, a přiřadit " +
  "buňky do sloupců: název analytu, hodnota, jednotka, referenční interval. " +
  "Text buněk NIKDY neupravuj — kopíruj ho ZNAKOVĚ PŘESNĚ tak, jak je uveden " +
  "(včetně desetinné čárky, '<', '>' a značek jako '!'). Nic nepočítej ani " +
  "nepřeváděj. Pokud některý sloupec na řádku chybí, vrať prázdný řetězec. " +
  "Hlavičky, patičky a informace o pacientovi mezi výsledky nezahrnuj. " +
  "Confidence nastav 'low', pokud si přiřazením sloupců nejsi jistý.";

const TEXT_LAYER_HINT =
  "Nápověda — textová vrstva PDF (pořadí může být zpřeházené, " +
  "obrázek je závazný pro přiřazení sloupců; text použij jen k " +
  "ověření číslic):\n\n";

const TOOL = {
  name: "record_lab_results",
  description: "Zaznamenej přepsané laboratorní výsledky z jedné stránky.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      report_date: {
        type: ["string", "null"],
        description: "Datum odběru v ISO formátu YYYY-MM-DD, jinak null.",
      },
      report_date_raw: { type: ["string", "null"] },
      lab_name: { type: ["string", "null"] },
      patient_name: { type: ["string", "null"] },
      patient_id: { type: ["string", "null"] },
      measurements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            raw_analyte_name: { type: "string" },
            value_raw: { type: "string" },
            unit_raw: { type: "string" },
            ref_range_raw: { type: "string" },
            source_snippet: {
              type: "string",
              description: "Celý řádek tak, jak je vytištěn (pro ověření).",
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: [
            "raw_analyte_name",
            "value_raw",
            "unit_raw",
            "ref_range_raw",
            "source_snippet",
            "confidence",
          ],
        },
      },
    },
    required: [
      "report_date",
      "report_date_raw",
      "lab_name",
      "patient_name",
      "patient_id",
      "measurements",
    ],
  },
} as const;

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Non-zero once the tools+system prefix is long enough to cache. */
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function usageOf(u: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

/** The tool_use block a forced tool_choice guarantees. */
function toolInput(message: Anthropic.Message): Record<string, unknown> {
  const block = message.content.find((b) => b.type === "tool_use");
  return (block && "input" in block ? (block.input as Record<string, unknown>) : {}) ?? {};
}

function toExtraction(input: Record<string, any>, usage: Usage, model: string): PageExtraction {
  return {
    report_date: input.report_date ?? null,
    report_date_raw: input.report_date_raw ?? null,
    lab_name: input.lab_name ?? null,
    patient_name: input.patient_name ?? null,
    patient_id: input.patient_id ?? null,
    measurements: Array.isArray(input.measurements) ? input.measurements : [],
    usage,
    model,
  };
}

export interface PageExtraction {
  report_date: string | null;
  report_date_raw: string | null;
  lab_name: string | null;
  patient_name: string | null;
  patient_id: string | null;
  measurements: Array<{
    raw_analyte_name: string;
    value_raw: string;
    unit_raw: string;
    ref_range_raw: string;
    source_snippet: string;
    confidence: "high" | "medium" | "low";
  }>;
  usage: Usage;
  model: string;
}

function clientFor(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    // Three attempts total. A page that still fails is skipped and reported
    // rather than sinking the whole report.
    maxRetries: 3,
  });
}

/**
 * The system prompt and tool schema are byte-identical on every page of a
 * report, so they are marked cacheable. Caching is a prefix match in the order
 * tools -> system -> messages, so the breakpoint goes on the system block:
 * everything before it (the tools) is cached with it, and the per-page rows
 * that follow stay outside.
 *
 * Note the minimum cacheable prefix is ~1024 tokens; this prefix may sit under
 * that, in which case caching silently does not engage. `cacheReadTokens` on
 * the result is there so that can be checked against a real key rather than
 * assumed — if it stays zero across the pages of one report, the prefix is too
 * short to cache and the annotation is simply inert.
 */
function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

/**
 * Extract from the page's own text layer — no image sent.
 *
 * Preferred over `extractPage` whenever the PDF is digital: the characters
 * come from the file rather than from pixels, so a misread decimal is not
 * merely unlikely, it is impossible. Also markedly cheaper, since a page of
 * text costs a fraction of a 220 DPI image in input tokens.
 */
export async function extractPageText(
  apiKey: string,
  model: string,
  rowsText: string,
): Promise<PageExtraction> {
  const message = await clientFor(apiKey).messages.create({
    model,
    max_tokens: 8000,
    system: cachedSystem(SYSTEM_EXTRACT_TEXT),
    tools: [TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [
      { role: "user", content: `Řádky vytištěné na stránce:\n\n${rowsText.slice(0, 40000)}` },
    ],
  });
  return toExtraction(toolInput(message), usageOf(message.usage), model);
}

/** Transcribe one rendered page image with one model. Used for scans. */
export async function extractPage(
  apiKey: string,
  model: string,
  imageBase64: string,
  mediaType: string,
  textLayer: string | null,
): Promise<PageExtraction> {
  const content: unknown[] = [
    { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
  ];
  if (textLayer && textLayer.trim()) {
    content.push({ type: "text", text: TEXT_LAYER_HINT + textLayer.slice(0, 20000) });
  }
  content.push({ type: "text", text: "Přepiš všechny měřené řádky z této stránky." });

  const message = await clientFor(apiKey).messages.create({
    model,
    max_tokens: 8000,
    system: cachedSystem(SYSTEM_EXTRACT),
    tools: [TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content: content as Anthropic.ContentBlockParam[] }],
  });
  return toExtraction(toolInput(message), usageOf(message.usage), model);
}

const SYSTEM_CHAT =
  "Jsi asistent, který pomáhá číst výsledky krevních testů. Odpovídej česky, " +
  "stručně a POUZE popisně. Máš k dispozici strukturovaná data níže — každé " +
  "číslo, které uvedeš, musí pocházet z těchto dat; nikdy žádné nedopočítávej " +
  "ani neodhaduj. Hodnoty a referenční meze už byly spočítány deterministicky, " +
  "ber je jako dané. Nestanovuj diagnózu, nedoporučuj léčbu a nespekuluj o " +
  "příčinách; popiš, co se v datech změnilo, a případně doporuč konzultaci " +
  "s lékařem. Pokud se ptají na něco, co v datech není, řekni to.";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Answer a question about the already-extracted data.
 *
 * The normalized values are injected as context rather than fetched through
 * tools: the dataset is small and already deterministic, so this keeps every
 * number the model can see traceable to the parsing layer.
 */
export async function chat(
  apiKey: string,
  dataContext: string,
  history: ChatTurn[],
): Promise<{ text: string; usage: Usage; model: string }> {
  const message = await clientFor(apiKey).messages.create({
    model: MODEL_CHAT,
    max_tokens: 1200,
    // The instructions are stable; the patient's data changes per session, so
    // the breakpoint sits between them.
    system: [
      { type: "text", text: SYSTEM_CHAT, cache_control: { type: "ephemeral" } },
      { type: "text", text: `=== DATA PACIENTA ===\n${dataContext}` },
    ],
    messages: history.slice(-12),
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, usage: usageOf(message.usage), model: MODEL_CHAT };
}
