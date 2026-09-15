/**
 * What every logged-out screen shares: the centered card, the question
 * "who is logged in", and the sentence a failed request shows. Lives apart
 * from App.tsx so the link page and the door can both import it without
 * importing each other.
 */
import { useState } from "react";
import { ApiError } from "../lib/api";

export interface Me {
  /** Null in the demo: the address is the owner's login, and no screen
   *  needs it to show their numbers. */
  email: string | null;
  createdAt: string;
  /** True when the public "Zobrazit demo pacienta" link opened this session. */
  demo: boolean;
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

/**
 * Whether the password fields show their text. A checkbox, not a hold-to-peek
 * eye: the reader decides once and the field stays readable while they type.
 * Returns the input type to use and the row that toggles it.
 */
export function useShownPassword(): { type: "text" | "password"; toggle: React.ReactNode } {
  const [shown, setShown] = useState(false);
  const toggle = (
    <label className="check">
      <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} />
      Zobrazit heslo
    </label>
  );
  return { type: shown ? "text" : "password", toggle };
}
