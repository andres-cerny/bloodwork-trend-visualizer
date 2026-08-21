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
import { czExact, czNum } from "../lib/summary";
import { czDate, czMonthYear } from "../lib/czech";
import { numericPoints, type Trend } from "../lib/trends";

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

export default function Chart({ trend }: { trend: Trend }) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const pts = numericPoints(trend);
  if (pts.length === 0) return <p className="muted">Žádné číselné hodnoty k zobrazení.</p>;

  // One measurement is not a trend. Drawing it as a chart invents an axis
  // scale that does not exist and shades the whole plot as "reference range",
  // which says nothing.
  if (pts.length === 1) {
    const p = pts[0];
    const out = p.flag === "high" || p.flag === "low";
    return (
      <p className="single-point">
        <strong className={out ? "out" : undefined}>
          {czExact(p.value, p.valueRaw)}
          {trend.unit ? ` ${trend.unit}` : ""}
        </strong>{" "}
        <span className="muted">
          — jediné měření ({czDate(p.date)})
          {p.refLow !== null || p.refHigh !== null
            ? `, referenční rozmezí ${p.refLow !== null ? czNum(p.refLow) : ""}–${
                p.refHigh !== null ? czNum(p.refHigh) : ""
              }`
            : ""}
          . Pro vývoj je potřeba alespoň druhý odběr.
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

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value as number)}`).join(" ");
  const ticks = niceTicks(yMin, yMax);
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
            <rect x={PAD.left} y={band.top} width={innerW} height={band.height} fill="var(--band)" />
          </g>
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
              {/* Hit target deliberately larger than the mark. */}
              <circle cx={x(i)} cy={y(p.value as number)} r={16} fill="transparent"
                      onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              <circle
                cx={x(i)} cy={y(p.value as number)} r={hover === i ? 6.5 : 5}
                fill={out ? "var(--status-critical)" : "var(--series-1)"}
                stroke="var(--surface-1)" strokeWidth={2}
              />
              {out && (
                <text x={x(i)} y={y(p.value as number) - 12} textAnchor="middle" fontSize={13}
                      fill="var(--status-critical)" fontWeight={700}>
                  {p.flag === "high" ? "↑" : "↓"}
                </text>
              )}
              {/* Label the latest point: reading twenty charts should not mean
                  opening twenty tables to find the current value. */}
              {i === pts.length - 1 && (
                <text
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
          ? `${active.date}: ${czNum(active.value)}${trend.unit ? ` ${trend.unit}` : ""}` +
            (active.flag === "high" ? " — nad rozmezím" : active.flag === "low" ? " — pod rozmezím" : "")
          : band
            ? `Referenční rozmezí ${band.bLow !== null ? czNum(band.bLow) : ""}${
                band.bLow !== null && band.bHigh !== null ? "–" : ""
              }${band.bHigh !== null ? czNum(band.bHigh) : ""}${trend.unit ? ` ${trend.unit}` : ""}`
            : "Bez referenčního rozmezí."}
      </figcaption>
    </figure>
  );
}
