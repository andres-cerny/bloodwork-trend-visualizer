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

/** Server-side Turnstile check. Never trust the widget's client-side result. */
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (remoteIp) body.append("remoteip", remoteIp);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
