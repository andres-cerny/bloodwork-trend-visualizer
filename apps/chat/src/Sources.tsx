/**
 * The turn's evidence, numbered.
 *
 * A lab source is not a link — it is the actual row of the printed report,
 * cropped from the page image by the bbox the pipeline located. A document
 * source is the excerpt the tool read, with its page beside it. This panel
 * renders the registry exactly as the server sent it: a [n] in the answer
 * with no entry here points at nothing, and that absence is information.
 *
 * All rendering, no reasoning: the bbox, the image URL and the excerpt all
 * arrived in a `sources` event.
 *
 * Re-homed in the second pass — the same components now render into the right
 * rail on a desktop and into a „Zdroje (n)" disclosure under the answer on a
 * phone.
 *
 * The crop semantics are the ones the spec pins — the located row's band, the
 * whole printed row, expanding to the page image — but the *window* is now two
 * dimensional. A band drawn across the full 1819px sheet spends a third of the
 * rail on the blank margins the printer left, which is a third of the rail not
 * spent on the print; cropping to the located row's own x-range as well buys
 * that back and lands the type ~1.5× larger at rest. Crucially it lands it
 * larger with the „Referenční meze" column still inside the frame: the column
 * is the bbox's own right edge, so it cannot be scaled off the card.
 *
 * And a crop is drawn only where a row was actually located. When a report is
 * cited as a whole the `sources` event carries no bbox, and there is no way to
 * conjure the cited row on this side without inventing it — so the earlier
 * fallback showed the page's letterhead instead. One letterhead says what the
 * paper is; eight of them, identical down to the doctor's name, say nothing
 * and cost the reader the whole rail. Those entries are now what they honestly
 * are — a numbered reference: label, laboratory, date, and the entire page one
 * click away behind the `+`.
 *
 * Two things here are the mobile candidate's, kept because they were better
 * than this one's: the page behind the `+` is named on the card („Celá strana
 * nálezu" / „Celá strana dokumentu") rather than left to a tooltip nobody
 * hovers, and the rail is split — what the answer actually cited above the
 * divider, „Další podklady" below it. The crop is *not* that candidate's: it
 * sized the row to a fixed type height and let the rest run off the card behind
 * a fade, which reads well until the reader wants the reference range, and the
 * reference range is the column the fade takes first.
 */
import { useEffect, useRef, useState } from "react";
import { czDate } from "./dates";
import { scrollIntoNearest } from "./motion";

export interface Source {
  n: number;
  kind: "lab" | "document";
  label: string;
  date: string;
  lab?: string;
  reportId?: string;
  page?: number;
  imageUrl?: string | null;
  bbox?: [number, number, number, number] | null;
  documentId?: string;
  title?: string;
  excerpt?: string;
  pageW?: number | null;
  pageH?: number | null;
}

/** Breathing room around the located row, in page pixels. */
const BLEED_Y = 14;
const BLEED_X = 14;

/** A window onto the page, in page pixels. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A rectangle of the printed page, scaled to whatever width it is given.
 *
 * Pure CSS, no measurement and no layout thrash: the wrapper's aspect-ratio
 * reserves the window's shape at any panel width, the image is blown up so
 * that the window fills the wrapper (`width: pageW / windowW`), and it is then
 * shifted by the window's origin — expressed as a fraction of the image's own
 * width and height, which is exactly what a percentage translate means.
 */
function Crop({
  src,
  rect,
  pageW,
  pageH,
}: {
  src: string;
  rect: Rect;
  pageW: number;
  pageH: number;
}) {
  const w = Math.max(1, rect.x1 - rect.x0);
  const h = Math.max(1, rect.y1 - rect.y0);
  return (
    <span className="src-mat">
      <span className="src-crop" style={{ aspectRatio: `${w} / ${h}` }}>
        <img
          src={src}
          alt=""
          style={{
            width: `${(100 * pageW) / w}%`,
            transform: `translate(${(-100 * rect.x0) / pageW}%, ${(-100 * rect.y0) / pageH}%)`,
          }}
        />
      </span>
    </span>
  );
}

/**
 * The whole printed row: the located bbox gives the row's band, and the crop
 * shows that band from the parameter's name to the end of its reference range
 * — the value, the unit and the range are what a reader wants, and they are
 * what the located row spans. The bleed is generous enough that the row is not
 * shaved by a locator that ended a pixel early.
 */
