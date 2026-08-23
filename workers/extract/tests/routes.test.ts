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
    SINGLE_MODEL: "0",
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

let calls: Array<{ url: string; body: any }> = [];

beforeEach(() => {
  calls = [];
  nextStream = null;
  // The SDK may call fetch with a Request object rather than (url, init), so
  // read the body from whichever shape arrives.
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const req: Request | null = typeof input === "object" && "url" in input ? (input as Request) : null;
    const u = req ? req.url : String(input);

    if (u.includes("turnstile")) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const rawBody = req ? await req.clone().text() : init?.body;
    const body = rawBody ? JSON.parse(String(rawBody)) : {};
    calls.push({ url: u, body });

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
