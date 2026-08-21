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
import { czNum } from "../lib/summary";
import { numericPoints, type Trend } from "../lib/trends";

const W = 640;
const H = 220;
const PAD = { top: 14, right: 14, bottom: 26, left: 46 };

export default function Chart({ trend }: { trend: Trend }) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const pts = numericPoints(trend);
  if (pts.length === 0) return <p className="muted">Žádné číselné hodnoty k zobrazení.</p>;

  const values = pts.map((p) => p.value as number);
  const lows = pts.map((p) => p.refLow).filter((v): v is number => v !== null);
  const highs = pts.map((p) => p.refHigh).filter((v): v is number => v !== null);
  const lo = Math.min(...values, ...lows, ...highs);
  const hi = Math.max(...values, ...lows, ...highs);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.15 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
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
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
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
            <text x={PAD.left - 7} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--ink-muted)">
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
                <text x={x(i)} y={y(p.value as number) - 12} textAnchor="middle" fontSize={11}
                      fill="var(--status-critical)" fontWeight={700}>
                  {p.flag === "high" ? "↑" : "↓"}
                </text>
              )}
            </g>
          );
        })}

        {pts.map((p, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-muted)">
            {p.date.slice(2, 7).replace("-", "/")}
          </text>
        ))}
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
