/**
 * The login cookie: an HMAC-signed {uid, exp}, verified statelessly.
 *
 * Deliberately not @bw/gate's mintSession. That token is a Turnstile page
 * allowance — its claims are {pages, sid}, its TTL is minutes, and widening it
 * to carry a user id would hand every demo deployment a shape it must never
 * accept. Same construction, different claims, different secret.
 *
 * Stateless costs one thing: a cookie cannot be revoked server-side. The
 * balancing check is in requireUser — the uid is looked up on every request,
 * so a deleted account's cookies die with the row.
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

export interface CookieClaims {
  /** The user row's id. */
  uid: string;
  /** Expiry, epoch seconds. */
  exp: number;
}

export async function mintCookieToken(secret: string, uid: string, ttlSeconds: number): Promise<string> {
  const claims: CookieClaims = { uid, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

/** Denies on every malformed path — a broken cookie is an absent one. */
export async function verifyCookieToken(secret: string, token: string | null): Promise<CookieClaims | null> {
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
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as CookieClaims;
    if (typeof claims.uid !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export const COOKIE_NAME = "kapka_session";

export function readCookie(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=") || null;
  }
  return null;
}

/**
 * HttpOnly keeps it from scripts; Secure is fine even for wrangler dev, which
 * browsers exempt on localhost; SameSite=Lax means a cross-site POST arrives
 * without it, which is the CSRF posture for every state-changing route.
 */
export function setCookieHeader(token: string, maxAgeSeconds: number): string {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/** Random 256-bit token for a magic link; only its hash is stored. */
export function newLoginToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64urlEncode(bytes);
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
