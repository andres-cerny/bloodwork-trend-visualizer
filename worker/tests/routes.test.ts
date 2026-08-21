/**
 * Route-level tests for the Worker, with the Anthropic and Turnstile calls
 * stubbed. Everything except the network hop to Claude is real code: the
 * session gate, the spend ledger, the freeze, and the text-vs-vision choice.
 *
 * The freeze is the behaviour worth proving — it is the only thing standing
 * between a public URL and an unbounded bill.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../index";
import { mintSession } from "../auth";

const SECRET = "test-session-secret";

function fakeKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
  } as unknown as KVNamespace;
}

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response("static", { status: 200 }) } as unknown as Fetcher,
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

let calls: Array<{ url: string; body: any }> = [];

beforeEach(() => {
  calls = [];
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

describe("spend ledger", () => {
  it("records what a call cost", async () => {
    const env = makeEnv();
    const s = await mintSession(SECRET, 600, 12);
    const res = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    const body = (await res.json()) as any;
    // 2k in + 1k out on Sonnet ($3/$15) and Opus ($5/$25) = 0.021 + 0.035
    expect(body.costUsd).toBeCloseTo(0.056, 3);
    expect(body.budget.spentUsd).toBeCloseTo(0.056, 3);
  });

  it("freezes both AI routes once the ceiling is reached", async () => {
    // One extraction costs $0.056, so a $0.05 ceiling is crossed by the first
    // call — the guard is checked before a call, not mid-flight.
    const env = makeEnv({ BUDGET_USD_LIMIT: "0.05" });
    const s = await mintSession(SECRET, 600, 12);

    // First call starts under the ceiling and is allowed through.
    expect((await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env)).status).toBe(200);

    // It pushed the ledger past the ceiling, so the next call is refused.
    const blocked = await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    expect(blocked.status).toBe(402);
    const body = (await blocked.json()) as any;
    expect(body.error).toBe("budget_exhausted");
    expect(body.budget.frozen).toBe(true);

    const chat = await worker.fetch(
      post("/api/chat", { dataContext: "d", history: [{ role: "user", content: "ahoj" }] }, s),
      env,
    );
    expect(chat.status).toBe(402);
  });

  it("makes no Claude call at all once frozen", async () => {
    const env = makeEnv({ BUDGET_USD_LIMIT: "0.05" });
    const s = await mintSession(SECRET, 600, 12);
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    calls = [];
    await worker.fetch(post("/api/extract", { rowsText: "x | y" }, s), env);
    expect(calls).toHaveLength(0);
  });
});

describe("static assets", () => {
  it("serves anything that is not an API route", async () => {
    const res = await worker.fetch(new Request("https://demo.test/"), makeEnv());
    expect(await res.text()).toBe("static");
  });

  it("404s an unknown API route rather than falling through to assets", async () => {
    const res = await worker.fetch(new Request("https://demo.test/api/nope"), makeEnv());
    expect(res.status).toBe(404);
  });
});
