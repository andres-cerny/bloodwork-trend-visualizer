/**
 * How many mails one address may ask for: five an hour, twenty a day, per IP.
 *
 * A mail is the one thing a stranger can make this worker do to a third
 * party — fill their inbox with links they did not ask for — and the one
 * thing that costs the operator per request. So the ceiling is on the
 * asker, not the address asked for: an address is what a stranger types,
 * an IP is what they have. Both limits are Ondřej's numbers
 * (docs/plans/multi-user.md, Goal 6).
 *
 * D1, not KV. KV is eventually consistent, so five requests in the same
 * second would each read "4" and all pass — a limit that fails under the
 * exact load it exists for. The table follows login_failures: one row per
 * request, counted over the window, pruned as it ages out. The IP is stored
 * as a salted hash; the table is a counter, not a log of who came.
 */
import { SQL } from "./db";
import { sha256Hex } from "./session";

export const HOUR_LIMIT = 5;
export const DAY_LIMIT = 20;
const HOUR = 3600;
const DAY = 24 * HOUR;

export interface RateLimitEnv {
  DB: D1Database;
  /** The hash's salt, so the table cannot be walked back to addresses. */
  SESSION_SECRET: string;
}

/** Which window is full, or null when the asker may go on. */
export type Over = "hour" | "day" | null;

/**
 * The asker's address as the shell forwards it. Absent — `wrangler dev`
 * without the shell, a test that did not set it — every request shares one
 * bucket, which is the safe direction to be wrong in.
 */
const ipOf = (request: Request) => request.headers.get("cf-connecting-ip")?.trim() || "unknown";

export async function ipHash(env: RateLimitEnv, request: Request): Promise<string> {
  return sha256Hex(`${env.SESSION_SECRET}:${ipOf(request)}`);
}

/** Read before the work: a full window refuses without minting or mailing. */
export async function overLimit(env: RateLimitEnv, hash: string, now: number): Promise<Over> {
  const day = await env.DB.prepare(SQL.countSignupAttempts).bind(hash, now - DAY).first<{ n: number }>();
  if ((day?.n ?? 0) >= DAY_LIMIT) return "day";
  const hour = await env.DB.prepare(SQL.countSignupAttempts).bind(hash, now - HOUR).first<{ n: number }>();
  if ((hour?.n ?? 0) >= HOUR_LIMIT) return "hour";
  return null;
}

/** Count this request, and let the day's leftovers go. */
export async function recordAttempt(env: RateLimitEnv, hash: string, now: number): Promise<void> {
  await env.DB.prepare(SQL.insertSignupAttempt).bind(hash, now).run();
  await env.DB.prepare(SQL.pruneSignupAttempts).bind(now - DAY).run();
}

/** The refusal, in Czech, saying when to come back. */
export const tooMany = (over: Exclude<Over, null>) =>
  over === "day"
    ? "Příliš mnoho žádostí o odkaz z této adresy. Zkuste to znovu zítra."
    : "Příliš mnoho žádostí o odkaz z této adresy. Zkuste to znovu za hodinu.";
