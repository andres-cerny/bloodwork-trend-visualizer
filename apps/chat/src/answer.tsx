/**
 * The answer, as the model writes it.
 *
 * The clinical profile answers in headings, bullets and bold labels, and a
 * `<div>` holding the raw characters renders that as a paragraph of hashes and
 * asterisks — which is what the transcript did before. This is the smallest
 * renderer that respects the four things the profile actually emits (`##`,
 * `###`, `- `/`1. ` lists, `**bold**`) plus the `[n]` markers, and nothing else.
 *
 * No markdown library, deliberately: the input is one prompt's output, not
 * arbitrary user content, and every construct not listed above must render as
 * the literal text the model wrote rather than silently disappearing. Text
 * arrives a fragment at a time, so a half-typed `**` or `[1` has to survive as
 * characters — it does, because nothing here requires a closing token.
 */
import { Fragment, type ReactNode } from "react";

/** Counts markers across one answer, so the first of them is findable. */
interface CiteSeq {
  seen: number;
}

/** `**bold**` and `[n]`, in one pass over a line. */
function inline(
  text: string,
  key: string,
  seq: CiteSeq,
  onCite?: (n: number) => void,
  activeN?: number | null,
) {
  const out: ReactNode[] = [];
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
      const first = seq.seen++ === 0;
      out.push(
        <button
          key={`${key}-${i}`}
          type="button"
          className={`cite${activeN === n ? " on" : ""}`}
          // The camera needs one stable handle on an answer's first marker —
          // which is not always `[1]`: an answer that cites only the newest
          // report opens at [6], and a testid keyed to the number would have
          // no element to find.
          {...(first ? { "data-testid": "cite-1" } : {})}
          onClick={() => onCite?.(n)}
          aria-label={`Zdroj ${n}`}
        >
          {n}
        </button>,
      );
      return;
    }
    out.push(<Fragment key={`${key}-${i}`}>{part}</Fragment>);
  });
  return out;
}

type Chunk =
  | { kind: "h2"; lines: string[] }
  | { kind: "h3"; lines: string[] }
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function chunk(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      chunks.push({ kind: "p", lines: [] });
      continue;
    }
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      chunks.push(
        h[1].length === 2 ? { kind: "h2", lines: [h[2]] } : { kind: "h3", lines: [h[2]] },
      );
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      const last = chunks[chunks.length - 1];
      if (last && last.kind === "ul") last.items.push(ul[1]);
      else chunks.push({ kind: "ul", items: [ul[1]] });
      continue;
    }
    const ol = /^(\d+)\.\s+(.*)$/.exec(line);
    if (ol) {
      const last = chunks[chunks.length - 1];
      if (last && last.kind === "ol") last.items.push(ol[2]);
      else chunks.push({ kind: "ol", items: [ol[2]] });
      continue;
    }
    const last = chunks[chunks.length - 1];
    if (last && last.kind === "p" && last.lines.length > 0) last.lines.push(line);
    else chunks.push({ kind: "p", lines: [line] });
  }
  return chunks.filter((c) =>
    c.kind === "ul" || c.kind === "ol" ? c.items.length > 0 : c.lines.length > 0,
  );
}

export default function Answer({
  text,
  onCite,
  activeN,
}: {
  text: string;
  onCite?: (n: number) => void;
  activeN?: number | null;
}) {
  const seq: CiteSeq = { seen: 0 };
  return (
    <div className="answer">
      {chunk(text).map((c, i) => {
        if (c.kind === "ul" || c.kind === "ol") {
          const items = c.items.map((it, j) => (
            <li key={j}>{inline(it, `${i}-${j}`, seq, onCite, activeN)}</li>
          ));
          return c.kind === "ul" ? <ul key={i}>{items}</ul> : <ol key={i}>{items}</ol>;
        }
        const body = inline(c.lines.join(" "), String(i), seq, onCite, activeN);
        if (c.kind === "h2") return <h2 key={i}>{body}</h2>;
        if (c.kind === "h3") return <h3 key={i}>{body}</h3>;
        return <p key={i}>{body}</p>;
      })}
    </div>
  );
}
