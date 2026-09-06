/**
 * The second photo reader: Google Gemini 3.8 Flash through `@google/genai`.
 *
 * Same `CallResult` shape as `callReader` in extract.ts, so an arm is declared
 * once and only its `provider` says which API answers. The prompt is the
 * *imported* `SYSTEM_EXTRACT` / `SYSTEM_EXTRACT_TEXT` and the schema is
 * `TOOL.input_schema` converted field by field — the moment this file restates
 * the Czech, it stops measuring the app (docs/plans/lab-adaptability.md,
 * "Invariants").
 *
 * Settings, all from the plan's "Decisions already made":
 *   - structured output: `responseMimeType: "application/json"` +
 *     `responseSchema` (the OpenAPI-subset `Schema` the SDK types), with
 *     `["string","null"]` unions mapped to `nullable: true` and the property
 *     order pinned with `propertyOrdering` (Gemini otherwise sorts keys);
 *   - `temperature: 0`;
 *   - thinking minimal: `thinkingConfig.thinkingLevel = MINIMAL` (the Gemini 3
 *     knob; `thinkingBudget` is the 2.5-era one);
 *   - media resolution per *part*, because the request-level `MediaResolution`
 *     enum stops at HIGH: `PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH`
 *     by default, `…_HIGH` for the arm that measures what the extra tokens buy;
 *   - no retries: `httpOptions.retryOptions.attempts = 1` (the SDK default is
 *     5). Same reason as extract.ts — a retried call reads as model latency.
 *
 * Key: `GEMINI_API_KEY`, beside `ANTHROPIC_API_KEY` in the repo-root `.env`
 * (a symlink; git-ignored). The harness reads `process.env` only, so load it
 * into the shell first:
 *
 *   set -a; source .env; set +a
 *   BENCH_MAX_USD=5 npm run bench:adapt
 *
 * No network without a key. `BENCH_DRY_RUN=1` (or `--dry-run` on the adapt
 * bench) prints the request shape through `describeRequest` and never
 * constructs a client — that is how this file is tested without spending.
 */
import {
  GoogleGenAI,
  PartMediaResolutionLevel,
  ThinkingLevel,
  Type,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
  type Schema,
} from "@google/genai";

import { SYSTEM_EXTRACT, SYSTEM_EXTRACT_TEXT, TEXT_LAYER_HINT, TOOL, type Usage } from "@bw/extraction";
import { type TextRow } from "@bw/lab-core";

import { priceUsd, rowsIndexed, type CallResult, type Reader } from "./extract";

export const GEMINI_MODEL = "gemini-3.8-flash";

export type MediaResolutionArm = "high" | "ultra_high";

export type GeminiInput =
  /** The text-layer path: rows as the Worker joins them, `row_index` anchor. */
  | { kind: "text"; rows: TextRow[] }
  /** The image path: one rendered page, optionally with the text layer as a hint. */
  | { kind: "image"; base64: string; mediaType: string; textLayer?: string | null };

/* ------------------------------------------------------------------ schema */

const TYPE: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  integer: Type.INTEGER,
  boolean: Type.BOOLEAN,
  array: Type.ARRAY,
  object: Type.OBJECT,
};

/**
 * JSON Schema (the Anthropic tool's `input_schema`) → Gemini `Schema`.
 *
 * Only the constructs the tool actually uses are handled, and anything else
 * throws rather than being dropped: a schema Gemini quietly relaxes would
 * show up later as fabrications, which is exactly the failure the plan's
 * "Risks" names. `additionalProperties` has no counterpart and is omitted —
 * Gemini's structured output does not emit unknown keys anyway.
 */
export function toGeminiSchema(node: any): Schema {
  if (!node || typeof node !== "object") throw new Error(`toGeminiSchema: not a schema node: ${JSON.stringify(node)}`);
  const out: Schema = {};

  let type = node.type;
  if (Array.isArray(type)) {
    const nonNull = type.filter((t: string) => t !== "null");
    if (nonNull.length !== 1) throw new Error(`toGeminiSchema: unsupported union ${JSON.stringify(type)}`);
    if (nonNull.length !== type.length) out.nullable = true;
    type = nonNull[0];
  }
  if (typeof type !== "string" || !TYPE[type]) throw new Error(`toGeminiSchema: unsupported type ${JSON.stringify(type)}`);
  out.type = TYPE[type];

  if (node.description) out.description = node.description;
  if (node.enum) out.enum = [...node.enum];
  if (node.items) out.items = toGeminiSchema(node.items);
  if (node.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(node.properties)) out.properties[k] = toGeminiSchema(v);
    out.propertyOrdering = Object.keys(node.properties);
  }
  if (node.required) out.required = [...node.required];

  for (const k of Object.keys(node)) {
    if (!["type", "description", "enum", "items", "properties", "required", "additionalProperties"].includes(k)) {
      throw new Error(`toGeminiSchema: unsupported keyword "${k}"`);
    }
  }
  return out;
}

/** The text path's schema: `source_snippet` swapped for `row_index`, as `TOOL_TEXT` does. */
function textToolSchema(): any {
  const tool = JSON.parse(JSON.stringify(TOOL)) as any;
  const item = tool.input_schema.properties.measurements.items;
  delete item.properties.source_snippet;
  item.required = item.required.filter((k: string) => k !== "source_snippet");
  item.properties.row_index = {
    type: "integer",
    description: "Pořadové číslo řádku vstupu, ze kterého tento výsledek pochází.",
  };
  item.required.push("row_index");
  return tool.input_schema;
}