const rowRect = (
  bbox: [number, number, number, number],
  pageW: number,
  pageH: number,
): Rect => ({
  x0: Math.max(0, bbox[0] - BLEED_X),
  y0: Math.max(0, bbox[1] - BLEED_Y),
  x1: Math.min(pageW, bbox[2] + BLEED_X),
  y1: Math.min(pageH, bbox[3] + BLEED_Y),
});

/**
 * A quoted excerpt, with the document's own label lines closed up.
 *
 * The excerpt arrives as the extractor read the sheet: a two-column header
 * flattened into one line per cell, so „Pacient:" and „Michal Novák" are two
 * lines, and eleven such lines stand between the top of the quote and the
 * first clinical sentence. Clamped at four lines that was a quote of a form,
 * ending at „Pacient:…" — the reader learned the document has a patient.
 *
 * The only thing changed is where the line breaks fall: a line that ends in a
 * colon takes the line after it. No word is altered, added, reordered or
 * dropped — the quote reads exactly as it did, in the shape the paper had, and
 * the clinical line is now inside the clamp instead of eight lines below it.
 */
export function foldExcerpt(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const value = line.trim();
    // A label takes its value, and only its value: a second label after an
    // unanswered one starts its own line rather than being swallowed.
    if (prev !== undefined && /:\s*$/.test(prev) && value && !/:$/.test(value))
      out[out.length - 1] = `${prev} ${value}`;
    else out.push(line);
  }
  const folded = out.join("\n").trimEnd();
  // The registry ships a fixed-length excerpt, so it can stop mid-word. The
  // ellipsis says the paper goes on; without it „…subakromiální imping" reads
  // as something the app got wrong rather than as a quote that was cut.
  return /[.!?…]$/.test(folded) ? folded : `${folded}…`;
}

/* ------------------------------------------------------------------ *
 * Where a quote should start
 *
 * What the reader wants is the sentence the `[n]` was put beside. That
 * sentence is very often not in the payload: the `sources` event carries one
 * fixed-length excerpt taken from the top of the document, so when the answer
 * cites „kompletní rupturu LCA" from the middle of an MR report, those words
 * are simply not on this side of the wire. No client code can show them, and
 * inventing them is the one thing an evidence panel may never do.
 *
 * What *is* possible is to stop spending the excerpt on the stationery. Every
 * sheet in this corpus opens the same way — practice, department, the document
 * title (which the card already carries as its own heading), then four or five
 * identity labels — and a card that opens with nine lines of that has told the
 * reader nothing they could not read off the card's own title. So the head is
 * skipped up to the first line that is none of those things, and the quote
 * starts there.
 *
 * The rules below only ever *choose where to begin*. No word is altered,
 * reordered, paraphrased or dropped from the middle: what is shown is a
 * contiguous run of the excerpt, ending where the excerpt ends, marked with a
 * leading „…" when a head was skipped.
 * ------------------------------------------------------------------ */

/** „… s.r.o.", „… a.s." — the practice, not the patient. */
const ORG_LINE = /(s\.\s?r\.\s?o\.|a\.\s?s\.|spol\.\s*s\s*r\.\s?o\.|z\.ú\.|o\.p\.s\.)/i;
/** „Radiodiagnostické pracoviště", „Ortopedické oddělení — operační sál". */
const FACILITY_LINE =
  /\b(pracovišt[ěe]|odděl[eě]ní|ambulance|laborato[řr]|klinika|poliklinika|centrum|ústav|nemocnice|ordinace|sál)\b/i;
/**
 * An identity or provenance label. „Diagnóza:", „Závěr:", „RA:" are absent on
 * purpose — those are the lines this whole function exists to reach.
 */
const ADMIN_LABEL =
  /^(pacient(ka)?|jméno|příjmení|datum[^:]*|rodné\s+číslo|rč|(zdravotní\s+)?pojišťovna|id|věk|pohlaví|adresa|bydliště|terapeut(ka)?|operatér(ka)?|popsal(a)?|vyšetřil(a)?|vyhodnotil(a)?|zpracoval(a)?|provedl(a)?|(indikující|odesílající|ošetřující)\s+lékař(ka)?|lékař(ka)?|technika|přístroj|protokol|číslo\s+protokolu|kód|identifikace)\s*:/i;

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** How much of the tail stands in when the excerpt is stationery end to end. */
const TAIL_LINES = 2;

