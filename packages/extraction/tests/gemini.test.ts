/**
 * The Gemini reader, without calling Gemini.
 *
 * Everything worth pinning about this reader is in the request it builds and
 * the shape it returns, and both are checkable offline: `geminiImageRequest`
 * takes no client, and `extractPageGemini` goes through global `fetch`, which
 * is stubbed here. Nothing in this file spends money or needs a key.
 *
 * The property under test is not "the request looks right" but **the two
 * readers are indistinguishable downstream**: same prompt, same schema, same
 * `PageExtraction`. `reconcile()` unions reads by analyte name and flags any
 * value the two disagree on — so the moment a Gemini read normalises a field
 * differently from an Anthropic one, every page starts flagging rows for a
 * difference of vendor rather than a difference of reading.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractPageGemini,
  geminiImageRequest,
  GEMINI_IMAGE_TOKENS,
  GEMINI_MEDIA_RESOLUTION,
  MODEL_GEMINI,
  parseGeminiJson,
  SONNET_IMAGE_MAX_EDGE,
  SYSTEM_EXTRACT,
  TEXT_LAYER_HINT,
  TOOL,
  toGeminiSchema,
} from "../src/index";

const IMG = "AAAABBBB";

function req(over: Partial<Parameters<typeof geminiImageRequest>[0]> = {}) {
  return geminiImageRequest({
    model: MODEL_GEMINI,
    imageBase64: IMG,
    mediaType: "image/jpeg",
    textLayer: null,
    ...over,
  });
}

/** The parts of a built request, as plain objects. */
const partsOf = (p: ReturnType<typeof geminiImageRequest>) =>
  ((p.contents as any)[0].parts ?? []) as any[];

describe("the request carries the deployed prompt and schema, not a copy", () => {
  it("sends SYSTEM_EXTRACT verbatim", () => {
    // Not "contains the word transcribe": the exact string the Anthropic
    // readers get. A paraphrase here is how two readers stop being a
    // cross-check and start being two different jobs.
    expect(req().config?.systemInstruction).toBe(SYSTEM_EXTRACT);
  });

  it("converts TOOL.input_schema rather than restating it", () => {
    const schema: any = req().config?.responseSchema;
    expect(schema.required).toEqual(TOOL.input_schema.required);
    const m = schema.properties.measurements.items;
    expect(m.required).toEqual([...TOOL.input_schema.properties.measurements.items.required]);
    // The vision tool keeps source_snippet; the text tool's row_index has no
    // business here.
    expect(Object.keys(m.properties)).toContain("source_snippet");
    expect(Object.keys(m.properties)).not.toContain("row_index");
  });

  it("maps a [string, null] union to nullable and pins property order", () => {
    const schema: any = req().config?.responseSchema;
    expect(schema.properties.report_date.nullable).toBe(true);
    expect(schema.properties.measurements.nullable).toBeUndefined();
    // Gemini sorts object keys unless told not to, and the reconciler keys on
    // the analyte name — a reordered measurement object is still fine, but a
    // schema that has silently dropped the ordering is a signal the conversion
    // changed under us.
    expect(schema.propertyOrdering).toEqual(Object.keys(TOOL.input_schema.properties));
  });

  it("refuses a schema construct it cannot represent, rather than dropping it", () => {
    // A quietly relaxed schema shows up later as fabrications, which is the
    // one failure a second reader is worst at catching.
    expect(() => toGeminiSchema({ type: "string", pattern: "^x$" })).toThrow(/unsupported keyword/);
    expect(() => toGeminiSchema({ type: ["string", "number"] })).toThrow(/unsupported union/);
    expect(() => toGeminiSchema({ type: "tuple" })).toThrow(/unsupported type/);
  });
});

