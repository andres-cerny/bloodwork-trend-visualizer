/**
 * Route-level tests for the Worker, with the Anthropic and Turnstile calls
 * stubbed. Everything except the network hop to Claude is real code: the
 * session gate, the spend ledger, the freeze, and the text-vs-vision choice.
 *
 * The freeze is the behaviour worth proving — it is the only thing standing
 * between a public URL and an unbounded bill.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { mintSession, recordSpendUsd, totalSpentUsd } from "@bw/gate";
import { priceUsd } from "@bw/agent-core";
import { MODEL_GEMINI } from "@bw/extraction";

const SECRET = "test-session-secret";

function fakeKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string, _opts?: unknown) => void store.set(k, v),
  } as unknown as KVNamespace;
}

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    BUDGET: fakeKv(),
    ANTHROPIC_API_KEY: "sk-ant-test",
    TURNSTILE_SECRET_KEY: "turnstile-test",
    SESSION_SECRET: SECRET,
    BUDGET_USD_LIMIT: "20",
    MAX_PAGES_PER_SESSION: "12",
    SESSION_TTL_SECONDS: "1800",
    TURNSTILE_HOSTNAMES: "demo.test",
    SINGLE_MODEL: "0",
    // PHOTO_READERS deliberately unset: the default is what a deploy of this
    // code does, so it is what the suite runs against unless a test says
    // otherwise.
    ...over,
  };
}

/** One tool_use reply, priced so a known number of calls crosses the ceiling. */
function anthropicReply(rows: Array<[string, string, string, string]>, outTokens = 1000) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        input: {
          report_date: "2025-06-03",
          report_date_raw: "3.6.2025",
          lab_name: "Laboratoř Vzor",
          patient_name: null,
          patient_id: null,
          measurements: rows.map(([n, v, u, r]) => ({
            raw_analyte_name: n,
            value_raw: v,
            unit_raw: u,
            ref_range_raw: r,
            source_snippet: `${n} ${v}`,
            confidence: "high",
          })),
        },
      },
    ],
    usage: {
      input_tokens: 2000,
      output_tokens: outTokens,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}


/** One Gemini reply, structured-output JSON in a text part. */
function geminiReply(rows: Array<[string, string, string, string]>, outTokens = 1000) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                report_date: "2025-06-03",
                report_date_raw: "3.6.2025",
                lab_name: "Laboratoř Vzor",
                patient_name: null,
                patient_id: null,
                measurements: rows.map(([n, v, u, r]) => ({
                  raw_analyte_name: n,
                  value_raw: v,
                  unit_raw: u,
                  ref_range_raw: r,
                  source_snippet: `${n} ${v}`,
                  confidence: "high",
                })),
              }),
            },
          ],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 2000,
      candidatesTokenCount: outTokens,
      thoughtsTokenCount: 0,
    },
  };
}

/**
 * An Anthropic streaming reply, as SSE.
 *
 * The extraction stub returns a whole JSON message; the agent calls
 * `messages.stream()` and gets frames. Without this the chat route was
 * effectively untested — the old suite handed a tool_use block to a text-only
 * chat call, the text filter produced "", and nothing asserted otherwise.
 */
