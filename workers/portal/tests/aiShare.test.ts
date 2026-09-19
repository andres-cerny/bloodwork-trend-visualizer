/**
 * AI konzultace: the link is a bearer key to health numbers, so the properties
 * worth proving are the ones that bound it. Only the token's hash is stored;
 * the page answers for a live token and says one identical 404 for an
 * expired, revoked, unknown or malformed one; a new link kills the old;
 * the served text is the text the client sent and nothing from the users
 * table; deleting the account deletes the share. Plain node, fake D1, same
 * pattern as the other route tests.
 */
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";
import { SQL } from "../src/db";
import { mintCookieToken, sha256Hex } from "../src/session";

const SECRET = "test-portal-secret";

interface ShareRow {
  token_hash: string;
  user_id: string;
  snapshot: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}
interface Tables {
  users: Array<{ id: string; email: string; created_at: string; settings: string | null; session_epoch: number }>;
  shares: ShareRow[];
  reports: Array<{ id: string; user_id: string }>;
  pages: Array<{ report_id: string; kv_key: string }>;
  invites: Array<{ code: string; used_by: string | null }>;
}

function fakeD1(t: Tables): D1Database {
  const run = (sql: string, a: unknown[]): { results: unknown[]; changes: number } => {
    switch (sql) {
      case SQL.userById:
        return { results: t.users.filter((u) => u.id === a[0]), changes: 0 };
      case SQL.insertShare: {
        const [token_hash, user_id, snapshot, created_at, expires_at] = a as [string, string, string, number, number];
        t.shares.push({ token_hash, user_id, snapshot, created_at, expires_at, revoked_at: null });
        return { results: [], changes: 1 };
      }
      case SQL.shareByHash:
        return {
          results: t.shares.filter((s) => s.token_hash === a[0]).map((s) => ({ snapshot: s.snapshot, expires_at: s.expires_at, revoked_at: s.revoked_at })),
          changes: 0,
        };
      case SQL.liveShareForUser:
        return {
          results: t.shares
            .filter((s) => s.user_id === a[0] && s.revoked_at === null && s.expires_at > (a[1] as number))
            .sort((x, y) => y.created_at - x.created_at)
            .slice(0, 1)
            .map((s) => ({ expires_at: s.expires_at })),
          changes: 0,
        };
      case SQL.updateLiveShare: {
        let n = 0;
        for (const s of t.shares) if (s.user_id === a[0] && s.revoked_at === null && s.expires_at > (a[2] as number)) (s.snapshot = a[1] as string), n++;
        return { results: [], changes: n };
      }
      case SQL.revokeSharesForUser: {
        let n = 0;
        for (const s of t.shares) if (s.user_id === a[0] && s.revoked_at === null) (s.revoked_at = a[1] as number), n++;
        return { results: [], changes: n };
      }
      case SQL.deleteSharesForUser: {
        const before = t.shares.length;
        t.shares = t.shares.filter((s) => s.user_id !== a[0]);
        return { results: [], changes: before - t.shares.length };
      }
      case SQL.deleteMessagesForUser:
        return { results: [], changes: 0 };
      // The rest of the account cascade, so DELETE /api/account runs whole.
      case SQL.pageKeysForUser:
      case SQL.deletePagesForUser:
      case SQL.deleteReportsForUser:
      case SQL.clearLoginFailures:
      case SQL.unlinkInvites:
        return { results: [], changes: 0 };
      case SQL.deleteUser: {
        const before = t.users.length;
        t.users = t.users.filter((u) => u.id !== a[0]);
        return { results: [], changes: before - t.users.length };
      }
      case SQL.unlinkSynonyms:
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

const kv = () => ({ get: async () => null, put: async () => {}, delete: async () => {} }) as unknown as KVNamespace;

const A = { id: "u-a", email: "a@example.com", created_at: "2026-01-01T00:00:00Z", settings: '{"learned":{"glukoza":["S_Glukóza"]}}', session_epoch: 0 };
const B = { id: "u-b", email: "b@example.com", created_at: "2026-01-01T00:00:00Z", settings: null, session_epoch: 0 };
const TEXT = "This page holds one person's own blood test results.\n\nglukoza | mmol/l | 4,11–5,6 | 2025-08-13: 6,1 (H)\n";

let tables: Tables;
let env: Env;

const as = async (user: { id: string }) => ({ cookie: `mojekrev_session=${await mintCookieToken(SECRET, user.id, 3600)}` });
const api = async (user: { id: string } | null, method: string, path: string, body?: unknown) =>
  worker.fetch(
    new Request(`https://portal${path}`, {
      method,
      headers: { ...(user ? await as(user) : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }),
    env,
  );
const mint = async (user: { id: string } = A, text = TEXT) => (await (await api(user, "POST", "/api/ai-share", { text })).json()) as { url: string; expiresAt: string };
const page = (url: string, accept?: string) => worker.fetch(new Request(url, accept ? { headers: { accept } } : undefined), env);
const tokenOf = (url: string) => /\/ai\/([^/.]+)$/.exec(url)![1];
/** The text inside the page's <pre>, entities and all. */
const preOf = (html: string) => /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(html)![1];

beforeEach(() => {
  tables = { users: [{ ...A }, { ...B }], shares: [], reports: [], pages: [], invites: [] };
  env = { DB: fakeD1(tables), PAGES: kv(), BUDGET: kv(), EXTRACT: {} as Fetcher, SESSION_SECRET: SECRET, EXTRACT_SESSION_SECRET: "x" };
});

describe("minting", () => {
  it("needs a login, like everything under /api", async () => {
    expect((await api(null, "POST", "/api/ai-share", { text: TEXT })).status).toBe(401);
    expect((await api(null, "GET", "/api/ai-share")).status).toBe(401);
    expect((await api(null, "DELETE", "/api/ai-share")).status).toBe(401);
  });

  it("stores the token's hash and the text, never the token", async () => {
    const { url, expiresAt } = await mint();
    const token = tokenOf(url);
    expect(token).toHaveLength(43);
    expect(url).toBe(`https://portal/ai/${token}`);
    expect(tables.shares).toHaveLength(1);
    expect(tables.shares[0].token_hash).toBe(await sha256Hex(token));
    expect(tables.shares[0].token_hash).not.toContain(token);
    expect(tables.shares[0].snapshot).toBe(TEXT);
    expect(tables.shares[0].user_id).toBe("u-a");
    // 24 hours from now, give or take the test's own clock.
    expect(Math.abs(Date.parse(expiresAt) - Date.now() - 86_400_000)).toBeLessThan(5_000);
  });

  it("refuses an empty, missing or oversized text", async () => {
    expect((await api(A, "POST", "/api/ai-share", { text: "   " })).status).toBe(400);
    expect((await api(A, "POST", "/api/ai-share", {})).status).toBe(400);
    expect((await api(A, "POST", "/api/ai-share", "not json")).status).toBe(400);
    expect((await api(A, "POST", "/api/ai-share", { text: "x".repeat(600 * 1024) })).status).toBe(413);
    expect(tables.shares).toHaveLength(0);
  });

  it("revokes the previous link when a new one is minted", async () => {
    const first = await mint();
    const second = await mint();
    expect((await page(first.url)).status).toBe(404);
    expect((await page(second.url)).status).toBe(200);
    expect(tables.shares.filter((s) => s.revoked_at === null)).toHaveLength(1);
    const live = (await (await api(A, "GET", "/api/ai-share")).json()) as { expiresAt: string };
    expect(live.expiresAt).toBe(second.expiresAt);
  });

  it("replaces the live link's text in place, under the same URL", async () => {
    const { url, expiresAt } = await mint();
    const res = await api(A, "PUT", "/api/ai-share", { text: TEXT + "O mně:\n- Věk: 30–34 let\n" });
    expect(res.status).toBe(200);
    expect(preOf(await (await page(url)).text())).toBe(TEXT + "O mně:\n- Věk: 30–34 let\n");
    expect(tables.shares).toHaveLength(1);
    expect(await (await api(A, "GET", "/api/ai-share")).json()).toEqual({ expiresAt });
    // Someone else's PUT does not reach it.
    expect((await api(B, "PUT", "/api/ai-share", { text: "theirs" })).status).toBe(404);
    expect(preOf(await (await page(url)).text())).not.toBe("theirs");
  });

  it("refuses to update when there is no live link, and refuses the same bad texts as a mint", async () => {
    expect((await api(A, "PUT", "/api/ai-share", { text: TEXT })).status).toBe(404);
    const { url } = await mint();
    tables.shares[0].expires_at = Math.floor(Date.now() / 1000) - 1;
    expect((await api(A, "PUT", "/api/ai-share", { text: TEXT })).status).toBe(404);
    expect((await page(url)).status).toBe(404);
    await mint();
    expect((await api(A, "PUT", "/api/ai-share", { text: "  " })).status).toBe(400);
    expect((await api(A, "PUT", "/api/ai-share", "not json")).status).toBe(400);
    expect((await api(A, "PUT", "/api/ai-share", { text: "x".repeat(600 * 1024) })).status).toBe(413);
    expect((await api(null, "PUT", "/api/ai-share", { text: TEXT })).status).toBe(401);
  });

  it("reports the live link's expiry, or null", async () => {
    expect(await (await api(A, "GET", "/api/ai-share")).json()).toBeNull();
    const { expiresAt } = await mint();
    expect(await (await api(A, "GET", "/api/ai-share")).json()).toEqual({ expiresAt });
    // Someone else's link is not this account's.
    expect(await (await api(B, "GET", "/api/ai-share")).json()).toBeNull();
  });
});

describe("the public page", () => {
  it("answers a live token with a page holding the stored text, uncached and unindexed, without a login", async () => {
    const { url } = await mint();
    const res = await page(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain('<html lang="cs">');
    expect(preOf(html)).toBe(TEXT);
    // Nothing of the text outside the <pre>, and nothing fetched from anywhere.
    expect(html.replace(preOf(html), "")).not.toContain("glukoza");
    expect(html).not.toMatch(/<script|<link|src=|url\(/);
  });

  it("is HTML whatever the fetcher asks for — an assistant that asked for markdown refused what it got", async () => {
    const { url } = await mint();
    for (const accept of ["text/markdown", "text/plain", "text/markdown, text/html;q=0.9", "text/html,application/xhtml+xml,*/*;q=0.8", "*/*"]) {
      const res = await page(url, accept);
      expect(res.status, accept).toBe(200);
      expect(res.headers.get("content-type"), accept).toBe("text/html; charset=utf-8");
      expect(preOf(await res.text()), accept).toBe(TEXT);
    }
  });

  it("escapes the text in the page, so a value like <0,5 survives", async () => {
    const hostile = "crp | mg/l | <0,5 & >10 | 2025-08-13: <0,5\n<script>alert(1)</script>\n";
    const { url } = await mint(A, hostile);
    const html = await (await page(url)).text();
    expect(html).not.toContain("<script>");
    expect(preOf(html)).toBe("crp | mg/l | &lt;0,5 &amp; &gt;10 | 2025-08-13: &lt;0,5\n&lt;script&gt;alert(1)&lt;/script&gt;\n");
  });

  it("redirects the .md shape of a link to the bare address, so no fetcher sees a file-looking URL", async () => {
    const { url } = await mint();
    const token = tokenOf(url);
    const res = await page(`${url}.md`);
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/ai/${token}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    // The redirect says nothing about the token: a dead one redirects the same way, and 404s after.
    await api(A, "DELETE", "/api/ai-share");
    expect((await page(`${url}.md`)).status).toBe(301);
    expect((await page(url)).status).toBe(404);
  });

  it("carries neither the e-mail nor any word from the users table", async () => {
    const { url } = await mint();
    const body = await (await page(url)).text();
    for (const u of tables.users) {
      expect(body).not.toContain(u.email);
      expect(body).not.toContain(u.id);
      expect(body).not.toContain(u.created_at);
      if (u.settings) expect(body).not.toContain(u.settings);
    }
    expect(body).not.toContain("@");
  });

  it("says the same 404 for expired, revoked, unknown and malformed tokens", async () => {
    const { url } = await mint();
    const token = tokenOf(url);
    const refusals: Response[] = [];

    // Unknown: a well-formed token nobody minted.
    refusals.push(await page(`https://portal/ai/${"A".repeat(43)}`));
    // Malformed: wrong length, wrong alphabet, another extension, empty.
    refusals.push(await page(`https://portal/ai/${token.slice(1)}`));
    refusals.push(await page(`https://portal/ai/${token}x`));
    refusals.push(await page(`https://portal/ai/${token.slice(0, 42)}$`));
    refusals.push(await page(`https://portal/ai/${token}.txt`));
    refusals.push(await page(`https://portal/ai/${token}.md.md`));
    refusals.push(await page(`https://portal/ai/`));
    refusals.push(await page(`https://portal/ai/${token}/extra`));
    // Revoked, whatever is asked for.
    await api(A, "DELETE", "/api/ai-share");
    refusals.push(await page(url));
    refusals.push(await page(url, "text/markdown"));
    // Expired: the row's clock, not the test's.
    const { url: url2 } = await mint();
    tables.shares.find((s) => s.revoked_at === null)!.expires_at = Math.floor(Date.now() / 1000) - 1;
    refusals.push(await page(url2));
    refusals.push(await page(url2, "text/markdown"));
    // Not a GET.
    refusals.push(await worker.fetch(new Request(url2, { method: "POST" }), env));

    const bodies = new Set<string>();
    for (const r of refusals) {
      expect(r.status).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
      expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      bodies.add(await r.text());
    }
    expect(bodies.size).toBe(1);
  });

  it("stays live after a revoke of somebody else's", async () => {
    const { url } = await mint(A);
    await mint(B);
    await api(B, "DELETE", "/api/ai-share");
    expect((await page(url)).status).toBe(200);
  });
});

describe("account deletion", () => {
  it("deletes the share with the account, and the page is gone", async () => {
    const { url } = await mint();
    expect((await api(A, "DELETE", "/api/account")).status).toBe(200);
    expect(tables.shares).toHaveLength(0);
    expect((await page(url)).status).toBe(404);
  });
});
