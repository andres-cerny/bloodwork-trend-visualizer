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

/**
 * The shape of the answer that is coming.
 *
 * The gap between the last tool result and the first word is the longest
 * silence in a turn, and three small dots at the top of nine hundred empty
 * pixels do not fill it — that screen reads as a request that died. A skeleton
 * at the answer's real measure does: the column already has the proportions of
 * the thing being written, so the wait is legible as a wait.
 *
 * `aria-hidden`, and the live region is the sentence beside it: a screen
 * reader gets „Agent pracuje…" once, not six announcements of a grey bar.
 */
function Skeleton({ titled }: { titled: boolean }) {
  // Two groups, because the thing being written is a sectioned summary and
  // one group of five bars left half a phone still empty under it. Nothing
  // here claims how long the answer will be; it claims that an answer with
  // headings is on its way, which is what the four steps above already say.
  return (
    <div className="skel" aria-hidden="true">
      {titled && <span className="skel-line skel-title" />}
      {(titled ? [0, 1, 2, 4] : [0, 3]).map((i) => (
        <span key={i} className={`skel-line skel-w${i}`} />
      ))}
      {titled && (
        <>
          <span className="skel-line skel-title skel-title-2" />
          {[1, 2, 0, 4].map((i) => (
            <span key={`b${i}`} className={`skel-line skel-w${i}`} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * The chart, titled.
 *
 * `Chart` draws one series and deliberately has no legend — "the card title
 * names it", says its own header comment, and until now no card did. The
 * reader learned that the line was hemoglobin from the prose above it, which
 * works while the prose is on screen and fails the moment the chart is what
 * they scrolled back to. The name and the unit are read straight off the
 * payload the server sent; nothing here computes anything.
 */
interface TrendLike {
  displayName?: string;
  unit?: string;
}

function Charts({ series }: { series: unknown }) {
  const groups = (series ?? []) as Array<{ unit?: string; series: TrendLike[] }>;
  const names = groups.flatMap((g) => g.series.map((t) => t.displayName).filter(Boolean));
  const unit = groups.map((g) => g.unit).find(Boolean);
  return (
    <figure className="chart-card">
      {names.length > 0 && (
        <figcaption className="chart-head">
          <span className="chart-title">{names.join(", ")}</span>
          {unit && <span className="chart-unit">{unit}</span>}
        </figcaption>
      )}
      {/* `includeRefRange`: here the chart arrives inside a sentence — „vše v
          pásmu normy" — and the band is the claim that sentence makes, so the
          axis has to hold the whole range or the picture argues with the
          prose.

          `fitText`: and this chart is read on a phone, in a column ~326px
          wide, where a 640-unit viewBox halves every label — the two limit
          labels that fix above landed at ~5px, beside a 16px caption saying
          the same numbers in words. Opted in, the type is sized after the
          scale instead of before it.

          The bloodwork trends tab opts into neither, and its charts are
          unchanged. */}
      {groups.flatMap((g, j) =>
        (g.series as never[]).map((trend, k) => (
          <Chart key={`${j}-${k}`} trend={trend} includeRefRange fitText />
        )),
      )}
    </figure>
  );
}

export default function Transcript({
  blocks,
  railed,
  focus,
  onCite,
  onFollowup,
  onFill,
  mobileOpen,
  onToggleSources,
}: {
  blocks: Block[];
  /** Desktop: evidence lives in the rail, so no disclosure under the answer. */
  railed: boolean;
  focus: { blockId: number; n: number | null } | null;
  onCite: (blockId: number, n: number) => void;
  onFollowup: (text: string) => void;
  /** Put text in the composer without sending it — the patient choice. */
  onFill: (text: string) => void;
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
          <article className="turn" key={b.id}>
            <h2 className="q">{b.question}</h2>

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
                  onChoose={onFill}
                  markFirstCite={
                    all.findIndex((x) => "part" in x && x.part.kind === "text") === i
                  }
                />
              ),
            )}

            {/* Something is still coming: the column takes the shape of it.
                Nothing said yet — a title bar and five lines; mid-paragraph —
                two lines continuing the measure, because a heading skeleton
                under a heading that has already arrived is a lie about what
                is next. */}
            {b.streaming && (
              <>
                <p className="sr-only" aria-live="polite">
                  Agent pracuje na odpovědi…
                </p>
                <Skeleton titled={!spoken} />
              </>
            )}

            {!railed && b.sources.length > 0 && (
              <div className="turn-sources">
                <button
                  type="button"
                  className="sources-toggle"
                  data-testid="sources-toggle"
                  aria-expanded={open}
                  onClick={(e) => {
                    // Opening a disclosure below the fold reveals evidence the
                    // reader cannot see; bring the block to the top instead.
                    const wrap = e.currentTarget.parentElement;
                    onToggleSources(b.id);
                    if (!open)
                      requestAnimationFrame(() => wrap?.scrollIntoView({ block: "start" }));
                  }}
                >
                  <span className="sources-caret" aria-hidden="true" data-open={open} />
                  Zdroje ({b.sources.length})
                </button>
                {open && (
                  <div data-testid="sources-panel">
                    <Sources sources={b.sources} activeCite={active} />
                  </div>
                )}
              </div>
            )}

            {b.followups.length > 0 && (
              <div className="followups" data-testid="followups">
                <div className="followups-head">Související</div>
                {b.followups.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="followup"
                    onClick={() => onFollowup(q)}
                  >
                    <span>{q}</span>
                    {/* The same glyph the empty state's suggestions carry: one
                        action, one mark. `+` is the rail's crop expander and
                        reads as „add", which this is not. */}
                    <span className="ask-glyph" aria-hidden="true">
                      ↗
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
