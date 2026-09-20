/**
 * The scheduled check: posts when something changes, once; silent when
 * healthy; silent without the bot — and it runs either way.
 *
 * The shell is the global fetch, stubbed per URL; the extractor is the
 * EXTRACT binding; the state between runs is the fake KV, which the tests
 * keep across runs to prove the "once" claims.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { SQL } from "../src/db";
import { runWatch, SPEND_THRESHOLDS, type WatchEnv } from "../src/watch";

interface EventRow {
  at: number;
}
interface MessageRow {
  answered_at: string | null;
}

let events: EventRow[];
let messages: MessageRow[];
function fakeD1(): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.pruneEvents: {
        const before = events.length;
        events = events.filter((e) => e.at >= (a[0] as number));
        return { results: [], changes: before - events.length };
      }
      case SQL.pruneAnsweredMessages: {
        const before = messages.length;
        messages = messages.filter((m) => m.answered_at === null || m.answered_at >= (a[0] as string));
        return { results: [], changes: before - messages.length };
      }
      case SQL.recentEvents:
        return { results: [], changes: 0 };
      default:
        throw new Error(`fakeD1: no branch for: ${sql}`);
    }
  };
  const make = (sql: string, args: unknown[]): unknown => ({
    bind: (...values: unknown[]) => make(sql, values),
    async first() {
      return run(sql, args).results[0] ?? null;
    },
    async all() {
      return { results: run(sql, args).results };
    },
    async run() {
      return { success: true, meta: { changes: run(sql, args).changes } };
    },
  });
  return { prepare: (sql: string) => make(sql, []) } as unknown as D1Database;
}

function fakeKv() {
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

/** What the shell answers, by path; the extractor's status and ledger. */
let shell: Record<string, number | "unreachable">;
let extractStatus: number | "unreachable";
let budget: { spentUsd: number; budgetUsd: number; frozen: boolean };
let sent: Array<{ chat_id: string; text: string }>;
let env: WatchEnv & { BUDGET: ReturnType<typeof fakeKv> };
const NOW = new Date("2026-09-19T20:00:00Z");

