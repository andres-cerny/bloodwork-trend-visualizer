/**
 * Single-analyte trend: a line over time with the reference range as a band.
 *
 * One series, so no legend — the card title names it. Out-of-range points are
 * marked in status red *and* carry an arrow glyph, and the band means a point
 * outside the range is readable from position alone. Colour is reinforcement,
 * never the only channel.
 *
 * Hand-rolled SVG rather than a chart library: the whole form is a band, a
 * polyline and some dots, and this keeps full control of touch targets and the
 * mobile viewBox without shipping a dependency.
 */
import { useId, useState } from "react";
import {
  czExact,
  czNum,
  czDate,
  czMonthYear,
  prettyUnit,
  numericPoints,
  type Trend,
} from "@bw/lab-core";

/**
 * Round axis values a person would actually write: 1, 2, 2.5, 5 or 10 times a
 * power of ten. Deriving ticks from the data range instead produces labels
 * like "0,056", which reads as a measurement rather than a scale marker.
 */
export function niceStep(range: number, target: number): number {
  if (!(range > 0)) return 1;
  const rough = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const step = niceStep(hi - lo, target);
  const first = Math.ceil(lo / step) * step;
  const out: number[] = [];
  // Guard against a degenerate range producing an unbounded loop.
  for (let v = first, i = 0; v <= hi + step * 1e-9 && i < 20; v += step, i++) {
    // Re-round: repeated addition accumulates float error that shows up in
    // the label as 0,30000000000000004.
    out.push(Math.round(v / step) * step);
  }
  return out;
}

const W = 640;
const H = 240;
// Generous left padding: axis labels are rendered at a size that survives
// being scaled down to a ~330px phone viewport, so they need the room.
const PAD = { top: 18, right: 18, bottom: 30, left: 58 };

