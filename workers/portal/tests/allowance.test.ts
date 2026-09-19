/**
 * Documents, not dollars — and the shop that sells them.
 *
 * The properties worth proving are the ones a person would notice on their
 * bill: a document is taken once however many pages it has, given back only
 * when nothing could be read, never given back for deleting the report, and
 * refused at zero in Czech. Then Stripe: a purchase credits the account once
 * however many times the webhook is delivered, a forged or stale signature is
 * refused before the body is read, and with no secrets set the shop is
 * closed rather than broken. Everything real except D1, KV, the extractor
 * and Stripe's API — the signature check runs the real HMAC both ways.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken } from "../src/session";
import { recordUserSpendUsd, monthOf } from "../src/ledger";
import { allowanceOf, documents, FREE_DOCUMENTS } from "../src/allowance";
import { PACKAGES, verifyStripeSignature } from "../src/stripe";
import { SHOW_SQL, documentsSql } from "../../../tools/scripts/moje-krev-budget.mjs";

const SECRET = "test-portal-secret";
const EXTRACT_SECRET = "test-extract-secret";
const WEBHOOK_SECRET = "whsec_test_0123456789";

interface User {
  id: string;
  email: string;
  created_at: string;
  settings: string | null;
  budget_usd?: number | null;
  session_epoch: number;
  doc_allowance: number;
  doc_used: number;
}
interface Doc {
  id: string;
  user_id: string;
  created_at: string;
  pages_sent: number;
  pages_read: number;
  pages_failed: number;
  released_at: string | null;
}
interface Purchase {
  event_id: string;
  user_id: string | null;
  package: string;
  amount_czk: number;
  created_at: string;
}
interface Tables {
  users: User[];
  reports: Array<{ id: string; user_id: string; payload: string }>;
  documents: Doc[];
  purchases: Purchase[];
}

/** Dispatches on the exact SQL constants; a query without a branch throws. */
function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.allowanceForUser:
        return { results: t.users.filter((u) => u.id === a[0]).map((u) => ({ doc_allowance: u.doc_allowance, doc_used: u.doc_used })), changes: 0 };
      case SQL.insertDocument: {
        if (t.documents.some((d) => d.id === a[0])) return { results: [], changes: 0 };
        t.documents.push({ id: a[0] as string, user_id: a[1] as string, created_at: a[2] as string, pages_sent: 0, pages_read: 0, pages_failed: 0, released_at: null });
        return { results: [], changes: 1 };
      }
      case SQL.documentById:
        return { results: t.documents.filter((d) => d.id === a[0]), changes: 0 };
      case SQL.deleteDocument: {
        const before = t.documents.length;
        t.documents = t.documents.filter((d) => d.id !== a[0]);
        return { results: [], changes: before - t.documents.length };
      }
      case SQL.takeDocument: {
        const u = t.users.find((x) => x.id === a[0]);
        if (!u || !(u.doc_used < u.doc_allowance)) return { results: [], changes: 0 };
        u.doc_used += 1;
        return { results: [], changes: 1 };
      }
      case SQL.sendPage: {
        const d = t.documents.find((x) => x.id === a[0] && x.user_id === a[1] && x.released_at === null && x.pages_sent < (a[2] as number));
        if (!d) return { results: [], changes: 0 };
        d.pages_sent += 1;
        return { results: [], changes: 1 };
      }
      case SQL.notePageRead: {
        const d = t.documents.find((x) => x.id === a[0]);
        if (d) d.pages_read += 1;
        return { results: [], changes: d ? 1 : 0 };
      }
      case SQL.notePageFailed: {
        const d = t.documents.find((x) => x.id === a[0]);
        if (d) d.pages_failed += 1;
        return { results: [], changes: d ? 1 : 0 };
      }
      case SQL.releaseDocument: {
        // The slot goes back only when nothing was read and nothing is still
        // out at the extractor: every page sent has come back failed.
        const d = t.documents.find((x) => x.id === a[0] && x.user_id === a[1] && x.pages_read === 0 && x.pages_failed === x.pages_sent && x.released_at === null);
        if (!d) return { results: [], changes: 0 };
        d.released_at = a[2] as string;
        return { results: [], changes: 1 };
      }
      case SQL.giveBackDocument: {
        const u = t.users.find((x) => x.id === a[0]);
        if (!u || u.doc_used <= 0) return { results: [], changes: 0 };
        u.doc_used -= 1;
        return { results: [], changes: 1 };
      }
      case SQL.insertPurchase: {
        if (t.purchases.some((p) => p.event_id === a[0])) return { results: [], changes: 0 };
        t.purchases.push({ event_id: a[0] as string, user_id: a[1] as string, package: a[2] as string, amount_czk: a[3] as number, created_at: a[4] as string });
        return { results: [], changes: 1 };
      }
      case SQL.creditDocuments: {
        const u = t.users.find((x) => x.id === a[0]);
        if (u) u.doc_allowance += a[1] as number;
        return { results: [], changes: u ? 1 : 0 };
      }
      // The report routes, only as far as delete needs them.
      case SQL.reportOwner:
        return { results: t.reports.filter((r) => r.id === a[0]).map((r) => ({ id: r.id, user_id: r.user_id })), changes: 0 };
      case SQL.pagesForReport:
        return { results: [], changes: 0 };
      case SQL.deletePages:
        return { results: [], changes: 0 };
      case SQL.deleteReport: {
        const before = t.reports.length;
        t.reports = t.reports.filter((r) => !(r.id === a[0] && r.user_id === a[1]));
        return { results: [], changes: before - t.reports.length };
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
  const store = new Map<string, string>();
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

/** The extractor: answers each page with the status it is told to, and counts. */
function fakeExtract(status: () => number) {
  let calls = 0;
  const fetcher = {
    fetch: async () => {
      calls += 1;
      const s = status();
      const body = s === 200 ? { reads: [], mode: "text", costUsd: 0.01, budget: {} } : { error: "extraction_failed", message: "no" };
      return new Response(JSON.stringify(body), { status: s, headers: { "content-type": "application/json" } });
    },
  } as unknown as Fetcher;
  return { fetcher, calls: () => calls };
}

/**
 * An extractor that holds every page until told to answer: what the wire
 * looks like while six pages are out and the browser has already given up.
 * `answer(status)` lets the pages go, in the order they arrived.
 */
function heldExtract() {
  const waiting: Array<(s: number) => void> = [];
  const fetcher = {
    fetch: () =>
      new Promise<Response>((resolve) => {
        waiting.push((s) => {
          const body = s === 200 ? { reads: [], mode: "text", costUsd: 0.01, budget: {} } : { error: "extraction_failed", message: "no" };
          resolve(new Response(JSON.stringify(body), { status: s, headers: { "content-type": "application/json" } }));
        });
      }),
  } as unknown as Fetcher;
  return { fetcher, held: () => waiting.length, answer: (s: number) => waiting.shift()?.(s) };
}

const A: User = { id: "u-a", email: "a@example.com", created_at: "2026-01-01T00:00:00Z", settings: null, session_epoch: 0, doc_allowance: 5, doc_used: 0 };
const B: User = { id: "u-b", email: "b@example.com", created_at: "2026-01-01T00:00:00Z", settings: null, session_epoch: 0, doc_allowance: 5, doc_used: 0 };

let tables: Tables;
let env: Env;
let extractStatus = 200;

async function call(user: { id: string }, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, demo = false) {
  const cookie = `mojekrev_session=${await mintCookieToken(SECRET, user.id, 3600, demo)}`;
  const init: RequestInit = { method, headers: { cookie, ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  return worker.fetch(new Request(`https://portal${path}`, init), env);
}

const open = (user: { id: string }, id: string) => call(user, "POST", "/api/documents", { id });
const page = (user: { id: string }, doc: string) => call(user, "POST", "/api/extract", { rowsText: "x" }, { "x-document": doc });
const release = (user: { id: string }, id: string) => call(user, "DELETE", `/api/documents/${id}`);
const allowance = async (user: { id: string }) => (await (await call(user, "GET", "/api/allowance")).json()) as { free: number; purchased: number; used: number; remaining: number };

// The refusal log is a real line (reports.test.ts pins what it holds); here
// it is noise under every failed page.
afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  tables = { users: [{ ...A }, { ...B }], reports: [], documents: [], purchases: [] };
  extractStatus = 200;
  env = {
    DB: fakeD1(tables),
    PAGES: fakeKv(),
    BUDGET: fakeKv(),
    EXTRACT: fakeExtract(() => extractStatus).fetcher,
    SESSION_SECRET: SECRET,
    EXTRACT_SESSION_SECRET: EXTRACT_SECRET,
    MAX_PAGES_PER_REPORT: "6",
  };
});

/* -------------------------------------------------------------- documents */

describe("what an account starts with", () => {
  it("is five free documents, none used, for a row the migration touched", () => {
    // Exactly the row every existing account has after the migration:
    // defaults on both columns, whatever it had uploaded before.
    expect(allowanceOf({ doc_allowance: 5, doc_used: 0 })).toEqual({ free: 5, purchased: 0, used: 0, remaining: 5 });
    expect(FREE_DOCUMENTS).toBe(5);
  });

  it("reads a bought or granted surplus as purchased, and never goes below zero", () => {
    expect(allowanceOf({ doc_allowance: 20, doc_used: 7 })).toEqual({ free: 5, purchased: 15, used: 7, remaining: 13 });
    expect(allowanceOf({ doc_allowance: 5, doc_used: 5 })).toEqual({ free: 5, purchased: 0, used: 5, remaining: 0 });
    // The operator lowered someone to 2: the free part is what they have.
    expect(allowanceOf({ doc_allowance: 2, doc_used: 0 })).toEqual({ free: 2, purchased: 0, used: 0, remaining: 2 });
  });

  it("is what GET /api/allowance answers, and an existing account with reports keeps all five", async () => {
    tables.reports.push({ id: "old-1", user_id: A.id, payload: "{}" }, { id: "old-2", user_id: A.id, payload: "{}" });
    expect(await allowance(A)).toEqual({ free: 5, purchased: 0, used: 0, remaining: 5 });
  });

  it("declines the word: 1 dokument, 2 dokumenty, 5 dokumentů", () => {
    expect(documents(1)).toBe("1 dokument");
    expect(documents(2)).toBe("2 dokumenty");
    expect(documents(4)).toBe("4 dokumenty");
    expect(documents(5)).toBe("5 dokumentů");
    expect(documents(20)).toBe("20 dokumentů");
  });
});

describe("taking a document", () => {
  it("takes one at the open, and none of the six pages takes another", async () => {
    const opened = await open(A, "d-1");
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { allowance: { used: number } }).allowance.used).toBe(1);
    for (let i = 0; i < 6; i++) expect((await page(A, "d-1")).status).toBe(200);
    expect(await allowance(A)).toEqual({ free: 5, purchased: 0, used: 1, remaining: 4 });
    expect(tables.documents[0]).toMatchObject({ pages_sent: 6, pages_read: 6 });
  });

  it("refuses a seventh page of a six-page document before the extractor is asked", async () => {
    const extract = fakeExtract(() => 200);
    env.EXTRACT = extract.fetcher;
    await open(A, "d-1");
    for (let i = 0; i < 6; i++) await page(A, "d-1");
    const seventh = await page(A, "d-1");
    expect(seventh.status).toBe(409);
    expect(((await seventh.json()) as { error: string }).error).toBe("no_document");
    expect(extract.calls()).toBe(6);
  });

  it("refuses a page of no document, and of another account's document", async () => {
    await open(A, "d-1");
    expect((await call(A, "POST", "/api/extract", { rowsText: "x" })).status).toBe(409);
    expect((await page(B, "d-1")).status).toBe(409);
    expect((await open(B, "d-1")).status).toBe(403);
    expect(await allowance(B)).toMatchObject({ used: 0 });
  });

  it("opens the same id twice for one document — a retry takes nothing", async () => {
    await open(A, "d-1");
    const again = await open(A, "d-1");
    expect(again.status).toBe(200);
    expect(((await again.json()) as { already: boolean }).already).toBe(true);
    expect(await allowance(A)).toMatchObject({ used: 1 });
  });

  it("answers 402 no_documents at zero, in Czech, and takes nothing", async () => {
    for (const id of ["d-1", "d-2", "d-3", "d-4", "d-5"]) expect((await open(A, id)).status).toBe(200);
    const sixth = await open(A, "d-6");
    expect(sixth.status).toBe(402);
    const body = (await sixth.json()) as { error: string; message: string; allowance: { remaining: number } };
    expect(body.error).toBe("no_documents");
    expect(body.message).toBe("Máte vyčerpáno 5 dokumentů zdarma. Přikupte další v Reportech.");
    expect(body.allowance.remaining).toBe(0);
    // The id was not kept: after a purchase it opens.
    expect(tables.documents.map((d) => d.id)).not.toContain("d-6");
    // And the neighbour is untouched.
    expect(await allowance(B)).toMatchObject({ used: 0, remaining: 5 });
  });

  it("says all N documents once some were bought", async () => {
    tables.users[0].doc_allowance = 20;
    tables.users[0].doc_used = 20;
    const res = await open(A, "d-x");
    expect(res.status).toBe(402);
    expect(((await res.json()) as { message: string }).message).toBe("Máte vyčerpáno všech 20 dokumentů. Přikupte další v Reportech.");
  });

  it("refuses a frozen person before taking, so the fuse costs no document", async () => {
    await recordUserSpendUsd(env.BUDGET, A.id, monthOf(), 10);
    const res = await open(A, "d-1");
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe("budget_exhausted");
    expect(await allowance(A)).toMatchObject({ used: 0 });
    expect(tables.documents).toEqual([]);
  });
});

