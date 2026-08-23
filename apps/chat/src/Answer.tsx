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
 */
import type { ReactNode } from "react";

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
 * Punctuation that belongs to the sentence, not to the marker.
 *
 * The agent writes „…dle pacienta samotného [7]." — and the marker, a chip
 * with its own padding, then leaves the full stop floating a clear space off
 * the word it ends. It reads as a typo, and it repeated on nearly every bullet
 * of the flagship answer. The sentence is closed first and the marker follows
 * it, which is both what the eye expects and what every research reader has
 * already seen: „…dle pacienta samotného. [7]".
 */
const TRAILING_PUNCT = /^[.,;:!?)\]]+/;
/** The word the marker is attached to — it must not be left on the line above. */
const LAST_WORD = /(\S+)\s*$/;

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
  // One pass, two patterns: bold spans and citation markers.
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  // The parts array is walked with an index because a marker reaches backwards
  // into what has already been emitted and forwards into what has not.
  const rest = [...parts];
  rest.forEach((part, i) => {
    if (!part) return;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    if (bold) {
      out.push(<strong key={`${key}-${i}`}>{bold[1]}</strong>);
      return;
    }
    const cite = /^\[(\d+)\]$/.exec(part);
    if (cite) {
      const n = Number(cite[1]);
      const first = marks.first;
      marks.first = false;

      // Take back the word this marker belongs to, if the thing before it is
      // plain text. After a bold span or another marker there is no word to
      // take, and the bond simply holds marker + punctuation.
      let word = "";
      const prev = out[out.length - 1];
      if (typeof prev === "string") {
        const m = LAST_WORD.exec(prev);
        if (m) {
          word = m[1];
          const head = prev.slice(0, m.index);
          if (head) out[out.length - 1] = head;
          else out.pop();
        }
      }
      // …and the punctuation that closes the sentence, from what follows.
      const next = rest[i + 1];
      let punct = "";
      if (typeof next === "string") {
        const m = TRAILING_PUNCT.exec(next);
        if (m) {
          punct = m[0];
          rest[i + 1] = next.slice(punct.length);
        }
      }

      out.push(
        <span className="cite-bond" key={`${key}-${i}`}>
          {word}
          {punct}
          <button
            type="button"
            className={`cite${activeCite === n ? " is-active" : ""}`}
            {...(citeIds.has(n) ? {} : { "data-orphan": "true" })}
            data-testid={first ? "cite-1" : undefined}
            aria-label={`Zdroj ${n}`}
            onClick={() => onCite?.(n)}
          >
            {n}
          </button>
        </span>,
      );
      return;
    }
    out.push(part);
  });
  return out;
}

/**
 * What makes one candidate not the other: a birth date. „narozen 19. 7. 1963"
 * and „narozen 27. 2. 1988" differ in six characters, and rendered as body
 * prose those six characters carried no more weight than the rest.
 */
const DISCRIMINATOR = /\b(\d{1,2}\.\s?\d{1,2}\.\s?\d{4})\b/;

/** The line, with its date carrying the weight. Presentation only. */
function discriminate(body: string, key: string): ReactNode[] {
  const m = DISCRIMINATOR.exec(body);
  if (!m) return [body];
  return [
    body.slice(0, m.index),
    <strong className="cand-key" key={`${key}-k`}>
      {m[1]}
    </strong>,
    body.slice(m.index + m[1].length),
  ];
}

export default function Answer({
  text,
  onCite,
  activeCite = null,
  citeIds,
  markFirstCite = false,
}: {
  text: string;
  onCite?: (n: number) => void;
  activeCite?: number | null;
  /** Which [n] actually have an entry this turn; the rest render as orphans. */
  citeIds: Set<number>;
  /** This is the turn's opening prose, so its first marker is the turn's. */
  markFirstCite?: boolean;
}) {
  const marks: Marks = { first: markFirstCite };
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  let nums: Array<{ n: number; body: string; key: string }> = [];

  const flush = () => {
    if (list.length === 0) return;
    out.push(
      <ul key={`ul-${out.length}`}>
        {list.map((li, i) => (
          <li key={i}>{li}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  /**
   * A numbered run, closed.
   *
   * Two or more of them make a set — a set of candidates, when every entry
   * carries the thing that tells them apart. One on its own is a Czech date
   * opening a paragraph („8. 10. 2024 provedena artroskopická plastika…"),
   * which is why the run has to start at 1 and reach 2 before it is a list at
   * all.
   */
  const flushNums = () => {
    if (nums.length === 0) return;
    const items = nums;
    nums = [];
    if (items.length < 2) {
      for (const it of items)
        out.push(
          <p key={it.key}>
            {inline(`${it.n}. ${it.body}`, it.key, onCite, activeCite, citeIds, marks)}
          </p>,
        );
      return;
    }
    const candidates = items.every((it) => DISCRIMINATOR.test(it.body));
    if (!candidates) {
      out.push(
        <ol key={`ol-${out.length}`}>
          {items.map((it) => (
            <li key={it.key}>{inline(it.body, it.key, onCite, activeCite, citeIds, marks)}</li>
          ))}
        </ol>,
      );
      return;
    }
    out.push(
      <ol className="cands" key={`ol-${out.length}`}>
        {items.map((it) => (
          <li className="cand" key={it.key}>
            <span className="cand-n" aria-hidden="true">
              {it.n}
            </span>
            <span className="cand-text">{discriminate(it.body, it.key)}</span>
          </li>
        ))}
      </ol>,
    );
  };

  const close = () => {
    flush();
    flushNums();
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const key = `l${i}`;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushNums();
      list.push(inline(bullet[1], key, onCite, activeCite, citeIds, marks));
      return;
    }
    const numbered = /^\s*(\d+)\.\s+(.+)$/.exec(line);
    if (numbered && numbered[2].length <= 140) {
      const n = Number(numbered[1]);
      const opens = nums.length === 0 && n === 1;
      const continues = nums.length > 0 && n === nums[nums.length - 1].n + 1;
      if (opens || continues) {
        flush();
        nums.push({ n, body: numbered[2], key });
        return;
      }
    }
    close();
    if (!line.trim()) return;
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
  close();

  return <div className="answer">{out}</div>;
}
