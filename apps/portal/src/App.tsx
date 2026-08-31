/**
 * Moje krev's walking skeleton: who are you, or the door.
 *
 * This file is the door and nothing else: who are you, or the login form.
 * Everything behind it — upload, verification, trends — is ui/Portal.tsx.
 */
import { useEffect, useState } from "react";
import Portal from "./ui/Portal";
import Privacy from "./ui/Privacy";
import { loginConfirm, peekConfirm } from "./lib/api";

interface Me {
  email: string;
  createdAt: string;
}

type Screen =
  | { kind: "loading" }
  | { kind: "login"; notice: string | null }
  | { kind: "sent"; message: string; devLink: string | null }
  | { kind: "confirm"; token: string; email: string }
  | { kind: "home"; me: Me };

async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me").catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as Me;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  // One public page beside the door; the shell serves index.html for any
  // path, so this is the whole router.
  if (location.pathname === "/soukromi") return <Privacy />;

  useEffect(() => {
    // The confirm redirect lands on "/" with a cookie, or back here with
    const params = new URLSearchParams(location.search);
    // ?prihlaseni=neplatne when the link was spent or expired.
    const invalidLink = params.get("prihlaseni") === "neplatne";
    // ?potvrdit=TOKEN: the magic link bounced here. Name the account before
    // logging in, so a link opened by the wrong person can be refused.
    const token = params.get("potvrdit");
    if (invalidLink || token) history.replaceState(null, "", "/");
    if (token) {
      void peekConfirm(token).then(
        ({ email }) => setScreen({ kind: "confirm", token, email }),
        () => setScreen({ kind: "login", notice: "Odkaz už neplatí. Nechte si poslat nový." }),
      );
      return;
    }
    void fetchMe().then((me) =>
      setScreen(
        me
          ? { kind: "home", me }
          : { kind: "login", notice: invalidLink ? "Odkaz už neplatí. Nechte si poslat nový." : null },
      ),
    );
  }, []);

  switch (screen.kind) {
    case "loading":
      return null;
    case "login":
      return <Login notice={screen.notice} onSent={(message, devLink) => setScreen({ kind: "sent", message, devLink })} />;
    case "sent":
      return (
        <main className="door">
          <h1>Moje krev</h1>
          <p className="sub">{screen.message}</p>
          <p className="sub">Odkaz platí 15 minut. Zavřít tuto záložku ničemu nevadí.</p>
          {screen.devLink && (
            <p className="sub">
              <a href={screen.devLink}>Vývojové přihlášení</a>
            </p>
          )}
        </main>
      );
    case "confirm":
      return <Confirm email={screen.email} token={screen.token} onDone={(me) => setScreen({ kind: "home", me })} onFail={() => setScreen({ kind: "login", notice: "Odkaz už neplatí. Nechte si poslat nový." })} />;
    case "home":
      return <Portal email={screen.me.email} onLogout={() => setScreen({ kind: "login", notice: null })} />;
  }
}

function Confirm({ email, token, onDone, onFail }: { email: string; token: string; onDone: (me: Me) => void; onFail: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function login() {
    setBusy(true);
    setError(null);
    try {
      await loginConfirm(token);
      const me = await fetchMe();
      if (me) onDone(me);
      else onFail();
    } catch {
      onFail();
    }
  }
  return (
    <main className="door">
      <h1>Moje krev</h1>
      <p className="sub">Přihlásit se do účtu:</p>
      <p className="sub"><strong>{email}</strong></p>
      <p className="sub">Pokud to není váš e-mail, odkaz nepoužívejte — někdo vám ho mohl poslat, aby vaše výsledky skončily v jeho účtu.</p>
      {error && <p className="notice">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={login}>
        Přihlásit se jako {email}
      </button>
    </main>
  );
}

function Login({ notice, onSent }: { notice: string | null; onSent: (message: string, devLink: string | null) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body = mode === "login" ? { email } : { email, invite };
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res) {
      setError("Spojení se nezdařilo. Zkuste to prosím znovu.");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      devLink?: string;
    };
    if (!res.ok) {
      setError(data.message ?? "Něco se pokazilo. Zkuste to prosím znovu.");
      return;
    }
    onSent(data.message ?? "Poslali jsme vám přihlašovací odkaz.", data.devLink ?? null);
  }

  return (
    <main className="door">
      <h1>Moje krev</h1>
      <p className="sub">Krevní testy v čase. Bez jména, bez rodného čísla — jen vaše hodnoty.</p>
      {notice && <p className="notice">{notice}</p>}
      <form onSubmit={submit}>
        {mode === "register" && (
          <label>
            Pozvánkový kód
            <input
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
        )}
        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>
        {error && <p className="notice">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {mode === "login" ? "Poslat přihlašovací odkaz" : "Založit účet"}
        </button>
      </form>
      <button className="btn linkish" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Mám pozvánkový kód" : "Už mám účet"}
      </button>
      <p className="sub" style={{ marginTop: 18 }}>
        <a href="/soukromi">Co ukládáme, a co ne</a>
      </p>
    </main>
  );
}