describe("giving a document back", () => {
  it("happens when no page could be read", async () => {
    extractStatus = 502;
    await open(A, "d-1");
    for (let i = 0; i < 3; i++) expect((await page(A, "d-1")).status).toBe(502);
    expect(await allowance(A)).toMatchObject({ used: 1 });
    const res = await release(A, "d-1");
    expect(((await res.json()) as { released: boolean }).released).toBe(true);
    expect(await allowance(A)).toEqual({ free: 5, purchased: 0, used: 0, remaining: 5 });
    // A released document takes no more pages.
    expect((await page(A, "d-1")).status).toBe(409);
  });

  it("does not happen when even one page was read", async () => {
    let n = 0;
    env.EXTRACT = fakeExtract(() => (++n === 1 ? 200 : 502)).fetcher;
    await open(A, "d-1");
    expect((await page(A, "d-1")).status).toBe(200);
    expect((await page(A, "d-1")).status).toBe(502);
    const res = await release(A, "d-1");
    expect(((await res.json()) as { released: boolean }).released).toBe(false);
    expect(await allowance(A)).toMatchObject({ used: 1 });
  });

  it("does not happen while a page is still out at the extractor", async () => {
    // The hole: the slot is decided by pages_read, which moves only when the
    // extractor answers. A browser that opens, sends two pages and deletes
    // the document at once would get the slot back and the two reads both.
    const held = heldExtract();
    env.EXTRACT = held.fetcher;
    await open(A, "d-1");
    const first = page(A, "d-1");
    const second = page(A, "d-1");
    await vi.waitFor(() => expect(held.held()).toBe(2));
    const early = await release(A, "d-1");
    expect(((await early.json()) as { released: boolean }).released).toBe(false);
    expect(await allowance(A)).toMatchObject({ used: 1 });
    // Both fail: now, and only now, the slot comes back.
    held.answer(502);
    held.answer(502);
    expect((await first).status).toBe(502);
    expect((await second).status).toBe(502);
    expect(tables.documents[0]).toMatchObject({ pages_sent: 2, pages_read: 0, pages_failed: 2 });
    const late = await release(A, "d-1");
    expect(((await late.json()) as { released: boolean }).released).toBe(true);
    expect(await allowance(A)).toMatchObject({ used: 0 });
  });

  it("never happens once one of the pages in flight was read", async () => {
    const held = heldExtract();
    env.EXTRACT = held.fetcher;
    await open(A, "d-1");
    const first = page(A, "d-1");
    const second = page(A, "d-1");
    await vi.waitFor(() => expect(held.held()).toBe(2));
    expect(((await (await release(A, "d-1")).json()) as { released: boolean }).released).toBe(false);
    held.answer(200);
    held.answer(502);
    await Promise.all([first, second]);
    expect(tables.documents[0]).toMatchObject({ pages_sent: 2, pages_read: 1, pages_failed: 1 });
    expect(((await (await release(A, "d-1")).json()) as { released: boolean }).released).toBe(false);
    expect(await allowance(A)).toMatchObject({ used: 1 });
  });

  it("counts a page the extractor could not be reached for as failed, not as in flight", async () => {
    env.EXTRACT = { fetch: async () => { throw new Error("service binding down"); } } as unknown as Fetcher;
    await open(A, "d-1");
    const res = await page(A, "d-1");
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("extraction_failed");
    expect(tables.documents[0]).toMatchObject({ pages_sent: 1, pages_read: 0, pages_failed: 1 });
    expect(((await (await release(A, "d-1")).json()) as { released: boolean }).released).toBe(true);
    expect(await allowance(A)).toMatchObject({ used: 0 });
  });

  it("happens once: a second release changes nothing", async () => {
    extractStatus = 502;
    await open(A, "d-1");
    await page(A, "d-1");
    await release(A, "d-1");
    await release(A, "d-1");
    expect(await allowance(A)).toMatchObject({ used: 0 });
  });

  it("is not something another account can do", async () => {
    extractStatus = 502;
    await open(A, "d-1");
    await page(A, "d-1");
    expect(((await (await release(B, "d-1")).json()) as { released: boolean }).released).toBe(false);
    expect(await allowance(A)).toMatchObject({ used: 1 });
  });

  it("does not happen when the report is deleted", async () => {
    await open(A, "d-1");
    await page(A, "d-1");
    tables.reports.push({ id: "d-1", user_id: A.id, payload: "{}" });
    expect((await call(A, "DELETE", "/api/reports/d-1")).status).toBe(200);
    expect(tables.reports).toEqual([]);
    expect(await allowance(A)).toMatchObject({ used: 1, remaining: 4 });
    // Nor by releasing the document after the delete: a page was read.
    await release(A, "d-1");
    expect(await allowance(A)).toMatchObject({ used: 1 });
  });
});

