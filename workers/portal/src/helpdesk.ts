/**
 * „Napište nám": a message in, a row in D1, a line in Telegram.
 *
 * Anyone may write — a logged-in person under their login's address, a
 * stranger under one they type and a Turnstile they solve. The message is
 * stored whole (`messages`), and when the bot is configured its first lines
 * go to Ondřej's help-desk chat with a one-line `wrangler d1 execute` to read
 * the rest, followed — when the `AI` binding is there — by a model's guess at
 * the cause, marked as a guess (src/triage.ts). The answer is his, by e-mail,
 * by hand; tools/scripts/moje-krev-helpdesk.mjs lists what is open and marks
 * what is answered.
 *
 * The response is the same whether or not anything was posted: a person is
 * told their message arrived because it did — it is in the database — not
 * because a third party accepted a copy.
 */
import { verifyTurnstile } from "@bw/gate";
import { SQL, type UserRow } from "./db";
import { userHash } from "./events";
import { sha256Hex } from "./session";
import { notify, type TelegramEnv } from "./telegram";
import { triage, formatTriage, type ExtractorState, type TriageEnv } from "./triage";

export interface HelpdeskEnv extends TelegramEnv, TriageEnv {
  DB: D1Database;
  /** The rate-limit counters live here, beside the other short-lived counters. */
  BUDGET: KVNamespace;
  EXTRACT: Fetcher;
  TELEGRAM_HELPDESK_CHAT?: string;
  /** Set, and a logged-out message must carry a solved Turnstile. */
  TURNSTILE_SECRET_KEY?: string;
  /** Comma-separated hostnames the widget may be solved on; unset refuses. */
  TURNSTILE_HOSTNAMES?: string;
}

/** What one message may hold. Long enough for a story, short enough to read. */
export const MAX_MESSAGE_CHARS = 4000;
/** Per e-mail and per IP, in a sliding hour. */
export const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 3600;
/** How much of the text the Telegram line carries; the rest is read from D1. */
const PREVIEW_CHARS = 500;
/** The widget's `data-action`; the token must have been minted for this surface. */
export const TURNSTILE_ACTION_HELPDESK = "helpdesk";

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const looksLikeEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * One counter per key, expiring with the window. Approximate under KV's
 * consistency, which is fine: this stops a script, not a person who writes
 * twice.
 */
async function overLimit(kv: KVNamespace, key: string): Promise<boolean> {
  const k = `helpdesk_rl_${key}`;
  const n = parseInt((await kv.get(k)) ?? "0", 10) || 0;
  if (n >= RATE_LIMIT) return true;
  await kv.put(k, String(n + 1), { expirationTtl: RATE_WINDOW_SECONDS });
  return false;
}

/** The extractor's status and two numbers, for the triage; null when it will not say. */
async function extractorState(env: HelpdeskEnv): Promise<ExtractorState | null> {
  const res = await env.EXTRACT.fetch(new Request("https://extract/api/status")).catch(() => null);
  if (!res) return { status: null, spentUsd: null, budgetUsd: null, frozen: null };
  const data = (await res.json().catch(() => ({}))) as { budget?: { spentUsd?: number; budgetUsd?: number; frozen?: boolean } };
  return {
    status: res.status,
    spentUsd: typeof data.budget?.spentUsd === "number" ? data.budget.spentUsd : null,
    budgetUsd: typeof data.budget?.budgetUsd === "number" ? data.budget.budgetUsd : null,
    frozen: typeof data.budget?.frozen === "boolean" ? data.budget.frozen : null,
  };
}

/** The first Telegram message: who, which report, the first lines, how to read the rest. */
export function helpdeskNotice(m: { id: string; email: string; text: string; reportId: string | null; loggedIn: boolean }): string {
  const preview = m.text.length > PREVIEW_CHARS ? `${m.text.slice(0, PREVIEW_CHARS)}…` : m.text;
  return [
    "Moje krev — nová zpráva",
    `Od: ${m.email} (${m.loggedIn ? "přihlášený" : "nepřihlášený"})`,
    `Report: ${m.reportId ?? "—"}`,
    "———",
    preview,
    "———",
    `Celý text: cd workers/portal && npx wrangler d1 execute moje-krev --remote --command "SELECT text FROM messages WHERE id = '${m.id}'"`,
    `Po odpovědi: node tools/scripts/moje-krev-helpdesk.mjs --answered ${m.id} --apply`,
  ].join("\n");
}

/**
 * POST /api/helpdesk { email?, text, reportId?, turnstileToken? }.
 *
 * `user` is the session's account or null. `ctx` is the request's execution
 * context when the caller has one: the Telegram post and the triage then run
 * after the 200 is sent, so a slow model never holds the person's screen.
 */
export async function handleHelpdesk(request: Request, env: HelpdeskEnv, user: UserRow | null, ctx?: ExecutionContext): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; text?: unknown; reportId?: unknown; turnstileToken?: unknown }
    | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "bad_request", message: "Napište prosím, co se stalo." }, 400);
  if (text.length > MAX_MESSAGE_CHARS) {
    return json({ error: "too_long", message: `Zpráva je příliš dlouhá — nejvýše ${MAX_MESSAGE_CHARS.toLocaleString("cs-CZ")} znaků.` }, 413);
  }
  // The login's address wins over anything typed: a logged-in person cannot
  // write under someone else's name, and the field on the page is read-only.
  const typed = typeof body?.email === "string" ? body.email.trim() : undefined;
  const email = user ? user.email : looksLikeEmail(typed) ? typed.toLowerCase() : null;
  if (!email) return json({ error: "bad_request", message: "Vyplňte platný e-mail, na který máme odpovědět." }, 400);
  const reportId = typeof body?.reportId === "string" && REPORT_ID.test(body.reportId.trim()) ? body.reportId.trim() : null;

  const ip = request.headers.get("cf-connecting-ip");
  if (!user && env.TURNSTILE_SECRET_KEY) {
    const token = body?.turnstileToken;
    if (typeof token !== "string" || !token) return json({ error: "turnstile_required", message: "Potvrďte prosím, že nejste robot." }, 400);
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip, {
      hostnames: (env.TURNSTILE_HOSTNAMES ?? "").split(","),
      action: TURNSTILE_ACTION_HELPDESK,
    });
    if (!ok) return json({ error: "turnstile_failed", message: "Ověření se nezdařilo. Načtěte stránku a zkuste to znovu." }, 400);
  }

  const keys = [await sha256Hex(email), ...(ip ? [`ip_${await sha256Hex(ip)}`] : [])];
  for (const k of keys) {
    if (await overLimit(env.BUDGET, k)) {
      return json({ error: "rate_limited", message: "Za poslední hodinu přišlo příliš mnoho zpráv. Zkuste to prosím později." }, 429);
    }
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(SQL.insertMessage)
    .bind(id, new Date().toISOString(), user?.id ?? null, email, text, reportId, (request.headers.get("user-agent") ?? "").slice(0, 200) || null)
    .run();

  const tell = async () => {
    await notify(env, env.TELEGRAM_HELPDESK_CHAT, helpdeskNotice({ id, email, text, reportId, loggedIn: !!user }));
    const guess = await triage(env, {
      kind: "helpdesk",
      text,
      userHash: user ? await userHash(user.id) : null,
      reportId,
      extractor: await extractorState(env),
    });
    if (guess) await notify(env, env.TELEGRAM_HELPDESK_CHAT, formatTriage(guess));
  };
  if (ctx) ctx.waitUntil(tell());
  else await tell();
  return json({ ok: true });
}
