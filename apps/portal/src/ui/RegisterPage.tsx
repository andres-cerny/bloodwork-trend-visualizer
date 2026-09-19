/**
 * The open door's one form, in two moods: /registrace asks for an address
 * and the two consents and mails a link that will open the account;
 * /zapomenute-heslo asks for the address alone and mails a link that will
 * set a new password. Both end on the same sentence (VerifyMailPage) —
 * the worker answers the same whether the address has an account or not,
 * and this screen must not know either.
 *
 * The consents are the legal texts' (docs/plans/multi-user.md, Goal 9):
 * health data under the privacy page, and the terms. Both are required and
 * the worker refuses without them; the wording is rendered here, the date
 * it was given is stored on the account when the link is used.
 */
import { useState } from "react";
import { PORTAL_TURNSTILE_ACTIONS } from "@bw/gate/turnstile";
import { requestReset, requestSignup } from "../lib/api";
import { useTurnstile } from "../lib/turnstile";
import { Door, TurnstileBox, messageOf } from "./Door";
import VerifyMailPage from "./VerifyMailPage";

export type RegisterMode = "register" | "forgot";

const COPY = {
  register: {
    title: "Registrace",
    lead: "Zadejte e-mail. Pošleme vám odkaz, kterým si zvolíte heslo — tím vznikne váš účet.",
  },
  forgot: {
    title: "Zapomenuté heslo",
    lead: "Zadejte e-mail svého účtu. Pošleme vám odkaz, kterým si nastavíte nové heslo.",
  },
} as const;

export default function RegisterPage({ mode }: { mode: RegisterMode }) {
  const [email, setEmail] = useState("");
  const [health, setHealth] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const gate = useTurnstile(mode === "register" ? PORTAL_TURNSTILE_ACTIONS.register : PORTAL_TURNSTILE_ACTIONS.forgot);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register" && !(health && terms)) {
      setError("Zaškrtněte prosím oba souhlasy.");
      return;
    }
    if (gate.available && !gate.token) {
      setError("Počkejte prosím na ověření, že nejste robot.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") await requestSignup(email, true, gate.token);
      else await requestReset(email, gate.token);
      setSent(email.trim());
    } catch (err) {
      setError(messageOf(err));
      // Spent either way; the next try needs a fresh one.
      gate.reset();
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <VerifyMailPage email={sent} />;

  const copy = COPY[mode];
  return (
    <Door>
      <h2>{copy.title}</h2>
      <p className="sub">{copy.lead}</p>
      <form onSubmit={submit}>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        {mode === "register" && (
          <>
            <label className="check consent">
              <input type="checkbox" checked={health} onChange={(e) => setHealth(e.target.checked)} />
              <span>
                Souhlasím se zpracováním svých zdravotních údajů podle <a href="/soukromi">Zásad ochrany soukromí</a>
              </span>
            </label>
            <label className="check consent">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>
                Souhlasím s <a href="/podminky">Podmínkami užití</a>
              </span>
            </label>
          </>
        )}
        <TurnstileBox gate={gate} />
        {error && <p className="notice">{error}</p>}
        <button className="btn primary" disabled={busy}>
          Poslat odkaz
        </button>
      </form>
      <p className="door-foot sub">
        <a href="/">Přihlášení</a>
        {mode === "register" ? <a href="/zapomenute-heslo">Zapomenuté heslo</a> : <a href="/registrace">Registrovat</a>}
        <a href="/soukromi">Co ukládáme, a co ne</a>
      </p>
    </Door>
  );
}
