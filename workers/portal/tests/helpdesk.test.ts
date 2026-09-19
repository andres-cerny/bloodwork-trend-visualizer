/**
 * „Napište nám": stored whatever the bot does, forwarded when the bot exists,
 * guessed at when the model exists — and the guess is labelled as one.
 *
 * Telegram and the siteverify endpoint are the global fetch, stubbed; the
 * `AI` binding is an object with one `run`. Everything the bot receives is
 * captured so the tests can say what it never received: a value, a page,
 * an address in the events table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken } from "../src/session";
import { helpdeskNotice, MAX_MESSAGE_CHARS, RATE_LIMIT } from "../src/helpdesk";
import { routeLabel, userHash } from "../src/events";
import { formatTriage, parseTriage, SYSTEM_TRIAGE, triagePrompt, TRIAGE_MODEL } from "../src/triage";
import { tablesFromSchema } from "../../../tools/scripts/check-schema.mjs";
import { answeredSql, listSql, readSql } from "../../../tools/scripts/moje-krev-helpdesk.mjs";

const SECRET = "test-portal-secret";

interface MessageRow {
  id: string;
  created_at: string;
  user_id: string | null;
  email: string;
  text: string;
  report_id: string | null;
  user_agent: string | null;
}
interface EventRow {
  id: string;
  at: number;
  route: string;
  status: number;
  code: string | null;
  user_hash: string | null;
  request_id: string | null;
}
interface Tables {
  users: Array<{ id: string; email: string; created_at: string; settings: string | null; session_epoch: number; budget_usd: number | null }>;
  messages: MessageRow[];
  events: EventRow[];
}

function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.insertMessage:
        t.messages.push({
          id: a[0] as string,
          created_at: a[1] as string,
          user_id: a[2] as string | null,
          email: a[3] as string,
          text: a[4] as string,
          report_id: a[5] as string | null,
          user_agent: a[6] as string | null,
        });
        return { results: [], changes: 1 };
      case SQL.insertEvent:
        t.events.push({
          id: a[0] as string,
          at: a[1] as number,
          route: a[2] as string,
          status: a[3] as number,
          code: a[4] as string | null,
          user_hash: a[5] as string | null,
          request_id: a[6] as string | null,
        });
        return { results: [], changes: 1 };
      case SQL.eventsForUser:
        return { results: t.events.filter((e) => e.user_hash === a[0]).sort((x, y) => y.at - x.at).slice(0, 20), changes: 0 };
      case SQL.recentEvents:
        return { results: [...t.events].sort((x, y) => y.at - x.at).slice(0, 20), changes: 0 };
      case SQL.pruneEvents: {
        const before = t.events.length;
        t.events = t.events.filter((e) => e.at >= (a[0] as number));
        return { results: [], changes: before - t.events.length };
      }
      case SQL.settingsForUser:
        return { results: t.users.filter((u) => u.id === a[0]).map((u) => ({ settings: u.settings })), changes: 0 };
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

/** The extractor's /api/status, as the triage reads it. */
const fakeExtract = (status = 200, budget = { spentUsd: 12.3, budgetUsd: 30, frozen: false }) =>
  ({
    fetch: async () => new Response(JSON.stringify({ budget, photoReaders: "sonnet+gemini" }), { status, headers: { "content-type": "application/json" } }),
  }) as unknown as Fetcher;

const A = { id: "u-a", email: "a@example.com", created_at: "2026-01-01T00:00:00Z", settings: null, session_epoch: 0, budget_usd: null };

let tables: Tables;
let env: Env;
/** Every sendMessage body Telegram received, in order. */
let sent: Array<{ chat_id: string; text: string }>;
/** Every request the stubbed fetch saw, by URL. */
let fetched: string[];
/** Whether the stubbed siteverify says yes. */
let turnstileOk = true;