beforeEach(() => {
  events = [];
  messages = [];
  shell = { "/": 200, "/api/processors": 200 };
  extractStatus = 200;
  budget = { spentUsd: 3.2, budgetUsd: 30, frozen: false };
  sent = [];
  env = {
    DB: fakeD1(),
    BUDGET: fakeKv(),
    EXTRACT: {
      fetch: async () => {
        if (extractStatus === "unreachable") throw new Error("not connected");
        return new Response(JSON.stringify({ budget, photoReaders: "sonnet+gemini" }), { status: extractStatus, headers: { "content-type": "application/json" } });
      },
    } as unknown as Fetcher,
    APP_URL: "https://moje-krev.example.workers.dev/",
    TELEGRAM_BOT_TOKEN: "123:abc",
    TELEGRAM_OPS_CHAT: "-100999",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://api.telegram.org/")) {
        sent.push(JSON.parse(init?.body as string));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      const path = new URL(url).pathname;
      const answer = shell[path];
      if (answer === undefined) throw new Error(`unexpected fetch: ${url}`);
      if (answer === "unreachable") throw new TypeError("fetch failed");
      return new Response("", { status: answer });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("the app and the extractor", () => {
  it("is silent when everything answers 200", async () => {
    const r = await runWatch(env, NOW);
    expect(r).toMatchObject({ app: "up", extract: "up", spendPct: 10.7, posted: [] });
    expect(sent).toEqual([]);
    // The shell was probed end to end: the page and the route through the chain.
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("https://moje-krev.example.workers.dev/");
    expect(urls).toContain("https://moje-krev.example.workers.dev/api/processors");
  });

  it("posts once when the shell stops answering 200, and once more when it recovers", async () => {
    shell["/api/processors"] = 502;
    await runWatch(env, NOW);
    await runWatch(env, NOW);
    await runWatch(env, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0].chat_id).toBe("-100999");
    expect(sent[0].text).toBe("Moje krev — aplikace neodpovídá: GET / → 200, GET /api/processors → 502.");

    shell["/api/processors"] = 200;
    await runWatch(env, NOW);
    await runWatch(env, NOW);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe("Moje krev — aplikace zase odpovídá (GET / → 200, GET /api/processors → 200).");
  });

  it("says 'bez odpovědi' when the shell cannot be reached at all", async () => {
    shell["/"] = "unreachable";
    await runWatch(env, NOW);
    expect(sent[0].text).toBe("Moje krev — aplikace neodpovídá: GET / → bez odpovědi, GET /api/processors → 200.");
  });

  it("posts on the extractor being unreachable, and on its recovery", async () => {
    extractStatus = "unreachable";
    const down = await runWatch(env, NOW);
    expect(down.extract).toBe("down");
    expect(down.spendPct).toBeNull();
    await runWatch(env, NOW);
    expect(sent.map((m) => m.text)).toEqual(["Moje krev — extraktor neodpovídá: GET /api/status → bez odpovědi."]);
    extractStatus = 500;
    await runWatch(env, NOW);
    expect(sent).toHaveLength(1);
    extractStatus = 200;
    await runWatch(env, NOW);
    expect(sent.map((m) => m.text).at(-1)).toBe("Moje krev — extraktor zase odpovídá (GET /api/status → 200).");
  });

  it("skips the shell when APP_URL is unset and still checks the extractor", async () => {
    delete env.APP_URL;
    extractStatus = 503;
    const r = await runWatch(env, NOW);
    expect(r.app).toBe("skipped");
    expect(sent.map((m) => m.text)).toEqual(["Moje krev — extraktor neodpovídá: GET /api/status → 503."]);
  });
});

describe("the spend", () => {
  it("posts at 80 % once a month, in Czech money", async () => {
    budget = { spentUsd: 24.5, budgetUsd: 30, frozen: false };
    const r = await runWatch(env, NOW);
    expect(r.spendPct).toBe(81.7);
    await runWatch(env, NOW);
    await runWatch(env, new Date("2026-09-30T23:59:00Z"));
    expect(sent.map((m) => m.text)).toEqual([
      "Moje krev — útrata extraktoru 24,50 z 30,00 USD (81 %). Nový účet stojí nejvýš 1,50 USD; při 100 % nahrávání zamrzne pro všechny.",
    ]);
    // A new month, still over: it is said again, once.
    await runWatch(env, new Date("2026-10-01T00:15:00Z"));
    await runWatch(env, new Date("2026-10-01T00:30:00Z"));
    expect(sent).toHaveLength(2);
  });

  it("posts the 100 % line once as well, after the 80 % one", async () => {
    budget = { spentUsd: 24.5, budgetUsd: 30, frozen: false };
    await runWatch(env, NOW);
    budget = { spentUsd: 30.02, budgetUsd: 30, frozen: true };
    await runWatch(env, NOW);
    await runWatch(env, NOW);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe(
      "Moje krev — extraktor je zamrzlý: útrata 30,02 z 30,00 USD. Každé nahrání teď odpovídá „společný limit je vyčerpán\". Ledger se sám nenuluje — docs/moje-krev-handoff.md, „Ledger extraktoru\".",
    );
    expect(SPEND_THRESHOLDS).toEqual([80, 100]);
  });

  it("jumping straight past 100 % posts both thresholds in one run", async () => {
    budget = { spentUsd: 31, budgetUsd: 30, frozen: true };
    await runWatch(env, NOW);
    expect(sent.map((m) => m.text.slice(0, 40))).toEqual(["Moje krev — útrata extraktoru 31,00 z 30", "Moje krev — extraktor je zamrzlý: útrata"]);
  });

  it("is silent under 80 %", async () => {
    budget = { spentUsd: 23.99, budgetUsd: 30, frozen: false };
    await runWatch(env, NOW);
    expect(sent).toEqual([]);
  });

  it("adds the model's guess under an alert when the AI binding is there", async () => {
    const calls: Array<Record<string, unknown>> = [];
    env.AI = {
      run: async (_m: string, inputs: Record<string, unknown>) => {
        calls.push(inputs);
        return { response: JSON.stringify({ cause: "Dvacet nových účtů za týden.", where: "moje-krev-extract BUDGET", confidence: "medium", action: "Zkontrolovat počet registrací a vynulovat ledger.", questions: [] }) };
      },
    };
    budget = { spentUsd: 24.5, budgetUsd: 30, frozen: false };
    await runWatch(env, NOW);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe("Odhad (GLM): Dvacet nových účtů za týden.\nKde: moje-krev-extract BUDGET\nJistota: střední\nCo udělat: Zkontrolovat počet registrací a vynulovat ledger.");
    const user = (calls[0].messages as Array<{ content: string }>)[1].content;
    expect(user).toContain("Provozní hlášení");
    expect(user).toContain("útrata 24,50 z 30,00 USD, zamrzlý: ne");
  });
});

describe("without the bot", () => {
  it("runs, reports, posts nothing, and still remembers the state", async () => {
    delete env.TELEGRAM_BOT_TOKEN;
    delete env.TELEGRAM_OPS_CHAT;
    shell["/"] = 500;
    budget = { spentUsd: 29, budgetUsd: 30, frozen: false };
    const r = await runWatch(env, NOW);
    expect(r.app).toBe("down");
    expect(r.posted).toHaveLength(2);
    expect(sent).toEqual([]);
    expect(env.BUDGET._store.get("ops_state_app")).toBe("down");
    expect(env.BUDGET._store.get("ops_budget_alerted_2026-09_80")).toBeTruthy();
  });
});

describe("housekeeping", () => {
  it("prunes events older than thirty days", async () => {
    const now = Math.floor(NOW.getTime() / 1000);
    events = [{ at: now - 31 * 86400 }, { at: now - 29 * 86400 }, { at: now }];
    const r = await runWatch(env, NOW);
    expect(r.pruned).toBe(1);
    expect(events).toHaveLength(2);
  });

  it("prunes help-desk messages answered more than twelve months ago, and keeps every unanswered one", async () => {
    // The privacy page says a message lives „do odpovědi a 12 měsíců po ní".
    // The scheduled check is what makes that sentence true.
    messages = [
      { answered_at: "2025-09-18T20:00:00Z" }, // a year and a day: goes
      { answered_at: "2025-09-20T20:00:00Z" }, // a day short of a year: stays
      { answered_at: null }, // open since 2024: stays until answered
    ];
    const r = await runWatch(env, NOW);
    expect(r.prunedMessages).toBe(1);
    expect(messages).toEqual([{ answered_at: "2025-09-20T20:00:00Z" }, { answered_at: null }]);
  });

  it("is what the cron trigger runs", async () => {
    let waited: Promise<unknown> | null = null;
    const ctx = { waitUntil: (p: Promise<unknown>) => void (waited = p), passThroughOnException: () => {} } as unknown as ExecutionContext;
    shell["/"] = 500;
    await worker.scheduled!({ scheduledTime: NOW.getTime(), cron: "*/15 * * * *", noRetry: () => {} } as ScheduledController, env as never, ctx);
    expect(waited).not.toBeNull();
    await waited;
    expect(sent).toHaveLength(1);
  });
});
