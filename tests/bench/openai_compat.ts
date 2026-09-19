/**
 * The free-tier readers: any OpenAI-compatible `/chat/completions` endpoint.
 *
 * Three providers share this one file because they share one wire shape —
 * Cloudflare Workers AI, Groq and Mistral's chat models all take the same
 * request and answer with the same `choices[0].message.content` + `usage`.
 * What differs is the base URL, the key, and which knob turns thinking off.
 * That is the whole provider table below; everything else is common.
 *
 * Why these three (docs/free-llm-apis, 2026-09-18 session): the app should be
 * free to use, the cost of a page is Sonnet (3.7 of 5.1 ¢ on the text path,
 * ~4.5 of 5.6 ¢ on photos), and these are the free tiers whose terms do not
 * train on the input. Gemini's free quota is ~20 requests/day, so it is not
 * here. The arms are single readers first — the pair numbers come offline
 * from the same persisted outputs, as for every other arm.
 *
 * Same `CallResult` as callReader / callGemini / callMistral, so an arm is
 * declared once and only its `provider` says which API answers. The prompt is
 * the *imported* `SYSTEM_EXTRACT` / `SYSTEM_EXTRACT_TEXT` and the schema is
 * `TOOL.input_schema` (image) or the text path's `row_index` variant — the
 * moment this file restates the Czech it stops measuring the app.
 *
 * Settings, mirroring gemini.ts:
 *   - structured output: `response_format: { type: "json_schema" }` with the
 *     tool schema as-is (JSON Schema, which these endpoints take directly;
 *     no `nullable` rewrite needed). Probed 2026-09-18: all three Workers AI
 *     models and Groq's Qwen answered valid JSON under it.
 *   - `temperature: 0`, `max_tokens: 8000`.
 *   - thinking OFF, because thinking is billed as output and a 27B model
 *     thinking about a table triples the bill for nothing the scorer reads.
 *     The knob is per provider: Workers AI takes vLLM's
 *     `chat_template_kwargs.enable_thinking=false` (probed: GLM 380→159 and
 *     Qwen 342→233 completion tokens, no `reasoning_content`); Groq takes
 *     `reasoning_effort: "none"` and rejects `chat_template_kwargs` with a
 *     400. Mistral Small does not think.
 *   - no retries except 429 — "429 is not a bad read" (mistral.ts). Free
 *     tiers are rate-limited by design: Groq's is 30 RPM / 8k TPM, so a
 *     429 there is a fact about the tier, not the model. Timed per attempt;
 *     only the attempt that answered is reported.
 *
 * Images: the Claude-tier render (long edge 2576 px, corpora.ts
 * CLAUDE_PHOTO_EDGE). Groq bills every image as a fixed 2,048 tokens and
 * Workers AI's models tokenise by patch, so neither is helped by more pixels
 * than that; docs/lab-adaptability.md showed 5146 px buys nothing over 2576
 * for Gemini either.
 *
 * Keys: `GROQ_API_KEY` and `MISTRAL_API_KEY` in the repo-root `.env`.
 * Cloudflare has no key in `.env`: the bench reads the **wrangler OAuth
 * token** from `~/Library/Preferences/.wrangler/config/default.toml` (or
 * `CLOUDFLARE_API_TOKEN` when set) and the account from
 * `CLOUDFLARE_ACCOUNT_ID` (default: the one `wrangler whoami` prints). The
 * OAuth token expires hourly; on a 401 the call runs `wrangler whoami`, which
 * refreshes it, re-reads, and tries once more.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { SYSTEM_EXTRACT, SYSTEM_EXTRACT_TEXT, TEXT_LAYER_HINT, TOOL, type Usage } from "@bw/extraction";
import { type TextRow } from "@bw/lab-core";

import { priceUsd, rowsIndexed, type CallResult, type Reader } from "./extract";
import { textToolSchema } from "./gemini";

export type CompatProvider = "cloudflare" | "groq" | "mistral-chat";

export type CompatInput =
  | { kind: "text"; rows: TextRow[] }
  | { kind: "image"; base64: string; mediaType: string; textLayer?: string | null };

/* --------------------------------------------------------------- providers */

/** Model ids, pinned. Workers AI ids carry the `@cf/` prefix on the OpenAI endpoint too. */
export const CF_GLM = "@cf/zai-org/glm-5.3-flash";
export const CF_SCOUT = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const CF_QWEN = "@cf/qwen/qwen3.8-27b";
export const GROQ_QWEN = "qwen/qwen3.8-27b";
/** Mistral Small 4 — the dated id, as mistral.ts pins the OCR model. */
export const MISTRAL_SMALL = "mistral-small-2603";
/** Ministral 3 14B, Dec 2025 — vision + tools; free tier on this workspace (30 req/min). */
export const MINISTRAL_14B = "ministral-14b-2512";

