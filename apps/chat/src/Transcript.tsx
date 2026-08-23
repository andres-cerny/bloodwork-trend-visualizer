/**
 * The conversation, one block per question.
 *
 * A tool-using turn is not a wall of text arriving at once — it is the agent
 * saying what it is about to look up, looking it up, and only then answering.
 * The steps are rendered as their own compact rows rather than hidden, because
 * a reader who can see that the number came from `get_trend` has a reason to
 * trust it; they are set small and quiet, because they are what the agent did,
 * not what it said.
 *
 * Reading order is fixed and top-down: question → steps → answer → chart →
 * evidence (on a phone) → what to ask next.
 */
import { Chart } from "@bw/ui-kit";
import Answer from "./Answer";
import Sources from "./Sources";
import { czDates } from "./format";
import { awaitingFirstWord, type Block, type Item } from "./thread";

/** Czech for what each tool does, so the step reads as a sentence. */
const TOOL_LABEL: Record<string, string> = {
  find_patient: "hledá pacienta v kartotéce",
  search_documents: "prohledává dokumentaci",
  get_document: "otevírá dokument",
  list_analytes: "hledá dostupné parametry",
  get_trend: "načítá vývoj hodnoty",
  summarize_changes: "porovnává odběry",
  propose_chart: "připravuje graf",
  computed_values: "počítá odvozené hodnoty",
  cohort_query: "prochází kartotéku",
};

function Steps({ item }: { item: Extract<Item, { kind: "steps" }> }) {
  const running = item.steps.some((s) => s.pending);
  return (
    <div className={`steps${running ? " running" : ""}`}>
      <div className="steps-head">
        <span className="eyebrow">Postup</span>
        <span className="steps-n">{item.steps.length}</span>
      </div>
      <ol className="steps-list">
        {item.steps.map((s, i) => (
          <li key={i} className={`step${s.pending ? " pending" : s.ok === false ? " failed" : ""}`}>
            <span className="step-mark" aria-hidden="true">
              {s.pending ? "" : s.ok === false ? "✕" : "✓"}
            </span>
            <span className="step-text">
              {s.pending ? `${TOOL_LABEL[s.name] ?? s.name}…` : czDates(s.summary ?? s.name)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A chart the model named and the server filled. There is no path by which an
 * invented number reaches this component.
 */
function Charts({ item }: { item: Extract<Item, { kind: "chart" }> }) {
  const groups = (item.series ?? []) as Array<{ series: unknown[] }>;
  return (
    <div className="chart-card">
      {groups.flatMap((g, j) =>
        ((g.series ?? []) as never[]).map((trend, k) => {
          const t = trend as { displayName?: string; unit?: string };
          return (
            <figure key={`${j}-${k}`} className="chart-figure">
              <figcaption className="chart-title">
                <span className="chart-name">{t.displayName ?? "graf"}</span>
                {t.unit && <span className="chart-unit">{t.unit}</span>}
              </figcaption>
              <Chart trend={trend} />
            </figure>
          );
        }),
      )}
    </div>
  );
}

export default function Transcript({
  blocks,
  live,
  desktop,
  focus,
  openSources,
  onCite,
  onToggleSources,
  onAsk,
}: {
  blocks: Block[];
  /** A turn is still arriving — live from the worker or paused mid-replay. */
  live: boolean;
  desktop: boolean;
  focus: { block: number; n: number | null } | null;
  /** Which blocks have their „Zdroje (n)" disclosure open (phones only). */
  openSources: Record<number, boolean>;
  onCite: (block: number, n: number) => void;
  onToggleSources: (block: number) => void;
  onAsk: (q: string) => void;
}) {
  return (
    <div className="blocks">
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        const streaming = live && last && !b.done;
        return (
          <article key={b.id} className="block">
            <h2 className="q">
              <span className="q-mark" aria-hidden="true">
                ?
              </span>
              {b.question}
            </h2>

            {b.items.map((item, k) =>
              item.kind === "steps" ? (
                <Steps key={k} item={item} />
              ) : item.kind === "chart" ? (
                <Charts key={k} item={item} />
              ) : (
                <Answer
                  key={k}
                  text={item.text}
                  active={focus && focus.block === b.id ? focus.n : null}
                  onCite={(n) => onCite(b.id, n)}
                />
              ),
            )}

            {streaming && awaitingFirstWord(b) && (
              <div className="skeleton" aria-live="polite" aria-label="Asistent pracuje">
                <span />
                <span />
                <span />
              </div>
            )}

            {b.error && <p className="err">{b.error}</p>}

            {/* Phones have no rail, so the registry rides under its own answer.
                On a workstation the same component renders to the right. */}
            {!desktop && b.sources.length > 0 && (
              <div className="src-disc">
                <button
                  type="button"
                  className="src-disc-btn"
                  data-testid="sources-toggle"
                  aria-expanded={Boolean(openSources[b.id])}
                  onClick={() => onToggleSources(b.id)}
                >
                  <span className="src-disc-caret" aria-hidden="true">
                    {openSources[b.id] ? "▾" : "▸"}
                  </span>
                  Zdroje ({b.sources.length})
                </button>
                {openSources[b.id] && (
                  <div data-testid="sources-panel">
                    <Sources
                      sources={b.sources}
                      focus={focus && focus.block === b.id ? focus.n : null}
                    />
                  </div>
                )}
              </div>
            )}

            {b.followups.length > 0 && (
              <div className="followups" data-testid="followups">
                <span className="eyebrow fu-label">Související</span>
                <div className="fu-row">
                  {b.followups.map((q) => (
                    <button key={q} type="button" className="fu-chip" onClick={() => onAsk(q)}>
                      <span>{q}</span>
                      <span className="fu-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
