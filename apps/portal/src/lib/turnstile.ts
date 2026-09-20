/**
 * The Turnstile widget on a public form, as a token the form posts.
 *
 * Not ui-kit's useTurnstile: that one trades a solved challenge for the
 * demo's session token on the spot, and the portal has no such session —
 * the worker checks the token itself on register, login, forgot and the
 * help desk, one token per submit. So this hook does less: it mounts the
 * widget once a site key exists, holds the token the widget hands over,
 * and resets the widget after a submit, because a token is single-use and
 * the next try needs a new one.
 *
 * Without VITE_TURNSTILE_SITE_KEY — the local app — there is no widget and
 * no token; the worker accepts that only with OPEN_SIGNUP_DEV_BYPASS set
 * (workers/portal/src/signup.ts).
 *
 * With a site key and no script — blocked by an extension, or offline —
 * the box under the form would stay empty for ever and the form's only
 * word about it would be the refusal on submit. So the hook waits
 * `TURNSTILE_WAIT_MS` for the widget to render, and if nothing did, says
 * so in `failed`; the box shows one sentence. A widget that renders late
 * but in time, or one whose script was already on the page, never trips
 * it — the check is for a child in the box, which is what a render leaves.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalTurnstileAction } from "@bw/gate/turnstile";

export interface TurnstileGate {
  /** Attach to the element the widget renders into. */
  boxRef: React.RefObject<HTMLDivElement>;
  /** A site key is configured (and the gate is enabled for this reader), so a widget renders and a token is required. */
  available: boolean;
  /** The solved token, or null until the widget answers — and after a reset. */
  token: string | null;
  /** The widget did not render within `TURNSTILE_WAIT_MS`: the script is blocked, or the page is offline. */
  failed: boolean;
  /** After a submit, whatever it answered: the token is spent. */
  reset: () => void;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
}

/** ui-kit declares `window.turnstile` with a narrower render; read it our way. */
const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";

/** Under 300px of room the standard widget does not fit; the compact one does. */
const COMPACT_BELOW = 300;

/** How long the widget may take to appear before the box says it did not. */
export const TURNSTILE_WAIT_MS = 8_000;

/** The one sentence the box shows then. Muted: nothing the reader did was wrong. */
export const TURNSTILE_FAILED = "Ověření, že nejste robot, se nenačetlo. Načtěte prosím stránku znovu.";

export function useTurnstile(action: PortalTurnstileAction, enabled = true): TurnstileGate {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const available = Boolean(siteKey) && enabled;
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!available || !boxRef.current) return;
    const el = boxRef.current;
    const render = () => {
      const t = api();
      if (!t || widgetRef.current !== null || el.childElementCount > 0) return;
      widgetRef.current = t.render(el, {
        sitekey: siteKey,
        action,
        size: el.clientWidth > 0 && el.clientWidth < COMPACT_BELOW ? "compact" : "flexible",
        callback: (tok: string) => setToken(tok),
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      });
    };
    if (api()) render();
    else {
      // One script for the page, whichever form asked first.
      const prev = window.onTurnstileLoad;
      window.onTurnstileLoad = () => {
        prev?.();
        render();
      };
      if (!document.querySelector(`script[src^="https://challenges.cloudflare.com/turnstile/"]`)) {
        const s = document.createElement("script");
        s.src = SCRIPT;
        s.async = true;
        document.head.appendChild(s);
      }
    }
    // The deadline reads the box, not a flag: a render is a child in it,
    // whichever path put it there.
    const deadline = setTimeout(() => setFailed(el.childElementCount === 0), TURNSTILE_WAIT_MS);
    return () => clearTimeout(deadline);
  }, [available, siteKey, action]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetRef.current !== null) api()?.reset(widgetRef.current);
  }, []);

  return { boxRef, available, token, failed, reset };
}