/**
 * The operator's grant: the same script that sets a budget, `--documents`.
 * The statement is pinned because it is the one write to doc_allowance that
 * no route makes, and its floor — never under what is used — is the rule a
 * refund could otherwise break.
 */
describe("moje-krev-budget.mjs --documents", () => {
  it("adds to the allowance by e-mail, lowercased", () => {
    const { sql, says } = documentsSql({ email: " Kdo@Example.com ", n: 5 });
    expect(sql).toBe("UPDATE users SET doc_allowance = MAX(doc_used, doc_allowance + 5) WHERE email = 'kdo@example.com';");
    expect(says).toContain("+5 documents");
  });

  it("takes back with the same floor, and refuses anything but a whole non-zero number", () => {
    expect(documentsSql({ email: "a@b.cz", n: "-15" }).sql).toContain("MAX(doc_used, doc_allowance - 15)");
    for (const bad of [0, 1.5, "x", ""]) expect(() => documentsSql({ email: "a@b.cz", n: bad })).toThrow(/not a number of documents/);
  });

  it("shows the documents beside the budget", () => {
    expect(SHOW_SQL).toContain("doc_used, doc_allowance");
  });
});

/* ------------------------------------------------------------------ shop */

const stripeEnv = () => ({
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_5: "price_five",
  STRIPE_PRICE_15: "price_fifteen",
});

