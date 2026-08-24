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
 * Three zones, the shape a doctor already knows from a research assistant:
 * threads on the left, the conversation in the middle, the evidence on the
 * right. On a phone the left zone is a drawer and the right zone folds into a
 * „Zdroje (n)" disclosure under each answer — the composer stays pinned above
 * the keyboard, because the phone case is the strict one.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, askAgent, getStatus, type Budget } from "@bw/api-client";
import type { AgentEvent } from "@bw/agent-core/events";
import { ThemeSwitch, useTurnstile } from "@bw/ui-kit";
import Transcript, { type Block } from "./Transcript";
import Composer from "./Composer";
import Sidebar from "./Sidebar";
import Sources, { type Source } from "./Sources";
import { FIXTURES, findFixture, type Fixture } from "./fixtures";

const TENANTS: Record<string, { label: string; blurb: string; suggestions: string[] }> = {
  sport: {
    label: "Sportovní medicína",
    blurb: "Laboratoře, sportovní prohlídky a tréninková pásma.",
    suggestions: [
      "Dej mi souhrn Tomáše Hrubého.",
      "Jak se vyvíjí ferritin Kláry Šebestové?",
      "Ukaž hemoglobin Vojtěcha Palána v grafu.",
    ],
  },
  orto: {
    label: "Ortopedie a fyzioterapie",
    blurb: "Předoperační odběry, operační protokoly a záznamy z fyzioterapie.",
    suggestions: [
      "Dej mi souhrn Michala Nováka.",
      "Které předoperační hodnoty jsou mimo rozmezí?",
      "Kteří pacienti mají hemoglobin pod referenčním rozmezím?",
    ],
  },
};

interface Patient {
  ref: string;
  fullName: string;
  birthDate: string;
}

/** Everything one thread knows. Replay and a live turn produce the same thing. */
interface Thread {
  blocks: Block[];
  patient: Patient | null;
  error: string | null;
}

const EMPTY: Thread = { blocks: [], patient: null, error: null };

/* ------------------------------------------------------------------ *
 * One event-applying path.
 * ------------------------------------------------------------------ */

/**
 * Fold one agent event into the thread.
 *
 * There is exactly one of these, and both the live stream and the fixture
 * replayer go through it — which is what makes a rendered fixture evidence
 * that the UI handles the event grammar, rather than evidence that the fixture
 * was written to match the renderer.
 *
 * It is a pure reducer of `(thread, event)`, and that is load-bearing rather
 * than tasteful. The first version kept the "is a bubble open?" flag in a local
 * variable and read it inside the state updater; React applies updaters after
 * the await loop has already moved the flag on, so the first fragment after a
 * chart replaced the chart instead of opening a new part. The fix then was to
 * capture the flag at enqueue time. The fix now is structural: whether a part
 * is open is derived from `prev` at apply time — it is the last part, and it is
 * text — so there is no flag to read at the wrong moment, and StrictMode's
 * double invocation is harmless because nothing here mutates.
 */
function applyEvent(thread: Thread, ev: AgentEvent): Thread {
  const i = thread.blocks.length - 1;
  if (i < 0) return thread;
  const b = thread.blocks[i];
  const put = (patch: Partial<Block>): Thread => ({
    ...thread,
    blocks: [...thread.blocks.slice(0, i), { ...b, ...patch }],
  });

  switch (ev.type) {
    case "text": {
      const last = b.parts[b.parts.length - 1];
      // A tool step, a chart or a source registry ends the paragraph the agent
      // was writing; the next fragment starts a new one instead of repainting
      // everything said before the interruption into it.
      if (last?.kind === "text")
        return put({
          parts: [...b.parts.slice(0, -1), { kind: "text", text: last.text + ev.text }],
        });
      return put({ parts: [...b.parts, { kind: "text", text: ev.text }] });
    }
    case "tool_start":
      // Showing the step is the point of streaming a tool-using turn: the agent
      // spends most of it not talking.
      return put({
        parts: [...b.parts, { kind: "tool", name: ev.name, pending: true }],
      });
    case "tool_result": {
      // findLastIndex needs ES2023; this targets ES2022 and the array is a
      // conversation, not a dataset.
      let k = -1;
      for (let j = b.parts.length - 1; j >= 0; j--) {
        const p = b.parts[j];
        if (p.kind === "tool" && p.pending) {
          k = j;
          break;
        }
      }
      if (k === -1) return thread;
      const parts = [...b.parts];
      parts[k] = {
        kind: "tool",
        name: ev.name,
        pending: false,
        ok: ev.ok,
        summary: ev.summary,
      };
      return put({ parts });
    }
    case "chart":
      // The model named this chart; the series came from the data source.
      return put({
        parts: [...b.parts, { kind: "chart", spec: ev.spec, series: ev.series }],
      });
    case "sources":
      return put({ sources: ev.sources as unknown as Source[] });
    case "followups":
      // The model's own proposals. No event, no chips — never a canned menu.
      return put({ followups: ev.questions });
    case "patient":
      // The server resolved who the conversation is about. Pin the ref; the
      // chip is what keeps a near-miss visible.
      return {
        ...thread,
        patient: {
          ref: ev.ref,
          fullName: ev.fullName,
          birthDate: ev.birthDate,
        },
      };
    case "error":
      return { ...thread, error: ev.message };
    case "done":
      return put({ streaming: false });
    default:
      return thread;
  }
}

