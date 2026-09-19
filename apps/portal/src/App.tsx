/**
 * Moje krev's door: who are you, or the login form.
 *
 * This file is the door and nothing else. Logged out, "/" is the landing
 * page (ui/LandingPage.tsx) and "/prihlaseni" the login form; "/registrace?kod=…"
 * and "/heslo?kod=…" are the two kinds of link the operator or the mail
 * sends (ui/InvitePage.tsx); "/registrace" bare and "/zapomenute-heslo" are
 * the open door's two forms that mail a link (ui/RegisterPage.tsx);
 * "/soukromi", "/podminky" and "/proc-prikoupit" are the public pages
 * beside them. The shell serves index.html for any path, so this is the
 * whole router. Everything behind the door — upload, verification, trends —
 * is ui/Portal.tsx.
 */
import { useEffect, useState } from "react";
import { PORTAL_TURNSTILE_ACTIONS } from "@bw/gate/turnstile";
import ContactPage from "./ui/ContactPage";
import InvitePage from "./ui/InvitePage";
import Portal from "./ui/Portal";
import Privacy from "./ui/Privacy";
import WhyPayPage from "./ui/WhyPayPage";
import RegisterPage from "./ui/RegisterPage";
import TermsPage from "./ui/TermsPage";
import LandingPage, { LOGIN_PATH } from "./ui/LandingPage";
import { Door, DoorWays, TurnstileBox, fetchMe, messageOf, type Me, useShownPassword, useSignupOpen } from "./ui/Door";
import { login } from "./lib/api";
import { useTurnstile } from "./lib/turnstile";

export default function App() {
  // Set once a link has opened the account: from then on this is the portal,
  // whatever path the link arrived on.
  const [entered, setEntered] = useState<Me | null>(null);
  const path = location.pathname;
  if (path === "/soukromi") return <Privacy />;
  if (path === "/napiste-nam") return <ContactPage />;
  if (path === "/proc-prikoupit") return <WhyPayPage />;
  if (path === "/podminky") return <TermsPage />;
  // The open door (ui/RegisterPage.tsx): /registrace without a code asks
  // for an address and mails the link; with one it is the operator's
  // sign-up link as before.
  const hasCode = new URLSearchParams(location.search).has("kod");
  if (!entered && path === "/registrace" && !hasCode) return <RegisterPage mode="register" />;
  if (!entered && path === "/zapomenute-heslo") return <RegisterPage mode="forgot" />;
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
    case "login": {
      // The stranger's first page is the landing; the form is one link on.
      // Either way in lands on "/", so a reload after login shows the portal
      // and not a login form over it.
      const done = (me: Me) => {
        history.replaceState(null, "", "/");
        setScreen({ kind: "home", me });
      };
      return location.pathname === LOGIN_PATH ? <Login onDone={done} /> : <LandingPage onDone={done} />;
    }
    case "home":
      return <Portal email={screen.me.email} demo={screen.me.demo} onLogout={() => setScreen({ kind: "login" })} />;
  }
}

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const pw = useShownPassword();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The open door's two extras and its bot gate (ui/Door.tsx, lib/turnstile.ts).
  // The demo patient is offered on the landing page, not here.
  const open = useSignupOpen();
  const gate = useTurnstile(PORTAL_TURNSTILE_ACTIONS.login);

  /** One call, then the same question the three password doors ask. */
  async function enter(open: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await open();
      const me = await fetchMe();
      if (me) onDone(me);
      else setError("Přihlášení se nezdařilo. Zkuste to prosím znovu.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (gate.available && !gate.token) {
      setError("Počkejte prosím na ověření, že nejste robot.");
      return;
    }
    await enter(() => login(email, password, gate.token));
    // A token is single-use: whatever the answer, the next try needs a new one.
    gate.reset();
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
            type={pw.type}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {pw.toggle}
        <TurnstileBox gate={gate} />
        {error && <p className="notice">{error}</p>}
        <button className="btn primary" disabled={busy}>
          Přihlásit se
        </button>
      </form>
      <DoorWays open={open} />
      {/* Each link its own box (flex, not inline text): at 360 the row wraps,
          and an inline anchor that wraps covers the whole line. */}
      <nav className="door-foot legal-foot" aria-label="Další cesty">
        <a href="/">← Úvod</a>
        <span aria-hidden="true">·</span>
        <a href="/soukromi">Co ukládáme, a co ne</a>
        <span aria-hidden="true">·</span>
        <a href="/napiste-nam">Napište nám</a>
      </nav>
    </Door>
  );
}