describe("the settings the measurement was taken under", () => {
  it("asks for ultra_high on the image part, per part", () => {
    const parts = partsOf(req());
    expect(parts[0].inlineData).toEqual({ data: IMG, mimeType: "image/jpeg" });
    // Per part, not per request: the request-level enum stops at HIGH, so
    // ultra_high is only reachable here.
    expect(parts[0].mediaResolution).toEqual({ level: "MEDIA_RESOLUTION_ULTRA_HIGH" });
    expect(GEMINI_MEDIA_RESOLUTION).toBe("ultra_high");
  });

  it("can be dropped to high, and that is the cheaper arm", () => {
    const parts = partsOf(req({ mediaResolution: "high" }));
    expect(parts[0].mediaResolution).toEqual({ level: "MEDIA_RESOLUTION_HIGH" });
    expect(GEMINI_IMAGE_TOKENS.ultra_high - GEMINI_IMAGE_TOKENS.high).toBe(1120);
  });

  it("uses temperature 0, JSON output and thinking LOW", () => {
    const c = req().config!;
    expect(c.temperature).toBe(0);
    expect(c.responseMimeType).toBe("application/json");
    // MINIMAL is in the SDK enum and this model rejects it with a 400.
    expect(c.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(c.maxOutputTokens).toBe(8000);
  });

  it("appends the text-layer hint only when the page has one", () => {
    expect(partsOf(req()).map((p) => p.text).filter(Boolean)).toEqual([
      "Přepiš všechny měřené řádky z této stránky.",
    ]);
    const withHint = partsOf(req({ textLayer: "S_Glukóza 5,32" }));
    expect(withHint[1].text).toBe(TEXT_LAYER_HINT + "S_Glukóza 5,32");
    // Whitespace is not a text layer.
    expect(partsOf(req({ textLayer: "   " })).length).toBe(2);
  });

  it("leaves the retry policy to the caller", () => {
    expect(req().config?.httpOptions).toBeUndefined();
    expect(req({ attempts: 1 }).config?.httpOptions).toEqual({ retryOptions: { attempts: 1 } });
  });
});

describe("image resolution per reader", () => {
  it("caps Sonnet at its tier and does not cap Gemini", () => {
    // Sonnet's image tier tops out at a 2576 px long edge. Gemini spends a
    // fixed token budget per part whatever the pixels are, so downscaling for
    // it would throw detail away and save nothing.
    expect(SONNET_IMAGE_MAX_EDGE).toBe(2576);
    expect(GEMINI_IMAGE_TOKENS.ultra_high).toBe(2240);
  });
});

/* ------------------------------------------------------------------ call */

function geminiReply(body: unknown, usage: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 3000,
        candidatesTokenCount: 900,
        thoughtsTokenCount: 100,
        ...usage,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const PAGE = {
  report_date: "2025-06-03",
  report_date_raw: "3.6.2025",
  lab_name: "Laboratoř Vzor",
  patient_name: null,
  patient_id: null,
  measurements: [
    {
      raw_analyte_name: "S_Glukóza",
      value_raw: "5,32",
      unit_raw: "mmol/l",
      ref_range_raw: "(4,11-5,60)",
      source_snippet: "S_Glukóza 5,32",
      confidence: "high",
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("extractPageGemini", () => {
  it("returns the same PageExtraction shape the Anthropic readers do", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: any) => {
      calls.push(typeof input === "string" ? input : input.url);
      return geminiReply(PAGE);
    });

    const out = await extractPageGemini("test-key", MODEL_GEMINI, IMG, "image/jpeg", null);

    expect(calls[0]).toContain("generativelanguage.googleapis.com");
    expect(calls[0]).toContain(MODEL_GEMINI);
    expect(out.model).toBe(MODEL_GEMINI);
    expect(out.measurements).toEqual(PAGE.measurements);
    expect(out.report_date).toBe("2025-06-03");
    // Thoughts are billed as output; folding them in is what keeps the extract
    // Worker's spend ledger — and therefore its freeze — honest.
    expect(out.usage).toEqual({
      inputTokens: 3000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("fills the fields a read omitted the same way toExtraction does", async () => {
    vi.stubGlobal("fetch", async () => geminiReply({ measurements: [] }));
    const out = await extractPageGemini("test-key", MODEL_GEMINI, IMG, "image/jpeg", null);
    expect(out).toMatchObject({
      report_date: null,
      report_date_raw: null,
      lab_name: null,
      patient_name: null,
      patient_id: null,
      measurements: [],
    });
  });

  it("refuses without a key instead of calling out with an empty one", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(extractPageGemini("", MODEL_GEMINI, IMG, "image/jpeg", null)).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects rather than inventing a page when the body will not parse", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    // The Worker's Promise.allSettled turns this into "one reader answered",
    // which reconcile then flags — silence is the one outcome not allowed.
    await expect(
      extractPageGemini("test-key", MODEL_GEMINI, IMG, "image/jpeg", null),
    ).rejects.toThrow();
  });
});

describe("parseGeminiJson", () => {
  it("accepts a fenced body — politeness is not a failure", () => {
    expect(parseGeminiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseGeminiJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("throws on an empty body rather than returning an empty page", () => {
    // An empty page reads as "this page has no results", which is a claim.
    expect(() => parseGeminiJson("")).toThrow(/empty/);
    expect(() => parseGeminiJson(undefined)).toThrow(/empty/);
  });
});
