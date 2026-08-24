/**
 * The answer body.
 *
 * The agent writes Markdown — `##` sections, `**bold**` parameter names, dashed
 * lists — because that is what the model produces and what the eval grades.
 * Rendering it as one preformatted paragraph, which is what the first pass did,
 * throws away the only structure a long clinical summary has: a doctor scanning
 * for "which values are out of range" reads headings, not prose.
 *
 * Deliberately a subset, hand-written, no dependency: headings, unordered
 * lists, bold, and the `[n]` markers. There is no user-authored Markdown here —
 * the input is the agent's own text — so the missing constructs (tables, links,
 * images, raw HTML) are constructs the profile never emits, and a Markdown
 * library would be 40 kB to render four of them.
 *
 * `[n]` is the load-bearing one. It is a button, not a superscript: clicking it
 * focuses that entry in the evidence rail. A number whose entry does not exist
 * still renders — the absence is information, and the rail shows nothing to
 * scroll to.
 *
 * The other load-bearing construct is the numbered run the agent writes when
 * it is asking *which patient* — see `flush`. It is the only place in this
 * renderer where the shape of the Markdown is read as a question rather than
 * as typography, and it earns that because picking the wrong Michal Novák is
 * the one mistake this screen exists to prevent.
 *
 * And it is welded to the word in front of it. A marker is a control, and a
 * control that has drifted onto a line of its own — „pod rozmezím 30–400" then
 * a lone grey 6 — has stopped reading as one; it reads as a footnote artefact
 * the typesetter forgot. The welding is structural rather than cosmetic: the
 * preceding word, the marker, and any punctuation that follows it go into one
 * `white-space: nowrap` group, so there is no line break for them to fall
 * through at any column width.
 */
import { isValidElement, type ReactNode } from "react";
import { czDate, czDatesInText } from "./dates";

/**
 * State that has to survive across the lines of one answer: which marker is
 * the first one. The camera reaches for it by name, and an answer's opening
 * citation is not always `[1]` — a summary that reads six reports before it
 * says anything cites `[6]` first.
 */
interface Marks {
  first: boolean;
}

/**
 * „V kartotéce jsou dva pacienti jménem Michal Novák:" — the name the numbered
 * lines under it are alternatives of. The agent writes it once, in the
 * sentence that opens the choice, and then writes only birth dates; a reader
 * scrolled to the list sees two dates and no patient.
 */
const NAMED = /jménem\s+([^:.\n]+?)\s*[:.]?\s*$/;

/** „narozen 19. 7. 1963" / „nar. 27. 2. 1988" — a candidate, not a sentence. */
const BORN = /^(?:narozen[ay]?|nar\.)\s+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\s*$/i;

/** Punctuation that belongs to the sentence, not to the next word. */
const TRAILING = /^[.,;:!?)\]»”"…]+/;

/** A run of text with `**bold**` and `[n]` resolved into nodes. */
function inline(
  text: string,
  key: string,
  onCite: ((n: number) => void) | undefined,
  activeCite: number | null,
  citeIds: Set<number>,
  marks: Marks,
): ReactNode[] {
  const out: ReactNode[] = [];

  // The open nowrap group, if the last thing emitted was a marker. It is held
  // back rather than pushed, because what follows a marker — a full stop, a
  // second marker — may still belong inside it.
  let bind: { key: string; kids: ReactNode[] } | null = null;
  const settle = () => {
    if (!bind) return;
    out.push(
      <span className="cite-bind" key={bind.key}>
        {bind.kids}
      </span>,
    );
    bind = null;
  };

  // One pass, two patterns: bold spans and citation markers.
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  parts.forEach((part, i) => {
    if (!part) return;

    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      settle();
      out.push(<strong key={`${key}-${i}`}>{bold[1]}</strong>);
      return;
    }

    const cite = /^\[(\d+)\]$/.exec(part);
    if (cite) {
      const n = Number(cite[1]);
      const first = marks.first;
      marks.first = false;
      const marker = (
        <button
          key={`${key}-${i}`}
          type="button"
          className={`cite${activeCite === n ? " is-active" : ""}`}
          {...(citeIds.has(n) ? {} : { "data-orphan": "true" })}
          data-testid={first ? "cite-1" : undefined}
          aria-label={`Zdroj ${n}`}
          onClick={() => onCite?.(n)}
        >
          {n}
        </button>
      );
      // `[1][2]` is one run and stays one run.
      if (bind) {
        bind.kids.push(marker);
        return;
      }

      // Otherwise take the word in front of it out of the flow and bind them.
      const prev = out[out.length - 1];
      const kids: ReactNode[] = [];
      if (typeof prev === "string") {
        // The trailing space is captured too: inside a nowrap group it still
        // prints, and taking it along is what removes the break opportunity.
        const tail = /(\S+[ \t]*)$/.exec(prev);
        if (tail) {
          const head = prev.slice(0, prev.length - tail[1].length);
          if (head) out[out.length - 1] = head;
          else out.pop();
          kids.push(tail[1]);
        }
      } else if (isValidElement(prev)) {
        out.pop();
        kids.push(prev);
      }
      kids.push(marker);
      bind = { key: `${key}-b${i}`, kids };
      return;
    }

    const open = bind;
    if (open) {
      const punct = TRAILING.exec(part);
      if (punct) {
        open.kids.push(punct[0]);
        settle();
        const rest = part.slice(punct[0].length);
        if (rest) out.push(rest);
        return;
      }
      settle();
    }
    out.push(part);
  });

  settle();
  return out;
}

