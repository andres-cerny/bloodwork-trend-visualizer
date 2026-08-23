/**
 * The clinical agent, as its own app.
 *
 * This app renders; it does not reason. It holds no lab code and imports
 * neither lab-core nor the toolset — every number it shows arrived through the
 * agent, which got it from the deterministic layer. That is what lets the data
 * source live in a practice's database without the client learning anything.
 *
 * The URL path is the practice: /sport and /orto are separate tenants over
 * separate databases, and the server refuses a slug it does not know. The
 * patient is a chip, not a belief: the server resolves identity and hands back
 * a ref in a `patient` event; this client pins it, shows who is open, and
 * sends the ref back with every turn. It never invents one.
 *
 * Three zones, because research is three questions at once: what did I ask
 * before (left), what does it say (centre), and how does it know (right). On a
 * phone the left becomes a drawer and the right folds under each answer — the
 * same components, at column width.
 *
 * `?fx=<slug>` replays a committed conversation with no session and no call to
 * the worker; `&step=<n>` stops partway through the last turn. Both go through
 * `applyEvent`, exactly like a live turn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, askAgent, getStatus, type Budget } from "@bw/api-client";
import { ThemeSwitch, useTurnstile } from "@bw/ui-kit";
import Composer from "./Composer";
import Sidebar from "./Sidebar";
import Sources from "./Sources";
import Transcript from "./Transcript";
import { FIXTURES, findFixture, isPaused, replay } from "./fixtures";
import {
  answerText,
  applyEvent,
  emptyThread,
  startTurn,
  type Thread,
  type UiEvent,
} from "./thread";

const TENANTS: Record<string, { label: string; suggestions: string[] }> = {
  sport: {
    label: "Sportovní medicína",
    suggestions: [
      "Dej mi souhrn Tomáše Hrubého.",
      "Jak se vyvíjí ferritin Kláry Šebestové?",
      "Ukaž hemoglobin Vojtěcha Palána v grafu.",
    ],
  },
  orto: {
    label: "Ortopedie a fyzioterapie",
    suggestions: [
      "Dej mi souhrn Michala Nováka.",
      "Které předoperační hodnoty jsou mimo rozmezí?",
      "Shrň, co se změnilo od minulého odběru.",
    ],
  },
};

/** /sport and /orto are practices; anything else offers the choice. */
function tenantFromPath(): string | null {
  const slug = window.location.pathname.split("/")[1] ?? "";
  return slug in TENANTS ? slug : null;
}

/**
 * The whole first paint, decided from the URL alone.
 *
 * Read once, in a state initialiser: a replay that arrives in a second render
 * is a replay the reader watches flicker into place.
 */
function boot(tenant: string | null) {
  const empty = { thread: emptyThread(), slug: null as string | null, paused: false };
  if (!tenant) return empty;
  const q = new URLSearchParams(window.location.search);
  const slug = q.get("fx");
  if (!slug) return empty;
  const fx = findFixture(tenant, slug);
  // Unknown slug → the normal empty state. A demo URL that rots should look
  // like a fresh thread, not like an error.
  if (!fx) return empty;
  const raw = q.get("step");
  const step = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  return { thread: replay(fx, step), slug, paused: isPaused(fx, step) };
}

/** Czech counts three ways, and „3 uložená konverzace" reads as a typo. */
const conversations = (n: number): string =>
  n === 1
    ? "1 uložená konverzace"
    : n < 5
      ? `${n} uložené konverzace`
      : `${n} uložených konverzací`;

