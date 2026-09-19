/**
 * The shop: two packages of documents, sold through Stripe Checkout.
 *
 * No SDK. Stripe's API is form-encoded HTTP and its webhook signature is an
 * HMAC, and both are a few lines over `fetch` and WebCrypto — the Workers
 * bundle stays small and the code stays readable in one screen. Nothing here
 * runs until four secrets are set (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
 * `STRIPE_PRICE_5`, `STRIPE_PRICE_15`); without them `POST /api/buy` says the
 * shop is closed and the webhook refuses everything, so a deployment with no
 * Stripe account behaves exactly as if this file did not exist.
 *
 * The flow: the browser asks for a package, this mints a Checkout Session
 * whose `client_reference_id` is the account's id and answers its URL; the
 * person pays on Stripe's page (card, Apple Pay, Google Pay — Checkout's
 * business) and comes back to the app with `?koupeno=1`; Stripe separately
 * posts `checkout.session.completed` here, the signature is checked, the
 * event is written once (its id is the primary key of `purchases`) and the
 * account is credited. The return URL proves nothing and credits nothing —
 * only the signed event does.
 */
import { SQL, type UserRow } from "./db";
import { creditDocuments, readAllowance } from "./allowance";

export interface StripeEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Stripe price ids (`price_…`) of the two packages, in CZK. */
  STRIPE_PRICE_5?: string;
  STRIPE_PRICE_15?: string;
}

/** What is for sale. The Stripe prices must say the same numbers. */
export const PACKAGES = {
  "5": { documents: 5, czk: 49 },
  "15": { documents: 15, czk: 99 },
} as const;
export type PackageId = keyof typeof PACKAGES;

export const isPackage = (s: unknown): s is PackageId => s === "5" || s === "15";

export const shopOpen = (env: StripeEnv): boolean =>
  !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_5 && env.STRIPE_PRICE_15);

/** How far a webhook's timestamp may sit from now: Stripe's own default. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------- checkout */

/**
 * A Checkout Session for one package, on the person's behalf.
 *
 * Only what Stripe needs to sell and to tell us who bought: the price, the
 * account id (twice — `client_reference_id` is what the completed event
 * carries back, `metadata.package` is the one fact the price id would
 * otherwise have to be looked up for), and where to come back. The account's
 * e-mail is not sent: Stripe asks for one on its page, and what the person
 * types there is theirs to give.
 */
export async function createCheckout(
  env: StripeEnv,
  pkg: PackageId,
  uid: string,
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string } | { error: string }> {
  const price = pkg === "5" ? env.STRIPE_PRICE_5 : env.STRIPE_PRICE_15;
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": price ?? "",
    "line_items[0][quantity]": "1",
    client_reference_id: uid,
    "metadata[package]": pkg,
    "metadata[user_id]": uid,
    success_url: `${origin}/?koupeno=1`,
    cancel_url: `${origin}/`,
  });
  const res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: { type?: string; code?: string } };
  if (!res.ok || typeof data.url !== "string") {
    // Stripe's error text can carry the price id or the request; the type
    // and code are enough to find it in the dashboard, and ours to log.
    console.error(`stripe checkout refused: ${res.status} ${data.error?.type ?? ""} ${data.error?.code ?? ""}`.trim());
    return { error: "stripe_refused" };
  }
  return { url: data.url };
}

export const shopClosed = () => json({ error: "shop_closed", message: "Obchod zatím není otevřený." }, 503);

/** `POST /api/buy {package}` — the sheet redirects to the URL this answers. */
export async function handleBuy(request: Request, env: StripeEnv, user: UserRow, demo: boolean): Promise<Response> {
  if (!shopOpen(env)) return shopClosed();
  // A demo visitor is a stranger on the owner's account: their money must
  // not land in it, and Stripe would attribute the purchase to the owner.
  if (demo) return json({ error: "demo_readonly", message: "V demu nelze nakupovat." }, 403);
  const body = (await request.json().catch(() => null)) as { package?: unknown } | null;
  if (!isPackage(body?.package)) return json({ error: "bad_request", message: "Neznámý balíček." }, 400);
  const made = await createCheckout(env, body.package, user.id, new URL(request.url).origin);
  if ("error" in made) return json({ error: made.error, message: "Platbu se nepodařilo zahájit. Zkuste to prosím znovu." }, 502);
  return json({ url: made.url });
}

