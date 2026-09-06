/**
 * Route-level tests for the account's data: reports, page images, the
 * extract proxy and the per-person ledger. Everything real except D1, KV
 * and the extractor behind the service binding.
 *
 * The properties worth proving are the isolation ones — one account cannot
 * read, overwrite or delete another's report, and one account's spend cannot
 * freeze another — and the promise the schema makes: identity a client sends
 * is emptied before it is stored.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken } from "../src/session";
import { recordUserSpendUsd, monthOf, userBudget } from "../src/ledger";
import { verifySession } from "@bw/gate";

const SECRET = "test-portal-secret";
const EXTRACT_SECRET = "test-extract-secret";

interface Tables {
  users: Array<{ id: string; email: string; created_at: string; settings: string | null }>;
  reports: Array<{ id: string; user_id: string; report_date: string | null; lab_name: string | null; payload: string; created_at: string; fingerprint: string | null }>;
  pages: Array<{ report_id: string; page_num: number; kv_key: string; width: number | null; height: number | null }>;
  /** Set to make the next fingerprint lookup miss — another request landing
   *  between the worker's check and its insert, as a race would. */
  raceOnce?: boolean;
}

/** The unique index on (user_id, fingerprint), as D1 reports it. */
const UNIQUE_FAILED = "D1_ERROR: UNIQUE constraint failed: reports.user_id, reports.fingerprint";

/** Dispatches on the exact SQL constants; a query without a branch throws. */
function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.reportsForUser:
        return {
          results: t.reports
            .filter((r) => r.user_id === a[0])
            .sort((x, y) => (x.report_date ?? "").localeCompare(y.report_date ?? ""))
            .map((r) => ({ id: r.id, payload: r.payload })),
          changes: 0,
        };
      case SQL.reportOwner:
        return { results: t.reports.filter((r) => r.id === a[0]).map((r) => ({ id: r.id, user_id: r.user_id })), changes: 0 };
      case SQL.reportByFingerprint: {
        if (t.raceOnce) {
          t.raceOnce = false;
          return { results: [], changes: 0 };
        }
        return { results: t.reports.filter((r) => r.user_id === a[0] && r.fingerprint === a[1] && r.id !== a[2]).map((r) => ({ id: r.id })), changes: 0 };
      }
      case SQL.upsertReport: {
        const [id, uid, date, lab, payload, created, fingerprint] = a as [string, string, string | null, string | null, string, string, string | null];
        // The partial unique index: one fingerprint per account, NULLs free.
        if (fingerprint !== null && t.reports.some((r) => r.user_id === uid && r.fingerprint === fingerprint && r.id !== id)) throw new Error(UNIQUE_FAILED);
        const existing = t.reports.find((r) => r.id === id);
        if (existing) {
          if (existing.user_id !== uid) return { results: [], changes: 0 };
          Object.assign(existing, { report_date: date, lab_name: lab, payload, fingerprint });
          return { results: [], changes: 1 };
        }
        t.reports.push({ id, user_id: uid, report_date: date, lab_name: lab, payload, created_at: created, fingerprint });
        return { results: [], changes: 1 };
      }
      case SQL.deletePage: {
        const before = t.pages.length;
        t.pages = t.pages.filter((p) => !(p.report_id === a[0] && p.page_num === a[1]));
        return { results: [], changes: before - t.pages.length };
      }
      case SQL.deleteReport: {
        const before = t.reports.length;
        t.reports = t.reports.filter((r) => !(r.id === a[0] && r.user_id === a[1]));
        return { results: [], changes: before - t.reports.length };
      }
      case SQL.pagesForReport:
        return { results: t.pages.filter((p) => p.report_id === a[0]), changes: 0 };
      case SQL.upsertPage: {
        const [rid, n, key, w, h] = a as [string, number, string, number | null, number | null];
        const existing = t.pages.find((p) => p.report_id === rid && p.page_num === n);
        if (existing) Object.assign(existing, { kv_key: key, width: w, height: h });
        else t.pages.push({ report_id: rid, page_num: n, kv_key: key, width: w, height: h });
        return { results: [], changes: 1 };
      }
      case SQL.deletePages: {
        const before = t.pages.length;
        t.pages = t.pages.filter((p) => p.report_id !== a[0]);
        return { results: [], changes: before - t.pages.length };
      }
      case SQL.settingsForUser:
        return { results: t.users.filter((u) => u.id === a[0]).map((u) => ({ settings: u.settings })), changes: 0 };
      case SQL.saveSettings: {
        const u = t.users.find((x) => x.id === a[0]);
        if (u) u.settings = a[1] as string;
        return { results: [], changes: u ? 1 : 0 };
      }
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
      const r = run(sql, args);
      return { success: true, meta: { changes: r.changes } };
    },
  });
  return { prepare: (sql: string) => make(sql, []) } as unknown as D1Database;
}