/**
 * Prices live in extract.ts `PRICING` beside Haiku's and Gemini's — this file
 * imports `priceUsd` from there, so a table here would be a cycle.
 */

const WRANGLER_CONFIG = join(homedir(), "Library/Preferences/.wrangler/config/default.toml");
const CF_ACCOUNT_DEFAULT = "0ed321fc701ed4c748d3a12417c27f17";

function wranglerToken(): string {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (!existsSync(WRANGLER_CONFIG)) return "";
  const m = readFileSync(WRANGLER_CONFIG, "utf8").match(/oauth_token\s*=\s*"([^"]+)"/);
  return m?.[1] ?? "";
}

/** `wrangler whoami` refreshes an expired OAuth token as a side effect. */
function refreshWranglerToken(): string {
  try {
    execFileSync("npx", ["wrangler", "whoami"], { stdio: "ignore", timeout: 30_000 });
  } catch {
    /* the re-read below decides */
  }
  return wranglerToken();
}

/** The request fields that turn thinking off, per provider — see the header. */
const NO_THINKING: Record<CompatProvider, Record<string, unknown>> = {
  cloudflare: { chat_template_kwargs: { enable_thinking: false } },
  groq: { reasoning_effort: "none" },
  "mistral-chat": {},
};

interface Endpoint {
  url: string;
  key: string;
}

