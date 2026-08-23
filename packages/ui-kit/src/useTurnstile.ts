import { useEffect, useRef, useState } from "react";
import { ApiError, hasSession, startSession } from "@bw/api-client";

/**
 * Mount the Turnstile widget and trade a solved challenge for a session.
 *
 * This used to live inside UploadPanel, where its success callback was the only
 * thing that set `unlocked` — so the chat tab's readiness was produced by the
 * upload screen. That is invisible while there is one app with both, and fatal
 * the moment there is an app with only chat: it could never unlock anything.
 *
 * The widget script is loaded once, on demand, and only when a site key is
 * configured. `available` is false otherwise, which is what lets a caller say
 * "not enabled in this demo" rather than pointing at a gate that will never
 * render.
 */
export interface Turnstile {
  /** Attach to the element the widget should render into. */
  boxRef: React.RefObject<HTMLDivElement>;
  /** A session token is held; the AI routes will accept calls. */
  ready: boolean;
  /** A site key is configured, so a challenge can appear at all. */
  available: boolean;
  error: string | null;
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => void };
    onTurnstileLoad?: () => void;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";

export function useTurnstile(siteKey: string | undefined, onUnlock?: () => void): Turnstile {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(hasSession());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready || !siteKey || !boxRef.current) return;
    const el = boxRef.current;
    const render = () => {
      if (!window.turnstile || el.childElementCount > 0) return;
      window.turnstile.render(el, {
        sitekey: siteKey,
        callback: async (token: string) => {
          try {
            await startSession(token);
            setReady(true);
            onUnlock?.();
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Ověření se nezdařilo.");
          }
        },
      });
    };
    if (window.turnstile) render();
    else {
      window.onTurnstileLoad = render;
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      document.head.appendChild(s);
    }
  }, [ready, siteKey, onUnlock]);

  return { boxRef, ready, available: Boolean(siteKey), error };
}
