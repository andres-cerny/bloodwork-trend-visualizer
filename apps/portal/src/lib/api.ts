/**
 * Talking to the portal worker. Cookie-authenticated, so there is no token
 * to hold; the one thing worth knowing here is which errors end an upload.
 */
import type { LabReport } from "@bw/lab-core";

export interface Budget {
  spentUsd: number;
  budgetUsd: number;
  frozen: boolean;
  remainingUsd: number;
  month: string;
}

export interface Settings {
  /** canonicalId → raw names the reader mapped to it, in acceptance order. */
  learned?: Record<string, string[]>;
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly budget?: Budget) {
    super(message);
  }
}

/** Errors after which every remaining page would fail the same way. */
const FATAL = new Set(["budget_exhausted", "unauthorized"]);
export const isFatalApiError = (e: unknown): boolean => e instanceof ApiError && FATAL.has(e.code);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; budget?: Budget };
  if (!res.ok) throw new ApiError(data.message ?? `Chyba ${res.status}`, data.error ?? "unknown", res.status, data.budget);
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Which form a link opens. A dead link is an ApiError with status 404. */
export const checkInvite = (code: string) =>
  request<{ kind: "signup" | "password" }>(`/api/auth/invite/${encodeURIComponent(code)}`);

/** Each of the three mints the session cookie on success; the caller then
 *  reads /api/me, which is the only thing that says who is logged in. */
export const register = (code: string, email: string, password: string) =>
  request<{ ok: true }>("/api/auth/register", jsonInit("POST", { code, email, password }));
export const login = (email: string, password: string) =>
  request<{ ok: true }>("/api/auth/login", jsonInit("POST", { email, password }));
export const setPassword = (code: string, password: string) =>
  request<{ ok: true }>("/api/auth/password", jsonInit("POST", { code, password }));

export const getStatus = () => request<{ budget: Budget; maxPages: number }>("/api/status");

/** A row as the reader wrote it, before its page is finished. Provisional. */
export interface ProvisionalRow {
  raw_analyte_name?: string;
  value_raw?: string;
  unit_raw?: string;
  row_index?: number;
}

export interface ExtractResult {
  reads: any[];
  mode: "text" | "vision";
  costUsd: number;
  budget: Budget;
}

/**
 * One page to the extractor: the printed rows of a digital page, or the
 * painted image of a scan. Never both, and never an image of a page that has
 * rows — the text path is what keeps the pixels at home.
 *
 * With `onRow` the page is asked for as a stream: one JSON object per line,
 * rows as each reader writes them, then a final line that is the whole
 * answer. Only that last line is returned — the rows before it are for the
 * screen. A worker that does not stream yet answers with plain JSON, which
 * is read the old way, so the two can be deployed in either order.
 */
export async function extractPage(
  page: { rowsText: string } | { imageBase64: string; mediaType: string },
  onRow?: (row: ProvisionalRow, model: string) => void,
): Promise<ExtractResult> {
  if (!onRow) return request<ExtractResult>("/api/extract", jsonInit("POST", page));

  const res = await fetch("/api/extract", jsonInit("POST", { ...page, stream: true }));
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.includes("x-ndjson") || !res.body) {
    const data = (await res.json().catch(() => ({}))) as ExtractResult & { message?: string; error?: string };
    if (!res.ok) throw new ApiError(data.message ?? `Chyba ${res.status}`, data.error ?? "unknown", res.status, data.budget);
    return data;
  }

  let final: ExtractResult | null = null;
  const handle = (text: string) => {
    if (!text.trim()) return;
    const ev = JSON.parse(text) as { type: string; model?: string; row?: ProvisionalRow; message?: string; error?: string; budget?: Budget };
    if (ev.type === "row" && ev.row) onRow(ev.row, ev.model ?? "");
    else if (ev.type === "done") final = ev as unknown as ExtractResult;
    else if (ev.type === "error") throw new ApiError(ev.message ?? "Čtení stránky selhalo.", ev.error ?? "unknown", 502, ev.budget);
  };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let tail = "";
  for (;;) {
    const { value, done } = await reader.read();
    tail += done ? dec.decode() : dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = tail.indexOf("\n")) >= 0) {
      handle(tail.slice(0, nl));
      tail = tail.slice(nl + 1);
    }
    if (done) break;
  }
  handle(tail);
  if (!final) throw new ApiError("Čtení stránky se přerušilo — zkuste to znovu.", "stream_ended", 502);
  return final;
}

export const listReports = () => request<LabReport[]>("/api/reports");

export const putReport = (report: LabReport) => request<{ ok: true }>(`/api/reports/${report.id}`, jsonInit("PUT", report));

export const putPage = (reportId: string, pageNum: number, blob: Blob, width: number, height: number) =>
  request<{ ok: true; imageUrl: string }>(`/api/reports/${reportId}/${pageNum}`, {
    method: "PUT",
    headers: { "content-type": blob.type || "image/jpeg", "x-image-width": String(width), "x-image-height": String(height) },
    body: blob,
  });

export const deleteReport = (id: string) => request<{ ok: true }>(`/api/reports/${id}`, { method: "DELETE" });

export const getSettings = () => request<Settings>("/api/settings");
export const putSettings = (s: Settings) => request<{ ok: true }>("/api/settings", jsonInit("PUT", s));

export const logout = () => request<void>("/api/auth/logout", { method: "POST" });

/** Immediate and complete — the worker deletes rows and page images together. */
export const deleteAccount = () => request<{ ok: true }>("/api/account", { method: "DELETE" });

/** Sdílet s AI: the text is built here from the account's own payloads and
 *  stored verbatim; the URL comes back once. */
export interface AiShare {
  url: string;
  expiresAt: string;
}
export const createAiShare = (text: string) => request<AiShare>("/api/ai-share", jsonInit("POST", { text }));
export const getAiShare = () => request<{ expiresAt: string } | null>("/api/ai-share");
export const revokeAiShare = () => request<{ ok: true }>("/api/ai-share", { method: "DELETE" });