function fakeKv() {
  const store = new Map<string, { value: string | ArrayBuffer; metadata?: unknown }>();
  return {
    get: async (k: string) => {
      const v = store.get(k)?.value;
      return typeof v === "string" ? v : v ? new TextDecoder().decode(v) : null;
    },
    getWithMetadata: async (k: string) => {
      const e = store.get(k);
      return { value: e?.value ?? null, metadata: e?.metadata ?? null };
    },
    put: async (k: string, v: string | ArrayBuffer, opts?: { metadata?: unknown }) => {
      store.set(k, { value: v, metadata: opts?.metadata });
    },
    delete: async (k: string) => void store.delete(k),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, { value: unknown; metadata?: unknown }> };
}

/** The extractor behind the binding: records what it was asked, answers a cost. */
function fakeExtract(reply: { status: number; body: unknown }) {
  const calls: Array<{ session: string | null; body: string }> = [];
  const fetcher = {
    fetch: async (req: Request) => {
      calls.push({ session: req.headers.get("x-demo-session"), body: await req.text() });
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

/** The extractor answering as a stream: rows, then the whole answer on the last line. */
function fakeExtractStream(lines: unknown[]) {
  const calls: Array<{ session: string | null; body: string }> = [];
  const fetcher = {
    fetch: async (req: Request) => {
      calls.push({ session: req.headers.get("x-demo-session"), body: await req.text() });
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          // Deliberately split across chunks mid-line, as a network would.
          const text = lines.map((l) => JSON.stringify(l) + "\n").join("");
          ctrl.enqueue(enc.encode(text.slice(0, 20)));
          ctrl.enqueue(enc.encode(text.slice(20)));
          ctrl.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
    },
  } as unknown as Fetcher;
  return { fetcher, calls };
}

const A = { id: "u-a", email: "a@example.com", created_at: "2026-01-01T00:00:00Z", settings: null };
const B = { id: "u-b", email: "b@example.com", created_at: "2026-01-01T00:00:00Z", settings: null };

const report = (id: string) => ({
  id,
  sourceFile: "x.pdf",
  reportDate: "2026-03-04",
  labName: "Lab",
  // A client that forgot to redact. The worker must not keep these.
  patientName: "Jan Novák",
  patientId: "800101/0006",
  pages: [{ pageNum: 1, imageUrl: "data:image/jpeg;base64,AAAA", imageWidth: 800, imageHeight: 1100 }],
  measurements: [{ rawAnalyteName: "S_Glukóza", valueRaw: "5,32", unitRaw: "mmol/l", refRangeRaw: "(4,11-5,60)" }],
});

/** A fingerprint as the client computes it: SHA-256, lowercase hex. */
const FP = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

let tables: Tables;
let env: Env;
let extract: ReturnType<typeof fakeExtract>;

async function as(user: { id: string }) {
  return { cookie: `mojekrev_session=${await mintCookieToken(SECRET, user.id, 3600)}` };
}

async function call(user: { id: string }, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...(await as(user)), ...headers } };
  if (body instanceof ArrayBuffer) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  return worker.fetch(new Request(`https://portal${path}`, init), env);
}

beforeEach(() => {
  tables = { users: [{ ...A }, { ...B }], reports: [], pages: [] };
  extract = fakeExtract({ status: 200, body: { reads: [], mode: "text", costUsd: 0.0123, budget: { spentUsd: 1 } } });
  env = {
    DB: fakeD1(tables),
    PAGES: fakeKv(),
    BUDGET: fakeKv(),
    EXTRACT: extract.fetcher,
    SESSION_SECRET: SECRET,
    EXTRACT_SESSION_SECRET: EXTRACT_SECRET,
    PORTAL_USD_LIMIT: "5",
  };
});

describe("the door", () => {
  it("refuses every data route without a session", async () => {
    for (const [m, p] of [["GET", "/api/reports"], ["POST", "/api/extract"], ["GET", "/api/pages/r/1"], ["GET", "/api/settings"]]) {
      const res = await worker.fetch(new Request(`https://portal${p}`, { method: m }), env);
      expect(res.status, `${m} ${p}`).toBe(401);
    }
  });
});

describe("extract proxy", () => {
  it("forwards the page under a session the extractor's secret verifies, and books the cost to the person", async () => {
    const res = await call(A, "POST", "/api/extract", { rowsText: "0\tS_Glukóza | 5,32" });
    expect(res.status).toBe(200);
    expect(extract.calls).toHaveLength(1);
    expect(JSON.parse(extract.calls[0].body)).toEqual({ rowsText: "0\tS_Glukóza | 5,32" });
    const claims = await verifySession(EXTRACT_SECRET, extract.calls[0].session);
    expect(claims?.pages).toBe(1);

    const data = (await res.json()) as { costUsd: number; budget: { spentUsd: number; budgetUsd: number } };
    expect(data.costUsd).toBe(0.0123);
    // The budget in the answer is the person's ledger, not the extractor's.
    expect(data.budget).toMatchObject({ spentUsd: 0.0123, budgetUsd: 5 });
  });

  it("passes a streamed answer through line by line, and books the cost from the last line", async () => {
    const stream = fakeExtractStream([
      { type: "row", model: "claude-haiku-4-5", row: { raw_analyte_name: "S_Glukóza", value_raw: "5,32" } },
      { type: "done", reads: [], mode: "text", costUsd: 0.0123, budget: { spentUsd: 99 } },
    ]);
    env.EXTRACT = stream.fetcher;
    const res = await call(A, "POST", "/api/extract", { rowsText: "0\tS_Glukóza | 5,32", stream: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("x-ndjson");
    expect(JSON.parse(stream.calls[0].body).stream).toBe(true);

    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ type: "row", model: "claude-haiku-4-5", row: { raw_analyte_name: "S_Glukóza", value_raw: "5,32" } });
    // The last line carries the person's ledger, not the extractor's, and the
    // cost has been booked by the time the stream closes.
    expect(lines[1]).toMatchObject({ type: "done", costUsd: 0.0123, budget: { spentUsd: 0.0123, budgetUsd: 5 } });
    expect((await userBudget(env.BUDGET, A.id, 5)).spentUsd).toBe(0.0123);
  });

  it("freezes the person who spent the month's allowance, and nobody else", async () => {
    await recordUserSpendUsd(env.BUDGET, A.id, monthOf(), 5);
    const a = await call(A, "POST", "/api/extract", { rowsText: "x" });
    expect(a.status).toBe(402);
    expect(extract.calls).toHaveLength(0);
    const b = await call(B, "POST", "/api/extract", { rowsText: "x" });
    expect(b.status).toBe(200);
    expect(extract.calls).toHaveLength(1);
  });

  it("passes the extractor's refusal through, in the portal's words", async () => {
    extract = fakeExtract({ status: 402, body: { error: "budget_exhausted", message: "Demo vyčerpalo…", budget: {} } });
    env.EXTRACT = extract.fetcher;
    const res = await call(A, "POST", "/api/extract", { rowsText: "x" });
    expect(res.status).toBe(402);
    const data = (await res.json()) as { error: string; message: string };
    expect(data.error).toBe("budget_exhausted");
    expect(data.message).not.toContain("Demo");
  });
});

describe("reports", () => {
  it("stores what the client built, with the identity fields emptied", async () => {
    expect((await call(A, "PUT", "/api/reports/r-1", report("r-1"))).status).toBe(200);
    const list = (await (await call(A, "GET", "/api/reports")).json()) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0].patientName).toBeNull();
    expect(list[0].patientId).toBeNull();
    expect(tables.reports[0].payload).not.toContain("Novák");
    expect(tables.reports[0].payload).not.toContain("800101");
    // The page image is named by route, never carried inline.
    expect(list[0].pages).toEqual([{ pageNum: 1, imageWidth: 800, imageHeight: 1100, imageUrl: "/api/pages/r-1/1" }]);
    expect(tables.reports[0].payload).not.toContain("data:image");
  });

  it("is each account's own: another account sees nothing and cannot overwrite", async () => {
    await call(A, "PUT", "/api/reports/r-1", report("r-1"));
    expect(await (await call(B, "GET", "/api/reports")).json()).toEqual([]);
    const res = await call(B, "PUT", "/api/reports/r-1", { ...report("r-1"), labName: "Hijack" });
    expect(res.status).toBe(403);
    expect(tables.reports[0].lab_name).toBe("Lab");
  });

  it("keeps the same report's own re-save as an update, not a duplicate", async () => {
    expect((await call(A, "PUT", "/api/reports/r-1", { ...report("r-1"), fingerprint: FP })).status).toBe(200);
    expect((await call(A, "PUT", "/api/reports/r-1", { ...report("r-1"), fingerprint: FP, labName: "Lab 2" })).status).toBe(200);
    expect(tables.reports).toHaveLength(1);
    expect(tables.reports[0].lab_name).toBe("Lab 2");
  });

  it("rejects a payload that is not a report, or whose id disagrees with the path", async () => {
    expect((await call(A, "PUT", "/api/reports/r-1", { id: "r-2", measurements: [], pages: [] })).status).toBe(400);
    expect((await call(A, "PUT", "/api/reports/r-1", "nonsense")).status).toBe(400);
    expect((await call(A, "PUT", "/api/reports/../etc", report("../etc"))).status).toBe(404);
  });
});