function isBoilerplate(line: string, title?: string): boolean {
  const t = line.trim();
  if (!t) return true;
  // The document's own title. It is the card's heading two rows above; a quote
  // that opens by repeating it has spent a line saying nothing new.
  if (title && squash(t) === squash(title)) return true;
  if (ORG_LINE.test(t)) return true;
  const words = t.split(/\s+/).length;
  if (FACILITY_LINE.test(t) && words <= 6) return true;
  if (ADMIN_LABEL.test(t)) return true;
  // A bare section heading — „Anamnéza", „Provedené vyšetření". Short, no
  // colon, no number, no sentence end: it announces content rather than being
  // content, and the line under it is the content.
  if (words <= 3 && !/[:.!?…]/.test(t) && !/\d/.test(t)) return true;
  return false;
}

/**
 * The excerpt, opened at its first substantive line.
 *
 * When every line is stationery — and for two of this corpus's documents every
 * line genuinely is, because the excerpt stops before the report's first
 * sentence — the tail is shown instead of the head. Neither end proves the
 * citation; the tail is at least the end nearest the text that follows, and
 * three identical letterheads in a rail are worse than three different last
 * lines.
 */
export function openExcerpt(text: string, title?: string): string {
  const lines = foldExcerpt(text).split("\n");
  const first = lines.findIndex((l) => !isBoilerplate(l, title));
  const from = first >= 0 ? first : Math.max(0, lines.length - TAIL_LINES);
  return (from > 0 ? "…" : "") + lines.slice(from).join("\n");
}