/** Which layout is on screen. The rail and the disclosure are exclusive. */
function useDesktop(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 960px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 960px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export default function App() {
  const [tenant] = useState<string | null>(tenantFromPath);
  const start = useMemo(() => boot(tenant), [tenant]);

  const [thread, setThread] = useState<Thread>(start.thread);
  const [slug, setSlug] = useState<string | null>(start.slug);
  const [paused, setPaused] = useState(start.paused);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState<{ block: number; n: number | null } | null>(null);
  const [openSources, setOpenSources] = useState<Record<number, boolean>>({});
  const threadRef = useRef<HTMLDivElement>(null);
  const desktop = useDesktop();

  const onUnlock = useCallback(() => undefined, []);
  const gate = useTurnstile(
    import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
    onUnlock,
  );

  useEffect(() => {
    if (tenant) getStatus(tenant).then((s) => setBudget(s.budget)).catch(() => {});
  }, [tenant]);

  // A reply that lands below the fold reads as no reply at all.
  useEffect(() => {
    const el = threadRef.current;
    if (el && busy) el.scrollTop = el.scrollHeight;
  }, [thread, busy]);

  const blocked = !gate.available
    ? "Asistent není v této ukázce zapnutý."
    : budget?.frozen
      ? "Rozpočet ukázky na AI funkce je vyčerpán."
      : null;

  const canSend = !blocked && gate.ready && !busy;

  /**
   * One turn, live.
   *
   * Every event goes through the same `applyEvent` the replayer uses, and the
   * updater is pure — the "is a paragraph open?" question is answered from the
   * state being updated, never from a flag this loop has already moved past.
   */
  async function send(text: string) {
    const q = text.trim();
    if (!q || !tenant || busy) return;
    // Pre-gate, a suggestion fills the composer instead of sending: the reader
    // sees what they are about to ask, and asks it once verified.
    if (!canSend) {
      setDraft(q);
      return;
    }

    const history = thread.blocks.flatMap((b) => {
      const a = answerText(b);
      return a
        ? [
            { role: "user" as const, content: b.question },
            { role: "assistant" as const, content: a },
          ]
        : [{ role: "user" as const, content: b.question }];
    });
    history.push({ role: "user" as const, content: q });

    setThread((s) => startTurn(s, q));
    setDraft("");
    setFocus(null);
    setBusy(true);

    try {
      for await (const ev of askAgent({
        profile: "clinical",
        history,
        tenant,
        ...(thread.patient ? { patientRef: thread.patient.ref } : {}),
      })) {
        setThread((s) => applyEvent(s, ev as UiEvent));
        if (ev.type === "done") getStatus(tenant).then((s) => setBudget(s.budget)).catch(() => {});
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Nepodařilo se odpovědět.";
      setThread((s) => applyEvent(s, { type: "error", message }));
      if (e instanceof ApiError && e.budget) setBudget(e.budget);
    } finally {
      setBusy(false);
    }
  }

  function openFixture(next: string) {
    if (!tenant) return;
    const fx = findFixture(tenant, next);
    if (!fx) return;
    setThread(replay(fx));
    setSlug(next);
    setPaused(false);
    setFocus(null);
    setOpenSources({});
    setDrawer(false);
    window.history.pushState(null, "", `/${tenant}?fx=${encodeURIComponent(next)}`);
    if (threadRef.current) threadRef.current.scrollTop = 0;
  }

  function newThread() {
    if (!tenant) return;
    setThread(emptyThread());
    setSlug(null);
    setPaused(false);
    setFocus(null);
    setOpenSources({});
    setDrawer(false);
    setDraft("");
    window.history.pushState(null, "", `/${tenant}`);
  }

  if (!tenant) {
    return (
      <div className="picker">
        <header className="picker-top">
          <strong>Klinický asistent</strong>
          <ThemeSwitch />
        </header>
        <main className="picker-main">
          <h1 className="picker-h">Vyberte ordinaci</h1>
          <p className="picker-lead">
            Každá ordinace má vlastní kartotéku, odběry a dokumentaci. Asistent odpovídá jen
            nad tou, kterou otevřete.
          </p>
          <div className="picker-cards">
            {Object.entries(TENANTS).map(([s, t]) => (
              <a key={s} className="picker-card" href={`/${s}`}>
                <span className="picker-name">{t.label}</span>
                <span className="picker-hint">
                  {conversations((FIXTURES[s] ?? []).length)} · {t.suggestions[0]}
                </span>
                <span className="picker-go" aria-hidden="true">
                  →
                </span>
              </a>
            ))}
          </div>
        </main>
        <footer className="picker-foot">
          Ukázka nad syntetickými pacienty. Popisuje, nediagnostikuje.
        </footer>
      </div>
    );
  }

  const blocks = thread.blocks;
  // The rail follows the answer the reader is looking at: the one whose [n]
  // they clicked, otherwise the latest that has evidence at all.
  const focused =
    (focus && blocks.find((b) => b.id === focus.block && b.sources.length > 0)) ??
    [...blocks].reverse().find((b) => b.sources.length > 0) ??
    null;

  const onCite = (block: number, n: number) => {
    setFocus({ block, n });
    if (!desktop) setOpenSources((s) => ({ ...s, [block]: true }));
  };

  return (
    <div className={`shell${drawer ? " drawer-open" : ""}`}>
      <Sidebar
        practice={TENANTS[tenant].label}
        fixtures={FIXTURES[tenant] ?? []}
        active={slug}
        budget={budget}
        open={drawer}
        onOpen={openFixture}
        onNew={newThread}
        onClose={() => setDrawer(false)}
      />
      <button
        type="button"
        className="scrim"
        aria-label="Zavřít panel"
        tabIndex={-1}
        onClick={() => setDrawer(false)}
      />

      <div className="center">
        <header className="bar">
          <button
            type="button"
            className="icon-btn bar-toggle"
            data-testid="sidebar-toggle"
            aria-label="Otevřít historii"
            onClick={() => setDrawer(true)}
          >
            ☰
          </button>
          <span className="bar-title">
            {slug ? findFixture(tenant, slug)?.title : blocks.length ? blocks[0].question : "Nové vlákno"}
          </span>
          {thread.patient && (
            <span
              className="pchip"
              data-testid="patient-chip"
              title={`Otevřená karta: ${thread.patient.fullName}`}
            >
              <span className="pchip-dot" aria-hidden="true" />
              <span className="pchip-name">{thread.patient.fullName}</span>
              <span className="pchip-born">nar. {thread.patient.birthDate.slice(0, 4)}</span>
              <button
                type="button"
                aria-label="Zavřít kartu pacienta"
                onClick={() => setThread((s) => ({ ...s, patient: null }))}
              >
                ✕
              </button>
            </span>
          )}
        </header>

        <div className="thread" data-testid="thread" ref={threadRef}>
          {blocks.length === 0 ? (
            <div className="empty">
              <h2>Zeptejte se na výsledky pacienta</h2>
              <p className="empty-lead">
                Asistent čte kartotéku, odběry, jejich vývoj a dokumentaci této ordinace.
                Každé číslo v odpovědi má svůj zdroj.
              </p>
              <span className="eyebrow">Příklady</span>
              <ul className="sugg">
                {TENANTS[tenant].suggestions.map((s) => (
                  <li key={s}>
                    <button type="button" onClick={() => send(s)}>
                      <span>{s}</span>
                      <span className="fu-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="caps">
                Kartotéka · Odběry · Vývoj hodnot · Grafy · Dokumentace · Citace
              </p>
            </div>
          ) : (
            <Transcript
              blocks={blocks}
              live={busy || paused}
              desktop={desktop}
              focus={focus}
              openSources={openSources}
              onCite={onCite}
              onToggleSources={(id) => setOpenSources((s) => ({ ...s, [id]: !s[id] }))}
              onAsk={send}
            />
          )}
        </div>

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => send(draft)}
          busy={busy}
          gate={gate}
          blocked={blocked}
        />
      </div>

      {desktop && (
        <aside className="rail-right" data-testid="sources-panel">
          <div className="rail-head-r">
            <span className="eyebrow">Zdroje</span>
            {focused && <span className="rail-count">{focused.sources.length}</span>}
          </div>
          {focused ? (
            <div className="rail-scroll">
              <p className="rail-q" title={focused.question}>
                {focused.question}
              </p>
              <Sources
                sources={focused.sources}
                focus={focus && focus.block === focused.id ? focus.n : null}
              />
            </div>
          ) : (
            <div className="rail-scroll">
              <p className="rail-empty">
                Zdroje se objeví tady — vždy ta místa v odběru nebo v dokumentu, ze kterých
                odpověď vychází.
              </p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