describe("the same file twice", () => {
  const jpeg = (b: number) => new Uint8Array([0xff, 0xd8, b]).buffer;
  const put = (user: { id: string }, id: string, n: number, b: number) =>
    call(user, "PUT", `/api/reports/${id}/${n}`, jpeg(b), { "content-type": "image/jpeg", "x-image-width": "800", "x-image-height": "1100" });

  it("stores the fingerprint from the payload in its own column, and drops one that is not a hash", async () => {
    expect((await call(A, "PUT", "/api/reports/r-1", { ...report("r-1"), fingerprint: FP })).status).toBe(200);
    expect(tables.reports[0].fingerprint).toBe(FP);
    expect(JSON.parse(tables.reports[0].payload).fingerprint).toBe(FP);
    // The client reads it back on the report: that is how it recognises the file next time.
    const list = (await (await call(A, "GET", "/api/reports")).json()) as Array<{ fingerprint?: string }>;
    expect(list[0].fingerprint).toBe(FP);

    expect((await call(A, "PUT", "/api/reports/r-2", { ...report("r-2"), fingerprint: "not-a-hash" })).status).toBe(200);
    expect(tables.reports[1].fingerprint).toBeNull();
    expect(JSON.parse(tables.reports[1].payload)).not.toHaveProperty("fingerprint");
    // A report without one is not a duplicate of another without one.
    expect((await call(A, "PUT", "/api/reports/r-3", report("r-3"))).status).toBe(200);
    expect(tables.reports).toHaveLength(3);
  });

  it("answers 409 with the existing id for a second report with the same fingerprint, and stores nothing", async () => {
    await call(A, "PUT", "/api/reports/r-1", { ...report("r-1"), fingerprint: FP });
    const res = await call(A, "PUT", "/api/reports/r-2", { ...report("r-2"), fingerprint: FP });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "duplicate", message: "Tento report už máte nahraný.", existingId: "r-1" });
    expect(tables.reports).toHaveLength(1);
  });

  it("answers the same 409 when the duplicate lands between the check and the insert", async () => {
    await call(A, "PUT", "/api/reports/r-1", { ...report("r-1"), fingerprint: FP });
    tables.raceOnce = true;
    const res = await call(A, "PUT", "/api/reports/r-2", { ...report("r-2"), fingerprint: FP });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { existingId: string }).existingId).toBe("r-1");
    expect(tables.reports).toHaveLength(1);
  });

  it("is per account: the same fingerprint under another account is that account's own report", async () => {
    await call(A, "PUT", "/api/reports/r-1", { ...report("r-1"), fingerprint: FP });
    expect((await call(B, "PUT", "/api/reports/r-9", { ...report("r-9"), fingerprint: FP })).status).toBe(200);
    expect(tables.reports.map((r) => [r.id, r.user_id, r.fingerprint])).toEqual([["r-1", "u-a", FP], ["r-9", "u-b", FP]]);
  });

  it("replacing a report with fewer pages leaves no stale page rows or KV keys", async () => {
    const three = { ...report("r-1"), pages: [1, 2, 3].map((n) => ({ pageNum: n, imageWidth: 800, imageHeight: 1100 })) };
    expect((await call(A, "PUT", "/api/reports/r-1", three)).status).toBe(200);
    for (const n of [1, 2, 3]) expect((await put(A, "r-1", n, n)).status).toBe(200);
    const kv = env.PAGES as unknown as { _store: Map<string, { value: ArrayBuffer }> };
    expect(tables.pages.map((p) => p.page_num)).toEqual([1, 2, 3]);
    expect([...kv._store.keys()].sort()).toEqual(["u-a/r-1/page_1", "u-a/r-1/page_2", "u-a/r-1/page_3"]);

    // The replacement, as the client stores it: the row (naming one page),
    // the page, the row again.
    const one = { ...report("r-1"), fingerprint: FP, pages: [{ pageNum: 1, imageWidth: 800, imageHeight: 1100 }] };
    expect((await call(A, "PUT", "/api/reports/r-1", one)).status).toBe(200);
    expect((await put(A, "r-1", 1, 9)).status).toBe(200);
    expect((await call(A, "PUT", "/api/reports/r-1", one)).status).toBe(200);
    expect(tables.pages).toEqual([{ report_id: "r-1", page_num: 1, kv_key: "u-a/r-1/page_1", width: 800, height: 1100 }]);
    expect([...kv._store.keys()]).toEqual(["u-a/r-1/page_1"]);
    // And the page that stayed is the new one, not the old.
    expect(new Uint8Array(kv._store.get("u-a/r-1/page_1")!.value)).toEqual(new Uint8Array(jpeg(9)));
    expect(tables.reports).toHaveLength(1);
    expect(tables.reports[0].fingerprint).toBe(FP);
  });
});