export default function Chart({
  trend,
  includeRefRange = false,
}: {
  trend: Trend;
  /**
   * Opt in to a y-domain that contains the whole reference range.
   *
   * Off by default, and the default is the byte-for-byte rendering every
   * existing caller already has: the bloodwork trends tab scales to the data
   * on purpose (see the note on the domain below), because a ferritin fall
   * from 112 to 88 inside a 30–400 band is the entire reason that chart was
   * opened, and putting 400 on the axis flattens it into a straight line.
   *
   * The chat app opts in, because its chart arrives *inside a sentence*: the
   * answer says „vše v pásmu normy" two lines under a plot whose band filled
   * every pixel and whose last point sat on the bottom axis rule. There the
   * band is the claim being made, so the band has to be visible as a band —
   * with paper above the upper limit and below the lower one — or the picture
   * contradicts the prose. With it on, the tint stops being the series colour
   * too: a band that means „normal" is not a second blue object competing with
   * the line.
   */
  includeRefRange?: boolean;
}) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const pts = numericPoints(trend);
  if (pts.length === 0) return <p className="muted">Žádné číselné hodnoty k zobrazení.</p>;

  // One measurement is not a trend. Drawing it as a chart invents an axis
  // scale that does not exist and shades the whole plot as "reference range",
  // which says nothing.
  if (pts.length === 1) {
    const p = pts[0];
    // Censored results ("<1,0") are ordinary lab results, not extraction
    // failures. Counting only numeric points made a CRP measured four times —
    // <1,0, <1,0, 2,4, <1,0 — announce itself as "jediné měření", which is
    // simply untrue and reads aloud as a clinical statement.
    const censored = trend.points.filter((q) => q.value === null);
    const out = p.flag === "high" || p.flag === "low";
    return (
      <p className="single-point">
        <strong className={out ? "out" : undefined}>
          {czExact(p.value, p.valueRaw)}
          {trend.unit ? ` ${trend.unit}` : ""}
        </strong>{" "}
        <span className="muted">
          {censored.length === 0
            ? ` — jediné měření (${czDate(p.date)})`
            : ` — jediný číselný výsledek (${czDate(p.date)}); ` +
              `${censored.length === 1 ? "další odběr" : `dalších ${censored.length} odběrů`} ` +
              `pod mezí stanovitelnosti (${censored.map((q) => q.valueRaw).join(", ")})`}
          {p.refLow !== null || p.refHigh !== null
            ? `, referenční rozmezí ${p.refLow !== null ? czNum(p.refLow) : ""}–${
                p.refHigh !== null ? czNum(p.refHigh) : ""
              }`
            : ""}
          . Pro křivku je potřeba alespoň druhá číselná hodnota.
        </span>
      </p>
    );
  }

  const values = pts.map((p) => p.value as number);
  const lows = pts.map((p) => p.refLow).filter((v): v is number => v !== null);
  const highs = pts.map((p) => p.refHigh).filter((v): v is number => v !== null);

  // Scale to the DATA, not to the reference range.
  //
  // Including the range in the domain flattens the thing the chart exists to
  // show: ferritin moving 112 → 88 inside a 30–400 band renders as a straight
  // line, and the fall is exactly why the chart was opened. The band is drawn
  // as a backdrop and simply clips when it extends past the view.
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const vSpan = hi - lo;
  const pad = vSpan > 0 ? vSpan * 0.25 : Math.abs(hi) * 0.15 || 1;

  // Keep a nearby range edge visible when it is close enough to be useful,
  // so "just inside the limit" still reads as such.
  const nearLow = lows.filter((v) => v >= lo - pad * 2);
  const nearHigh = highs.filter((v) => v <= hi + pad * 2);
  let yMin = Math.min(lo - pad, ...nearLow);
  let yMax = Math.max(hi + pad, ...nearHigh);

  // Opted in: both limits are inside the plot, with air above and below them,
  // so the band reads as a band rather than as the backdrop.
  if (includeRefRange) {
    const dLo = Math.min(lo, ...lows);
    const dHi = Math.max(hi, ...highs);
    const dPad = dHi > dLo ? (dHi - dLo) * 0.12 : pad;
    yMin = dLo - dPad;
    yMax = dHi + dPad;
  }

  // A concentration or a count cannot be negative, and an axis that says
  // "-25,5" for ferritin undermines every number beside it.
  const canBeNegative = values.some((v) => v < 0) || lows.some((v) => v < 0);
  if (!canBeNegative && yMin < 0) yMin = 0;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Space points by DATE, not by index.
  //
  // Equal spacing quietly rewrites the history: draws in January, February and
  // then three years later render identically to three evenly spaced draws, so
  // a steep rise followed by a plateau reads as a gentle slope. A chart titled
  // "vývoj hodnot v čase" has to put time on the time axis.
  const times = pts.map((p) => Date.parse(p.date)).map((v) => (Number.isFinite(v) ? v : 0));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = t1 - t0;
  const x = (i: number) =>
    pts.length === 1 || span <= 0
      ? PAD.left + innerW / 2
      : PAD.left + ((times[i] - t0) / span) * innerW;
  const y = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const band = (() => {
    const bLow = lows.length ? Math.max(...lows) : null;
    const bHigh = highs.length ? Math.min(...highs) : null;
    if (bLow === null && bHigh === null) return null;
    const top = y(bHigh ?? yMax);
    const bottom = y(bLow ?? yMin);
    return { top, height: Math.max(1, bottom - top), bLow, bHigh };
  })();

  const offscreenLimits: string[] = [];
  if (band?.bHigh != null && (band.bHigh < yMin || band.bHigh > yMax)) offscreenLimits.push("horní mez");
  if (band?.bLow != null && (band.bLow < yMin || band.bLow > yMax)) offscreenLimits.push("dolní mez");

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value as number)}`).join(" ");
  // A domain widened to hold the whole range is a wider domain, and four ticks
  // over it lands on a step of 20 where 10 was available — two labels for the
  // whole axis. Only the opted-in domain asks for the denser target; the
  // default keeps the tick count every existing chart has.
  const ticks = niceTicks(yMin, yMax, includeRefRange ? 5 : 4);
  const active = hover !== null ? pts[hover] : null;

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Vývoj ${trend.displayName}${trend.unit ? ` v ${trend.unit}` : ""}`}
        style={{ display: "block", touchAction: "pan-y" }}
        onMouseLeave={() => setHover(null)}
      >
        <clipPath id={clipId}>
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
        </clipPath>

        {band && (
          <g clipPath={`url(#${clipId})`}>
            <rect
              x={PAD.left}
              y={band.top}
              width={innerW}
              height={band.height}
              fill={includeRefRange ? "var(--band-neutral)" : "var(--band)"}
            />
          </g>
        )}

        {/* Draw each reference limit as a labelled line when it falls inside
            the view. The shaded band alone is ambiguous: with the axis scaled
            to the data it often fills the whole plot (saying nothing) or is
            cropped at an edge, where the cut could be misread as the limit. */}
        {[
          { v: band?.bHigh ?? null, label: "horní mez" },
          { v: band?.bLow ?? null, label: "dolní mez" },
        ].map(({ v, label }, i) =>
          v !== null && v >= yMin && v <= yMax ? (
            <g key={i}>
              <line
                x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)}
                stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="4 3"
              />
              <text
                x={W - PAD.right} y={y(v) - 4} textAnchor="end"
                fontSize={11} fill="var(--ink-muted)"
              >
                {label} {czNum(v)}
              </text>
            </g>
          ) : null,
        )}

        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 7} y={y(t) + 4} textAnchor="end" fontSize={13} fill="var(--ink-muted)">
              {czNum(t)}
            </text>
          </g>
        ))}

        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {pts.map((p, i) => {
          const out = p.flag === "high" || p.flag === "low";
          return (
            <g key={i}>
              {/*
                Hit target deliberately larger than the mark — and everything
                drawn after it is pointer-transparent.

                mouseenter does not bubble, so the visible dot painted on top
                of this circle was eating the event: pointing straight at a
                measurement did nothing, and only the ring of empty space
                around it responded. Guarded by "shows a readout when the
                pointer is on the dot itself" in e2e/visual.e2e.ts.
              */}
              <circle cx={x(i)} cy={y(p.value as number)} r={16} fill="transparent"
                      onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
                      onClick={() => setHover((h) => (h === i ? null : i))} />
              {/* An unconfirmed reading is drawn hollow. It may well be
                  right, so dropping it would hide real data — but it must not
                  look as solid as a value two reads agreed on. */}
              <circle
                pointerEvents="none"
                cx={x(i)} cy={y(p.value as number)} r={hover === i ? 6.5 : 5}
                fill={p.unconfirmed ? "var(--surface-1)" : out ? "var(--status-critical)" : "var(--series-1)"}
                stroke={p.unconfirmed ? (out ? "var(--status-critical)" : "var(--series-1)") : "var(--surface-1)"}
                strokeWidth={p.unconfirmed ? 2.5 : 2}
                strokeDasharray={p.unconfirmed ? "3 2" : undefined}
              />
              {out && (
                <text x={x(i)} y={y(p.value as number) - 12} textAnchor="middle" fontSize={13}
                      pointerEvents="none" fill="var(--status-critical)" fontWeight={700}>
                  {p.flag === "high" ? "↑" : "↓"}
                </text>
              )}
              {/* Label the latest point: reading twenty charts should not mean
                  opening twenty tables to find the current value. */}
              {i === pts.length - 1 && (
                <text
                  pointerEvents="none"
                  x={x(i) - 9}
                  y={y(p.value as number) - 10}
                  textAnchor="end"
                  fontSize={14}
                  fontWeight={700}
                  fill={out ? "var(--status-critical)" : "var(--ink-1)"}
                >
                  {czNum(p.value)}
                </text>
              )}
            </g>
          );
        })}

        {/* Hover readout, anchored to the point.
            The caption under the chart carries the same words for screen
            readers and for touch, but a reader following a line with the mouse
            should not have to look away from it to find out what they are
            pointing at. Drawn last so it sits over the series, and flipped
            near an edge so it never leaves the plot. */}
        {hover !== null && active && (() => {
          const lines = [
            czDate(active.date),
            `${czExact(active.value, active.valueRaw)}${trend.unit ? ` ${prettyUnit(trend.unit)}` : ""}`,
            active.flag === "high"
              ? "nad rozmezím"
              : active.flag === "low"
                ? "pod rozmezím"
                : active.refLow !== null || active.refHigh !== null
                  ? "v rozmezí"
                  : "",
          ].filter(Boolean);
          if (active.unconfirmed) lines.push("nepotvrzeno");
          // No text metrics inside an SVG viewBox, so the width is estimated
          // per line from its character count. Erring a little wide only
          // leaves padding; erring narrow clips the date.
          const w = Math.max(84, ...lines.map((l, i) => l.length * (i === 1 ? 6.9 : 5.6) + 18));
          const h = 16 + lines.length * 14;
          const px = x(hover);
          const py = y(active.value as number);
          const left = px + 14 + w > W - PAD.right ? px - 14 - w : px + 14;
          const top = Math.min(Math.max(PAD.top, py - h / 2), H - PAD.bottom - h);
          const out = active.flag === "high" || active.flag === "low";
          return (
            <g className="chart-tip" pointerEvents="none">
              {/* A guide down to the axis: with ten points a box floating
                  beside the line leaves "which one?" genuinely open. */}
              <line
                x1={px} x2={px} y1={PAD.top} y2={H - PAD.bottom}
                stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="3 3" opacity={0.55}
              />
              <rect x={left} y={top} width={w} height={h} rx={7}
                    fill="var(--surface-1)" stroke="var(--border-strong)" strokeWidth={1} />
              {lines.map((l, i) => (
                <text
                  key={i}
                  x={left + 9}
                  y={top + 14 + i * 14}
                  fontSize={i === 1 ? 12.5 : 10.5}
                  fontWeight={i === 1 ? 700 : 400}
                  fill={i === 1 ? (out ? "var(--status-critical)" : "var(--ink-1)") : "var(--ink-2)"}
                >
                  {l}
                </text>
              ))}
            </g>
          );
        })()}

        {/* With real time spacing two close draws can collide, so a label is
            dropped when it would overlap the previous one. */}
        {pts.map((p, i) => {
          const MIN_GAP = 46;
          const prevShown = pts.slice(0, i).reduce((acc, _, j) => (x(j) >= acc ? x(j) : acc), -Infinity);
          if (i > 0 && i < pts.length - 1 && x(i) - prevShown < MIN_GAP) return null;
          return (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={13} fill="var(--ink-muted)">
              {czMonthYear(p.date)}
            </text>
          );
        })}
      </svg>

      <figcaption className="muted" style={{ minHeight: "1.4em", marginTop: 2 }}>
        {active
          ? `${czDate(active.date)}: ${czNum(active.value)}${trend.unit ? ` ${trend.unit}` : ""}` +
            (active.flag === "high" ? " — nad rozmezím" : active.flag === "low" ? " — pod rozmezím" : "") +
            (active.unconfirmed ? " · nepotvrzeno" : "")
          : band
            ? `Referenční rozmezí ${band.bLow !== null ? czNum(band.bLow) : ""}${
                band.bLow !== null && band.bHigh !== null ? "–" : ""
              }${band.bHigh !== null ? czNum(band.bHigh) : ""}${trend.unit ? ` ${trend.unit}` : ""}`
            : "Bez referenčního rozmezí."}
      </figcaption>
    </figure>
  );
}
