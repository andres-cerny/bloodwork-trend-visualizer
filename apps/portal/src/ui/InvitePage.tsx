/**
 * The two links the operator sends, one page: /registrace?kod=… opens a new
 * account, /heslo?kod=… sets an existing account's password. The page asks
 * the server what the code is before showing anything, so a spent or
 * expired link is one sentence, not a form that fails on submit — and the
 * form shown is the one the code is for, whichever path it arrived on.
 *
 * A third kind arrives by mail (workers/portal/src/signup.ts): a sign-up
 * code that already names its address. The form then asks for the password
 * alone — the address is the one the mail went to, shown and not editable —
 * and the account is born when it is set.
 */
import { useEffect, useState } from "react";
import { COOKIES_BLOCKED, Door, DoorFoot, DoorWaiting, fetchMe, messageOf, type Me, useShownPassword, useSignupOpen } from "./Door";
import { ApiError, checkInvite, register, setPassword } from "../lib/api";
import { LOGIN_PATH } from "./LandingPage";

const MIN_PASSWORD = 8;

type State =
  | { kind: "checking" }
  | { kind: "dead" }
  | { kind: "unreachable"; message: string }
  | { kind: "signup"; code: string; email?: string }
  | { kind: "password"; code: string };

export default function InvitePage({ onDone }: { onDone: (me: Me) => void }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  const [attempt, setAttempt] = useState(0);
  const open = useSignupOpen();

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("kod") ?? "";
    if (!code) {
      setState({ kind: "dead" });
      return;
    }
    setState({ kind: "checking" });
    void checkInvite(code).then(
      ({ kind, email }) => setState(kind === "signup" ? { kind, code, email } : { kind, code }),
      async (e) => {
        // Only the worker saying so makes a link dead. Offline, a 5xx or a
        // request that never answered used to say „Odkaz už neplatí" too,
        // and send a person with a good link to ask for another.
        if (!(e instanceof ApiError) || e.status !== 404) {
          setState({ kind: "unreachable", message: messageOf(e) });
          return;
        }
        // The common dead link is one clicked twice: the first click logged
        // them in. If it did, this is the portal, not a dead end.
        const me = await fetchMe().catch(() => null);
        if (me) onDone(me);
        else setState({ kind: "dead" });
      },
    );
  }, [attempt]);

  switch (state.kind) {
    case "checking":
      return <DoorWaiting text="Ověřuji odkaz…" />;
    case "unreachable":
      return (
        <Door>
          <p className="notice">Odkaz se nepodařilo ověřit. {state.message}</p>
          <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>
            Zkusit znovu
          </button>
        </Door>
      );
    case "dead":
      return (
        <Door>
          <p className="notice">
            {open
              ? "Odkaz už neplatí — byl už použit, nebo vypršel. Nechte si poslat nový."
              : "Odkaz už neplatí. Napište mi a pošlu nový."}
          </p>
          {open && (
            <a className="btn primary" href="/zapomenute-heslo">
              Poslat nový odkaz
            </a>
          )}
          <DoorFoot>
            <a href={LOGIN_PATH}>Přihlášení</a>
          </DoorFoot>
        </Door>
      );
    case "signup":
      return <InviteForm kind="signup" code={state.code} mailed={state.email} onDone={onDone} />;
    case "password":
      return <InviteForm kind="password" code={state.code} onDone={onDone} />;
  }
}

function InviteForm({
  kind,
  code,
  mailed,
  onDone,
}: {
  kind: "signup" | "password";
  code: string;
  /** The address a mailed sign-up code is for; undefined on an operator's code. */
  mailed?: string;
  onDone: (me: Me) => void;
}) {
  const [email, setEmail] = useState(mailed ?? "");
  const [password, setPw] = useState("");
  const pw = useShownPassword();
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Heslo musí mít nejméně ${MIN_PASSWORD} znaků.`);
      return;
    }
    if (password !== again) {
      setError("Hesla se neshodují.");
      return;
    }
    setBusy(true);
    try {
      // A mailed code carries its address and goes through the set-password
      // route; an operator's code takes the address typed here.
      if (kind === "signup" && !mailed) await register(code, email, password);
      else await setPassword(code, password);
      const me = await fetchMe();
      if (me) onDone(me);
      else setError(COOKIES_BLOCKED);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Door>
      {kind === "signup" && mailed ? (
        <>
          <h2>Vytvoření účtu</h2>
          <p className="sub">
            Zvolte si heslo. Tím vznikne váš účet pro e-mail <strong>{mailed}</strong> — přihlašovat se pak budete tímto
            e-mailem a heslem.
          </p>
        </>
      ) : kind === "signup" ? (
        <>
          <h2>Vytvoření účtu</h2>
          <p className="sub">
            Zadejte e-mail a zvolte si heslo. Tím vznikne váš účet — přihlašovat se pak budete tímto e-mailem a heslem.
          </p>
        </>
      ) : (
        <>
          <h2>Nové heslo</h2>
          <p className="sub">
            Zvolte si nové heslo ke svému účtu. Přihlašovat se pak budete svým e-mailem a tímto heslem.
          </p>
        </>
      )}
      <form onSubmit={submit}>
        {kind === "signup" && !mailed && (
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
        )}
        <label>
          Heslo
          <input type={pw.type} value={password} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
          <span className="hint">Nejméně {MIN_PASSWORD} znaků</span>
        </label>
        <label>
          Heslo znovu
          <input type={pw.type} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </label>
        {pw.toggle}
        {error && <p className="notice">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {kind === "signup" ? "Vytvořit účet" : "Nastavit heslo"}
        </button>
      </form>
      <DoorFoot>
        <a href="/soukromi">Co ukládáme, a co ne</a>
      </DoorFoot>
    </Door>
  );
}
