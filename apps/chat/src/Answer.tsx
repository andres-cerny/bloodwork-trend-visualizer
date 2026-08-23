/**
 * The answer, as the agent wrote it.
 *
 * The model writes light Markdown — a section heading, a bold lead-in, bullets
 * of one measurement each — because that is the shape of a clinical summary.
 * Rendering it as plain text put `## Souhrn` and `**CK**` on screen literally,
 * which reads as a leaked prompt rather than a document. So this is a reader
 * for exactly the subset the profile produces: headings, unordered and
 * numbered lists, bold, paragraphs. Nothing here follows a link or renders raw
 * HTML — the model's text is content, never markup.
 *
 * `[n]` is the one piece of syntax the agent shares with the evidence rail: it
 * becomes a button that focuses source n. A number with no entry in the
 * registry visibly points at nothing, and that absence is information.
 */
import { Fragment, type ReactNode } from "react";

type Node =
  | { t: "h"; level: 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
/** „8. 10. 2024 provedena…" is a Czech date, not the eighth item of a list. */
const LOOKS_LIKE_DATE = (rest: string) => /^\d{1,2}\.\s/.test(rest);

/**
 * Block-level parse: line-oriented, because the model writes line-oriented.
 *
 * A numbered item has to *continue the count* — a list starts at 1 and each
 * item is the next number. Without that rule every paragraph opening with a
 * Czech date became item one of a list, which does not merely look wrong: it
 * renumbers „8. 10. 2024" to „1." and puts a date the agent never wrote on
 * screen.
 */
export function parse(src: string): Node[] {
  const out: Node[] = [];
  let para: string[] = [];
  let ordinal = 0;
  const flush = () => {
    if (para.length) out.push({ t: "p", text: para.join(" ") });
    para = [];
  };
  const push = (n: Node) => {
    flush();
    const prev = out[out.length - 1];
    if ((n.t === "ul" || n.t === "ol") && prev && prev.t === n.t) prev.items.push(...n.items);
    else out.push(n);
  };

  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      ordinal = 0;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      ordinal = 0;
      // Two levels only: the answer sits inside a question heading already, so
      // a third size would be a distinction without a difference.
      push({ t: "h", level: h[1].length <= 2 ? 2 : 3, text: h[2] });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      ordinal = 0;
      push({ t: "ul", items: [b[1]] });
      continue;
    }
    const n = NUMBERED.exec(line);
    if (n && Number(n[1]) === ordinal + 1 && !LOOKS_LIKE_DATE(n[2])) {
      ordinal += 1;
      push({ t: "ol", items: [n[2]] });
      continue;
    }
    ordinal = 0;
    para.push(line.trim());
  }
  flush();
  return out;
}

const INLINE = /(\*\*[^*]+\*\*|\[\d+\])/g;

function inline(text: string, cite: (n: number) => ReactNode): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    const m = /^\[(\d+)\]$/.exec(part);
    if (m) return <Fragment key={i}>{cite(Number(m[1]))}</Fragment>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export default function Answer({
  text,
  onCite,
  active,
}: {
  text: string;
  /** Focus the evidence rail (desktop) or the disclosure (mobile) on source n. */
  onCite: (n: number) => void;
  /** The source currently focused, so its markers read as connected. */
  active: number | null;
}) {
  const cite = (n: number) => (
    <button
      type="button"
      className={`cite${active === n ? " on" : ""}`}
      data-testid={`cite-${n}`}
      onClick={() => onCite(n)}
      title={`Zdroj ${n}`}
      aria-label={`Zdroj ${n}`}
    >
      {n}
    </button>
  );

  return (
    <div className="answer">
      {parse(text).map((n, i) => {
        if (n.t === "h")
          return n.level === 2 ? (
            <h3 key={i} className="a-h2">
              {inline(n.text, cite)}
            </h3>
          ) : (
            <h4 key={i} className="a-h3">
              {inline(n.text, cite)}
            </h4>
          );
        if (n.t === "ul")
          return (
            <ul key={i} className="a-list">
              {n.items.map((it, k) => (
                <li key={k}>{inline(it, cite)}</li>
              ))}
            </ul>
          );
        if (n.t === "ol")
          return (
            <ol key={i} className="a-list a-num">
              {n.items.map((it, k) => (
                <li key={k}>{inline(it, cite)}</li>
              ))}
            </ol>
          );
        return <p key={i}>{inline(n.text, cite)}</p>;
      })}
    </div>
  );
}
