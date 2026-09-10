/**
 * Password hashing: PBKDF2-SHA256 through Web Crypto, which is what a Worker
 * has. No bcrypt, no argon2 — neither exists in the runtime without WASM,
 * and a dependency that ships a hash function is a dependency to audit.
 *
 * Every row carries its own 16-byte salt and the iteration count it was
 * hashed with, so PBKDF2_ITERATIONS can rise later and old rows keep
 * verifying at their own count until the person next sets a password.
 *
 * The count is the free plan's problem, not the algorithm's: a Worker gets
 * 10 ms of CPU per request and one PBKDF2 run is the request's whole cost.
 * Measured locally (Node 22, Apple silicon, OpenSSL): 100 000 iterations =
 * 8.3 ms, 50 000 = 4.1 ms. Cloudflare's cores are not faster, so 50 000 is
 * the count that leaves room for the D1 round-trips and JSON around it. The
 * deployed worker's own timing decides whether it goes up
 * (docs/plans/moje-krev-login.md records the measurement).
 */

export const PBKDF2_ITERATIONS = 50_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export interface PasswordRecord {
  /** Hex, 32 bytes. */
  hash: string;
  /** Hex, 16 bytes. */
  salt: string;
  iters: number;
}

const enc = new TextEncoder();

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: Uint8Array, iters: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations: iters },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iters = PBKDF2_ITERATIONS): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return { hash: toHex(await derive(password, salt, iters)), salt: toHex(salt), iters };
}

/** Constant-time over the digest; a malformed record verifies nothing. */
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(record.hash) || !/^[0-9a-f]{32}$/.test(record.salt)) return false;
  if (!Number.isInteger(record.iters) || record.iters < 1) return false;
  const expected = fromHex(record.hash);
  const actual = await derive(password, fromHex(record.salt), record.iters);
  let diff = expected.length ^ actual.length;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}

/**
 * What an unknown e-mail is verified against, so that the login route spends
 * the same time whether or not the account exists. Never matches: the caller
 * still refuses, this only keeps the clock honest.
 */
export const DUMMY_RECORD: PasswordRecord = {
  hash: "0".repeat(64),
  salt: "0".repeat(32),
  iters: PBKDF2_ITERATIONS,
};
