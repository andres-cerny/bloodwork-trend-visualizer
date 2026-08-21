/**
 * Claude calls, server-side. The API key lives as a Worker secret and never
 * reaches the browser.
 *
 * The extraction prompt and tool schema are lifted verbatim from
 * src/extract.py — the model's only job is verbatim transcription, and every
 * number is computed afterwards by normalize.ts. Keep the two in sync: if the
 * Czech prompt drifts between the Python and this file, the demo and the local
 * tool stop extracting the same way.
 */

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

async function callAnthropic(apiKey: string, body: unknown): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`anthropic ${res.status}: ${detail.slice(0, 400)}`);
  }
  return res.json();
}

/** Transcribe one rendered page with one model. */
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

  const data = await callAnthropic(apiKey, {
    model,
    max_tokens: 8000,
    system: SYSTEM_EXTRACT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
    messages: [{ role: "user", content }],
  });

  const block = (data.content ?? []).find((b: any) => b.type === "tool_use");
  const input = block?.input ?? {};
  return {
    report_date: input.report_date ?? null,
    report_date_raw: input.report_date_raw ?? null,
    lab_name: input.lab_name ?? null,
    patient_name: input.patient_name ?? null,
    patient_id: input.patient_id ?? null,
    measurements: Array.isArray(input.measurements) ? input.measurements : [],
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
    model,
  };
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
  const data = await callAnthropic(apiKey, {
    model: MODEL_CHAT,
    max_tokens: 1200,
    system: `${SYSTEM_CHAT}\n\n=== DATA PACIENTA ===\n${dataContext}`,
    messages: history.slice(-12),
  });
  const text = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  return {
    text,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
    model: MODEL_CHAT,
  };
}