function anthropicStream(text: string, outTokens = 100, toolUse?: { name: string; input: unknown }) {
  const blocks: string[] = [];
  const ev = (t: string, d: unknown) => `event: ${t}\ndata: ${JSON.stringify(d)}\n\n`;

  blocks.push(ev("message_start", {
    type: "message_start",
    message: {
      id: "msg_stream", type: "message", role: "assistant", model: "claude-sonnet-5",
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 2000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }));

  if (toolUse) {
    blocks.push(ev("content_block_start", {
      type: "content_block_start", index: 0,
      content_block: { type: "tool_use", id: "toolu_1", name: toolUse.name, input: {} },
    }));
    blocks.push(ev("content_block_delta", {
      type: "content_block_delta", index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(toolUse.input) },
    }));
    blocks.push(ev("content_block_stop", { type: "content_block_stop", index: 0 }));
  } else {
    blocks.push(ev("content_block_start", {
      type: "content_block_start", index: 0, content_block: { type: "text", text: "" },
    }));
    // Deliberately split, so a client that reads one chunk as one frame fails.
    for (const piece of [text.slice(0, 3), text.slice(3)]) {
      blocks.push(ev("content_block_delta", {
        type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece },
      }));
    }
    blocks.push(ev("content_block_stop", { type: "content_block_stop", index: 0 }));
  }

  blocks.push(ev("message_delta", {
    type: "message_delta",
    delta: { stop_reason: toolUse ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: outTokens },
  }));
  blocks.push(ev("message_stop", { type: "message_stop" }));

  return new Response(blocks.join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * Let a streamed response finish.
 *
 * The route's work — calling Claude, running tools, recording spend — happens
 * as the body is produced, so a test that asserts on any of it without reading
 * the body is asserting before it has run.
 */
async function drain(res: Response): Promise<Response> {
  await res.clone().text();
  return res;
}

/** Collect an SSE body into the events it carried. */
async function sseEvents(res: Response): Promise<any[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice(6)));
}

/** What the next Claude call should return; set per test. */
let nextStream: { text: string; outTokens?: number; toolUse?: { name: string; input: unknown } } | null = null;

/** Where the stubbed challenge was solved. Tests override it per case. */
let turnstileHostname = "demo.test";

let calls: Array<{ url: string; body: any }> = [];

/** Which providers/models the stub should refuse this test. */
let failing = new Set<string>();

/**
 * When set, Gemini answers 200 with a body that is not JSON — the one shape
 * that is billed and unreadable at once (docs/security-review-gemini.md,
 * finding 4). The text is page-derived on purpose: finding 6 is about it
 * escaping in an error message.
 */
let geminiUnparseable = false;

