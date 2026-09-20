/**
 * What the server said no to, kept for thirty days.
 *
 * A help-desk message is usually „nahrávání nefunguje" and nothing more. The
 * events table is what makes that answerable: every 4xx and 5xx the worker
 * answered, and every upload the extractor turned down, as a route, a status
 * and the body's error code — keyed to the account by a hash, never by the
 * e-mail. Read newest-first beside the message (src/triage.ts), pruned by the
 * scheduled check (src/watch.ts).
 *
 * The rows carry no data of the person's: no value, no page, no printed name,
 * no query string, no id from the URL — a report id in the path is replaced
 * by `:id` before the route is written. What is left says which door
 * refused, when, and how often; that is the whole point.
 */
import { SQL } from "./db";
import { sha256Hex } from "./session";

export interface EventEnv {
  DB: D1Database;
}

/** How long a row is kept. The check that prunes runs every 15 minutes. */
export const EVENT_RETENTION_SECONDS = 30 * 86400;

/**
 * The first 12 hex of SHA-256(user id). Enough to group one account's rows
 * (a 48-bit prefix does not collide in a table this size) and useless for
 * anything else: the id is a random UUID, so the hash leads nowhere.
 */
export async function userHash(uid: string): Promise<string> {
  return (await sha256Hex(uid)).slice(0, 12);
}

/** Path segments that are ids, replaced so the table never holds one. */
const ID_ROUTES: Array<[RegExp, string]> = [
  [/^\/api\/(reports|pages)\/[^/]+\/\d+$/, "/api/$1/:id/:n"],
  [/^\/api\/(reports|documents)\/[^/]+$/, "/api/$1/:id"],
  [/^\/api\/auth\/invite\/[^/]+$/, "/api/auth/invite/:id"],
  [/^\/ai\/.+$/, "/ai/:token"],
];

/** "POST /api/extract", ids and query strings stripped. */
export function routeLabel(method: string, pathname: string): string {
  let path = pathname;
  for (const [re, to] of ID_ROUTES) {
    if (re.test(path)) {
      path = path.replace(re, to);
      break;
    }
  }
  return `${method} ${path}`.slice(0, 80);
}

export interface EventInput {
  route: string;
  status: number;
  /** The JSON body's `error`, when the answer had one. */
  code?: string | null;
  /** The account, or null for a request without a session. */
  uid?: string | null;
  requestId?: string | null;
}

/**
 * Write one row. Never throws — an events insert that fails must not turn a
 * 402 the person can act on into a 500 they cannot; the failure is logged.
 */
export async function recordEvent(env: EventEnv, e: EventInput): Promise<void> {
  try {
    await env.DB.prepare(SQL.insertEvent)
      .bind(
        crypto.randomUUID(),
        Math.floor(Date.now() / 1000),
        e.route.slice(0, 80),
        e.status,
        e.code ? String(e.code).slice(0, 40) : null,
        e.uid ? await userHash(e.uid) : null,
        e.requestId ? String(e.requestId).slice(0, 40) : null,
      )
      .run();
  } catch (err) {
    console.error(`event not recorded: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
  }
}

/**
 * Read the `error` code out of a refusal's body without consuming it. Every
 * refusal this worker answers is built by its `json()` and is small; a body
 * that is not JSON, or has no `error`, is a null code and still a row.
 */
export async function errorCodeOf(res: Response): Promise<string | null> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    const data = (await res.clone().json()) as { error?: unknown };
    return typeof data.error === "string" ? data.error : null;
  } catch {
    return null;
  }
}

/** Rows older than the retention window go. Returns how many. */
export async function pruneEvents(env: EventEnv, now = Math.floor(Date.now() / 1000)): Promise<number> {
  const r = await env.DB.prepare(SQL.pruneEvents).bind(now - EVENT_RETENTION_SECONDS).run();
  return r.meta?.changes ?? 0;
}