describe("page images", () => {
  const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer;

  it("round-trips for the owner, under the type it was sent as", async () => {
    await call(A, "PUT", "/api/reports/r-1", report("r-1"));
    const put = await call(A, "PUT", "/api/reports/r-1/1", jpeg(), { "content-type": "image/jpeg", "x-image-width": "800", "x-image-height": "1100" });
    expect(put.status).toBe(200);
    expect(tables.pages).toEqual([{ report_id: "r-1", page_num: 1, kv_key: "u-a/r-1/page_1", width: 800, height: 1100 }]);

    const get = await call(A, "GET", "/api/pages/r-1/1");
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/jpeg");
    expect(get.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(new Uint8Array(jpeg()));
  });

  it("is invisible to another account, and cannot be attached to another's report", async () => {
    await call(A, "PUT", "/api/reports/r-1", report("r-1"));
    await call(A, "PUT", "/api/reports/r-1/1", jpeg(), { "content-type": "image/jpeg" });
    expect((await call(B, "GET", "/api/pages/r-1/1")).status).toBe(404);
    expect((await call(B, "PUT", "/api/reports/r-1/2", jpeg(), { "content-type": "image/jpeg" })).status).toBe(404);
    expect(tables.pages).toHaveLength(1);
  });

  it("refuses anything that is not an image, and a page number past the cap", async () => {
    await call(A, "PUT", "/api/reports/r-1", report("r-1"));
    expect((await call(A, "PUT", "/api/reports/r-1/1", jpeg(), { "content-type": "application/pdf" })).status).toBe(400);
    expect((await call(A, "PUT", "/api/reports/r-1/31", jpeg(), { "content-type": "image/jpeg" })).status).toBe(404);
  });
});

describe("delete", () => {
  it("removes the row, the page rows and the images together", async () => {
    await call(A, "PUT", "/api/reports/r-1", report("r-1"));
    await call(A, "PUT", "/api/reports/r-1/1", new Uint8Array([1]).buffer, { "content-type": "image/jpeg" });
    await call(A, "PUT", "/api/reports/r-1/2", new Uint8Array([2]).buffer, { "content-type": "image/jpeg" });
    const pages = env.PAGES as unknown as { _store: Map<string, unknown> };
    expect(pages._store.size).toBe(2);

    const res = await call(A, "DELETE", "/api/reports/r-1");
    expect(res.status).toBe(200);
    expect(tables.reports).toEqual([]);
    expect(tables.pages).toEqual([]);
    expect(pages._store.size).toBe(0);
  });

  it("is not something another account can do", async () => {
    await call(A, "PUT", "/api/reports/r-1", report("r-1"));
    expect((await call(B, "DELETE", "/api/reports/r-1")).status).toBe(404);
    expect(tables.reports).toHaveLength(1);
  });
});

describe("settings", () => {
  it("round-trips a JSON object and starts empty", async () => {
    expect(await (await call(A, "GET", "/api/settings")).json()).toEqual({});
    expect((await call(A, "PUT", "/api/settings", { learned: { glukoza: ["S-GLU"] } })).status).toBe(200);
    expect(await (await call(A, "GET", "/api/settings")).json()).toEqual({ learned: { glukoza: ["S-GLU"] } });
    // Someone else's settings are their own.
    expect(await (await call(B, "GET", "/api/settings")).json()).toEqual({});
  });

  it("refuses anything but an object", async () => {
    expect((await call(A, "PUT", "/api/settings", [1, 2])).status).toBe(400);
  });
});