beforeEach(() => {
  tables = { users: [{ ...A }], messages: [], events: [] };
  sent = [];
  fetched = [];
  turnstileOk = true;
  env = {
    DB: fakeD1(tables),
    PAGES: fakeKv(),
    BUDGET: fakeKv(),
    EXTRACT: fakeExtract(),
    SESSION_SECRET: SECRET,
    EXTRACT_SESSION_SECRET: "x",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fetched.push(url);
      if (url.startsWith("https://api.telegram.org/")) {
        sent.push(JSON.parse(init?.body as string));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes("turnstile/v0/siteverify")) {
        return new Response(JSON.stringify({ success: turnstileOk, hostname: "moje-krev.example", action: "helpdesk" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const cookie = async (uid: string) => ({ cookie: `mojekrev_session=${await mintCookieToken(SECRET, uid, 3600)}` });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request("https://portal/api/helpdesk", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "vitest", ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );

describe("storing a message", () => {
  it("with a session: the login's address, the account, the report id", async () => {
    const res = await post({ text: "Nahrávání se zastaví u druhé strany.", reportId: "r-2026-03", email: "someone-else@example.com" }, await cookie("u-a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(tables.messages).toHaveLength(1);
    const m = tables.messages[0];
    expect(m.user_id).toBe("u-a");
    // The typed address is ignored: a logged-in person writes as themselves.
    expect(m.email).toBe("a@example.com");
    expect(m.text).toBe("Nahrávání se zastaví u druhé strany.");
    expect(m.report_id).toBe("r-2026-03");
    expect(m.user_agent).toBe("vitest");
  });

  it("without a session: the typed address, no account, no report id when malformed", async () => {
    const res = await post({ email: "Host@Example.com ", text: "Nejde mi to.", reportId: "../etc" });
    expect(res.status).toBe(200);
    const m = tables.messages[0];
    expect(m.user_id).toBeNull();
    expect(m.email).toBe("host@example.com");
    expect(m.report_id).toBeNull();
  });

  it("refuses an empty text, a missing address, and a text over the cap", async () => {
    expect((await post({ email: "h@example.com", text: "   " })).status).toBe(400);
    expect((await post({ text: "Ahoj" })).status).toBe(400);
    expect((await post({ email: "not-an-address", text: "Ahoj" })).status).toBe(400);
    const long = await post({ email: "h@example.com", text: "x".repeat(MAX_MESSAGE_CHARS + 1) });
    expect(long.status).toBe(413);
    expect(((await long.json()) as { message: string }).message).toContain("4\u00a0000");
    expect(tables.messages).toHaveLength(0);
    // Exactly the cap is fine.
    expect((await post({ email: "h@example.com", text: "x".repeat(MAX_MESSAGE_CHARS) })).status).toBe(200);
  });

  it("is the same 200 with and without the bot", async () => {
    const without = await post({ email: "h@example.com", text: "Ahoj" });
    env.TELEGRAM_BOT_TOKEN = "123:abc";
    env.TELEGRAM_HELPDESK_CHAT = "-100777";
    const withBot = await post({ email: "h2@example.com", text: "Ahoj" });
    expect(await without.json()).toEqual(await withBot.json());
    expect(tables.messages).toHaveLength(2);
  });
});

describe("the rate limit", () => {
  it("is 5 an hour per address, then 429, and stores nothing more", async () => {
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect((await post({ email: "h@example.com", text: `zpráva ${i}` }, { "cf-connecting-ip": `10.0.0.${i}` })).status).toBe(200);
    }
    const res = await post({ email: "h@example.com", text: "šestá" }, { "cf-connecting-ip": "10.0.0.99" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("rate_limited");
    expect(tables.messages).toHaveLength(RATE_LIMIT);
  });

  it("is 5 an hour per IP too, across addresses", async () => {
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect((await post({ email: `h${i}@example.com`, text: "zpráva" }, { "cf-connecting-ip": "10.0.0.1" })).status).toBe(200);
    }
    expect((await post({ email: "fresh@example.com", text: "zpráva" }, { "cf-connecting-ip": "10.0.0.1" })).status).toBe(429);
  });
});

describe("Turnstile on the logged-out form", () => {
  beforeEach(() => {
    env.TURNSTILE_SECRET_KEY = "secret";
    env.TURNSTILE_HOSTNAMES = "moje-krev.example";
  });

  it("is required without a session when the secret is set", async () => {
    const res = await post({ email: "h@example.com", text: "Ahoj" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("turnstile_required");
    expect(tables.messages).toHaveLength(0);
  });

  it("verifies the token through siteverify and stores on success", async () => {
    const res = await post({ email: "h@example.com", text: "Ahoj", turnstileToken: "tok" });
    expect(res.status).toBe(200);
    expect(fetched.some((u) => u.includes("turnstile/v0/siteverify"))).toBe(true);
    expect(tables.messages).toHaveLength(1);
  });

  it("refuses a token siteverify refuses", async () => {
    turnstileOk = false;
    const res = await post({ email: "h@example.com", text: "Ahoj", turnstileToken: "tok" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("turnstile_failed");
  });

  it("asks nothing of a logged-in person", async () => {
    const res = await post({ text: "Ahoj" }, await cookie("u-a"));
    expect(res.status).toBe(200);
    expect(fetched.some((u) => u.includes("siteverify"))).toBe(false);
  });
});

describe("Telegram", () => {
  it("is not called without the secrets", async () => {
    await post({ email: "h@example.com", text: "Ahoj" });
    expect(fetched.filter((u) => u.includes("telegram"))).toEqual([]);
  });

  it("is not called with a token but no chat", async () => {
    env.TELEGRAM_BOT_TOKEN = "123:abc";
    await post({ email: "h@example.com", text: "Ahoj" });
    expect(sent).toEqual([]);
  });

  it("gets the address, the first 500 characters, the report id and the d1 hint — in the help-desk chat", async () => {
    env.TELEGRAM_BOT_TOKEN = "123:abc";
    env.TELEGRAM_HELPDESK_CHAT = "-100777";
    env.TELEGRAM_OPS_CHAT = "-100999";
    const text = "Glukóza 5,32 mmol/l se mi ukazuje jako 53,2. ".repeat(20);
    await post({ text, reportId: "r-7" }, await cookie("u-a"));
    expect(sent).toHaveLength(1);
    const [m] = sent;
    expect(m.chat_id).toBe("-100777");
    expect(m.text).toContain("Od: a@example.com (přihlášený)");
    expect(m.text).toContain("Report: r-7");
    expect(m.text).toContain(text.slice(0, 500) + "…");
    expect(m.text).not.toContain(text.slice(0, 600));
    expect(m.text).toContain(`npx wrangler d1 execute moje-krev --remote --command "SELECT text FROM messages WHERE id = '${tables.messages[0].id}'"`);
    expect(fetched.filter((u) => u.includes("telegram"))[0]).toBe("https://api.telegram.org/bot123:abc/sendMessage");
  });

  it("carries nothing but what the person wrote: no stored value, no page, when the account has reports", async () => {
    // The notice is built from the message alone — the worker holds the
    // account's payloads and pages and this is the proof it reads none.
    const notice = helpdeskNotice({ id: "m-1", email: "a@example.com", text: "Nejde to.", reportId: "r-1", loggedIn: true });
    expect(notice).toBe(
      [
        "Moje krev — nová zpráva",
        "Od: a@example.com (přihlášený)",
        "Report: r-1",
        "———",
        "Nejde to.",
        "———",
        `Celý text: cd workers/portal && npx wrangler d1 execute moje-krev --remote --command "SELECT text FROM messages WHERE id = 'm-1'"`,
        "Po odpovědi: node tools/scripts/moje-krev-helpdesk.mjs --answered m-1 --apply",
      ].join("\n"),
    );
  });

  it("a stranger's notice says so", async () => {
    env.TELEGRAM_BOT_TOKEN = "123:abc";
    env.TELEGRAM_HELPDESK_CHAT = "-100777";
    await post({ email: "h@example.com", text: "Ahoj" });
    expect(sent[0].text).toContain("Od: h@example.com (nepřihlášený)");
    expect(sent[0].text).toContain("Report: —");
  });

  it("stores and answers 200 when Telegram refuses", async () => {
    env.TELEGRAM_BOT_TOKEN = "123:abc";
    env.TELEGRAM_HELPDESK_CHAT = "-100777";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    const res = await post({ email: "h@example.com", text: "Ahoj" });
    expect(res.status).toBe(200);
    expect(tables.messages).toHaveLength(1);
  });
});

/** An `AI` binding that records what it was asked and answers a fixed guess. */
function fakeAi(answer: unknown = { response: JSON.stringify(GUESS) }) {
  const calls: Array<{ model: string; inputs: Record<string, unknown> }> = [];
  return {
    calls,
    run: async (model: string, inputs: Record<string, unknown>) => {
      calls.push({ model, inputs });
      return answer;
    },
  };
}
/** 2026-09-19T16:40:00Z, as epoch seconds. */
const T1640 = Date.UTC(2026, 8, 19, 16, 40) / 1000;
const GUESS = {
  cause: "Účet narazil na osobní měsíční USD pojistku — poslední tři pokusy o nahrání skončily 402 budget_exhausted.",
  where: "POST /api/extract (src/index.ts, limitFor)",
  confidence: "high",
  action: "Zvednout limit účtu: node tools/scripts/moje-krev-budget.mjs <e-mail> 10 --apply, nebo počkat na nový měsíc.",
  questions: ["Kolik stran měl dokument, který neprošel?"],
};

describe("the triage", () => {
  beforeEach(() => {
    env.TELEGRAM_BOT_TOKEN = "123:abc";
    env.TELEGRAM_HELPDESK_CHAT = "-100777";
  });

  it("is skipped cleanly without the AI binding: one message, no error", async () => {
    const res = await post({ text: "Nejde to." }, await cookie("u-a"));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("is asked with the account's events and the message, and posted second with the prefix", async () => {
    const ai = fakeAi();
    env.AI = ai;
    const hash = await userHash("u-a");
    tables.events.push(
      { id: "e1", at: T1640, route: "POST /api/extract", status: 402, code: "budget_exhausted", user_hash: hash, request_id: null },
      { id: "e2", at: T1640 - 86_400, route: "PUT /api/settings", status: 413, code: "too_large", user_hash: hash, request_id: null },
      { id: "e3", at: T1640 - 3600, route: "POST /api/auth/login", status: 429, code: "locked", user_hash: "other-person", request_id: null },
    );
    await post({ text: "Nahrávání mi hlásí limit.", reportId: "r-3" }, await cookie("u-a"));

    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].model).toBe(TRIAGE_MODEL);
    const inputs = ai.calls[0].inputs;
    expect(inputs.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect((inputs.response_format as { type: string }).type).toBe("json_schema");
    const messages = inputs.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: SYSTEM_TRIAGE });
    const user = messages[1].content;
    expect(user).toContain("Zpráva od přihlášeného uživatele:");
    expect(user).toContain("Nahrávání mi hlásí limit.");
    expect(user).toContain("Report: r-3");
    // This account's events, newest first; the other person's is not there.
    expect(user).toContain("2026-09-19T16:40:00Z POST /api/extract 402 budget_exhausted");
    expect(user).toContain("2026-09-18T16:40:00Z PUT /api/settings 413 too_large");
    expect(user).not.toContain("locked");
    expect(user.indexOf("POST /api/extract")).toBeLessThan(user.indexOf("PUT /api/settings"));
    expect(user).toContain("Extraktor: /api/status 200, útrata 12,30 z 30,00 USD, zamrzlý: ne");
    // No e-mail reaches the model.
    expect(user).not.toContain("@");

    expect(sent).toHaveLength(2);
    expect(sent[0].text).toContain("Moje krev — nová zpráva");
    expect(sent[1].chat_id).toBe("-100777");
    expect(sent[1].text.startsWith("Odhad (GLM): ")).toBe(true);
    expect(sent[1].text).toBe(
      [
        `Odhad (GLM): ${GUESS.cause}`,
        `Kde: ${GUESS.where}`,
        "Jistota: vysoká",
        `Co udělat: ${GUESS.action}`,
        `Otázky pro uživatele: 1) ${GUESS.questions[0]}`,
      ].join("\n"),
    );
  });

  it("tells the model a stranger has no account, and gives it no events", async () => {
    const ai = fakeAi();
    env.AI = ai;
    tables.events.push({ id: "e1", at: 1_758_300_000, route: "POST /api/extract", status: 402, code: "budget_exhausted", user_hash: "abc", request_id: null });
    await post({ email: "h@example.com", text: "Nejde to." });
    const user = (ai.calls[0].inputs.messages as Array<{ content: string }>)[1].content;
    expect(user).toContain("nepřihlášeného návštěvníka (bez účtu, tedy bez záznamů k účtu)");
    expect(user).toContain("(žádné)");
    expect(user).not.toContain("budget_exhausted");
  });

  it("clips the message at 2 000 characters for the model", async () => {
    const ai = fakeAi();
    env.AI = ai;
    await post({ text: "a".repeat(3000) }, await cookie("u-a"));
    const user = (ai.calls[0].inputs.messages as Array<{ content: string }>)[1].content;
    expect(user).toContain("a".repeat(2000));
    expect(user).not.toContain("a".repeat(2001));
  });

  it("posts nothing second when the model's answer is not the five fields, and when it throws", async () => {
    env.AI = fakeAi({ response: "Nemám tušení." });
    await post({ text: "Nejde to." }, await cookie("u-a"));
    expect(sent).toHaveLength(1);
    env.AI = { run: async () => Promise.reject(new Error("3040: capacity")) };
    await post({ text: "Nejde to." }, await cookie("u-a"));
    expect(sent).toHaveLength(2);
    expect(sent.every((m) => !m.text.startsWith("Odhad"))).toBe(true);
  });

  it("reads the OpenAI-shaped answer too, and a fenced one", () => {
    const fenced = "```json\n" + JSON.stringify(GUESS) + "\n```";
    expect(parseTriage(fenced)).toEqual(GUESS);
    expect(parseTriage({ ...GUESS, confidence: "certain", questions: ["a", "b", "c"] })).toEqual({ ...GUESS, confidence: "low", questions: ["a", "b"] });
    expect(parseTriage({ cause: "x" })).toBeNull();
    expect(formatTriage({ ...GUESS, confidence: "medium", questions: [] })).not.toContain("Otázky");
  });

  it("the prompt for an ops alert names the watcher, not a user", () => {
    const p = triagePrompt({ kind: "ops", text: "Moje krev — extraktor neodpovídá: GET /api/status → 500.", userHash: null, extractor: { status: null, spentUsd: null, budgetUsd: null, frozen: null } }, []);
    expect(p).toContain("Provozní hlášení (od hlídače, ne od uživatele):");
    expect(p).toContain("Extraktor: nedostupný");
    expect(p).not.toContain("Report:");
  });
});

describe("the events table", () => {
  it("gets a row for a 402, a 413 and a 429, hashed to the account and never to the address", async () => {
    const headers = { ...(await cookie("u-a")), "cf-ray": "8a1b-PRG" };
    // 413: settings over the cap.
    const big = await worker.fetch(
      new Request("https://portal/api/settings", { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: `{"aiAsked":"${"x".repeat(600 * 1024)}"}` }),
      env,
    );
    expect(big.status).toBe(413);
    // 402: the person's own ledger frozen.
    tables.users[0].budget_usd = 0;
    const frozen = await worker.fetch(new Request("https://portal/api/extract", { method: "POST", headers, body: "{}" }), env);
    expect(frozen.status).toBe(402);
    // 429: the help desk's limit, logged out.
    for (let i = 0; i <= RATE_LIMIT; i++) await post({ email: "h@example.com", text: "zpráva" }, { "cf-connecting-ip": `10.1.0.${i}` });

    const hash = await userHash("u-a");
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
    const rows = tables.events.map((e) => [e.route, e.status, e.code, e.user_hash]);
    expect(rows).toContainEqual(["PUT /api/settings", 413, "too_large", hash]);
    expect(rows).toContainEqual(["POST /api/extract", 402, "budget_exhausted", hash]);
    expect(rows).toContainEqual(["POST /api/helpdesk", 429, "rate_limited", null]);
    expect(tables.events.find((e) => e.status === 413)!.request_id).toBe("8a1b-PRG");
    const everything = JSON.stringify(tables.events);
    expect(everything).not.toContain("@");
    expect(everything).not.toContain("u-a");
  });

  it("gets a row for an upload the extractor turned down, on the buffered and the streamed path", async () => {
    const headers = { ...(await cookie("u-a")), "content-type": "application/json" };
    env.EXTRACT = {
      fetch: async (req: Request) => {
        const stream = ((await req.json()) as { stream?: boolean }).stream === true;
        return stream
          ? new Response('{"type":"error","error":"extraction_failed","message":"Stránku se nepodařilo přečíst."}\n', {
              status: 200,
              headers: { "content-type": "application/x-ndjson" },
            })
          : new Response(JSON.stringify({ error: "extraction_failed", message: "Stránku se nepodařilo přečíst." }), { status: 502, headers: { "content-type": "application/json" } });
      },
    } as unknown as Fetcher;
    const buffered = await worker.fetch(new Request("https://portal/api/extract", { method: "POST", headers, body: JSON.stringify({ rowsText: "x" }) }), env);
    expect(buffered.status).toBe(502);
    const streamed = await worker.fetch(new Request("https://portal/api/extract", { method: "POST", headers, body: JSON.stringify({ rowsText: "x", stream: true }) }), env);
    expect(streamed.status).toBe(200);
    await streamed.text();
    const hash = await userHash("u-a");
    expect(tables.events.map((e) => [e.route, e.status, e.code, e.user_hash])).toEqual([
      ["POST /api/extract", 502, "extraction_failed", hash],
      ["POST /api/extract", 502, "extraction_failed", hash],
    ]);
  });

  it("writes no row for a 200 or a 204", async () => {
    const headers = await cookie("u-a");
    expect((await worker.fetch(new Request("https://portal/api/settings", { headers }), env)).status).toBe(200);
    expect((await worker.fetch(new Request("https://portal/api/auth/logout", { method: "POST" }), env)).status).toBe(204);
    expect(tables.events).toEqual([]);
  });

  it("strips ids out of the route", () => {
    expect(routeLabel("PUT", "/api/reports/r-2026-03-04")).toBe("PUT /api/reports/:id");
    expect(routeLabel("GET", "/api/pages/r-2026-03-04/2")).toBe("GET /api/pages/:id/:n");
    expect(routeLabel("GET", "/api/auth/invite/abc%20def")).toBe("GET /api/auth/invite/:id");
    expect(routeLabel("GET", "/ai/k7QmR2vX9pLw3fk7QmR2vX9pLw3fk7QmR2vX9pLw3fk7Q")).toBe("GET /ai/:token");
    expect(routeLabel("POST", "/api/extract")).toBe("POST /api/extract");
  });

  it("a failed insert does not turn the refusal into a 500", async () => {
    env.DB = { prepare: () => ({ bind: () => ({ run: async () => Promise.reject(new Error("no such table: events")), first: async () => null }) }) } as unknown as D1Database;
    const res = await worker.fetch(new Request("https://portal/api/reports"), env);
    expect(res.status).toBe(401);
  });
});

describe("schema.sql and the migration agree", () => {
  it("on both new tables, column for column", () => {
    const schema = tablesFromSchema(readFileSync(join(import.meta.dirname, "../schema.sql"), "utf-8"));
    const migration = tablesFromSchema(readFileSync(join(import.meta.dirname, "../migrations/2026-09-19-helpdesk.sql"), "utf-8"));
    expect([...migration.keys()].sort()).toEqual(["events", "messages"]);
    expect(migration.get("messages")).toEqual(schema.get("messages"));
    expect(migration.get("events")).toEqual(schema.get("events"));
    expect(schema.get("messages")).toEqual(["id", "created_at", "user_id", "email", "text", "report_id", "user_agent", "answered_at"]);
    expect(schema.get("events")).toEqual(["id", "at", "route", "status", "code", "user_hash", "request_id"]);
  });
});

describe("the operator's script", () => {
  it("lists newest first, open ones on request, and marks one answered once", () => {
    expect(listSql()).toContain("FROM messages ORDER BY created_at DESC LIMIT 50;");
    expect(listSql({ unanswered: true })).toContain("WHERE answered_at IS NULL ORDER BY");
    // The list shows whether there is an account, never which one.
    expect(listSql()).not.toMatch(/SELECT[^;]*\buser_id\b(?![^,]*THEN)/);
    expect(answeredSql("3f2c9a1e-0000-4000-8000-000000000001")).toBe(
      "UPDATE messages SET answered_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = '3f2c9a1e-0000-4000-8000-000000000001' AND answered_at IS NULL;",
    );
    expect(answeredSql("x' OR 1=1 --")).toContain("WHERE id = 'x'' OR 1=1 --'");
    expect(readSql("m")).toContain("SELECT id, created_at, email, user_id, report_id, user_agent, answered_at, text FROM messages WHERE id = 'm';");
  });
});
