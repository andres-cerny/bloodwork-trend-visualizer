/**
 * Talking to the portal worker. Cookie-authenticated, so there is no token
 * to hold; the one thing worth knowing here is which errors end an upload.
 */
import type { AiContext, CustomAnalyte, LabReport } from "@bw/lab-core";

export interface Budget {
  spentUsd: number;
  budgetUsd: number;
  frozen: boolean;
  remainingUsd: number;
  month: string;
}

/**
 * The allowance the person sees, in documents (workers/portal/src/allowance.ts):
 * `free` for good, `purchased` on top, `used` taken at each document's open,
 * `remaining` what is left to upload.
 */
export interface Allowance {
  free: number;
  purchased: number;
  used: number;
  remaining: number;
}

export interface Settings {
  /** canonicalId → raw names the reader mapped to it, in acceptance order. */
  learned?: Record<string, string[]>;
  /**
   * Parameters the reader founded in the mapping screen. registry.json is
   * curated and the same for every account, so a parameter of their own can
   * only live here — see lab-core/customAnalyte.ts.
   */
  customAnalytes?: CustomAnalyte[];
  /** What the person told their AI assistant about themselves, once. */
  aiContext?: AiContext;
  /**
   * What the mapping model answered, per printed name — asked once per
   * account, so a reload does not spend again (lib/aiMapping.ts).
   */
  aiAsked?: AiAsked;
}

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly budget?: Budget, readonly allowance?: Allowance) {
    super(message);
  }
}

/** Errors after which every remaining page would fail the same way. */
const FATAL = new Set(["budget_exhausted", "unauthorized", "no_document"]);
export const isFatalApiError = (e: unknown): boolean => e instanceof ApiError && FATAL.has(e.code);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; budget?: Budget; allowance?: Allowance };
  if (!res.ok) throw new ApiError(data.message ?? `Chyba ${res.status}`, data.error ?? "unknown", res.status, data.budget, data.allowance);
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/**
 * Which form a link opens. A dead link is an ApiError with status 404. A
 * sign-up link the worker mailed names its address, so the form need not
 * ask for it; an operator's sign-up code does not.
 */
export const checkInvite = (code: string) =>
  request<{ kind: "signup" | "password"; email?: string }>(`/api/auth/invite/${encodeURIComponent(code)}`);

/** Each of the three mints the session cookie on success; the caller then
 *  reads /api/me, which is the only thing that says who is logged in. The
 *  Turnstile token goes with the login on an open deployment; the worker
 *  ignores it on a closed one. */
export const register = (code: string, email: string, password: string) =>
  request<{ ok: true }>("/api/auth/register", jsonInit("POST", { code, email, password }));
export const login = (email: string, password: string, turnstile?: string | null) =>
  request<{ ok: true }>("/api/auth/login", jsonInit("POST", { email, password, ...(turnstile ? { turnstile } : {}) }));
export const setPassword = (code: string, password: string) =>
  request<{ ok: true }>("/api/auth/password", jsonInit("POST", { code, password }));

/**
 * The open door. `signupOpen` is what the door asks before drawing
 * „Registrovat" and „Zapomenuté heslo"; the two requests mail a link and
 * answer {ok:true} whether or not the address has an account — the mailbox
 * learns which, the screen does not. `consent` is both boxes ticked.
 */
export const signupOpen = () => request<{ open: boolean }>("/api/auth/signup").then((r) => r.open, () => false);
export const requestSignup = (email: string, consent: boolean, turnstile?: string | null) =>
  request<{ ok: true }>("/api/auth/register", jsonInit("POST", { email, consent, ...(turnstile ? { turnstile } : {}) }));
export const requestReset = (email: string, turnstile?: string | null) =>
  request<{ ok: true }>("/api/auth/forgot", jsonInit("POST", { email, ...(turnstile ? { turnstile } : {}) }));

/**
 * The public demo patient — a real account this deployment opens to anyone.
 *
 * `demoOffered` is a question, not a login: a deployment that names no demo
 * account answers 404, and the door then shows no link rather than one that
 * leads nowhere. `enterDemo` mints the session; the caller reads /api/me
 * after it, exactly like the three password doors.
 */
export const demoOffered = () => request<{ available: true }>("/api/auth/demo").then(() => true, () => false);
export const enterDemo = () => request<{ ok: true }>("/api/auth/demo", jsonInit("POST", {}));

export const getStatus = () => request<{ budget: Budget; maxPages: number; allowance: Allowance }>("/api/status");
export const getAllowance = () => request<Allowance>("/api/allowance");

/**
 * Open a document for extraction — the one call that takes a document from
 * the allowance. The id is the report id the browser minted, so document and
 * report share a name. Answers 402 `no_documents` (an ApiError with the
 * allowance on it) when none is left; a retry with the same id takes nothing.
 */
export const openDocument = (id: string) =>
  request<{ ok: true; already: boolean; allowance: Allowance }>("/api/documents", jsonInit("POST", { id }));

/** Give a document back. The worker does so only if no page of it was read. */
export const releaseDocument = (id: string) =>
  request<{ ok: true; released: boolean; allowance: Allowance }>(`/api/documents/${id}`, { method: "DELETE" });

/**
 * The shop: a Checkout URL to send the browser to, or an ApiError — 503
 * `shop_closed` while the deployment has no Stripe account behind it.
 */
