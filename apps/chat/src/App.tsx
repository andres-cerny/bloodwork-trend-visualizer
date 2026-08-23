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
 * a ref in a `patient` event; this client pins it, shows who is open, and sends
 * the ref back with every turn. It never invents one.
 *
 * Three zones, the research layout doctors already know: the histories on the
 * left, the conversation in the middle, the evidence on the right. Below 960px
 * the left rail becomes a drawer and the evidence folds under each answer —
 * same components, same state, different width.
 *
 * `?fx=<slug>` replays a committed conversation with no session and no API
 * call; `&step=<n>` stops the last turn mid-stream. Both go through the same
 * `applyEvent` a live turn uses, so what renders here is what renders there.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, askAgent, getStatus, type Budget } from "@bw/api-client";
import { ThemeSwitch, useTurnstile } from "@bw/ui-kit";
import Transcript from "./Transcript";
import Composer from "./Composer";
import Sidebar from "./Sidebar";
import Sources from "./Sources";
import {
  applyEvent,
  newCursor,
  startBlock,
  type Block,
  type Cursor,
  type Effects,
  type Patient,
} from "./events";
import { findFixture, fixturesFor, replayFixture } from "./fixtures";

const TENANTS: Record<string, { label: string; blurb: string; suggestions: string[] }> = {
  sport: {
    label: "Sportovní medicína",
    blurb: "Vytrvalostní sportovci, sledování v sezóně",
    suggestions: [
      "Dej mi souhrn Tomáše Hrubého.",
      "Jak se vyvíjí ferritin Kláry Šebestové?",
      "Ukaž hemoglobin Vojtěcha Palána v grafu.",
    ],
  },
  orto: {
    label: "Ortopedie a fyzioterapie",
    blurb: "Pooperační průběh, fyzioterapie, dokumentace",
    suggestions: [
      "Dej mi souhrn Michala Nováka.",
      "Které předoperační hodnoty jsou mimo rozmezí?",
      "Shrň, co se změnilo od minulého odběru.",
    ],
  },
};

const DESKTOP = "(min-width: 960px)";

/** /sport and /orto are practices; anything else offers the choice. */
function tenantFromPath(): string | null {
  const slug = window.location.pathname.split("/")[1] ?? "";
  return slug in TENANTS ? slug : null;
}

