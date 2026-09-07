/**
 * One reader, either path, either provider — the tier-2 shape of an arm.
 *
 * `readText` sends the deployed text call (`extractPageText`: exact prompt,
 * exact schema, prompt cache) for Anthropic and the Gemini mirror of it for
 * Google. `readImage` mirrors `extractPage` for Anthropic — same content
 * blocks, same cached system prompt, same forced tool — and hands Gemini the
 * same page through gemini.ts. Both return the `CallResult` extract.ts
 * defines, so adapt.bench.ts scores every arm with one code path.
 *
 * `readDocument` is the third shape: the ORIGINAL PDF page rather than a
 * render of it. Only the OCR provider takes it — Mistral OCR reads a
 * born-digital PDF's embedded text, which is the fair comparison against the
 * deployed text path, and a raster of that page would be a different question.
 * `readImage` also routes the OCR provider, so one arm declaration covers both.
 *
 * `maxRetries: 0` for the same reason extract.ts gives: a retry would be
 * recorded as latency.
 */
import Anthropic from "@anthropic-ai/sdk";

import { extractPageText, SYSTEM_EXTRACT, TEXT_LAYER_HINT, TOOL, type Usage } from "@bw/extraction";
import { rowsAsText, type TextRow } from "@bw/lab-core";

import { priceUsd, type CallResult, type Reader } from "./extract";
import { callGemini, type Tile } from "./gemini";
import { callMistral } from "./mistral";

export interface PageImage {
  base64: string;
  mediaType: string;
  textLayer?: string | null;
  /**
   * The same page pre-cut into overlapping halves. Gemini spends a fixed
   * budget per image *part*, so a tiled arm sends these instead of `base64`
   * to buy Sonnet-sized visual detail (gemini.ts, TILED_IMAGE_TOKENS). Claude
   * downscales one whole page either way, so its path ignores them.
   */
  tiles?: Tile[];
}

const EMPTY: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function failed(model: string, ms: number, e: any): CallResult {
  return {
    ok: false,
    model,
    ms,
    usage: EMPTY,
    costUsd: 0,
    thought: false,
    extraction: null,
    error: `${e?.status ?? ""} ${e?.name ?? "Error"}: ${e?.message ?? String(e)}`.trim(),
  };
}

/** One PDF page, sent as the file itself. OCR providers only. */
export interface PageDocument {
  base64: string;
  /** 1-based, as corpora.ts counts pages. */
  page: number;
  name?: string;
}

export async function readDocument(apiKey: string, reader: Reader, doc: PageDocument): Promise<CallResult> {
  if (reader.provider !== "mistral") {
    throw new Error(`readDocument: ${reader.provider ?? "anthropic"} takes no PDF — only the OCR provider does`);
  }
  return callMistral(apiKey, reader, { kind: "pdf", base64: doc.base64, page: doc.page, name: doc.name });
}

export async function readText(apiKey: string, reader: Reader, rows: TextRow[]): Promise<CallResult> {
  if (reader.provider === "google") return callGemini(apiKey, reader, { kind: "text", rows });
  const t0 = performance.now();
  try {
    const x = await extractPageText(apiKey, reader.model, rowsAsText(rows));
    return { ok: true, model: reader.model, ms: performance.now() - t0, usage: x.usage, costUsd: priceUsd(reader.model, x.usage), thought: false, extraction: x, error: null };
  } catch (e) {
    return failed(reader.model, performance.now() - t0, e);
  }
}

export async function readImage(apiKey: string, reader: Reader, image: PageImage): Promise<CallResult> {
  if (reader.provider === "mistral") {
    // No prompt and no text-layer hint: OCR reads the pixels it is given.
    return callMistral(apiKey, reader, { kind: "image", base64: image.base64, mediaType: image.mediaType });
  }
  if (reader.provider === "google") {
    return callGemini(
      apiKey,
      reader,
      image.tiles?.length
        ? { kind: "tiles", tiles: image.tiles, textLayer: image.textLayer }
        : { kind: "image", base64: image.base64, mediaType: image.mediaType, textLayer: image.textLayer },
    );
  }

  const content: Anthropic.ContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: image.mediaType as any, data: image.base64 } },
  ];
  if (image.textLayer && image.textLayer.trim()) {
    content.push({ type: "text", text: TEXT_LAYER_HINT + image.textLayer.slice(0, 20000) });
  }
  content.push({ type: "text", text: "Přepiš všechny měřené řádky z této stránky." });

  const t0 = performance.now();
  try {
    const message = await new Anthropic({ apiKey, maxRetries: 0 }).messages.create({
      model: reader.model,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM_EXTRACT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content }],
    });
    const ms = performance.now() - t0;
    const usage: Usage = {
      inputTokens: message.usage.input_tokens ?? 0,
      outputTokens: message.usage.output_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    const block = message.content.find((b) => b.type === "tool_use");
    const input = (block && "input" in block ? (block.input as any) : {}) ?? {};
    return {
      ok: true,
      model: reader.model,
      ms,
      usage,
      costUsd: priceUsd(reader.model, usage),
      thought: message.content.some((b) => b.type === "thinking"),
      extraction: {
        report_date: input.report_date ?? null,
        report_date_raw: input.report_date_raw ?? null,
        lab_name: input.lab_name ?? null,
        patient_name: input.patient_name ?? null,
        patient_id: input.patient_id ?? null,
        measurements: Array.isArray(input.measurements) ? input.measurements : [],
        usage,
        model: reader.model,
      },
      error: null,
    };
  } catch (e) {
    return failed(reader.model, performance.now() - t0, e);
  }
}
