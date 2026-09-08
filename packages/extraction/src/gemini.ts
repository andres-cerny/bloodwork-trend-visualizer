/**
 * The image path's second reader: Google Gemini 3.8 Flash.
 *
 * This is the *only* place in the product that talks to a provider other than
 * Anthropic, and it exists because of a measurement rather than a preference.
 * On 133 photographed pages carrying 3,585 truth rows
 * (docs/lab-adaptability.md, "The full corpus under the final prompt"):
 *
 *     pair                                 confirmed  flagged  UNCAUGHT  value errors
 *     gemini ultra_high + Sonnet 5              3583        5         0             0
 *     Sonnet 5 + Haiku 4.5   (deployed)         3307      494         0            40
 *
 * Both pairs are safe — the second reader catches everything either way — but
 * the deployed one pays for that safety by putting 494 rows in front of a human
 * instead of 5. The two readers must come from different vendors: every
 * same-vendor pair in that document has non-zero uncaught rows, because two
 * models from one lab make the same judgement calls and so confirm each other
 * on them.
 *
 * **Nothing here restates the prompt or the schema.** `SYSTEM_EXTRACT` and
 * `TOOL.input_schema` are imported from extract.ts and converted, and the
 * result goes through the same `toExtraction`, so `reconcile()` cannot tell
 * which provider produced a read. That is the property the whole cross-check
 * rests on.
 *
 * **`@google/genai` under workerd.** It runs. The package's `exports` map lists
 * `browser` before `node`, and wrangler's esbuild resolves with
 * `["workerd", "worker", "browser"]`, so a Worker build takes `dist/web`, whose
 * only import is `p-retry` — no `fs`, no `ws`, no `google-auth-library`, no
 * unguarded browser global. Every runtime probe it makes (`globalThis.process`,
 * `navigator`, `window`) is optional-chained, and the transport is plain
 * `fetch`/`Headers`. Verified by bundling the entry under those conditions and
 * by running the web build with `process` deleted and `fetch` stubbed.
 *
 * **New outbound host.** This adds `generativelanguage.googleapis.com` to the
 * extract Worker's egress, which until now was Anthropic and Turnstile only.
 * docs/constraints.md records "the Worker's only outbound hosts are hardcoded"
 * as a security-review finding; that still holds — the host is the SDK's own
 * default and no caller can redirect it — but the set has changed by one and
 * `/security-review` should see it.
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

import type { Usage } from "@bw/agent-core";

import { SYSTEM_EXTRACT, TEXT_LAYER_HINT, TOOL, toExtraction, type PageExtraction } from "./extract";

/**
 * Pinned to the dated id. A moving alias would silently void every number in
 * docs/lab-adaptability.md that this reader was chosen on.
 */
export const MODEL_GEMINI = "gemini-3.8-flash";

/** How many tokens one image part is worth to the model. */
export type MediaResolutionArm = "high" | "ultra_high";

/**
 * What one image *part* costs, per level — a fixed budget Gemini spends
 * whatever the pixels are. `ultra_high` is the top of the ladder; the only way
 * to buy more detail is to send more parts.
 *
 * Because the budget is fixed, a bigger picture is free. That is why the photo
 * path sends Gemini the uncut original while Sonnet gets a 2576 px long edge
 * (`SONNET_IMAGE_MAX_EDGE`): downscaling for Gemini would throw detail away
 * and save nothing.
 */
export const GEMINI_IMAGE_TOKENS: Record<MediaResolutionArm, number> = {
  high: 1120,
  ultra_high: 2240,
};

/**
 * Production setting. `ultra_high` beat `high` on the same 133 pages — 3583
 * rows matched against 3546, and `high` failed one page outright — for 1,120
 * extra tokens, about $0.001.
 */
export const GEMINI_MEDIA_RESOLUTION: MediaResolutionArm = "ultra_high";

/** No cap: see `GEMINI_IMAGE_TOKENS`. `null` means "send the original". */
export const GEMINI_IMAGE_MAX_EDGE: number | null = null;

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
 * throws rather than being dropped: a schema Gemini quietly relaxes would show
 * up later as fabrications, which is the one failure the cross-check is worst
 * at catching. `additionalProperties` has no counterpart and is omitted —
 * Gemini's structured output does not emit unknown keys anyway.
 *
 * `propertyOrdering` is pinned because Gemini otherwise sorts keys, and
 * `["string","null"]` unions become `nullable: true`.
 *
 * Lives here rather than in the bench so the measured conversion and the
 * deployed one cannot drift; tests/bench/gemini.ts imports it.
 */
