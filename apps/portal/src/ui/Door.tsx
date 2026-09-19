/**
 * What every logged-out screen shares: the centered card, the question
 * "who is logged in", and the sentence a failed request shows. Lives apart
 * from App.tsx so the link page and the door can both import it without
 * importing each other.
 */
import { Children, Fragment, useEffect, useState } from "react";
import { ApiError, signupOpen } from "../lib/api";
import type { TurnstileGate } from "../lib/turnstile";

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

/**
 * The links a door card ends on, one nav for every card. Each link is its
 * own flex box with a dot between — not inline text in a paragraph, where
 * an anchor is 21px tall (under the 24px floor the sweep holds every link
 * to) and a row of three wraps into ragged lines at 360. The dots are
 * hidden from a screen reader; the nav's label is what it announces.
 */
export function DoorFoot({ children }: { children: React.ReactNode }) {
  const links = Children.toArray(children).filter(Boolean);
  return (
    <nav className="door-foot legal-foot" aria-label="Další cesty">
      {links.map((link, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden="true">·</span>}
          {link}
        </Fragment>
      ))}
    </nav>
  );
}

/** What a failed request says to the reader; the worker's sentence when it has one. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Spojení se nezdařilo. Zkuste to prosím znovu.";
}

/**
 * Where the Turnstile widget renders, when there is a site key to render it
 * with. Without one the box is not drawn at all — an empty frame under a
 * form would read as something missing. The `.door-turnstile` rule gives it
 * the widget's height ahead of time, so the button under it does not jump
 * when the challenge appears.
 */
export function TurnstileBox({ gate }: { gate: TurnstileGate }) {
  if (!gate.available) return null;
  return <div ref={gate.boxRef} className="door-turnstile" />;
}

/**
 * Whether this deployment lets a stranger register. Asked rather than
 * assumed, like the demo link: most deployments are invite-only and must
 * show no door that leads to a 404.
 */
export function useSignupOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void signupOpen().then(setOpen);
  }, []);
  return open;
}

/**
 * The two other ways off the login form. Open, they are the registration
 * page and the forgotten-password page; closed, the one sentence the
 * invite-only door has always had.
 */
export function DoorWays({ open }: { open: boolean }) {
  if (!open) return <p className="sub">Zapomenuté heslo? Napište mi a pošlu vám odkaz.</p>;
  return (
    <div className="door-ways">
      <a className="btn linkish" href="/registrace">
        Registrovat
      </a>
      <a className="btn linkish" href="/zapomenute-heslo">
        Zapomenuté heslo
      </a>
    </div>
  );
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