const nextId = (blocks: Block[]) => blocks.reduce((m, b) => Math.max(m, b.id), -1) + 1;

/** Open a question. Everything the agent does next hangs under it. */
function ask(thread: Thread, question: string): Thread {
  return {
    ...thread,
    error: null,
    blocks: [
      ...thread.blocks,
      {
        id: nextId(thread.blocks),
        question,
        parts: [],
        sources: [],
        followups: [],
        streaming: true,
      },
    ],
  };
}

/**
 * A committed conversation, folded into a thread.
 *
 * `step` truncates the LAST turn to its first n events — the mid-stream state,
 * with earlier turns whole. That is the screenshot script's contract, and it is
 * also the only honest way to photograph streaming: the pending tool row and
 * the half-written answer are real states of the same reducer, not a mock.
 */
function replay(fx: Fixture, step: number | null): Thread {
  let t: Thread = EMPTY;
  fx.turns.forEach((turn, i) => {
    t = ask(t, turn.user);
    const last = i === fx.turns.length - 1;
    const events = last && step !== null ? turn.events.slice(0, step) : turn.events;
    for (const ev of events) t = applyEvent(t, ev);
  });
  return t;
}

/** What the worker needs to continue a thread it never streamed. */
function toHistory(
  blocks: Block[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const b of blocks) {
    out.push({ role: "user", content: b.question });
    const said = b.parts
      .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
      .map((p) => p.text)
      .join("\n\n");
    if (said) out.push({ role: "assistant", content: said });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

/** /sport and /orto are practices; anything else offers the choice. */
function tenantFromPath(): string | null {
  const slug = window.location.pathname.split("/")[1] ?? "";
  return slug in TENANTS ? slug : null;
}

function replayFromUrl(tenant: string | null): {
  slug: string | null;
  step: number | null;
} {
  if (!tenant) return { slug: null, step: null };
  const q = new URLSearchParams(window.location.search);
  const slug = q.get("fx");
  const raw = q.get("step");
  const step = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  return { slug: findFixture(tenant, slug) ? slug : null, step };
}

/** The newest answer that cited anything — what the rail shows by default. */
function lastWithSources(blocks: Block[]): Block | null {
  for (let i = blocks.length - 1; i >= 0; i--)
    if (blocks[i].sources.length) return blocks[i];
  return null;
}

const DESKTOP = "(min-width: 960px)";

function useDesktop(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

/**
 * Which palette is actually painting, as Turnstile spells it.
 *
 * The widget is an iframe Cloudflare styles, so it is the one surface in the
 * app that a token cannot reach: left alone it renders white, and on the dark
 * composer that is a 300×75 lightbox — the same "light asset dropped into a
 * dark page" the rail's crops were fixed for.
 *
 * ThemeSwitch owns the state and writes it to both places: `data-theme` on the
 * root and `bloodwork-theme` in localStorage. This reads the root, because the
 * root is what the CSS obeys, and falls back to storage for the first paint —
 * ThemeSwitch's effect runs after this component's initialiser, so on the very
 * first render the attribute is not on the element yet, and reading only the
 * attribute would mount a light widget and then rebuild it.
 *
 * No attribute and no stored choice is „Systém", and „Systém" is `auto`: the
 * iframe then asks `prefers-color-scheme` for itself, which is exactly the
 * question the missing attribute was deferring to.
 */
type Palette = "light" | "dark" | "auto";

function readPalette(): Palette {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  try {
    const v = localStorage.getItem("bloodwork-theme");
    if (v === "dark" || v === "light") return v;
  } catch {
    /* storage blocked — the system palette is a fine answer */
  }
  return "auto";
}

function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(readPalette);
  useEffect(() => {
    const sync = () => setPalette(readPalette());
    // Once on mount, because ThemeSwitch's own effect has just run and may
    // have set the attribute since this component rendered.
    sync();
    const ob = new MutationObserver(sync);
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => ob.disconnect();
  }, []);
  return palette;
}

/* ------------------------------------------------------------------ *
 * The app
 * ------------------------------------------------------------------ */

export default function App() {
  const [tenant] = useState<string | null>(tenantFromPath);
  const [initial] = useState(() => replayFromUrl(tenant));
  const [slug, setSlug] = useState<string | null>(initial.slug);
  const [thread, setThread] = useState<Thread>(() => {
    const fx = tenant && findFixture(tenant, initial.slug);
    return fx ? replay(fx, initial.step) : EMPTY;
  });

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [focus, setFocus] = useState<{
    blockId: number;
    n: number | null;
  } | null>(null);
  const [openSources, setOpenSources] = useState<Set<number>>(new Set());

  const desktop = useDesktop();
  const threadRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState(0);

  // The composer floats over the thread, so the thread has to end above it —
  // and how tall it is depends on what is inside: the input alone, the input
  // with a Turnstile widget under it, or the input with an error over it. A
  // fixed padding worked for one of those three and hid a follow-up chip
  // behind the box in the other two.
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const measure = () => setDockH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onUnlock = useCallback(() => setThread((t) => ({ ...t, error: null })), []);
  const palette = usePalette();
  const gate = useTurnstile(
    import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
    onUnlock,
    { theme: palette },
  );

  useEffect(() => {
    if (tenant)
      getStatus(tenant)
        .then((s) => setBudget(s.budget))
        .catch(() => {});
  }, [tenant]);

  // Switching threads is a pushState, so Back has to mean something. Without
  // this the URL walks backwards while the screen does not, which is worse
  // than not having history at all.
  useEffect(() => {
    if (!tenant) return;
    const onPop = () => {
      const { slug: s, step } = replayFromUrl(tenant);
      const fx = findFixture(tenant, s);
      setSlug(fx ? fx.slug : null);
      setThread(fx ? replay(fx, step) : EMPTY);
      setFocus(null);
      setOpenSources(new Set());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [tenant]);

  // A reply that lands below the fold reads as no reply at all. Only while a
  // live turn is running: a replay opens at its first question, the way a
  // reopened thread should.
  useEffect(() => {
    if (!busy) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, busy]);

  const blocked = !gate.available
    ? "Asistent není v této ukázce zapnutý. Uložená vlákna vlevo si můžete přečíst."
    : budget?.frozen
      ? "Rozpočet ukázky na AI funkce je vyčerpán. Uložená vlákna vlevo si můžete přečíst."
      : null;

  /* --- thread switching ------------------------------------------- */

  const openThread = useCallback(
    (next: string | null) => {
      if (!tenant) return;
      const fx = next ? findFixture(tenant, next) : null;
      window.history.pushState({}, "", fx ? `/${tenant}?fx=${fx.slug}` : `/${tenant}`);
      setSlug(fx ? fx.slug : null);
      setThread(fx ? replay(fx, null) : EMPTY);
      setFocus(null);
      setOpenSources(new Set());
      setDraft("");
      setDrawer(false);
    },
    [tenant],
  );

  /* --- sending ------------------------------------------------------ */

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || !tenant || blocked || !gate.ready) return;

    const before = thread;
    const history = [
      ...toHistory(before.blocks),
      { role: "user" as const, content: question },
    ];
    setDraft("");
    setThread((t) => ask(t, question));
    setBusy(true);

    try {
      for await (const ev of askAgent({
        profile: "clinical",
        history,
        tenant,
        ...(before.patient ? { patientRef: before.patient.ref } : {}),
      })) {
        setThread((t) => applyEvent(t, ev));
        if (ev.type === "done")
          getStatus(tenant)
            .then((s) => setBudget(s.budget))
            .catch(() => {});
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Nepodařilo se odpovědět.";
      setThread((t) => ({
        ...t,
        error: message,
        blocks: t.blocks.map((b, i) =>
          i === t.blocks.length - 1 ? { ...b, streaming: false } : b,
        ),
      }));
      if (e instanceof ApiError && e.budget) setBudget(e.budget);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A suggestion or a follow-up chip before the gate is passed fills the
   * composer instead of being swallowed: the question is the doctor's, and
   * losing it to a robot test is the rudest thing this screen could do.
   */
  function pick(text: string) {
    if (blocked || !gate.ready) {
      setDraft(text);
      dockRef.current?.querySelector("input")?.focus();
      return;
    }
    void send(text);
  }

  function onCite(blockId: number, n: number) {
    setFocus({ blockId, n });
    if (!desktop) setOpenSources((prev) => new Set(prev).add(blockId));
  }

  /* --- the practice picker ------------------------------------------ */

  if (!tenant) {
    return (
      <div className="picker">
        <header className="picker-top">
          <ThemeSwitch />
        </header>
        <main className="picker-main">
          <span className="brand-mark picker-mark" aria-hidden="true" />
          <h1>Klinický asistent</h1>
          <p className="muted">
            Ptejte se na laboratorní výsledky a dokumentaci pacienta. Vyberte ordinaci:
          </p>
          <div className="picker-cards">
            {Object.entries(TENANTS).map(([s, t]) => (
              <a key={s} className="picker-card" href={`/${s}`}>
                <strong>{t.label}</strong>
                <span className="muted">{t.blurb}</span>
              </a>
            ))}
          </div>
        </main>
        <footer className="picker-foot muted">
          Popisuje, nediagnostikuje. Ukázka — nezadávejte údaje skutečných pacientů.
        </footer>
      </div>
    );
  }

  /* --- the thread --------------------------------------------------- */

  const { blocks, patient } = thread;
  const empty = blocks.length === 0;
  // The rail shows the answer whose [n] was clicked, and otherwise the latest
  // answer that has any evidence at all.
  const focused = focus
    ? (blocks.find((b) => b.id === focus.blockId) ?? null)
    : lastWithSources(blocks);

  return (
    <div className="shell">
      <Sidebar
        practice={TENANTS[tenant].label}
        fixtures={FIXTURES[tenant] ?? []}
        activeSlug={slug}
        budget={budget}
        open={drawer}
        onPick={openThread}
        onNew={() => openThread(null)}
        onClose={() => setDrawer(false)}
      />
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <div
        className={`center${empty ? " is-empty" : ""}`}
        style={{ "--dock-h": `${dockH}px` } as React.CSSProperties}
      >
        {(!desktop || patient) && (
          <div className="topbar">
            <div className="column">
              <button
                type="button"
                className="drawer-toggle"
                data-testid="sidebar-toggle"
                aria-label="Zobrazit vlákna"
                onClick={() => setDrawer(true)}
              >
                <span aria-hidden="true">☰</span>
              </button>
              {patient ? (
                <span
                  className="patient-chip"
                  data-testid="patient-chip"
                  title={`Otevřená karta: ${patient.fullName}`}
                >
                  <span className="patient-dot" aria-hidden="true" />
                  {patient.fullName} · nar. {patient.birthDate.slice(0, 4)}
                  <button
                    type="button"
                    aria-label="Zavřít kartu pacienta"
                    onClick={() => setThread((t) => ({ ...t, patient: null }))}
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <span className="topbar-title">{TENANTS[tenant].label}</span>
              )}
            </div>
          </div>
        )}

        <div className="thread" data-testid="thread" ref={threadRef}>
          <div className="column">
            {empty ? (
              <div className="hero">
                <h1>Na co se dnes podíváme?</h1>
                <p className="muted">
                  Ptejte se na laboratorní výsledky a dokumentaci pacienta. Odpověď má u
                  sebe zdroje — řádek z tištěného nálezu nebo výňatek z dokumentu.
                </p>
              </div>
            ) : (
              <Transcript
                blocks={blocks}
                railed={desktop}
                focus={focus}
                onCite={onCite}
                onFollowup={pick}
                mobileOpen={openSources}
                onToggleSources={(id) =>
                  setOpenSources((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
            )}
          </div>
        </div>

        <div className="dock" ref={dockRef}>
          <div className="column">
            {thread.error && <p className="err dock-err">{thread.error}</p>}
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={() => void send(draft)}
              busy={busy}
              gate={gate}
              blocked={blocked}
            />
          </div>
        </div>

        {empty && (
          <div className="starters">
            <div className="column">
              {TENANTS[tenant].suggestions.map((s) => (
                <button key={s} type="button" className="starter" onClick={() => pick(s)}>
                  <span>{s}</span>
                  <span className="followup-plus" aria-hidden="true">
                    ↗
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {desktop && (
        <aside className="rail-right" data-testid="sources-panel" aria-label="Zdroje">
          <div className="rail-top">
            <div className="rail-head">
              Zdroje
              {focused && focused.sources.length > 0 && (
                <span className="rail-count">{focused.sources.length}</span>
              )}
            </div>
            {focused && focused.sources.length > 0 ? (
              <p className="rail-sub" title={focused.question}>
                {focused.question}
              </p>
            ) : (
              <p className="rail-empty muted">
                U odpovědi se tu objeví, z čeho čerpala — řádek z tištěného nálezu nebo
                výňatek z dokumentu. Číslo na konci věty sem odkazuje.
              </p>
            )}
          </div>
          {focused && focused.sources.length > 0 && (
            <Sources
              sources={focused.sources}
              activeCite={focus?.blockId === focused.id ? focus.n : null}
            />
          )}
        </aside>
      )}
    </div>
  );
}