/* -------------------------------------------------------------- webhook */

const enc = new TextEncoder();

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same length, every byte compared — a mismatch takes as long as a match. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Stripe's signature scheme: the header is `t=<unix seconds>,v1=<hex>[,v1=…]`,
 * and each v1 is HMAC-SHA256 of `${t}.${raw body}` under the endpoint
 * secret. Any one v1 matching is a match — Stripe sends several while a
 * secret is being rolled. The timestamp must sit within the tolerance of
 * now, or a captured delivery could be replayed for as long as the secret
 * lives.
 */
export async function verifyStripeSignature(
  secret: string,
  header: string | null,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!header) return false;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") t = /^\d+$/.test(v) ? parseInt(v, 10) : null;
    else if (k === "v1" && /^[0-9a-f]+$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t === null || v1.length === 0) return false;
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = await hmacHex(secret, `${t}.${body}`);
  return v1.some((s) => sameHex(s, expected));
}

interface StripeEvent {
  id?: unknown;
  type?: unknown;
  data?: { object?: CheckoutSession };
}

interface CheckoutSession {
  client_reference_id?: unknown;
  metadata?: { package?: unknown; user_id?: unknown };
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
}

/**
 * What a completed, paid session says about who bought what — or null when
 * the event is not that. `payment_status` is checked because Checkout can
 * complete with a delayed method still unpaid; the paid confirmation then
 * arrives as `checkout.session.async_payment_succeeded`, which is read the
 * same way, so a bank transfer credits when the money lands and not before.
 */
export function purchaseOf(event: StripeEvent): { eventId: string; uid: string; pkg: PackageId; amountCzk: number } | null {
  if (typeof event.id !== "string" || !event.id) return null;
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
  const s = event.data?.object;
  if (!s || s.payment_status !== "paid") return null;
  const uid = typeof s.client_reference_id === "string" ? s.client_reference_id : s.metadata?.user_id;
  const pkg = s.metadata?.package;
  if (typeof uid !== "string" || !uid || !isPackage(pkg)) return null;
  // Stripe reports minor units; CZK has two, so 4900 is 49 Kč.
  const amountCzk = typeof s.amount_total === "number" ? Math.round(s.amount_total / 100) : PACKAGES[pkg].czk;
  return { eventId: event.id, uid, pkg, amountCzk };
}

/**
 * `POST /api/stripe/webhook`. Public — Stripe is not logged in — and guarded
 * by the signature alone. A bad or stale signature is a 400 and nothing is
 * read from the body; a good one whose event is not a paid checkout is a
 * 200 and ignored, so Stripe does not keep retrying events we do not want.
 * An event already written credits nothing the second time.
 */
export async function handleStripeWebhook(request: Request, env: StripeEnv & { DB: D1Database }): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: "shop_closed" }, 503);
  const body = await request.text();
  if (!(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get("stripe-signature"), body))) {
    return json({ error: "bad_signature" }, 400);
  }
  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const bought = purchaseOf(event);
  if (!bought) return json({ received: true, ignored: true });

  // The insert is the idempotency check: OR IGNORE on the event id, and only
  // the call that wrote the row credits. Between the two statements there is
  // no transaction; a worker dying exactly there leaves a purchases row that
  // was never credited, which the table shows and the operator's
  // --documents repairs. Credit-then-write would risk crediting twice on
  // Stripe's retry, and that is the worse failure.
  const wrote = await env.DB.prepare(SQL.insertPurchase)
    .bind(bought.eventId, bought.uid, bought.pkg, bought.amountCzk, nowIso())
    .run();
  if (!wrote.meta || wrote.meta.changes !== 1) return json({ received: true, duplicate: true });
  const credited = await creditDocuments(env.DB, bought.uid, PACKAGES[bought.pkg].documents);
  // An account deleted between paying and this delivery: the payment is on
  // record, nobody to credit. 200, or Stripe retries forever.
  if (!credited) console.error(`stripe: paid event ${bought.eventId} names no account`);
  return json({ received: true, credited, allowance: credited ? await readAllowance(env.DB, bought.uid) : null });
}
