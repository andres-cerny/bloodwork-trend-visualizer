/** Worker API client. Holds the session token minted from one Turnstile pass. */
import type { LabReport } from "./models";
import { czNum } from "./summary";
import { numericPoints, type Trend } from "./trends";

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

export async function extract(imageBase64: string, mediaType: string, textLayer: string | null) {
  return post<{ reads: any[]; costUsd: number; budget: Budget }>("/api/extract", {
    imageBase64,
    mediaType,
    textLayer,
  });
}

export async function askChat(dataContext: string, history: Array<{ role: "user" | "assistant"; content: string }>) {
  return post<{ text: string; costUsd: number; budget: Budget }>("/api/chat", { dataContext, history });
}

/**
 * Compact, already-normalized view of the patient's data for the chat.
 *
 * Sent as context rather than exposed through tools: the dataset is small and
 * every number here came out of the deterministic parsing layer, so the model
 * has nothing left to compute — which is exactly the guarantee we want.
 */
export function buildChatContext(reports: LabReport[], trends: Map<string, Trend>): string {
  const lines: string[] = [];
  const dates = reports.map((r) => r.reportDate).filter(Boolean).sort();
  lines.push(`Počet reportů: ${reports.length}. Data odběrů: ${dates.join(", ")}.`);
  lines.push("");
  lines.push("Analyt | jednotka | referenční meze | hodnoty (datum: hodnota, stav)");
  for (const t of trends.values()) {
    const np = numericPoints(t);
    if (np.length === 0) continue;
    const last = np[np.length - 1];
    const ref =
      last.refLow !== null || last.refHigh !== null
        ? `${last.refLow !== null ? czNum(last.refLow) : ""}–${last.refHigh !== null ? czNum(last.refHigh) : ""}`
        : "neuvedeno";
    const series = np.map((p) => `${p.date}: ${czNum(p.value)} (${p.flag})`).join("; ");
    lines.push(`${t.displayName} | ${t.unit || "—"} | ${ref} | ${series}`);
  }
  return lines.join("\n");
}
