/**
 * Kapka's walking skeleton: who are you, or the door.
 *
 * Phase 1 ends where the home screen begins — a logged-in shell with the
 * account's e-mail is the proof the whole auth loop works. Upload, verify and
 * trends arrive in later phases; this file should stay the door and nothing
 * else.
 */
import { useEffect, useState } from "react";

interface Me {
  email: string;
  createdAt: string;
}

type Screen =
  | { kind: "loading" }
  | { kind: "login"; notice: string | null }
  | { kind: "sent"; message: string; devLink: string | null }
  | { kind: "home"; me: Me };

async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me").catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json()) as Me;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });

  useEffect(() => {
    // The confirm redirect lands on "/" with a cookie, or back here with
    // ?prihlaseni=neplatne when the link was spent or expired.
    const invalidLink = new URLSearchParams(location.search).get("prihlaseni") === "neplatne";
    if (invalidLink) history.replaceState(null, "", "/");
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
          <h1>Kapka</h1>
          <p className="sub">{screen.message}</p>
          <p className="sub">Odkaz platí 15 minut. Zavřít tuto záložku ničemu nevadí.</p>
          {screen.devLink && (
            <p className="sub">
              <a href={screen.devLink}>Vývojové přihlášení</a>
            </p>
          )}
        </main>
      );
    case "home":
      return <Home me={screen.me} onLogout={() => setScreen({ kind: "login", notice: null })} />;
  }
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
      <h1>Kapka</h1>
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
    </main>
  );
}

function Home({ me, onLogout }: { me: Me; onLogout: () => void }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    onLogout();
  }
  return (
    <main className="door">
      <h1>Kapka</h1>
      <p className="sub">Přihlášení: {me.email}</p>
      <p className="sub">Zatím tu nic není — nahrávání výsledků přijde v další fázi.</p>
      <button className="btn" onClick={logout}>
        Odhlásit se
      </button>
    </main>
  );
}