export const buyDocuments = (pkg: "5" | "15") => request<{ url: string }>("/api/buy", jsonInit("POST", { package: pkg }));

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
  /** How many readers were asked — see `interpretPage`. */
  readersAttempted?: number;
  costUsd: number;
  budget: Budget;
}

/**
 * Which reader pair the extractor runs, for the privacy page's processor
 * sentence. Public — /soukromi is reachable logged out — and `null` whenever
 * the answer does not arrive, which the copy reads as the broader claim.
 */
export const getProcessors = () =>
  request<{ photoReaders: string | null }>("/api/processors");

/**
 * „Napište nám". Logged in, the worker takes the address from the session and
 * `email` is ignored; logged out it is required, and so is the Turnstile
 * token on a deployment that asks for one. The 200 means the message is in
 * the database — not that anyone has been told yet.
 */
export const sendHelpdesk = (m: { email?: string; text: string; reportId?: string; turnstileToken?: string }) =>
  request<{ ok: true }>("/api/helpdesk", jsonInit("POST", m));

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
  /** The document this page belongs to — opened first with `openDocument`. */
  documentId: string,
  onRow?: (row: ProvisionalRow, model: string) => void,
): Promise<ExtractResult> {
  // The document rides in a header, not the body: the body goes to the
  // extractor as sent, and the extractor has no idea what a document is.
  const withDoc = (init: RequestInit): RequestInit => ({ ...init, headers: { ...(init.headers as Record<string, string>), "x-document": documentId } });
  if (!onRow) return request<ExtractResult>("/api/extract", withDoc(jsonInit("POST", page)));

  const res = await fetch("/api/extract", withDoc(jsonInit("POST", { ...page, stream: true })));
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

/** A spelling one account filed under a shipped analyte, read by every account. */
export interface TaughtSynonym {
  rawName: string;
  canonicalId: string;
  /** Taught by this account — the only one that can withdraw it. */
  mine: boolean;
}
export const listSynonyms = () => request<TaughtSynonym[]>("/api/synonyms");
export const teachSynonym = (rawName: string, canonicalId: string) =>
  request<{ ok: true }>("/api/synonyms", jsonInit("PUT", { rawName, canonicalId }));
export const forgetSynonym = (rawName: string) =>
  request<{ ok: true; removed: boolean }>("/api/synonyms", jsonInit("DELETE", { rawName }));

/**
 * The mapping fallback (packages/extraction/src/map.ts), on this account's
 * ledger. The wire shapes are restated here rather than imported: the app
 * must not depend on the extraction package, whose barrel carries the model
 * SDK, and a type-only import would still make it a dependency.
 */
export interface NameToMap {
  rawName: string;
  unit: string;
  refRange: string;
  material: string | null;
}
export interface CatalogEntry {
  id: string;
  name: string;
  unit: string;
}
export interface MapSuggestion {
  rawName: string;
  decision: "catalog" | "new" | "not_blood" | "unknown";
  canonicalId: string | null;
  proposed: { id: string; displayNameCs: string; unit: string } | null;
  reason: string;
  confidence: "high" | "medium" | "low";
}
export interface AiMapAnswer {
  suggestions: MapSuggestion[];
  /** Which model answered, for the record kept per name. */
  model?: string;
  costUsd?: number;
  budget: Budget;
}
/**
 * One name's answer as the account keeps it. `applied` marks the ones the
 * model filed without a click; `asking` is the in-memory mark between the
 * call and its answer, never persisted (see lib/aiMapping.ts).
 */
export interface AiAskedEntry {
  decision: MapSuggestion["decision"];
  canonicalId: string | null;
  confidence: MapSuggestion["confidence"];
  reason: string;
  model: string;
  /** ISO date, "2026-09-19". */
  at: string;
  /** For `new`: what it proposed, so the founding form opens with it after a reload. */
  proposed?: MapSuggestion["proposed"];
  applied?: true;
  asking?: true;
}
export type AiAsked = Record<string, AiAskedEntry>;
export const suggestWithAi = (names: NameToMap[], catalog: CatalogEntry[]) =>
  request<AiMapAnswer>("/api/map", jsonInit("POST", { names, catalog }));

export const getSettings = () => request<Settings>("/api/settings");
export const putSettings = (s: Settings) => request<{ ok: true }>("/api/settings", jsonInit("PUT", s));

export const logout = () => request<void>("/api/auth/logout", { method: "POST" });

/** Immediate and complete — the worker deletes rows and page images together. */
export const deleteAccount = () => request<{ ok: true }>("/api/account", { method: "DELETE" });

/** AI konzultace: the text is built here from the account's own payloads and
 *  stored verbatim; the URL comes back once. */
export interface AiShare {
  url: string;
  expiresAt: string;
}
export const createAiShare = (text: string) => request<AiShare>("/api/ai-share", jsonInit("POST", { text }));
/** Replace the live link's text in place — the URL the person may already have pasted stays. */
export const updateAiShare = (text: string) => request<{ ok: true }>("/api/ai-share", jsonInit("PUT", { text }));
export const getAiShare = () => request<{ expiresAt: string } | null>("/api/ai-share");
export const revokeAiShare = () => request<{ ok: true }>("/api/ai-share", { method: "DELETE" });
