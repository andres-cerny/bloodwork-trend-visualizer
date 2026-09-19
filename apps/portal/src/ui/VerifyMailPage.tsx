/**
 * The screen after „Poslat odkaz": one sentence saying where the link went
 * and how long it lives. The same words whether the address has an account
 * or not — the worker answered the same, and the mailbox is where the
 * difference shows. Nothing here polls or waits; the link opens /heslo on
 * its own, in whatever tab the mail app chooses.
 */
import { Door } from "./Door";

export const LINK_HOURS = 24;

export default function VerifyMailPage({ email }: { email: string }) {
  return (
    <Door>
      <h2>Odkaz je na cestě</h2>
      <p className="sub sent">
        Poslali jsme odkaz na <strong>{email}</strong>. Otevřete ho do {LINK_HOURS} hodin.
      </p>
      <p className="hint">Nepřišel? Podívejte se do nevyžádané pošty. Odkaz lze použít jednou.</p>
      <p className="door-foot sub">
        <a href="/">Přihlášení</a>
      </p>
    </Door>
  );
}
