/**
 * The conversation, as questions with answers under them.
 *
 * The first pass rendered a chat log: alternating bubbles, one row per event.
 * This is the research layout instead — each question is a heading and
 * everything the agent did for it hangs beneath, which is how a doctor rereads
 * a thread: they look for the question, not for the turn number.
 *
 * A tool-using turn is not a wall of text arriving at once — it is the agent
 * saying what it is about to look up, looking it up, and only then answering.
 * Those steps are rendered rather than hidden, because a reader who can see
 * that the answer came from `get_trend` has a reason to trust the number in
 * it. Once the turn is finished they fold into one line: they are the
 * provenance of the answer, not the answer.
 */
import { Chart } from "@bw/ui-kit";
import Answer from "./Answer";
import Sources, { type Source } from "./Sources";
import { scrollBehavior } from "./motion";

/** One thing the agent produced, in the order it produced it. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; pending: boolean; ok?: boolean; summary?: string }
  | { kind: "chart"; spec: unknown; series: unknown };

/** One question and everything that answered it. */
export interface Block {
  id: number;
  question: string;
  parts: Part[];
  sources: Source[];
  followups: string[];
  /** No `done` event yet — live, or a fixture stopped mid-stream by `&step=`. */
  streaming: boolean;
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
  cohort_query: "prohledává kartotéku",
};

type ToolPart = Extract<Part, { kind: "tool" }>;
type SaidPart = Exclude<Part, { kind: "tool" }>;

/** Consecutive tool rows fold into one group; anything else breaks the run. */
function group(parts: Part[]): Array<{ tools: ToolPart[] } | { part: SaidPart }> {
  const out: Array<{ tools: ToolPart[] } | { part: SaidPart }> = [];
  for (const p of parts) {
    if (p.kind === "tool") {
      const last = out[out.length - 1];
      if (last && "tools" in last) last.tools.push(p);
      else out.push({ tools: [p] });
    } else out.push({ part: p });
  }
  return out;
}

