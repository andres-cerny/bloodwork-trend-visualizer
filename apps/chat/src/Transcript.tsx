/**
 * The conversation.
 *
 * A tool-using turn is not a wall of text arriving at once — it is the agent
 * saying what it is about to look up, looking it up, and only then answering.
 * Those steps are rendered as their own rows rather than hidden, because a
 * reader who can see that the answer came from `get_trend` has a reason to
 * trust the number in it.
 */
import { Chart } from "@bw/ui-kit";
import Sources, { type Source } from "./Sources";

export interface Turn {
  role: "user" | "assistant" | "tool" | "chart" | "sources";
  content: string;
  /** Tool rows only: still running, or the outcome. */
  pending?: boolean;
  ok?: boolean;
  /** Chart rows only: the spec the model named and the series the server filled. */
  chart?: { spec: unknown; series: unknown };
  /** Sources rows only: the turn's evidence, numbered by the server. */
  sources?: Source[];
}

/**
 * An answer with [n] markers, rendered so each marker is a superscript chip.
 * The chips are text, not links — the sources panel right below the answer is
 * where they resolve, and a number with no panel entry visibly points at
 * nothing, which is the point.
 */
function withMarkers(text: string) {
  const parts = text.split(/(\[\d+\])/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    return m ? <sup key={i} className="cite">{m[1]}</sup> : part;
  });
}

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

export default function Transcript({
  turns,
  busy,
  suggestions,
  onPick,
}: {
  turns: Turn[];
  busy: boolean;
  suggestions: string[];
  onPick: (s: string) => void;
}) {
  if (turns.length === 0) {
    return (
      <div className="chat-empty">
        <p>Zeptejte se na výsledky pacienta. Například:</p>
        <div className="chat-suggestions">
          {suggestions.map((s) => (
            <button key={s} className="btn small" onClick={() => onPick(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-log">
      {turns.map((t, i) => {
        if (t.role === "tool") {
          return (
            <div key={i} className={`step${t.pending ? " pending" : t.ok === false ? " failed" : ""}`}>
              {t.pending ? (TOOL_LABEL[t.content] ?? t.content) + "…" : t.content}
            </div>
          );
        }
        if (t.role === "chart") {
          // The model named this chart; the series came from the data source.
          // There is no path by which an invented number reaches this component.
          const charts = (t.chart?.series ?? []) as Array<{ series: unknown[] }>;
          return (
            <div key={i} className="msg chart-msg">
              {charts.flatMap((c, j) =>
                (c.series as never[]).map((trend, k) => (
                  <Chart key={`${j}-${k}`} trend={trend} />
                )),
              )}
            </div>
          );
        }
        if (t.role === "sources") {
          return <Sources key={i} sources={t.sources ?? []} />;
        }
        return (
          <div key={i} className={`msg ${t.role === "user" ? "user" : "bot"}`}>
            {t.role === "assistant" ? withMarkers(t.content) : t.content}
          </div>
        );
      })}
      {busy && (
        <div className="msg bot muted" aria-live="polite">
          …
        </div>
      )}
    </div>
  );
}
