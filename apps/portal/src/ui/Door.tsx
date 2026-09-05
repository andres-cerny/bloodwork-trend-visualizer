/**
 * What every logged-out screen shares: the centered card, the question
 * "who is logged in", and the sentence a failed request shows. Lives apart
 * from App.tsx so the link page and the door can both import it without
 * importing each other.
 */
import { ApiError } from "../lib/api";

export interface Me {
  email: string;
  createdAt: string;
}

/** The only thing that says who is logged in: the cookie, read by the worker. */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me").catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as Me;
}

/** The centered card every logged-out state shares: mark, wordmark, content. */
export function Door({ children }: { children: React.ReactNode }) {
  return (
    <main className="door">
      <div className="door-card">
        <span className="door-mark" aria-hidden="true">
          🩸
        </span>
        <h1>Moje krev</h1>
        {children}
      </div>
    </main>
  );
}

/** What a failed request says to the reader; the worker's sentence when it has one. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Spojení se nezdařilo. Zkuste to prosím znovu.";
}