function SourceCard({
  s,
  active,
  open,
  chip,
  onToggle,
}: {
  s: Source;
  active: boolean;
  open: boolean;
  /** Cited entries carry their [n]; context sources below the divider do not. */
  chip: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // A [n] that focuses an entry the reader cannot see has focused nothing. The
  // rail moves, or the thread does on a phone — the shell never does, which is
  // what a bare scrollIntoView could not promise.
  useEffect(() => {
    if (active && ref.current) scrollIntoNearest(ref.current);
  }, [active]);

  // „Odběr 2023-02-14" over „Laboratoře Modrý Kámen s.r.o. · 14. 2. 2023" is
  // one card stating one date twice, and in two conventions, one of which is
  // not Czech. The registry's ISO is a key, not a caption: it goes through the
  // app's one date formatter like every other date, and the line underneath
  // then carries what the title does not — which laboratory printed it.
  const label = labelWithCzechDate(s.label);
  const dated = label !== s.label;
  const meta =
    s.kind === "lab"
      ? [s.lab, dated ? null : czDate(s.date)].filter(Boolean).join(" · ")
      : czDate(s.date);

  // A lab source the server located on the page (a bbox) is the printed row
  // itself. A lab source cited as a whole report has nothing located, so there
  // is no row to show — and eight cards each showing the same letterhead band
  // is a rail of eight indistinguishable pictures of stationery. Those become
  // what they actually are: a labelled reference, with the whole page one
  // click away. The letterhead is still there, behind the `+`, once.
  const rowCrop = s.kind === "lab" && s.bbox && s.imageUrl && s.pageW && s.pageH;

  return (
    <div
      className={`src${active ? " is-active" : ""}${open ? " is-open" : ""}${
        rowCrop ? "" : " is-compact"
      }${chip ? "" : " is-context"}`}
      ref={ref}
      id={`src-${s.n}`}
    >
      <button
        type="button"
        className="src-head"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={s.imageUrl ? `src-page-${s.n}` : undefined}
        title={open ? "Skrýt stranu" : "Zobrazit celou stranu"}
      >
        {chip && <span className="src-n">{s.n}</span>}
        <span className="src-title">
          <span className="src-label">
            {chip && <span className="sr-only">Zdroj {s.n}: </span>}
            {label}
          </span>
          <span className="src-meta">{meta}</span>
          {/* Without this the `+` is an unexplained glyph on a card that shows
              no picture, and the page behind it goes undiscovered. A card that
              did crop its row needs no such line — the picture is the promise. */}
          {!rowCrop && s.imageUrl && (
            <span className="src-hint">
              {s.kind === "lab" ? "Celá strana nálezu" : "Celá strana dokumentu"}
              {s.page ? ` — strana ${s.page}` : ""}
            </span>
          )}
        </span>
        {s.imageUrl && (
          <span className="src-more" aria-hidden="true">
            {open ? "−" : "+"}
          </span>
        )}
      </button>

      {/* The collapsed card is the located row — the whole page lives behind
          the `+`, where it costs the rail nothing until it is asked for. */}
      {rowCrop && (
        <Crop
          src={s.imageUrl as string}
          rect={rowRect(
            s.bbox as [number, number, number, number],
            s.pageW as number,
            s.pageH as number,
          )}
          pageW={s.pageW as number}
          pageH={s.pageH as number}
        />
      )}
      {/* The clamp lives on the inner span, not on the quote: `overflow` on a
          -webkit-box clips at its padding edge, so a padded clamp lets the
          first sliver of the line after the ellipsis paint anyway. */}
      {s.kind === "document" && s.excerpt && (
        <blockquote className="src-quote">
          <span>{openExcerpt(s.excerpt, s.title ?? s.label)}</span>
        </blockquote>
      )}
      {open && s.imageUrl && (
        <span className="src-page" id={`src-page-${s.n}`}>
          <img src={s.imageUrl} alt={`Strana ${s.page ?? 1}`} />
        </span>
      )}
    </div>
  );
}

/**
 * „Odběr 2023-02-14" → „Odběr · 14. 2. 2023". A label the registry built from
 * an ISO key, set the way the rest of the app sets a date. Returned unchanged
 * when the label carries no ISO date — „hemoglobin 149 g/l" is a label, and
 * the date belongs under it.
 */
function labelWithCzechDate(label: string): string {
  return label.replace(
    /\s*(\d{4})-(\d{2})-(\d{2})\s*$/,
    (_m, y: string, mo: string, d: string) => ` · ${czDate(`${y}-${mo}-${d}`)}`,
  );
}

export default function Sources({
  sources,
  activeCite = null,
  citeOrder = [],
}: {
  sources: Source[];
  /** Which entry the answer's [n] pointed at, if any. */
  activeCite?: number | null;
  /**
   * The `n` of every marker in the answer — which sources the prose cited.
   *
   * This decides *membership*, not order: everything named here is a card above
   * the divider, everything else is „Další podklady" below it. That is what the
   * rail used to get wrong, arriving in sample-date order so that a summary
   * citing [6], [7] and [8] sat beside three cards with no anchor in the
   * visible text at all.
   *
   * Within the cited group the cards run by their own number, not by first
   * mention. A doctor reading [4] scans for a 4, and a rail ordered 3, 4, 5, 1,
   * 2 makes that a hunt — the chips are the index, so the index must count.
   *
   * The numbers themselves are never rewritten: a chip renumbered to match its
   * position would break the one contract the marker has, that [6] in the text
   * and 6 in the rail are the same document.
   */
  citeOrder?: number[];
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (sources.length === 0) return null;

  const byN = new Map(sources.map((s) => [s.n, s]));
  const cited = citeOrder
    .map((n) => byN.get(n))
    .filter((s): s is Source => Boolean(s))
    .sort((a, b) => a.n - b.n);
  const seen = new Set(cited.map((s) => s.n));
  const context = sources.filter((s) => !seen.has(s.n));

  const card = (s: Source, chip: boolean) => (
    <SourceCard
      key={s.n}
      s={s}
      chip={chip}
      active={activeCite === s.n}
      open={open === s.n}
      onToggle={() => setOpen(open === s.n ? null : s.n)}
    />
  );

  return (
    <div className="src-list">
      {cited.map((s) => card(s, true))}
      {cited.length > 0 && context.length > 0 && <p className="src-divider">Další podklady</p>}
      {/* Nothing in the answer points here, so no chip — but the entry keeps
          its identity, and a [n] typed into a later turn still finds it. */}
      {context.map((s) => card(s, cited.length === 0))}
    </div>
  );
}