function useDesktop(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** What `?fx=` and `&step=` ask for, resolved against the bundled fixtures. */
function initialReplay(tenant: string | null) {
  if (!tenant) return null;
  const params = new URLSearchParams(window.location.search);
  const fx = findFixture(tenant, params.get("fx"));
  if (!fx) return null;
  const raw = params.get("step");
  const step = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  return { slug: fx.slug, ...replayFixture(fx, step) };
}

export default function App() {
  const [tenant] = useState<string | null>(tenantFromPath);
  const desktop = useDesktop();
  const start = useState(() => initialReplay(tenant))[0];

  const [blocks, setBlocks] = useState<Block[]>(start?.blocks ?? []);
  const [fx, setFx] = useState<string | null>(start?.slug ?? null);
  const [busy, setBusy] = useState(start?.streaming ?? false);
  const [error, setError] = useState<string | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [patient, setPatient] = useState<Patient | null>(start?.patient ?? null);
  const [draft, setDraft] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState<{ blockId: number; n: number } | null>(null);
  const [openSources, setOpenSources] = useState<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  /** Block ids are handed out across replays and live turns alike. */
  const idRef = useRef(start?.nextId ?? 1);

  const onUnlock = useCallback(() => setError(null), []);
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
  }, [blocks, busy]);

  // A clicked [n] has to arrive somewhere visible, or the gesture is a no-op.
  useEffect(() => {
    if (!focus || !railRef.current) return;
    railRef.current
      .querySelector(`[data-src-n="${focus.n}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus]);

  const fixtures = useMemo(() => (tenant ? fixturesFor(tenant) : []), [tenant]);

  /** The registry the rail shows: the focused answer's, else the newest one's. */
  const evidence = useMemo(() => {
    if (focus) {
      const b = blocks.find((x) => x.id === focus.blockId);
      if (b && b.sources.length > 0) return b;
    }
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].sources.length > 0) return blocks[i];
    return null;
  }, [blocks, focus]);

  function resetThread() {
    setBlocks([]);
    setPatient(null);
    setFocus(null);
    setOpenSources(null);
    setError(null);
    setBusy(false);
    idRef.current = 1;
  }

  function openFixture(slug: string) {
    if (!tenant) return;
    const f = findFixture(tenant, slug);
    if (!f) return;
    const r = replayFixture(f, null);
    resetThread();
    setBlocks(r.blocks);
    setPatient(r.patient);
    idRef.current = r.nextId;
    setFx(slug);
    setDrawer(false);
    window.history.pushState(null, "", `/${tenant}?fx=${encodeURIComponent(slug)}`);
    const el = threadRef.current;
    if (el) el.scrollTop = 0;
  }

  function newThread() {
    if (!tenant) return;
    resetThread();
    setFx(null);
    setDraft("");
    setDrawer(false);
    window.history.pushState(null, "", `/${tenant}`);
  }

  const blocked = !gate.available
    ? "Asistent není v této ukázce zapnutý. Nedávné rozhovory zůstávají ke čtení."
    : budget?.frozen
      ? "Rozpočet ukázky na AI funkce je vyčerpán. Nedávné rozhovory zůstávají ke čtení."
      : null;

  /**
   * The one path a live turn takes. Every event goes through `applyEvent` —
   * the same function the replayer calls — and the cursor is read here, at
   * enqueue time, never inside a React updater.
   */
  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !tenant) return;

    const history = [
      ...blocks.flatMap((b) => {
        const answer = b.parts
          .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
          .map((p) => p.text)
          .join("\n");
        return [
          { role: "user" as const, content: b.question },
          ...(answer.trim() ? [{ role: "assistant" as const, content: answer }] : []),
        ];
      }),
      { role: "user" as const, content: q },
    ];

    const cur: Cursor = newCursor(idRef.current);
    setBlocks(startBlock(q, cur));
    idRef.current = cur.nextId;
    setDraft("");
    setBusy(true);
    setError(null);

    const on: Effects = {
      patient: setPatient,
      error: setError,
      done: () => {
        getStatus(tenant).then((s) => setBudget(s.budget)).catch(() => {});
      },
    };

    try {
      for await (const ev of askAgent({
        profile: "clinical",
        history,
        tenant,
        ...(patient ? { patientRef: patient.ref } : {}),
      })) {
        setBlocks(applyEvent(ev, cur, on));
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nepodařilo se odpovědět.");
      if (e instanceof ApiError && e.budget) setBudget(e.budget);
    } finally {
      setBusy(false);
    }
  }

  /** A suggestion or a follow-up: sent when the gate is open, drafted when not. */
  const onAsk = (text: string) => {
    if (gate.ready && !blocked && !busy) void send(text);
    else setDraft(text);
  };

  if (!tenant) {
    return (
      <div className="pick-page">
        <div className="pick">
          <h1>Klinický asistent</h1>
          <p className="pick-sub">Ukázka nad dvěma ordinacemi. Vyberte, kterou chcete otevřít.</p>
          {Object.entries(TENANTS).map(([slug, t]) => (
            <a key={slug} className="pick-card" href={`/${slug}`}>
              <span className="pick-name">{t.label}</span>
              <span className="pick-blurb">{t.blurb}</span>
            </a>
          ))}
          <div className="pick-foot">
            <ThemeSwitch />
          </div>
          <p className="disclaimer">
            Popisuje, nediagnostikuje. Ukázka — nezadávejte údaje skutečných pacientů.
          </p>
        </div>
      </div>
    );
  }

  const empty = blocks.length === 0;

  return (
    <div className="shell">
      <Sidebar
        practice={TENANTS[tenant].label}
        fixtures={fixtures}
        current={fx}
        open={drawer}
        budget={budget}
        onNew={newThread}
        onOpen={openFixture}
        onClose={() => setDrawer(false)}
      />
      {drawer && <button className="scrim" aria-label="Zavřít nabídku" onClick={() => setDrawer(false)} />}

      <main className="thread-col">
        {(!desktop || patient) && (
          <div className="thread-head">
            {!desktop && (
              <button
                type="button"
                className="drawer-toggle"
                data-testid="sidebar-toggle"
                aria-label="Otevřít nabídku"
                aria-expanded={drawer}
                onClick={() => setDrawer(true)}
              >
                <span aria-hidden="true">☰</span>
                <span className="drawer-toggle-label">{TENANTS[tenant].label}</span>
              </button>
            )}
            {patient && (
              <span
                className="patient-chip"
                data-testid="patient-chip"
                title={`Otevřená karta: ${patient.fullName}`}
              >
                <span className="dot" aria-hidden="true" />
                {patient.fullName}
                <span className="pat-year">nar. {patient.birthDate.slice(0, 4)}</span>
                <button
                  type="button"
                  aria-label="Zavřít kartu pacienta"
                  onClick={() => setPatient(null)}
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        )}

        <div className="thread" data-testid="thread" ref={threadRef}>
          <div className="thread-inner">
            {empty ? (
              <div className="empty">
                <h1>Na co se dnes podíváme?</h1>
                <p>
                  Zeptejte se na výsledky pacienta. Odpověď je vždy podložená řádkem
                  z nálezu nebo výňatkem z dokumentace.
                </p>
                <div className="rail-label">Například</div>
                <div className="fu-list">
                  {TENANTS[tenant].suggestions.map((s) => (
                    <button key={s} type="button" className="fu-item" onClick={() => onAsk(s)}>
                      <span>{s}</span>
                      <span className="fu-plus" aria-hidden="true">
                        +
                      </span>
                    </button>
                  ))}
                </div>
                <p className="empty-hint">
                  Nebo si otevřete některý z nedávných rozhovorů — načtou se bez ověření.
                </p>
              </div>
            ) : (
              <Transcript
                blocks={blocks}
                busy={busy}
                desktop={desktop}
                focus={focus}
                openSources={openSources}
                onCite={(blockId, n) => {
                  setFocus({ blockId, n });
                  if (!desktop) setOpenSources(blockId);
                }}
                onToggleSources={(id) => setOpenSources(openSources === id ? null : id)}
                onAsk={onAsk}
              />
            )}
            {error && <p className="err thread-err">{error}</p>}
          </div>
        </div>

        <Composer
          value={draft}
          onChange={setDraft}
          onSend={() => void send(draft)}
          busy={busy}
          ready={gate.ready}
          blocked={blocked}
          gateBoxRef={gate.boxRef}
          gateError={gate.error}
        />
      </main>

      {desktop && (
        <aside className="rail-evidence" data-testid="sources-panel" aria-label="Zdroje">
          <div className="rail-ev-head">
            <div className="rail-label">Zdroje</div>
            {evidence ? (
              <p className="rail-ev-sub">{evidence.question}</p>
            ) : (
              <p className="rail-ev-sub">
                Každé číslo v odpovědi má svůj řádek z tištěného nálezu. Objeví se tady.
              </p>
            )}
          </div>
          <div className="rail-ev-body" ref={railRef}>
            {evidence && (
              <Sources
                sources={evidence.sources}
                focusedN={focus && focus.blockId === evidence.id ? focus.n : null}
              />
            )}
          </div>
        </aside>
      )}
    </div>
  );
}