const enc = new TextEncoder();
async function sign(secret: string, t: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const completed = (eventId: string, uid: string, pkg: "5" | "15", extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: eventId,
    type: "checkout.session.completed",
    data: { object: { id: "cs_1", client_reference_id: uid, metadata: { package: pkg, user_id: uid }, amount_total: PACKAGES[pkg].czk * 100, currency: "czk", payment_status: "paid", ...extra } },
  });

async function webhook(body: string, header?: string, at = Math.floor(Date.now() / 1000)) {
  const sig = header ?? `t=${at},v1=${await sign(WEBHOOK_SECRET, at, body)}`;
  return worker.fetch(new Request("https://portal/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body }), env);
}

describe("the shop, closed", () => {
  it("answers 503 shop_closed to a buy while the secrets are unset, in Czech", async () => {
    const res = await call(A, "POST", "/api/buy", { package: "5" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "shop_closed", message: "Obchod zatím není otevřený." });
  });

  it("is closed with any one of the four missing", async () => {
    Object.assign(env, stripeEnv(), { STRIPE_PRICE_15: undefined });
    expect((await call(A, "POST", "/api/buy", { package: "5" })).status).toBe(503);
  });

  it("refuses every webhook, whatever it carries", async () => {
    expect((await webhook(completed("evt_1", A.id, "5"))).status).toBe(503);
    expect(tables.purchases).toEqual([]);
  });
});

describe("buying", () => {
  beforeEach(() => Object.assign(env, stripeEnv()));

  it("mints a Checkout Session for the package on the person's behalf and answers its URL", async () => {
    const seen: Array<{ url: string; auth: string | null; form: URLSearchParams }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get("authorization"), form: new URLSearchParams(String(init.body)) });
      return new Response(JSON.stringify({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }), { status: 200 });
    });
    try {
      const res = await call(A, "POST", "/api/buy", { package: "15" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
      expect(seen).toHaveLength(1);
      expect(seen[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
      expect(seen[0].auth).toBe("Bearer sk_test_x");
      const f = seen[0].form;
      expect(f.get("mode")).toBe("payment");
      expect(f.get("line_items[0][price]")).toBe("price_fifteen");
      expect(f.get("line_items[0][quantity]")).toBe("1");
      expect(f.get("client_reference_id")).toBe(A.id);
      expect(f.get("metadata[package]")).toBe("15");
      expect(f.get("success_url")).toBe("https://portal/?koupeno=1");
      expect(f.get("cancel_url")).toBe("https://portal/");
      // The address stays home: Stripe asks for one on its own page.
      expect([...f.keys()]).not.toContain("customer_email");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("knows two packages and no other", async () => {
    for (const bad of ["10", 5, "", undefined]) {
      expect((await call(A, "POST", "/api/buy", { package: bad })).status, String(bad)).toBe(400);
    }
  });

  it("is not for a demo visitor — their money must not land in the owner's account", async () => {
    const res = await call(A, "POST", "/api/buy", { package: "5" }, {}, true);
    expect(res.status).toBe(403);
  });

  it("says so, without Stripe's words, when Stripe refuses", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { type: "invalid_request_error", code: "resource_missing", message: "No such price: price_fifteen for a@example.com" } }), { status: 400 }));
    try {
      const res = await call(A, "POST", "/api/buy", { package: "15" });
      expect(res.status).toBe(502);
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain("a@example.com");
      expect(spy.mock.calls.join(" ")).not.toContain("a@example.com");
    } finally {
      vi.unstubAllGlobals();
      spy.mockRestore();
    }
  });
});

