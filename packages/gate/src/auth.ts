/**
 * Turnstile verification and short-lived session tokens.
 *
 * A Turnstile token is single-use, but extracting a report fires one request
 * per page — so one successful challenge mints an HMAC-signed session token
 * covering a bounded number of pages for a bounded time. The visitor solves
 * one challenge, not one per page.
 */

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export interface SessionClaims {
  /** Expiry, epoch seconds. */
  exp: number;
  /** Maximum pages this session may extract. */
  pages: number;
  /** Random id, so sessions are distinguishable in logs. */
  sid: string;
}

export async function mintSession(secret: string, ttlSeconds: number, pages: number): Promise<string> {
  const claims: SessionClaims = {
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    pages,
    sid: crypto.randomUUID(),
  };
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(secret: string, token: string | null): Promise<SessionClaims | null> {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".", 2);
  let ok: boolean;
  try {
    const sigBytes = b64urlDecode(sig) as unknown as BufferSource;
    ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), sigBytes, enc.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as SessionClaims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Server-side Turnstile check. Never trust the widget's client-side result.
 *
 * `success` alone is not enough, and the gap is not theoretical here. A widget
 * registers several domains — this one has the production hostname *and*
 * localhost — and a token is valid for the widget, not for the page. So a
 * challenge solved against localhost produced a token production accepted.
 * Anyone who could run the app locally could mint production sessions.
 *
 * Cloudflare's canonical check is therefore three things, and all three matter:
 *
 *   success   the challenge was solved
 *   hostname  ...on a page we actually serve, not merely one on the widget
 *   action    ...at the surface that asked for it, not replayed from another
 *
 * Fails closed everywhere: a network error, a non-2xx, an unparseable body, or
 * an empty hostname allowlist all return false. An allowlist that is missing is
 * a misconfiguration, and treating it as "allow everything" is how a guard
 * quietly stops guarding.
 */
export interface TurnstileExpectations {
  /** Hostnames this deployment serves. Never include localhost in production. */
  hostnames: string[];
  /** The surface that requested the challenge, matched against `data-action`. */
  action: string;
}

interface SiteverifyResult {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  expect: TurnstileExpectations,
): Promise<boolean> {
  // A token is a bounded opaque string; anything else is not worth a round trip.
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  const allowed = new Set(expect.hostnames.map((h) => h.trim()).filter(Boolean));
  if (allowed.size === 0) return false;

  let data: SiteverifyResult;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // Without this, a hung siteverify hangs the request that is waiting on it.
      signal: AbortSignal.timeout(10_000),
      body,
    });
    if (!res.ok) return false;
    data = (await res.json()) as SiteverifyResult;
  } catch {
    return false;
  }

  if (data.success !== true) return false;
  if (typeof data.hostname !== "string" || !allowed.has(data.hostname)) return false;
  if (data.action !== expect.action) return false;
  return true;
}