export default function Answer({
  text,
  onCite,
  activeCite = null,
  citeIds,
  markFirstCite = false,
  onChoose,
}: {
  text: string;
  onCite?: (n: number) => void;
  activeCite?: number | null;
  /** Which [n] actually have an entry this turn; the rest render as orphans. */
  citeIds: Set<number>;
  /** This is the turn's opening prose, so its first marker is the turn's. */
  markFirstCite?: boolean;
  /**
   * Put this text in the composer — never send it. Picking the wrong patient
   * is the one clinical error the disambiguation screen exists to prevent, so
   * the row hands the doctor a sentence and stops; the send is theirs.
   */
  onChoose?: (text: string) => void;
}) {
  const marks: Marks = { first: markFirstCite };
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  /** The rendered nodes of each item, and the raw line they came from. */
  let list: Array<{ raw: string; nodes: ReactNode[] }> = [];
  /** „…dva pacienti jménem Michal Novák:" — carried down to the choices. */
  let named: string | null = null;
  // An enumeration is not a bullet list. „1. narozen 19. 7. 1963" is the shape
  // the agent uses when it is offering the reader a choice between two records,
  // and rendering it as loose paragraphs — which is what falling through to the
  // paragraph branch did — throws away the only signal that the lines are one
  // set of alternatives.
  let ordered = false;
  let next = 1;

  const flush = () => {
    if (list.length === 0) return;

    // A run of „1. narozen …" / „2. narozen …" is not a list, it is a
    // question: which of these two people do you mean? Rendered as an
    // enumeration it was two grey numerals — the same chip, the same size and
    // the same colour as the `[n]` citation markers in the prose above, on a
    // screen whose rail really does have an unrelated 1 and 2 — followed by a
    // bare birth date and no name at all. So it is rendered as what it is: one
    // card per person, the name the sentence above named, the birth date under
    // it, and a chevron that cannot be mistaken for a footnote.
    const born = list.map((it) => BORN.exec(it.raw)?.[1] ?? null);
    if (ordered && list.length > 1 && born.every((b) => b !== null)) {
      out.push(
        <ul className="candidates" key={`cand-${out.length}`}>
          {born.map((b, i) => {
            const date = czDate(b as string);
            const line = named ? `${named}, nar. ${date}` : `nar. ${date}`;
            const body = (
              <>
                <span className="cand-who">
                  {named && <span className="cand-name">{named}</span>}
                  <span className="cand-born">nar. {date}</span>
                </span>
                <span className="cand-go" aria-hidden="true">
                  ›
                </span>
              </>
            );
            return (
              <li key={i}>
                {onChoose ? (
                  <button
                    type="button"
                    className="candidate"
                    title="Doplní volbu do dotazu"
                    aria-label={`Doplnit do dotazu: ${line}`}
                    onClick={() => onChoose(line)}
                  >
                    {body}
                  </button>
                ) : (
                  <span className="candidate">{body}</span>
                )}
              </li>
            );
          })}
        </ul>,
      );
      list = [];
      return;
    }

    const Tag = ordered ? "ol" : "ul";
    out.push(
      <Tag key={`${Tag}-${out.length}`} className={ordered ? "choices" : undefined}>
        {list.map((li, i) => (
          <li key={i}>{li.nodes}</li>
        ))}
      </Tag>,
    );
    list = [];
  };

  lines.forEach((raw, i) => {
    // One date convention, everywhere. The model writes „16.1.2024" beside a
    // rail that writes „16. 1. 2024"; only the spacing inside a date is
    // touched, and nothing that is not a date can match.
    const line = czDatesInText(raw.trimEnd());
    const key = `l${i}`;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (ordered) flush();
      ordered = false;
      list.push({
        raw: bullet[1],
        nodes: inline(bullet[1], key, onCite, activeCite, citeIds, marks),
      });
      return;
    }
    const numbered = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line);
    // Czech writes dates the same way a list writes its markers, and this
    // agent writes a lot of dates: „8. 10. 2024 provedena artroskopická
    // plastika…" is a sentence, not the eighth item of anything. Two guards
    // separate them — the run has to start at 1 and count up, and what follows
    // the marker must not itself open with a day number.
    if (numbered && !/^\d{1,2}\.\s/.test(numbered[2])) {
      const n = Number(numbered[1]);
      if (n === (ordered ? next : 1)) {
        if (!ordered) flush();
        ordered = true;
        next = n + 1;
        list.push({
          raw: numbered[2],
          nodes: inline(numbered[2], key, onCite, activeCite, citeIds, marks),
        });
        return;
      }
    }
    flush();
    ordered = false;
    if (!line.trim()) return;
    // The sentence that opens a choice names the person the numbered lines
    // are alternatives of. Read it here, spend it in flush().
    const nm = NAMED.exec(line);
    if (nm) named = nm[1].trim();
    const head = /^(#{1,6})\s+(.*)$/.exec(line);
    if (head) {
      // `##` is the answer's top section, and the question above it is already
      // the page's h2 — so the answer's own levels start at h3.
      const level = Math.min(6, head[1].length + 1);
      const Tag = `h${level}` as "h3";
      out.push(
        <Tag key={key}>{inline(head[2], key, onCite, activeCite, citeIds, marks)}</Tag>,
      );
      return;
    }
    out.push(<p key={key}>{inline(line, key, onCite, activeCite, citeIds, marks)}</p>);
  });
  flush();

  return <div className="answer">{out}</div>;
}
