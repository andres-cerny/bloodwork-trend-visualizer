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
  parts.forEach((part, i) => {
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
      const known = citeIds.has(n);
      const marker = (
        <button
          key={`${key}-${i}`}
          type="button"
          className={`cite${activeCite === n ? " is-active" : ""}`}
          {...(known ? {} : { "data-orphan": "true" })}
          data-testid={first ? "cite-1" : undefined}
          aria-label={known ? `Zdroj ${n}` : `Zdroj ${n} — bez záznamu`}
          {...(activeCite === n ? { "aria-current": "true" as const } : {})}
          onClick={() => onCite?.(n)}
        >
          {n}
        </button>
      );

      // Bound to the word in front of it, inside one nowrap span. Left loose,
      // a marker after „pod rozmezím 30–400" wraps onto a line of its own and
      // stops reading as a control at all — it reads as a stray numeral, which
      // is exactly what a footnote artefact looks like. The trailing space goes
      // inside the span too: the gap before the marker is what the line would
      // otherwise break at.
      const prev = out[out.length - 1];
      const tail = typeof prev === "string" ? /(\S+[ \t]*)$/.exec(prev) : null;
      if (typeof prev === "string" && tail) {
        const head = prev.slice(0, prev.length - tail[1].length);
        if (head) out[out.length - 1] = head;
        else out.pop();
        out.push(
          <span className="cite-bind" key={`${key}-${i}-b`}>
            {tail[1]}
            {marker}
          </span>,
        );
        return;
      }
      out.push(marker);
      return;
    }
    out.push(part);
  });
  return out;
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

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const key = `l${i}`;
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(inline(bullet[1], key, onCite, activeCite, citeIds, marks));
      return;
    }
    flush();
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
  flush();

  return <div className="answer">{out}</div>;
}