beforeEach(() => {
  calls = [];
  failing = new Set();
  geminiUnparseable = false;
  turnstileHostname = "demo.test";
  nextStream = null;
  // The SDK may call fetch with a Request object rather than (url, init), so
  // read the body from whichever shape arrives.
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const req: Request | null = typeof input === "object" && "url" in input ? (input as Request) : null;
    const u = req ? req.url : String(input);

    if (u.includes("generativelanguage.googleapis.com")) {
      const raw = req ? await req.clone().text() : init?.body;
      calls.push({ url: u, body: raw ? JSON.parse(String(raw)) : {} });
      // 400, not 500: the SDK retries 5xx, and a retried refusal would make
      // this suite spend seconds proving nothing.
      if (failing.has("gemini")) {
        return new Response(JSON.stringify({ error: { message: "forced" } }), { status: 400 });
      }
      if (geminiUnparseable) {
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Omlouvám se, Jan Novák 800101/0006" }] } }],
            usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 1000, thoughtsTokenCount: 0 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(geminiReply([["S_Glukóza", "5,32", "mmol/l", "(4,11-5,60)"]])), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (u.includes("turnstile")) {
      return new Response(
        JSON.stringify({ success: true, hostname: turnstileHostname, action: "session" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const rawBody = req ? await req.clone().text() : init?.body;
    const body = rawBody ? JSON.parse(String(rawBody)) : {};
    calls.push({ url: u, body });

    if (failing.has("anthropic") || failing.has(String(body?.model))) {
      return new Response(JSON.stringify({ error: { message: "forced" } }), { status: 400 });
    }

    // A streaming request is an agent turn; a buffered one is extraction.
    if (body?.stream) {
      const spec = nextStream ?? { text: "Ahoj." };
      const reply = anthropicStream(spec.text, spec.outTokens ?? 100, spec.toolUse);
      nextStream = null; // a tool round-trip's second call falls back to text
      return reply;
    }

    return new Response(
      JSON.stringify(anthropicReply([["S_Glukóza", "5,32", "mmol/l", "(4,11-5,60)"]])),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
});
afterEach(() => vi.unstubAllGlobals());

const post = (path: string, body: unknown, session?: string) =>
  new Request(`https://demo.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session ? { "x-demo-session": session } : {}),
    },
    body: JSON.stringify(body),
  });
describe("session gate", () => {
  it("refuses extraction without a session", async () => {
    const res = await worker.fetch(post("/api/extract", { rowsText: "a | b" }), makeEnv());
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0); // never reached Claude
  });

  it("mints a session from a passing Turnstile token", async () => {
    const res = await worker.fetch(post("/api/session", { turnstileToken: "tok" }), makeEnv());
    expect(res.status).toBe(200);
    const { session, maxPages } = (await res.json()) as any;
    expect(maxPages).toBe(12);
    expect(session).toContain(".");
  });
});

describe("extraction path selection", () => {
  it("sends no image when rowsText is present", async () => {
    const env = makeEnv();
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", { rowsText: "S_Glukóza | 5,32" }, s), env);
    const body = (await res.json()) as any;
    expect(body.mode).toBe("text");
    for (const c of calls) {
      const content = JSON.stringify(c.body.messages);
      expect(content).not.toContain("base64");
      expect(content).not.toContain('"image"');
    }
  });

  it("falls back to the image when there is no text layer", async () => {
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(
      post("/api/extract", { imageBase64: "AAAA", mediaType: "image/jpeg" }, s),
      makeEnv(),
    );
    expect(((await res.json()) as any).mode).toBe("vision");
    expect(JSON.stringify(calls[0].body.messages)).toContain('"image"');
  });

  it("runs both models by default and one when SINGLE_MODEL is set", async () => {
    const s = await mintSession(SECRET, 600, 12);
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), makeEnv());
    expect(calls).toHaveLength(2);

    calls = [];
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), makeEnv({ SINGLE_MODEL: "1" }));
    expect(calls).toHaveLength(1);
  });

  it("with TEXT_READERS=cheap reads text once with the cheap model and images still twice", async () => {
    const s = await mintSession(SECRET, 600, 12);
    const env = makeEnv({ TEXT_READERS: "cheap" });
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.model).toBe("claude-haiku-4-5");

    calls = [];
    await worker.fetch(post("/api/extract", { imageBase64: "AAAA", mediaType: "image/jpeg" }, s), env);
    expect(calls).toHaveLength(2);
  });

  it("with stream:true answers one JSON object per line — rows as written, then the whole answer", async () => {
    const s = await mintSession(SECRET, 600, 12);
    nextStream = {
      text: "",
      toolUse: {
        name: "record_lab_results",
        input: {
          report_date: "2025-06-03",
          report_date_raw: "3.6.2025",
          lab_name: "Laboratoř Vzor",
          patient_name: null,
          patient_id: null,
          measurements: [
            { raw_analyte_name: "S_Glukóza", value_raw: "5,32", unit_raw: "mmol/l", ref_range_raw: "(4,11-5,60)", row_index: 3, confidence: "high" },
            { raw_analyte_name: "S_Urea", value_raw: "6,1", unit_raw: "mmol/l", ref_range_raw: "(2,8-8,0)", row_index: 4, confidence: "high" },
          ],
        },
      },
    };
    const res = await worker.fetch(post("/api/extract", { rowsText: "x | y", stream: true }, s), makeEnv({ SINGLE_MODEL: "1" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.type)).toEqual(["row", "row", "done"]);
    expect(lines[0]).toMatchObject({ model: "claude-sonnet-5", row: { raw_analyte_name: "S_Glukóza", value_raw: "5,32" } });
    const done = lines[2];
    expect(done.mode).toBe("text");
    expect(done.reads).toHaveLength(1);
    expect(done.reads[0].measurements).toHaveLength(2);
    expect(typeof done.costUsd).toBe("number");
    // The streamed call was a streaming call to Claude, and its tool asked
    // for eager input streaming — that is what makes rows arrive early.
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.tools[0].eager_input_streaming).toBe(true);
  });

  it("without stream:true answers exactly as before — plain JSON, buffered", async () => {
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), makeEnv({ SINGLE_MODEL: "1" }));
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(calls[0].body.stream).toBeUndefined();
    expect(((await res.json()) as any).reads).toHaveLength(1);
  });

  it("rejects a request carrying neither rows nor an image", async () => {
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", {}, s), makeEnv());
    expect(res.status).toBe(400);
  });
});

describe("per-session page allowance", () => {
  it("refuses once the session's pages are spent", async () => {
    // Without this the `pages` claim is just a comment: one Turnstile solve
    // would buy unlimited extraction for the token's lifetime.
    const env = makeEnv({ MAX_PAGES_PER_SESSION: "2" });
    const s = await mintSession(SECRET, 600, 2);
    const call = () => worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);

    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);

    const third = await call();
    expect(third.status).toBe(429);
    expect(((await third.json()) as any).error).toBe("page_limit");
  });

  it("makes no Claude call once the allowance is spent", async () => {
    const env = makeEnv({ MAX_PAGES_PER_SESSION: "1" });
    const s = await mintSession(SECRET, 600, 1);
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    calls = [];
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    expect(calls).toHaveLength(0);
  });

  it("counts per session, so a fresh challenge starts clean", async () => {
    const env = makeEnv({ MAX_PAGES_PER_SESSION: "1" });
    const a = await mintSession(SECRET, 600, 1);
    const b = await mintSession(SECRET, 600, 1);
    expect((await worker.fetch(post("/api/extract", { rowsText: "x" }, a), env)).status).toBe(200);
    expect((await worker.fetch(post("/api/extract", { rowsText: "x" }, a), env)).status).toBe(429);
    expect((await worker.fetch(post("/api/extract", { rowsText: "x" }, b), env)).status).toBe(200);
  });

});

describe("spend ledger", () => {
  it("records what a call cost", async () => {
    const env = makeEnv();
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    const body = (await res.json()) as any;
    // 2k in + 1k out on Sonnet 5 ($3/$15) = 0.021, and on Haiku 4.5 ($1/$5)
    // = 0.007. The second reader moved from Opus 4.8 to Haiku 4.5, which is
    // why this is 0.028 rather than the 0.056 it used to be.
    expect(body.costUsd).toBeCloseTo(0.028, 3);
    expect(body.budget.spentUsd).toBeCloseTo(0.028, 3);
  });

  it("freezes both AI routes once the ceiling is reached", async () => {
    // One extraction costs $0.028, so a $0.02 ceiling is crossed by the first
    // call — the guard is checked before a call, not mid-flight.
    const env = makeEnv({ BUDGET_USD_LIMIT: "0.02" });
    const s = await mintSession(SECRET, 600, 12);

    // First call starts under the ceiling and is allowed through.
    expect((await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env)).status).toBe(200);

    // It pushed the ledger past the ceiling, so the next call is refused.
    const blocked = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    expect(blocked.status).toBe(402);
    const body = (await blocked.json()) as any;
    expect(body.error).toBe("budget_exhausted");
    expect(body.budget.frozen).toBe(true);

    // Extraction froze; the agent's own ledger is untouched, which is the
    // point of keying them apart. The agent side of that is asserted in the
    // agent worker's own suite.
    expect(await totalSpentUsd(env.BUDGET, "agent")).toBe(0);
  });

  it("makes no Claude call at all once frozen", async () => {
    const env = makeEnv({ BUDGET_USD_LIMIT: "0.02" });
    const s = await mintSession(SECRET, 600, 12);
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    calls = [];
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    expect(calls).toHaveLength(0);
  });
});

describe("the session gate checks where the challenge was solved", () => {
  it("refuses a token solved on a hostname this deployment does not serve", async () => {
    // The widget registers localhost for development. A token belongs to the
    // widget, not the page, so before the hostname check this minted a
    // production session.
    turnstileHostname = "localhost";
    const res = await worker.fetch(
      post("/api/session", { turnstileToken: "solved-on-localhost" }),
      makeEnv(),
    );
    expect(res.status).toBe(403);
    expect((await res.json() as any).error).toBe("turnstile_failed");
  });

  it("refuses everything when the allowlist is not configured", async () => {
    const res = await worker.fetch(
      post("/api/session", { turnstileToken: "fine" }),
      makeEnv({ TURNSTILE_HOSTNAMES: "" }),
    );
    expect(res.status).toBe(403);
  });
});

/**
 * Which two readers transcribe a page image.
 *
 * The measurement behind this is in docs/lab-adaptability.md: on 133
 * photographed pages the deployed Sonnet+Haiku pair made 40 value errors and
 * put 494 rows in front of a human; Sonnet paired with Gemini 3.8 Flash made
 * none and flagged 5. Both reach zero uncaught errors, so this is a review-cost
 * change, not a safety one — which is exactly why it may be a config flip.
 *
 * The property pinned here is that **the default is today's behaviour**. A
 * deploy of this code with no var set must call Anthropic twice and Google not
 * at all, or "reversible" is a claim about a code change rather than a setting.
 */
describe("PHOTO_READERS", () => {
  const image = { imageBase64: "AAAA", mediaType: "image/jpeg" };
  const hosts = () => calls.map((c) => (c.url.includes("googleapis") ? "google" : "anthropic"));
  const models = () => calls.map((c) => c.body.model).filter(Boolean);

  async function extractImage(env: Env, body: Record<string, unknown> = image) {
    const s = await mintSession(SECRET, 600, 12);
    return worker.fetch(post("/api/extract", body, s), env);
  }

  it("defaults to today's pair, so deploying this code changes nothing", async () => {
    const res = await extractImage(makeEnv());
    expect(hosts()).toEqual(["anthropic", "anthropic"]);
    expect(models()).toEqual(["claude-sonnet-5", "claude-haiku-4-5"]);
    expect(((await res.json()) as any).readers).toBe("sonnet+haiku");
  });

  it("sends the image to Google when set to sonnet+gemini", async () => {
    const res = await extractImage(makeEnv({ PHOTO_READERS: "sonnet+gemini", GEMINI_API_KEY: "g" }));
    expect(hosts().sort()).toEqual(["anthropic", "google"]);
    expect(calls.find((c) => c.url.includes("googleapis"))!.url).toContain("gemini-3.8-flash");
    expect(((await res.json()) as any).readers).toBe("sonnet+gemini");
  });

  it("reverses the primary when set to gemini+sonnet", async () => {
    // Same pair, other order. It exists so "does the order matter?" is
    // answerable by a flip rather than a deploy — and SINGLE_MODEL then runs
    // the Google reader alone rather than the Anthropic one.
    await extractImage(makeEnv({ PHOTO_READERS: "gemini+sonnet", GEMINI_API_KEY: "g", SINGLE_MODEL: "1" }));
    expect(hosts()).toEqual(["google"]);
  });

  it("retreats to sonnet+haiku for an unknown value", async () => {
    const res = await extractImage(makeEnv({ PHOTO_READERS: "sonnet+opus", GEMINI_API_KEY: "g" }));
    expect(hosts()).toEqual(["anthropic", "anthropic"]);
    // The response says which pair ran, not which was configured: a var that
    // quietly did nothing is worse than one that failed.
    expect(((await res.json()) as any).readers).toBe("sonnet+haiku");
  });

  it("retreats to sonnet+haiku when the Google key is missing", async () => {
    // A missing secret must degrade to the pair that still works, never to one
    // reader in silence.
    const res = await extractImage(makeEnv({ PHOTO_READERS: "sonnet+gemini" }));
    expect(hosts()).toEqual(["anthropic", "anthropic"]);
    expect(((await res.json()) as any).readers).toBe("sonnet+haiku");
  });

  it("never touches the text path", async () => {
    // The characters come from the file there, and that path was measured at
    // 852/877 with zero value errors. Nothing in this change may reach it.
    const s = await mintSession(SECRET, 600, 12);
    await worker.fetch(
      post("/api/extract", { rowsText: "S_Glukóza | 5,32" }, s),
      makeEnv({ PHOTO_READERS: "sonnet+gemini", GEMINI_API_KEY: "g" }),
    );
    expect(hosts()).toEqual(["anthropic", "anthropic"]);
    expect(models()).toEqual(["claude-sonnet-5", "claude-haiku-4-5"]);
  });

  it("gives Gemini the larger encode of the photo and Sonnet the capped one", async () => {
    // Sonnet's tier caps at a 2576 px long edge; Gemini spends a fixed token
    // budget per image part whatever the pixels are, so the bigger picture is
    // free to it. A PDF page sends one image and both readers get it.
    await extractImage(
      makeEnv({ PHOTO_READERS: "sonnet+gemini", GEMINI_API_KEY: "g" }),
      { ...image, imageFullBase64: "BIGGER", imageFullMediaType: "image/jpeg" },
    );
    const google = calls.find((c) => c.url.includes("googleapis"))!;
    const anthropic = calls.find((c) => !c.url.includes("googleapis"))!;
    expect(JSON.stringify(google.body)).toContain("BIGGER");
    expect(JSON.stringify(anthropic.body)).toContain("AAAA");
    expect(JSON.stringify(anthropic.body)).not.toContain("BIGGER");
  });

  it("reports the configured pair on /api/status", async () => {
    const res = await worker.fetch(
      new Request("https://demo.test/api/status"),
      makeEnv({ PHOTO_READERS: "sonnet+gemini", GEMINI_API_KEY: "g" }),
    );
    expect(((await res.json()) as any).photoReaders).toBe("sonnet+gemini");
  });
});

/**
 * A page read by one reader must never come back looking cross-checked.
 *
 * `reconcile()` sees the reads, not the requests: one read means no two values
 * to differ and no row only one reader saw, so every row is confirmed. The
 * Worker is the only place that knows a second reader was *asked*, so it says
 * so — and `reconcile` turns that into `druhé čtení se nezdařilo` on every row,
 * which `review.ts` renders unconfirmed.
 */
describe("a failed reader is never silent", () => {
  it("reports two readers attempted when both answered", async () => {
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), makeEnv());
    const body = (await res.json()) as any;
    expect(body.reads).toHaveLength(2);
    expect(body.readersAttempted).toBe(2);
  });

  it("still reports two attempted when only one answered", async () => {
    // This is the whole defect: one read, no disagreement to find, a page of
    // rows that nothing checked. reconcile cannot see it without this number.
    failing.add("claude-haiku-4-5");
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), makeEnv());
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.reads).toHaveLength(1);
    expect(body.readersAttempted).toBe(2);
  });

  it("reports one attempted when only one was asked", async () => {
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(
      post("/api/extract", { rowsText: "x | y" }, s),
      makeEnv({ SINGLE_MODEL: "1" }),
    );
    expect(((await res.json()) as any).readersAttempted).toBe(1);
  });

  it("refuses the page outright when both readers fail", async () => {
    // Zero reads is not an empty page — an empty page reads as "no results
    // here", which is a claim about the document.
    failing.add("anthropic");
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), makeEnv());
    expect(res.status).toBe(502);
    expect(((await res.json()) as any).error).toBe("extraction_failed");
  });

  it("refuses the page when both image readers fail, across vendors too", async () => {
    failing.add("anthropic");
    failing.add("gemini");
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(
      post("/api/extract", { imageBase64: "AAAA", mediaType: "image/jpeg" }, s),
      makeEnv({ PHOTO_READERS: "sonnet+gemini", GEMINI_API_KEY: "g" }),
    );
    expect(res.status).toBe(502);
  });

  it("survives one vendor being down and says the page was read once", async () => {
    failing.add("gemini");
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(
      post("/api/extract", { imageBase64: "AAAA", mediaType: "image/jpeg" }, s),
      makeEnv({ PHOTO_READERS: "sonnet+gemini", GEMINI_API_KEY: "g" }),
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.reads).toHaveLength(1);
    expect(body.readersAttempted).toBe(2);
  });
});

/**
 * The spend ledger is the only thing between a public URL and an unbounded
 * bill, and it prices every call through one table. Gemini is a quarter of
 * Sonnet's rate; without its own entry the unknown-model fallback is Sonnet's,
 * which would freeze the demo on numbers nobody spent.
 */
describe("the ledger prices the Google reader at Google's rate", () => {
  it("charges Gemini's rate, not the Sonnet fallback", async () => {
    const env = makeEnv({ PHOTO_READERS: "sonnet+gemini", GEMINI_API_KEY: "g" });
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(
      post("/api/extract", { imageBase64: "AAAA", mediaType: "image/jpeg" }, s),
      env,
    );
    // Sonnet 2k in + 1k out ($3/$15) = 0.021; Gemini 2k in + 1k out
    // ($0.75/$3.75) = 0.00525. The fallback rate would have made it 0.042.
    // 0.02625, rounded to four places by the response.
    const { costUsd } = (await res.json()) as any;
    expect(costUsd).toBe(0.0262);
    // The unknown-model fallback would have charged Sonnet's rate for both.
    expect(costUsd).toBeLessThan(0.042);
  });
});

/**
 * `PHOTO_READERS` set to a key every object inherits.
 *
 * `PHOTO_PAIRS["constructor"]` is truthy — it is `Object`'s — so the `if
 * (!pair)` retreat was skipped and `pair.includes("gemini")` threw. That is a
 * 500 from /api/status, and a 500 from /api/extract *after* `consumePage` has
 * already spent a page (docs/security-review-gemini.md, finding 5). It never
 * failed open; what was false was the promise, in the wrangler comment and in
 * the function's own docstring, that an unrecognised value falls back.
 */
describe("PHOTO_READERS on an inherited key", () => {
  for (const key of ["constructor", "__proto__", "toString", "valueOf"]) {
    it(`retreats to sonnet+haiku for "${key}" rather than throwing`, async () => {
      const env = makeEnv({ PHOTO_READERS: key, GEMINI_API_KEY: "g" });

      const status = await worker.fetch(new Request("https://demo.test/api/status"), env);
      expect(status.status).toBe(200);
      expect(((await status.json()) as any).photoReaders).toBe("sonnet+haiku");

      const s = await mintSession(SECRET, 600, 12);
      const res = await worker.fetch(
        post("/api/extract", { imageBase64: "AAAA", mediaType: "image/jpeg" }, s),
        env,
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).readers).toBe("sonnet+haiku");
    });
  }
});

/**
 * The two things a failed read must still do: charge, and say nothing.
 *
 * A Gemini response that is billed and unparseable is the one shape the
 * Anthropic path cannot produce — `toolInput` answers `{}` rather than
 * throwing — and it used to be dropped from the ledger with the exception
 * (finding 4). Its message is built by V8 out of the model's own output,
 * which came off the patient's page, and the portal logs whatever the
 * extractor hands it (finding 6).
 */
describe("a Gemini call that was billed and could not be read", () => {
  async function readOnePage() {
    geminiUnparseable = true;
    const env = makeEnv({ PHOTO_READERS: "gemini+sonnet", GEMINI_API_KEY: "g", SINGLE_MODEL: "1" });
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(
      post("/api/extract", { imageBase64: "AAAA", mediaType: "image/jpeg" }, s),
      env,
    );
    return { env, res };
  }

  it("books the spend Google charged for it", async () => {
    const { env, res } = await readOnePage();
    expect(res.status).toBe(502);
    // 2000 in, 1000 out at Gemini's own rate. The freeze is the only thing
    // between a public URL and an unbounded bill, and it can only count what
    // it is told about.
    expect(await totalSpentUsd(env.BUDGET, "extract")).toBeCloseTo(
      priceUsd(MODEL_GEMINI, 2000, 1000),
      6,
    );
  });

  it("answers with a stable reason, carrying none of the page back", async () => {
    const { res } = await readOnePage();
    const body = (await res.json()) as any;
    expect(body.error).toBe("extraction_failed");
    expect(JSON.stringify(body)).not.toContain("Novák");
    expect(JSON.stringify(body)).not.toContain("Omlouvám");
    expect(JSON.stringify(body)).not.toContain("800101");
  });
});