/* ----------------------------------------------------------------- request */

const LEVEL: Record<MediaResolutionArm, PartMediaResolutionLevel> = {
  high: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
  ultra_high: PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH,
};

/**
 * The full request, built without a client so a dry run can print it.
 *
 * Mirrors `extractPageText` / `extractPage` in packages/extraction part for
 * part: system prompt, image, text-layer hint, the one-line user ask.
 */
export function geminiRequest(reader: Reader, input: GeminiInput): GenerateContentParameters {
  const parts: Part[] = [];
  let system: string;
  let schema: any;

  if (input.kind === "text") {
    system = SYSTEM_EXTRACT_TEXT;
    schema = textToolSchema();
    parts.push({ text: `Řádky vytištěné na stránce:\n\n${rowsIndexed(input.rows).slice(0, 40000)}` });
  } else {
    system = SYSTEM_EXTRACT;
    schema = TOOL.input_schema;
    parts.push({
      inlineData: { data: input.base64, mimeType: input.mediaType },
      mediaResolution: { level: LEVEL[reader.mediaResolution ?? "ultra_high"] },
    });
    if (input.textLayer && input.textLayer.trim()) {
      parts.push({ text: TEXT_LAYER_HINT + input.textLayer.slice(0, 20000) });
    }
    parts.push({ text: "Přepiš všechny měřené řádky z této stránky." });
  }

  return {
    model: reader.model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: system,
      temperature: 0,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(schema),
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      // The SDK retries 408/429/5xx five times by default; one attempt means
      // a failure is recorded as a failure, not as forty seconds of latency.
      httpOptions: { retryOptions: { attempts: 1 } },
    },
  };
}

/** The request with the image bytes elided — what a dry run prints. */
export function describeRequest(params: GenerateContentParameters): unknown {
  const clone = JSON.parse(JSON.stringify(params));
  for (const c of clone.contents ?? []) {
    for (const p of c.parts ?? []) {
      if (p.inlineData?.data) p.inlineData.data = `<base64, ${p.inlineData.data.length} chars>`;
      if (typeof p.text === "string" && p.text.length > 200) p.text = p.text.slice(0, 200) + `… (${p.text.length} chars)`;
    }
  }
  const sys = clone.config?.systemInstruction;
  if (typeof sys === "string" && sys.length > 200) {
    clone.config.systemInstruction = sys.slice(0, 200) + `… (${sys.length} chars)`;
  }
  return clone;
}

/* -------------------------------------------------------------------- call */

function usageOf(r: GenerateContentResponse): Usage & { imageTokens: number; thoughtTokens: number } {
  const u = r.usageMetadata;
  const thoughtTokens = u?.thoughtsTokenCount ?? 0;
  const imageTokens = (u?.promptTokensDetails ?? [])
    .filter((d) => d.modality === "IMAGE")
    .reduce((n, d) => n + (d.tokenCount ?? 0), 0);
  return {
    inputTokens: u?.promptTokenCount ?? 0,
    // Thoughts are billed as output; folding them in keeps priceUsd honest.
    outputTokens: (u?.candidatesTokenCount ?? 0) + thoughtTokens,
    cacheReadTokens: u?.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
    imageTokens,
    thoughtTokens,
  };
}

function parseJson(text: string | undefined): any {
  const t = (text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(t);
}

export async function callGemini(apiKey: string, reader: Reader, input: GeminiInput): Promise<CallResult> {
  const params = geminiRequest(reader, input);
  const empty: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  if (!apiKey) {
    return { ok: false, model: reader.model, ms: 0, usage: empty, costUsd: 0, thought: false, extraction: null, error: "GEMINI_API_KEY not set" };
  }
  const ai = new GoogleGenAI({ apiKey });

  const t0 = performance.now();
  try {
    const response = await ai.models.generateContent(params);
    const ms = performance.now() - t0;
    const { imageTokens, thoughtTokens, ...usage } = usageOf(response);
    let data: any;
    try {
      data = parseJson(response.text);
    } catch (e: any) {
      return {
        ok: false, model: reader.model, ms, usage, costUsd: priceUsd(reader.model, usage), thought: thoughtTokens > 0,
        extraction: null, imageTokens,
        error: `unparseable JSON (${response.candidates?.[0]?.finishReason ?? "?"}): ${e?.message ?? e}`,
      };
    }
    return {
      ok: true,
      model: reader.model,
      ms,
      usage,
      costUsd: priceUsd(reader.model, usage),
      thought: thoughtTokens > 0,
      imageTokens,
      extraction: {
        report_date: data.report_date ?? null,
        report_date_raw: data.report_date_raw ?? null,
        lab_name: data.lab_name ?? null,
        patient_name: data.patient_name ?? null,
        patient_id: data.patient_id ?? null,
        measurements: Array.isArray(data.measurements) ? data.measurements : [],
        usage,
        model: reader.model,
      },
      error: null,
    };
  } catch (e: any) {
    return {
      ok: false,
      model: reader.model,
      ms: performance.now() - t0,
      usage: empty,
      costUsd: 0,
      thought: false,
      extraction: null,
      error: `${e?.status ?? ""} ${e?.name ?? "Error"}: ${e?.message ?? String(e)}`.trim(),
    };
  }
}