function Steps({ tools, live }: { tools: ToolPart[]; live: boolean }) {
  const pending = tools.some((t) => t.pending);
  return (
    <details className={`steps${pending ? " is-live" : ""}`} open={pending || live}>
      <summary>
        <span className="steps-caret" aria-hidden="true" />
        {pending ? "Agent pracuje…" : `Kroky agenta (${tools.length})`}
      </summary>
      <ol className="steps-list">
        {tools.map((t, i) => (
          <li
            key={i}
            className={`step${t.pending ? " pending" : t.ok === false ? " failed" : ""}`}
          >
            <span className="step-dot" aria-hidden="true" />
            <span className="step-text">
              {t.pending ? `${TOOL_LABEL[t.name] ?? t.name}…` : (t.summary ?? t.name)}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function Charts({ series }: { series: unknown }) {
  const groups = (series ?? []) as Array<{ series: unknown[] }>;
  return (
    <div className="chart-card">
      {groups.flatMap((g, j) =>
        (g.series as never[]).map((trend, k) => (
          // Both opt-ins, and both because of the question this app is asked.
          // The answer beside the chart says „vše v pásmu normy", and a band
          // that runs off both edges of the plot cannot be checked against
          // that claim: the reader needs to see the limits and the air above
          // and below them. And once the band is most of the plot it is
          // furniture, so it stops borrowing the series colour.
          <Chart key={`${j}-${k}`} trend={trend} refInDomain bandTone="neutral" />
        )),
      )}
    </div>
  );
}

/**
 * The `n` of every marker in this turn's prose, in reading order.
 *
 * This is what the evidence panel orders itself by. Only markers the registry
 * actually issued count — an orphan `[9]` renders with its strike in the text
 * and has no card to put anywhere.
 */
export function citeOrder(b: Block): number[] {
  const seen: number[] = [];
  for (const p of b.parts) {
    if (p.kind !== "text") continue;
    for (const m of p.text.matchAll(/\[(\d+)\]/g)) {
      const n = Number(m[1]);
      if (!seen.includes(n) && b.sources.some((s) => s.n === n)) seen.push(n);
    }
  }
  return seen;
}

export default function Transcript({
  blocks,
  railed,
  focus,
  onCite,
  onFollowup,
  mobileOpen,
  onToggleSources,
}: {
  blocks: Block[];
  /** Desktop: evidence lives in the rail, so no disclosure under the answer. */
  railed: boolean;
  focus: { blockId: number; n: number | null } | null;
  onCite: (blockId: number, n: number) => void;
  onFollowup: (text: string) => void;
  /** Which blocks have their mobile „Zdroje (n)" disclosure open. */
  mobileOpen: Set<number>;
  onToggleSources: (blockId: number) => void;
}) {
  return (
    <div className="turns">
      {blocks.map((b) => {
        const citeIds = new Set(b.sources.map((s) => s.n));
        const active = focus && focus.blockId === b.id ? focus.n : null;
        const spoken = b.parts.some((p) => p.kind === "text");
        const open = mobileOpen.has(b.id);

        return (
          <article className="turn" key={b.id} aria-busy={b.streaming || undefined}>
            <h2 className="q">{b.question}</h2>

            {/* The answer arrives a fragment at a time. The region has to carry
                aria-live from the moment the question opens — a live region
                added at the same time as its content announces nothing — and
                `additions text` keeps a screen reader on the new words instead
                of re-reading the whole summary after every delta. */}
            <div className="turn-body" aria-live="polite" aria-relevant="additions text">
              {group(b.parts).map((g, i, all) =>
                "tools" in g ? (
                  <Steps key={i} tools={g.tools} live={b.streaming && !spoken} />
                ) : g.part.kind === "chart" ? (
                  <Charts key={i} series={g.part.series} />
                ) : (
                  <Answer
                    key={i}
                    text={g.part.text}
                    citeIds={citeIds}
                    activeCite={active}
                    onCite={(n) => onCite(b.id, n)}
                    markFirstCite={
                      all.findIndex((x) => "part" in x && x.part.kind === "text") === i
                    }
                  />
                ),
              )}

              {/* Something is still coming and nothing has been said yet: the
                  gap between the last tool and the first word is the longest
                  silence in a turn, and an empty column reads as a dead app.
                  Three dots say that to an eye and nothing at all to an ear. */}
              {b.streaming && (
                <p className="writing" role="status">
                  <span className="sr-only">Asistent píše odpověď…</span>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </p>
              )}
            </div>

            {!railed && b.sources.length > 0 && (
              <div className="turn-sources">
                <button
                  type="button"
                  className="sources-toggle"
                  data-testid="sources-toggle"
                  aria-expanded={open}
                  aria-controls={`sources-${b.id}`}
                  onClick={(e) => {
                    // Opening a disclosure below the fold reveals evidence the
                    // reader cannot see; bring the block to the top instead.
                    const wrap = e.currentTarget.parentElement;
                    onToggleSources(b.id);
                    if (!open)
                      requestAnimationFrame(() =>
                        wrap?.scrollIntoView({ block: "start", behavior: scrollBehavior() }),
                      );
                  }}
                >
                  <span className="sources-caret" aria-hidden="true" data-open={open} />
                  Zdroje ({b.sources.length})
                </button>
                {open && (
                  <div id={`sources-${b.id}`} data-testid="sources-panel">
                    <Sources
                      sources={b.sources}
                      activeCite={active}
                      citeOrder={citeOrder(b)}
                    />
                  </div>
                )}
              </div>
            )}

            {b.followups.length > 0 && (
              <div className="followups" data-testid="followups">
                <h3 className="followups-head">Související</h3>
                {b.followups.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="followup"
                    onClick={() => onFollowup(q)}
                  >
                    <span>{q}</span>
                    <span className="followup-plus" aria-hidden="true">
                      +
                    </span>
                  </button>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
