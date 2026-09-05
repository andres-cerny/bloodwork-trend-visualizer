/**
 * Moje krev's door: who are you, or the login form.
 *
 * This file is the door and nothing else. Three paths lead into the app —
 * "/" is the login, "/registrace" and "/heslo" are the two kinds of link the
 * operator sends (ui/InvitePage.tsx) — and "/soukromi" is the one public
 * page beside them. The shell serves index.html for any path, so this is
 * the whole router. Everything behind the door — upload, verification,
 * trends — is ui/Portal.tsx.
 */
import { useEffect, useState } from "react";
import InvitePage from "./ui/InvitePage";
import Portal from "./ui/Portal";
import Privacy from "./ui/Privacy";
import { Door, fetchMe, messageOf, type Me } from "./ui/Door";
import { login } from "./lib/api";

export default function App() {
  // Set once a link has opened the account: from then on this is the portal,
  // whatever path the link arrived on.
  const [entered, setEntered] = useState<Me | null>(null);
  const path = location.pathname;
  if (path === "/soukromi") return <Privacy />;
  if (!entered && (path === "/registrace" || path === "/heslo")) {
    return (
      <InvitePage
        onDone={(me) => {
          history.replaceState(null, "", "/");
          setEntered(me);
        }}
      />
    );
  }
  return <Home initial={entered} />;
}

type Screen = { kind: "loading" } | { kind: "login" } | { kind: "home"; me: Me };

function Home({ initial }: { initial: Me | null }) {
  const [screen, setScreen] = useState<Screen>(initial ? { kind: "home", me: initial } : { kind: "loading" });

  useEffect(() => {
    if (initial) return;
    void fetchMe().then((me) => setScreen(me ? { kind: "home", me } : { kind: "login" }));
  }, [initial]);

  switch (screen.kind) {
    case "loading":
      return null;
    case "login":
      return <Login onDone={(me) => setScreen({ kind: "home", me })} />;
    case "home":
      return <Portal email={screen.me.email} onLogout={() => setScreen({ kind: "login" })} />;
  }
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
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
      <p className="sub">Krevní testy v čase. Bez jména, bez rodného čísla — jen vaše hodnoty.</p>
      <form onSubmit={submit}>
        <label>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label>
          Heslo
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="notice">{error}</p>}
        <button className="btn primary" disabled={busy}>
          Přihlásit se
        </button>
      </form>
      <p className="sub">Zapomenuté heslo? Napište mi a pošlu vám odkaz.</p>
      <p className="door-foot sub">
        <a href="/soukromi">Co ukládáme, a co ne</a>
      </p>
    </Door>
  );
}