export function toGeminiSchema(node: any): Schema {
  if (!node || typeof node !== "object") {
    throw new Error(`toGeminiSchema: not a schema node: ${JSON.stringify(node)}`);
  }
  const out: Schema = {};

  let type = node.type;
  if (Array.isArray(type)) {
    const nonNull = type.filter((t: string) => t !== "null");
    if (nonNull.length !== 1) throw new Error(`toGeminiSchema: unsupported union ${JSON.stringify(type)}`);
    if (nonNull.length !== type.length) out.nullable = true;
    type = nonNull[0];
  }
  if (typeof type !== "string" || !TYPE[type]) {
    throw new Error(`toGeminiSchema: unsupported type ${JSON.stringify(type)}`);
  }
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

/* ----------------------------------------------------------------- request */

const LEVEL: Record<MediaResolutionArm, PartMediaResolutionLevel> = {
  high: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
  ultra_high: PartMediaResolutionLevel.MEDIA_RESOLUTION_ULTRA_HIGH,
};

export interface GeminiImageRequest {
  model: string;
  imageBase64: string;
  mediaType: string;
  textLayer: string | null;
  mediaResolution?: MediaResolutionArm;
  /**
   * HTTP attempts, not model retries. Left to the caller because the two
   * callers want opposite things: the Worker retries a 429 the way the
   * Anthropic client does, while the bench sets 1 so a failure is recorded as
   * a failure rather than as forty seconds of model latency.
   */
  attempts?: number;
}

/**
 * The full request, built without a client so it can be asserted on without
 * spending anything.
 *
 * Mirrors `extractPage` part for part: the image, the text-layer hint when the
 * page has one, the same one-line ask, the same system prompt and the same
 * tool schema. Thinking is `LOW` — `MINIMAL` is in the SDK enum and this model
 * rejects it with a 400 (288 calls, 2026-09-06, tests/bench/gemini.ts).
 * Temperature 0, as the Anthropic readers are by default.
 */
export function geminiImageRequest(req: GeminiImageRequest): GenerateContentParameters {
  const parts: Part[] = [
    {
      inlineData: { data: req.imageBase64, mimeType: req.mediaType },
      // Per *part*, not per request: the request-level MediaResolution enum
      // stops at HIGH, so ultra_high is only reachable here.
      mediaResolution: { level: LEVEL[req.mediaResolution ?? GEMINI_MEDIA_RESOLUTION] },
    },
  ];
  if (req.textLayer && req.textLayer.trim()) {
    parts.push({ text: TEXT_LAYER_HINT + req.textLayer.slice(0, 20000) });
  }
  parts.push({ text: "Přepiš všechny měřené řádky z této stránky." });

  return {
    model: req.model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: SYSTEM_EXTRACT,
      temperature: 0,
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
      responseSchema: toGeminiSchema(TOOL.input_schema),
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      ...(req.attempts === undefined ? {} : { httpOptions: { retryOptions: { attempts: req.attempts } } }),
    },
  };
}

/* -------------------------------------------------------------------- call */

/**
 * Gemini reports thoughts separately and bills them as output. Folding them in
 * is what keeps the spend ledger honest — the extract Worker's freeze is the
 * only thing between a public URL and an unbounded bill.
 */
function usageOf(r: GenerateContentResponse): Usage {
  const u = r.usageMetadata;
  return {
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    cacheReadTokens: u?.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
  };
}

/**
 * Structured output still arrives as text, and a model that wraps it in a
 * fence has not failed — it has been polite. Strip the fence, then parse; a
 * genuinely unparseable body throws, which is what the caller's
 * `Promise.allSettled` is there for.
 */
export function parseGeminiJson(text: string | undefined): Record<string, unknown> {
  const t = (text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  if (!t) throw new Error("Gemini returned an empty body");
  return JSON.parse(t) as Record<string, unknown>;
}

/**
 * Transcribe one rendered page image with Gemini.
 *
 * Signature and return type are `extractPage`'s, deliberately: the Worker picks
 * a reader by name and calls it through one lambda, and every caller downstream
 * — `reconcile`, `review.ts`, the verification tab — sees one shape.
 */
export async function extractPageGemini(
  apiKey: string,
  model: string,
  imageBase64: string,
  mediaType: string,
  textLayer: string | null,
  mediaResolution: MediaResolutionArm = GEMINI_MEDIA_RESOLUTION,
): Promise<PageExtraction> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent(
    geminiImageRequest({
      model,
      imageBase64,
      mediaType,
      textLayer,
      mediaResolution,
      // Three attempts, matching `clientFor`'s maxRetries: a page that still
      // fails is reported rather than sinking the report.
      attempts: 3,
    }),
  );

  return toExtraction(parseGeminiJson(response.text) as Record<string, any>, usageOf(response), model);
}