export function endpointFor(provider: CompatProvider, apiKey: string): Endpoint {
  switch (provider) {
    case "cloudflare": {
      const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? CF_ACCOUNT_DEFAULT;
      return {
        url: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`,
        key: apiKey || wranglerToken(),
      };
    }
    case "groq":
      return { url: "https://api.groq.com/openai/v1/chat/completions", key: apiKey };
    case "mistral-chat":
      return { url: "https://api.mistral.ai/v1/chat/completions", key: apiKey };
  }
}

export const KEY_ENV: Record<CompatProvider, string> = {
  cloudflare: "CLOUDFLARE_API_TOKEN (or the wrangler login)",
  groq: "GROQ_API_KEY",
  "mistral-chat": "MISTRAL_API_KEY",
};

/* ----------------------------------------------------------------- request */

export function compatRequest(provider: CompatProvider, reader: Reader, input: CompatInput): Record<string, unknown> {
  let system: string;
  let schema: any;
  let content: unknown;

  if (input.kind === "text") {
    system = SYSTEM_EXTRACT_TEXT;
    schema = textToolSchema();
    content = `Řádky vytištěné na stránce:\n\n${rowsIndexed(input.rows).slice(0, 40000)}`;
  } else {
    system = SYSTEM_EXTRACT;
    schema = TOOL.input_schema;
    const parts: unknown[] = [{ type: "image_url", image_url: { url: `data:${input.mediaType};base64,${input.base64}` } }];
    if (input.textLayer && input.textLayer.trim()) {
      parts.push({ type: "text", text: TEXT_LAYER_HINT + input.textLayer.slice(0, 20000) });
    }
    parts.push({ type: "text", text: "Přepiš všechny měřené řádky z této stránky." });
    content = parts;
  }

  return {
    model: reader.model,
    temperature: 0,
    max_tokens: 8000,
    messages: [
      { role: "system", content: system },
      { role: "user", content },
    ],
    response_format: { type: "json_schema", json_schema: { name: TOOL.name, schema } },
    ...NO_THINKING[provider],
  };
}

/** The request with the image bytes elided — what a dry run prints. */
export function describeRequest(req: Record<string, unknown>): unknown {
  const clone = JSON.parse(JSON.stringify(req));
  for (const m of clone.messages ?? []) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.image_url?.url) p.image_url.url = `<data URI, ${p.image_url.url.length} chars>`;
      }
    } else if (typeof m.content === "string" && m.content.length > 400) {
      m.content = m.content.slice(0, 200) + `… (${m.content.length} chars) …` + m.content.slice(-200);
    }
  }
  return clone;
}

/* -------------------------------------------------------------------- call */

const EMPTY: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const MAX_RETRIES = 6;
const BACKOFF_MS = 3_000;
const BACKOFF_CAP_MS = 60_000;

function parseJson(text: string): any {
  // Some models wrap the answer in a fence, or leave a <think> block in
  // content when thinking could not be turned off. Neither is the answer.
  const t = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  return JSON.parse(t);
}

function failed(model: string, ms: number, error: string): CallResult {
  return { ok: false, model, ms, usage: EMPTY, costUsd: 0, thought: false, extraction: null, error };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A 429 whose `retry-after` is longer than the backoff cap is a *daily*
 * limit, not pacing (Groq: 200k tokens/day on the free tier, "try again in
 * 1h23m"). Waiting it out inside a run would be hours of polling, so the
 * provider is marked exhausted until then and every later call fails at
 * once without sending. `loadPersisted` refuses failed calls, so the next
 * day's run picks those pages up — the free tier is tested over days, as
 * a free tier would be used.
 */
const exhaustedUntil: Partial<Record<CompatProvider, number>> = {};

export async function callCompat(provider: CompatProvider, apiKey: string, reader: Reader, input: CompatInput): Promise<CallResult> {
  const ep = endpointFor(provider, apiKey);
  if (!ep.key) return failed(reader.model, 0, `${KEY_ENV[provider]} not set`);
  const body = JSON.stringify(compatRequest(provider, reader, input));
  const until = exhaustedUntil[provider];
  if (until && Date.now() < until) {
    return failed(reader.model, 0, `${provider} daily limit — not sent; retry after ${new Date(until).toISOString()}`);
  }

  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(ep.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${ep.key}`, "Content-Type": "application/json" },
        body,
      });
    } catch (e: any) {
      return failed(reader.model, performance.now() - t0, `fetch: ${e?.message ?? e}`);
    }
    const ms = performance.now() - t0;
    const text = await res.text();

    if (res.status === 429) {
      // Groq's free tier caps OUTPUT tokens per minute at 1,000 and rejects a
      // request whose expected answer is longer — before running it, as a
      // 429 "Request too large". No wait makes that page fit: it is a fact
      // about the tier (a dense sheet is ~2k output tokens), recorded as such.
      if (/request too large/i.test(text)) return failed(reader.model, ms, `429 too large for the tier: ${text.slice(0, 300)}`);
      const ra = parseFloat(res.headers.get("retry-after") ?? "");
      if (Number.isFinite(ra) && ra * 1000 > BACKOFF_CAP_MS) {
        exhaustedUntil[provider] = Date.now() + ra * 1000;
        console.log(`   ${provider} daily limit — retry-after ${Math.round(ra / 60)} min; the rest of this arm is skipped: ${text.slice(0, 200)}`);
        return failed(reader.model, ms, `429 daily limit (retry-after ${Math.round(ra)} s): ${text.slice(0, 300)}`);
      }
      if (attempt >= MAX_RETRIES) return failed(reader.model, ms, `429 after ${MAX_RETRIES} retries: ${text.slice(0, 300)}`);
      const wait = Math.min(BACKOFF_CAP_MS, Number.isFinite(ra) ? ra * 1000 + 500 : BACKOFF_MS * 2 ** attempt);
      console.log(`   ${provider} 429 — backing off ${Math.round(wait)} ms (retry ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(wait);
      continue;
    }
    if (res.status === 401 && provider === "cloudflare" && !refreshed) {
      refreshed = true;
      ep.key = refreshWranglerToken();
      console.log("   cloudflare 401 — wrangler token refreshed, retrying once");
      continue;
    }
    if (!res.ok) return failed(reader.model, ms, `${res.status} ${text.slice(0, 300)}`);

    let d: any;
    try {
      d = JSON.parse(text);
    } catch {
      return failed(reader.model, ms, `non-JSON response: ${text.slice(0, 200)}`);
    }
    const msg = d.choices?.[0]?.message ?? {};
    const usage: Usage = {
      inputTokens: d.usage?.prompt_tokens ?? 0,
      outputTokens: d.usage?.completion_tokens ?? 0,
      cacheReadTokens: d.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: 0,
    };
    const thought = !!(msg.reasoning_content || msg.reasoning);
    const costUsd = priceUsd(reader.model, usage);
    let data: any;
    try {
      data = parseJson(msg.content ?? "");
    } catch (e: any) {
      return {
        ok: false, model: reader.model, ms, usage, costUsd, thought, extraction: null,
        error: `unparseable JSON (${d.choices?.[0]?.finish_reason ?? "?"}): ${e?.message ?? e}`,
      };
    }
    return {
      ok: true,
      model: reader.model,
      ms,
      usage,
      costUsd,
      thought,
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
  }
}
