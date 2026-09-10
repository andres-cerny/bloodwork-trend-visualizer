import { readSse, type AgentEvent } from "@bw/agent-core/events";

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

export async function getStatus(
  tenant?: string,
): Promise<{ budget: Budget; maxPages: number; crossCheck: boolean; photoReaders?: string }> {
  const res = await fetch(`/api/status${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`);
  if (!res.ok) throw new Error("status unavailable");
  return res.json();
}

export async function startSession(turnstileToken: string): Promise<void> {
  const { session } = await post<{ session: string }>("/api/session", { turnstileToken });
  setSession(session);
}

// --- the patient card --------------------------------------------------------
// Read-only JSON from /api/card/*. Types mirror the worker's responses and
// carry no lab knowledge — a value, a flag string and a unit are data this
// package transports, not concepts it understands.

export interface CardPatient {
  id: string;
  fullName: string;
  birthDate: string;
  sex: "m" | "f";
}

export type CardVisitKind = "annual" | "blood" | "perf_test" | "thb";

export interface CardVisitBase {
  id: string;
  visitDate: string;
  kind: CardVisitKind;
  title: string;
  noteDocumentId: string | null;
}

export interface CardVisit extends CardVisitBase {
  hasNote: boolean;
  labCount: number;
  outOfRange: number;
  unconfirmed: number;
  perfCount: number;
}

export interface CardLabRow {
  canonicalId: string;
  displayName: string;
  unit: string;
  value: number;
  valueRaw: string;
  flag: string;
  refLow: number | null;
  refHigh: number | null;
  unconfirmed: boolean;
  delta: number | null;
  prevDate: string | null;
}

export interface CardPerfPoint {
  visitId: string;
  metricId: string;
  displayName: string;
  unit: string;
  value: number;
  refLow: number | null;
  refHigh: number | null;
  testDate: string;
}

export interface CardPerfRow extends CardPerfPoint {
  delta: number | null;
  prevDate: string | null;
}

export interface CardPageRef {
  pageNum: number;
  imageUrl: string;
  width: number;
  height: number;
}

export interface CardDocument {
  id: string;
  docDate: string;
  kind: string;
  title: string;
  bodyText: string;
  pages: CardPageRef[];
}

export interface CardTrendPoint {
  date: string;
  value: number;
  unit: string | null;
  flag: string;
  refLow: number | null;
  refHigh: number | null;
  unconfirmed: string | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: headers() });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new ApiError(data.message ?? `Chyba ${res.status}`, data.error ?? "unknown", data.budget);
  return data as T;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const getCardPatients = (tenant: string) =>
  get<{ patients: CardPatient[] }>(`/api/card/patients?${q({ tenant })}`);

export const getCardVisits = (tenant: string, patient: string) =>
  get<{ patient: CardPatient; visits: CardVisit[] }>(`/api/card/visits?${q({ tenant, patient })}`);

export const getCardVisit = (tenant: string, patient: string, visit: string) =>
  get<{ visit: CardVisitBase; labs: CardLabRow[]; perf: CardPerfRow[]; note: CardDocument | null }>(
    `/api/card/visit?${q({ tenant, patient, visit })}`,
  );

export const getCardTrend = (tenant: string, patient: string, kind: "lab" | "perf", metric: string) =>
  get<{
    kind: "lab" | "perf";
    displayName: string;
    unit: string;
    points: Array<CardTrendPoint | CardPerfPoint>;
  }>(`/api/card/trend?${q({ tenant, patient, kind, metric })}`);

export const getCardDocument = (tenant: string, patient: string, doc: string) =>
  get<{ document: CardDocument }>(`/api/card/document?${q({ tenant, patient, doc })}`);

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
  return post<{
    reads: any[];
    mode: "text" | "vision";
    /**
     * How many readers were asked. Hand it to `reconcile` — without it a page
     * whose second read failed comes back looking cross-checked.
     */
    readersAttempted?: number;
    readers?: string;
    costUsd: number;
    budget: Budget;
  }>("/api/extract", { imageBase64, mediaType, textLayer, rowsText });
}

/**
 * Ask the agent, and receive the answer as it is written.
 *
 * Returns events rather than a string because a tool-using turn spends most of
 * itself not talking: the caller wants to show "looking up cholesterol" while
 * it happens, not a spinner followed by a paragraph.
 *
 * The profile is a name, never a prompt. The worker resolves it against its own
 * allowlist, so nothing a caller sends can widen what the agent is or what it
 * may reach.
 */
export async function* askAgent(req: {
  profile: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  context?: string;
  /** Which practice — required by tool-using profiles, validated server-side. */
  tenant?: string;
  /** A ref the server handed out via a `patient` event. Never invented here. */
  patientRef?: string;
}): AsyncGenerator<AgentEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(req),
  });

  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as any;
    throw new ApiError(
      data.message ?? `Chyba ${res.status}`,
      data.error ?? "unknown",
      data.budget,
    );
  }

  yield* readSse(res.body);
}
