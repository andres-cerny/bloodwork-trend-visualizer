/**
 * The conversation, grouped by question.
 *
 * A tool-using turn is not a wall of text arriving at once — it is the agent
 * saying what it is about to look up, looking it up, and only then answering.
 * The steps are rendered rather than hidden, because a reader who can see the
 * answer came from `get_trend` has a reason to trust the number in it.
 *
 * One block per question: heading, the steps it took, the answer with its
 * charts, the evidence (on a phone, behind its own disclosure), and finally the
 * model's own proposals for what to ask next. The reader's eye goes down one
 * column and never has to hunt for which answer a source belongs to.
 */
import { Chart } from "@bw/ui-kit";
import Answer from "./answer";
import Sources from "./Sources";
import type { Block } from "./events";

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
};

interface TrendLike {
  displayName?: string;
  unit?: string;
}

/** The series the server filled, flattened out of the chart event's envelope. */
function trendsOf(chart: { series: unknown }): TrendLike[] {
  const groups = (chart.series ?? []) as Array<{ series?: unknown[] }>;
  return groups.flatMap((g) => (g.series ?? []) as TrendLike[]);
}

function Steps({ steps }: { steps: Block["steps"] }) {
  if (steps.length === 0) return null;
  return (
    <div className="steps">
      {steps.map((s, i) => (
        <div
          key={i}
          className={`step${s.pending ? " pending" : s.ok === false ? " failed" : ""}`}
        >
          {s.pending ? `${TOOL_LABEL[s.name] ?? s.name}…` : s.summary}
        </div>
      ))}
    </div>
  );
}

export default function Transcript({
  blocks,
  busy,
  desktop,
  focus,
  openSources,
  onCite,
  onToggleSources,
  onAsk,
}: {
  blocks: Block[];
  busy: boolean;
  /** Above the breakpoint the evidence lives in the rail, not under the answer. */
  desktop: boolean;
  focus: { blockId: number; n: number } | null;
  openSources: number | null;
  onCite: (blockId: number, n: number) => void;
  onToggleSources: (blockId: number) => void;
  onAsk: (text: string) => void;
}) {
  return (
    <div className="qa-list">
      {blocks.map((b, bi) => {
        const last = bi === blocks.length - 1;
        const activeN = focus && focus.blockId === b.id ? focus.n : null;
        const sourcesOpen = openSources === b.id;
        return (
          <article key={b.id} className="qa">
            <h2 className="q">{b.question}</h2>

            <Steps steps={b.steps} />

            {b.parts.map((p, i) =>
              p.kind === "text" ? (
                <Answer
                  key={i}
                  text={p.text}
                  activeN={activeN}
                  onCite={(n) => onCite(b.id, n)}
                />
              ) : (
                <div key={i} className="chart-card">
                  {trendsOf(p.chart).map((trend, k) => (
                    <div key={k} className="chart-one">
                      <div className="chart-head">
                        {trend.displayName ?? "vývoj hodnoty"}
                        {trend.unit ? ` · ${trend.unit}` : ""}
                      </div>
                      {/* The model named this chart; the series came from the
                          data source. No invented number reaches this component. */}
                      <Chart trend={trend as never} />
                    </div>
                  ))}
                </div>
              ),
            )}

            {busy && last && (
              <div className="thinking" aria-live="polite" aria-label="Asistent pracuje">
                <span />
                <span />
                <span />
              </div>
            )}

            {!desktop && b.sources.length > 0 && (
              <div className="src-inline">
                <button
                  type="button"
                  className="src-disclose"
                  data-testid="sources-toggle"
                  aria-expanded={sourcesOpen}
                  onClick={() => onToggleSources(b.id)}
                >
                  Zdroje ({b.sources.length})
                  <span className="chev" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {sourcesOpen && (
                  <div data-testid="sources-panel" className="src-panel">
                    <Sources sources={b.sources} focusedN={activeN} />
                  </div>
                )}
              </div>
            )}

            {b.followups.length > 0 && (
              <section className="fu" data-testid="followups">
                <h3 className="fu-head">Související</h3>
                <div className="fu-list">
                  {b.followups.map((q) => (
                    <button key={q} type="button" className="fu-item" onClick={() => onAsk(q)}>
                      <span>{q}</span>
                      <span className="fu-plus" aria-hidden="true">
                        +
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </article>
        );
      })}
    </div>
  );
}
