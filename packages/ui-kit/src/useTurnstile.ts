import { useEffect, useRef, useState } from "react";
import { ApiError, hasSession, startSession } from "@bw/api-client";
import { TURNSTILE_ACTION } from "@bw/gate/turnstile";

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
/**
 * Everything about the widget that is presentation.
 *
 * Optional, and absent means untouched: with no options the render call is
 * byte-for-byte the one it always was, which is what keeps the upload panel's
 * two call sites — and their light, English chrome — exactly as they were.
 */
export interface TurnstileOptions {
  /**
   * The widget's own colour scheme. Turnstile reads it once, at render, so a
   * caller that changes this gets the widget rebuilt (see below).
   *
   * `"auto"` is the honest value for an app following the system theme: the
   * iframe then asks `prefers-color-scheme` itself, which is the same question
   * the absent `data-theme` is deferring to.
   */
  theme?: "light" | "dark" | "auto";
  /**
   * The widget's language, as Turnstile spells it — an ISO 639-1 code such as
   * `"cs"`. The iframe is the one surface in this app whose words are not ours,
   * and left alone it negotiates its own: on a Czech screen that is „Verify you
   * are human" under a Czech composer.
   */
  language?: string;
}

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
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
      remove?: (id: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";

export function useTurnstile(
  siteKey: string | undefined,
  onUnlock?: () => void,
  options?: TurnstileOptions,
): Turnstile {
  const boxRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(hasSession());
  const [error, setError] = useState<string | null>(null);
  /** The rendered widget, so a theme change can take it down again. */
  const widget = useRef<string | null>(null);
  // Read out as two strings, not kept as the options object: a caller passing
  // an inline literal must not re-render the widget on every keystroke in the
  // composer.
  const theme = options?.theme;
  const language = options?.language;
  /** Anything the caller asked for. Absent means Turnstile's own default. */
  const styled = theme !== undefined || language !== undefined;

  useEffect(() => {
    if (ready || !siteKey || !boxRef.current) return;
    const el = boxRef.current;
    const render = () => {
      if (!window.turnstile || el.childElementCount > 0) return;
      widget.current =
        window.turnstile.render(el, {
          sitekey: siteKey,
          // Checked server-side. A token minted for one surface must not be
          // replayable at another.
          action: TURNSTILE_ACTION,
          // Only when asked for. Turnstile's own defaults are what every caller
          // got before these parameters existed.
          ...(theme ? { theme } : {}),
          ...(language ? { language } : {}),
          callback: async (token: string) => {
            try {
              await startSession(token);
              setReady(true);
              onUnlock?.();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Ověření se nezdařilo.");
            }
          },
        }) ?? null;
    };
    if (window.turnstile) render();
    else {
      window.onTurnstileLoad = render;
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      document.head.appendChild(s);
    }

    // The teardown exists for exactly one reason: Turnstile reads `theme` and
    // `language` at render and never again, so following a live theme switch
    // means building the widget a second time. A caller that passes no options
    // cannot reach this branch — its widget is mounted once and never removed,
    // which is the lifetime it had before.
    if (!styled) return;
    return () => {
      const id = widget.current;
      widget.current = null;
      if (id !== null) window.turnstile?.remove?.(id);
      el.replaceChildren();
    };
  }, [ready, siteKey, onUnlock, theme, language, styled]);

  return { boxRef, ready, available: Boolean(siteKey), error };
}