describe("the webhook", () => {
  beforeEach(() => Object.assign(env, stripeEnv()));

  it("credits the package once the signed, paid event arrives", async () => {
    const res = await webhook(completed("evt_1", A.id, "5"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, credited: true, allowance: { free: 5, purchased: 5, used: 0, remaining: 10 } });
    expect(tables.purchases).toEqual([{ event_id: "evt_1", user_id: A.id, package: "5", amount_czk: 49, created_at: expect.any(String) }]);
    expect(await allowance(A)).toEqual({ free: 5, purchased: 5, used: 0, remaining: 10 });
    // And the neighbour got nothing.
    expect(await allowance(B)).toMatchObject({ purchased: 0 });

    await webhook(completed("evt_2", A.id, "15"));
    expect(await allowance(A)).toEqual({ free: 5, purchased: 20, used: 0, remaining: 25 });
    expect(tables.purchases[1]).toMatchObject({ package: "15", amount_czk: 99 });
  });

  it("credits an event once, however many times Stripe delivers it", async () => {
    const body = completed("evt_1", A.id, "15");
    expect((await webhook(body)).status).toBe(200);
    const again = await webhook(body);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(await allowance(A)).toMatchObject({ purchased: 15 });
    expect(tables.purchases).toHaveLength(1);
  });

  it("refuses a bad signature with 400 and writes nothing", async () => {
    const body = completed("evt_1", A.id, "5");
    const t = Math.floor(Date.now() / 1000);
    for (const header of [
      undefined,
      "",
      `t=${t},v1=${"0".repeat(64)}`,
      `t=${t},v1=${await sign("whsec_other", t, body)}`,
      // The right MAC over a different body.
      `t=${t},v1=${await sign(WEBHOOK_SECRET, t, completed("evt_1", B.id, "5"))}`,
      // A MAC with the timestamp left out of the signed text.
      `t=${t},v1=${await sign(WEBHOOK_SECRET, 0, body).then((s) => s)}`,
    ]) {
      const res = await webhook(body, header === undefined ? "" : header);
      expect(res.status, header ?? "(none)").toBe(400);
    }
    expect(tables.purchases).toEqual([]);
    expect(await allowance(A)).toMatchObject({ purchased: 0 });
  });

  it("refuses a timestamp outside five minutes either way, and takes one inside", async () => {
    const body = completed("evt_1", A.id, "5");
    const now = Math.floor(Date.now() / 1000);
    expect((await webhook(body, undefined, now - 301)).status).toBe(400);
    expect((await webhook(body, undefined, now + 301)).status).toBe(400);
    expect(tables.purchases).toEqual([]);
    expect((await webhook(body, undefined, now - 299)).status).toBe(200);
    expect(tables.purchases).toHaveLength(1);
  });

  it("matches any one v1 while a secret is being rolled", async () => {
    const body = completed("evt_1", A.id, "5");
    const t = Math.floor(Date.now() / 1000);
    expect(await verifyStripeSignature(WEBHOOK_SECRET, `t=${t},v1=${"a".repeat(64)},v1=${await sign(WEBHOOK_SECRET, t, body)}`, body, t)).toBe(true);
    expect(await verifyStripeSignature(WEBHOOK_SECRET, `t=${t},v0=${await sign(WEBHOOK_SECRET, t, body)}`, body, t)).toBe(false);
  });

  it("acknowledges and ignores every other event, and an unpaid completion", async () => {
    const other = JSON.stringify({ id: "evt_9", type: "payment_intent.succeeded", data: { object: {} } });
    expect(await (await webhook(other)).json()).toEqual({ received: true, ignored: true });
    const unpaid = completed("evt_8", A.id, "5", { payment_status: "unpaid" });
    expect(await (await webhook(unpaid)).json()).toEqual({ received: true, ignored: true });
    expect(tables.purchases).toEqual([]);
    expect(await allowance(A)).toMatchObject({ purchased: 0 });
  });

  it("records a payment for an account that is gone, credits nobody, and still says 200", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const res = await webhook(completed("evt_1", "u-deleted", "5"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ received: true, credited: false });
      expect(tables.purchases).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
