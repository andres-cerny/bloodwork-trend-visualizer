/**
 * The two links the operator sends, one page: /registrace?kod=… opens a new
 * account, /heslo?kod=… sets an existing account's password. The page asks
 * the server what the code is before showing anything, so a spent or
 * expired link is one sentence, not a form that fails on submit — and the
 * form shown is the one the code is for, whichever path it arrived on.
 */
import { useEffect, useState } from "react";
import { Door, fetchMe, messageOf, type Me } from "./Door";
import { checkInvite, register, setPassword } from "../lib/api";

const MIN_PASSWORD = 8;

type State = { kind: "checking" } | { kind: "dead" } | { kind: "signup"; code: string } | { kind: "password"; code: string };

export default function InvitePage({ onDone }: { onDone: (me: Me) => void }) {
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("kod") ?? "";
    if (!code) {
      setState({ kind: "dead" });
      return;
    }
    void checkInvite(code).then(
      ({ kind }) => setState({ kind, code }),
      () => setState({ kind: "dead" }),
    );
  }, []);

  switch (state.kind) {
    case "checking":
      return null;
    case "dead":
      return (
        <Door>
          <p className="notice">Odkaz už neplatí. Napište mi a pošlu nový.</p>
          <p className="door-foot sub">
            <a href="/">Přihlášení</a>
          </p>
        </Door>
      );
    case "signup":
    case "password":
      return <InviteForm kind={state.kind} code={state.code} onDone={onDone} />;
  }
}

function InviteForm({ kind, code, onDone }: { kind: "signup" | "password"; code: string; onDone: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPw] = useState("");
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
      if (kind === "signup") await register(code, email, password);
      else await setPassword(code, password);
      const me = await fetchMe();
      if (me) onDone(me);
      else setError("Přihlášení se nezdařilo. Zkuste to prosím znovu.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Door>
      <p className="sub">
        {kind === "signup"
          ? "Krevní testy v čase. Bez jména, bez rodného čísla — jen vaše hodnoty."
          : "Nové heslo k vašemu účtu."}
      </p>
      <form onSubmit={submit}>
        {kind === "signup" && (
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
        )}
        <label>
          Heslo
          <input type="password" value={password} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
          <span className="hint">Nejméně {MIN_PASSWORD} znaků</span>
        </label>
        <label>
          Heslo znovu
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
        </label>
        {error && <p className="notice">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {kind === "signup" ? "Vytvořit účet" : "Nastavit heslo"}
        </button>
      </form>
      <p className="door-foot sub">
        <a href="/soukromi">Co ukládáme, a co ne</a>
      </p>
    </Door>
  );
}
