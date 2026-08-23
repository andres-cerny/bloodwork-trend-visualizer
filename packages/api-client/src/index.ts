/**
 * Talking to the API worker from a browser.
 *
 * Holds the session token minted from one Turnstile pass, and nothing else —
 * no lab knowledge. Both apps use it, and the chat app must be able to without
 * learning what an analyte is.
 */

export interface Budget {
  spentUsd: number;
  budgetUsd: number;
  frozen: boolean;
  remainingUsd: number;
}

let sessionToken: string | null = null;
export const setSession = (t: string | null) => (sessionToken = t);
export const hasSession = () => sessionToken !== null;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (sessionToken) h["x-demo-session"] = sessionToken;
  return h;
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly budget?: Budget) {
    super(message);
  }
}

/**
 * Errors where retrying anything else is pointless: the session is gone, the
 * spend ceiling is reached, or the page allowance is spent. Every remaining
 * page of every remaining document would fail in exactly the same way.
 *
 * `page_limit` belongs here and was missing, which mattered little while
 * uploads were one document at a time and matters a lot with a queue: a batch
 * of five reports reaches the twelve-page allowance routinely, and without
 * this each remaining page retried and failed identically. A wall of identical
 * errors reads as a broken app; "the allowance is spent" reads as a limit.
 *
 * Anything else — a page that would not parse, a transient 5xx — is local to
 * the page it happened on and must not sink the document, let alone the batch.
 */
const FATAL_CODES = new Set(["budget_exhausted", "session_invalid", "page_limit"]);

export const isFatalApiError = (e: unknown): boolean =>
  e instanceof ApiError && FATAL_CODES.has(e.code);

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ApiError(data.message ?? `Chyba ${res.status}`, data.error ?? "unknown", data.budget);
  return data as T;
}

export async function getStatus(): Promise<{ budget: Budget; maxPages: number; crossCheck: boolean }> {
  const res = await fetch("/api/status");
  if (!res.ok) throw new Error("status unavailable");
  return res.json();
}

export async function startSession(turnstileToken: string): Promise<void> {
  const { session } = await post<{ session: string }>("/api/session", { turnstileToken });
  setSession(session);
}

/**
 * Extract one page. Pass `rowsText` for a digital PDF (no image leaves the
 * browser at all); pass the image only when the page is a scan.
 */
export async function extract(
  imageBase64: string | null,
  mediaType: string | null,
  textLayer: string | null,
  rowsText: string | null,
) {
  return post<{ reads: any[]; mode: "text" | "vision"; costUsd: number; budget: Budget }>(
    "/api/extract",
    { imageBase64, mediaType, textLayer, rowsText },
  );
}

export async function askChat(dataContext: string, history: Array<{ role: "user" | "assistant"; content: string }>) {
  return post<{ text: string; costUsd: number; budget: Budget }>("/api/chat", { dataContext, history });
}
