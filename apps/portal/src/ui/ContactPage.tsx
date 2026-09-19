/**
 * „Napište nám", at /napiste-nam: the one way to reach a person.
 *
 * Logged in, the address is the login's and cannot be edited — the worker
 * ignores anything else anyway. Logged out, the address is typed, and when
 * the deployment has a Turnstile site key the widget sits above the button
 * and its token goes with the message. The reply is by e-mail, by hand,
 * which is what the paragraph promises and nothing more.
 */
import { useEffect, useRef, useState } from "react";
import { Door, DoorFoot, fetchMe, messageOf, type Me } from "./Door";
import { sendHelpdesk } from "../lib/api";

/** The worker's cap, restated for the counter under the field. */
const MAX_CHARS = 4000;
/** The widget's action; the worker checks the token was minted for it. */
const TURNSTILE_ACTION = "helpdesk";
const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoadHelpdesk";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => void };
    onTurnstileLoadHelpdesk?: () => void;
  }
}

/**
 * The Turnstile widget as a token, or nothing when this deployment has no
 * site key. Its own hook rather than ui-kit's `useTurnstile`, which trades
 * the solve for a demo session — here the token is simply sent along.
 */
function useTurnstileToken(siteKey: string | undefined, enabled: boolean) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    if (!siteKey || !enabled || !boxRef.current) return;
    const el = boxRef.current;
    const render = () => {
      if (!window.turnstile || el.childElementCount > 0) return;
      window.turnstile.render(el, {
        sitekey: siteKey,
        action: TURNSTILE_ACTION,
        callback: (t: string) => setToken(t),
        "expired-callback": () => setToken(null),
      });
    };
    if (window.turnstile) render();
    else {
      window.onTurnstileLoadHelpdesk = render;
      const s = document.createElement("script");
      s.src = TURNSTILE_SCRIPT;
      s.async = true;
      document.head.appendChild(s);
    }
  }, [siteKey, enabled]);
  return { boxRef, token, required: Boolean(siteKey) && enabled };
}

type Who = { kind: "asking" } | { kind: "known"; me: Me | null };

export default function ContactPage() {
  const [who, setWho] = useState<Who>({ kind: "asking" });
  useEffect(() => {
    void fetchMe().then((me) => setWho({ kind: "known", me }));
  }, []);
  if (who.kind === "asking") return null;
  return <ContactForm me={who.me} />;
}

function ContactForm({ me }: { me: Me | null }) {
  // A demo visitor is logged in without an address of their own; they write
  // as a stranger would.
  const known = me?.email ?? null;
  const [email, setEmail] = useState(known ?? "");
  const [text, setText] = useState("");
  const [reportId, setReportId] = useState(() => new URLSearchParams(location.search).get("report") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const turnstile = useTurnstileToken(import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined, !known);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (turnstile.required && !turnstile.token) {
      setError("Potvrďte prosím, že nejste robot.");
      return;
    }
    setBusy(true);
    try {
      await sendHelpdesk({
        email: known ? undefined : email.trim(),
        text: text.trim(),
        reportId: reportId.trim() || undefined,
        turnstileToken: turnstile.token ?? undefined,
      });
      setSent(known ?? email.trim().toLowerCase());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Door>
        <h2>Napište nám</h2>
        <p className="sub contact-sent">
          Děkujeme, zpráva došla. Odpovíme na <strong>{sent}</strong>, obvykle do dvou dnů.
        </p>
        <DoorFoot>
          <a href="/">← Zpět do aplikace</a>
        </DoorFoot>
      </Door>
    );
  }

  return (
    <Door>
      <h2>Napište nám</h2>
      <p className="sub">
        Něco nefunguje, něco chybí, nebo si nevíte rady? Napište, co se stalo a co jste čekali.
        Odpovíme e-mailem, obvykle do dvou dnů.
      </p>
      <form onSubmit={submit}>
        <label>
          E-mail
          {known ? (
            <input type="email" value={known} readOnly aria-readonly="true" autoComplete="email" />
          ) : (
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          )}
          {known && <span className="hint">Odpovíme na e-mail, kterým jste přihlášeni.</span>}
        </label>
        <label>
          Zpráva
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))} rows={6} required maxLength={MAX_CHARS} />
          <span className="hint contact-count">
            {text.length.toLocaleString("cs-CZ")} / {MAX_CHARS.toLocaleString("cs-CZ")}
          </span>
        </label>
        <label>
          Report (nepovinné)
          <input type="text" value={reportId} onChange={(e) => setReportId(e.target.value)} maxLength={64} autoComplete="off" />
          <span className="hint">Datum odběru, např. 2026-03-04, pokud se zpráva týká jednoho z vašich reportů.</span>
        </label>
        {turnstile.required && <div ref={turnstile.boxRef} className="contact-turnstile" />}
        {error && <p className="notice">{error}</p>}
        <button className="btn primary" disabled={busy || !text.trim()}>
          Odeslat
        </button>
      </form>
      <DoorFoot>
        <a href="/">← Zpět</a>
        <a href="/soukromi">Co ukládáme, a co ne</a>
      </DoorFoot>
    </Door>
  );
}
