/**
 * A single parameter over time, for a person reading their own results.
 *
 * The classic `Chart` was drawn for a clinician comparing a slope; this one
 * answers the question a patient asks first — am I inside the range — and
 * only then how it moved. So the reference limits are in the plot whenever
 * they are within reach of the data, the space beyond them is tinted the
 * status colour, and a point outside is red where it sits. The classic stays
 * byte-for-byte for the demo; both read the same `Trend`, and "the model may
 * name a chart, never fill one" is enforced upstream of either.
 *
 * Still: scale to the data. A ferritin falling 112 → 88 inside a 30–400
 * band must not flatten into a line, so a limit far outside the data stays
 * off the plot and is named in the caption instead.
 *
 * Colour is never the only channel: an out-of-range point is red *and* sits
 * in the tinted zone *and* carries an arrow; an unconfirmed one is hollow
 * *and* named in the caption. Text takes ink tokens; only marks take signal.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { czDate, czExact, czMonthYear, czNum, numericPoints, prettyUnit, type Trend, type TrendPoint } from "@bw/lab-core";
import { niceTicks } from "./Chart";

const W = 640;
const H = 250;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
const MIN_TEXT_PX = 11;
const SMALLEST_LABEL = 11;
const MAX_TEXT_SCALE = 2.2;
/** A limit further than this many data spans from the data stays off-plot. */
const REACH = 3;

const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const isOut = (p: TrendPoint) => p.flag === "high" || p.flag === "low";

export interface Domain {
  yMin: number;
  yMax: number;
  bLow: number | null;
  bHigh: number | null;
  /** Limits that exist but were left off the plot, for the caption. */
  offPlot: Array<{ label: string; value: number }>;
}

/**
 * The y-domain: the data, plus each limit that is within reach of it, plus
 * air. Exported so the sparkline draws by the same rule as the chart.
 */
export function trendDomain(pts: TrendPoint[], air = 0.12): Domain {
  const values = pts.map((p) => p.value as number);
  const lows = pts.map((p) => p.refLow).filter((v): v is number => v !== null);
  const highs = pts.map((p) => p.refHigh).filter((v): v is number => v !== null);
  const bLow = lows.length ? Math.max(...lows) : null;
  const bHigh = highs.length ? Math.min(...highs) : null;

  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.abs(hi) * 0.1 || 1;

  const offPlot: Domain["offPlot"] = [];
  const included: number[] = [lo, hi];
  const consider = (v: number | null, label: string) => {
    if (v === null) return;
    const distance = v > hi ? v - hi : v < lo ? lo - v : 0;
    if (distance <= span * REACH) included.push(v);
    else offPlot.push({ label, value: v });
  };
  consider(bHigh, "horní mez");
  consider(bLow, "dolní mez");

  const min = Math.min(...included);
  const max = Math.max(...included);
  const range = max - min || span;
  let yMin = min - range * air;
  const yMax = max + range * air;
  const canBeNegative = values.some((v) => v < 0) || lows.some((v) => v < 0);
  if (!canBeNegative && yMin < 0) yMin = 0;
  return { yMin, yMax, bLow, bHigh, offPlot };
}

/** Points spaced by date, not by index — time on the time axis. */
function xScale(pts: TrendPoint[], left: number, width: number): (i: number) => number {
  const times = pts.map((p) => Date.parse(p.date)).map((v) => (Number.isFinite(v) ? v : 0));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = t1 - t0;
  return (i) => (pts.length === 1 || span <= 0 ? left + width / 2 : left + ((times[i] - t0) / span) * width);
}

export default function TrendChart({ trend }: { trend: Trend }) {
  const clipId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const figRef = useRef<HTMLElement>(null);
  const [drawnW, setDrawnW] = useState<number | null>(null);

  // Type keeps its size on the glass: the viewBox is 640 wide and a phone
  // draws it at ~340, so every label is scaled back up by the same factor.
  useMeasureEffect(() => {
    const el = figRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => {
      const w = el.getBoundingClientRect().width;
      setDrawnW((prev) => (w > 0 && Math.abs((prev ?? -1) - w) > 0.5 ? w : prev));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = drawnW !== null && drawnW > 0 ? drawnW / W : 1;
  const k = Math.min(MAX_TEXT_SCALE, Math.max(1, MIN_TEXT_PX / (SMALLEST_LABEL * scale)));

  const pts = numericPoints(trend);
  if (pts.length === 0) return <p className="muted">Žádné číselné hodnoty k zobrazení.</p>;
  if (pts.length === 1) {
    // One measurement is not a trend: a chart would invent an axis.
    const p = pts[0];
    return (
      <p className="single-point">
        <strong className={isOut(p) ? "out" : undefined}>
          {czExact(p.value, p.valueRaw)}
          {trend.unit ? ` ${prettyUnit(trend.unit)}` : ""}
        </strong>{" "}
        <span className="muted">— jediné měření ({czDate(p.date)}). Křivka od druhého odběru.</span>
      </p>
    );
  }

  const d = trendDomain(pts);
  const ticks = niceTicks(d.yMin, d.yMax, 6);
  const tickChars = Math.max(1, ...ticks.map((t) => czNum(t).length));
  const padLeft = Math.max(PAD.left, Math.ceil(tickChars * 12 * k * 0.58) + 10);
  const padBottom = Math.max(PAD.bottom, Math.ceil(12 * k * 1.4) + 6);
  const innerW = W - padLeft - PAD.right;
  const innerH = H - PAD.top - padBottom;
  const x = xScale(pts, padLeft, innerW);
  const y = (v: number) => PAD.top + innerH - ((v - d.yMin) / (d.yMax - d.yMin || 1)) * innerH;
  const inView = (v: number | null): v is number => v !== null && v >= d.yMin && v <= d.yMax;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value as number)}`).join(" ");
  const active = hover !== null ? pts[hover] : null;
  const unit = prettyUnit(trend.unit);

  return (
    <figure ref={figRef} className="tc" style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`Vývoj ${trend.displayName}${unit ? ` v ${unit}` : ""}`}
        style={{ display: "block", touchAction: "pan-y" }}
        onMouseLeave={() => setHover(null)}
      >
        <clipPath id={clipId}>
          <rect x={padLeft} y={PAD.top} width={innerW} height={innerH} />
        </clipPath>

        {/* Beyond each limit, the status tint. Inside the range the paper is
            left alone: the band is where nothing needs saying. */}
        <g clipPath={`url(#${clipId})`}>
          {inView(d.bHigh) && (
            <rect x={padLeft} y={PAD.top} width={innerW} height={Math.max(0, y(d.bHigh) - PAD.top)} fill="var(--status-critical-soft)" />
          )}
          {inView(d.bLow) && (
            <rect x={padLeft} y={y(d.bLow)} width={innerW} height={Math.max(0, PAD.top + innerH - y(d.bLow))} fill="var(--status-critical-soft)" />
          )}
        </g>

        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padLeft} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padLeft - 7 * k} y={y(t) + 4 * k} textAnchor="end" fontSize={12 * k} fill="var(--ink-muted)">
              {czNum(t)}
            </text>
          </g>
        ))}

        {[
          { v: d.bHigh, label: "horní mez" },
          { v: d.bLow, label: "dolní mez" },
        ].map(({ v, label }, i) =>
          inView(v) ? (
            <g key={i}>
              <line x1={padLeft} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--status-critical)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
              <text x={W - PAD.right} y={y(v) + (i === 0 ? -5 : 13) * k} textAnchor="end" fontSize={11 * k} fill="var(--critical-ink)">
                {label} {czNum(v)}
              </text>
            </g>
          ) : null,
        )}

        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {pts.map((p, i) => {
          const out = isOut(p);
          const last = i === pts.length - 1;
          const cx = x(i);
          const cy = y(p.value as number);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={16} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover((h) => (h === i ? null : i))} />
              <circle
                pointerEvents="none"
                cx={cx}
                cy={cy}
                r={last || hover === i ? 6 : 4.5}
                fill={p.unconfirmed ? "var(--surface-1)" : out ? "var(--status-critical)" : "var(--series-1)"}
                stroke={p.unconfirmed ? (out ? "var(--status-critical)" : "var(--series-1)") : "var(--surface-1)"}
                strokeWidth={2}
                strokeDasharray={p.unconfirmed ? "3 2" : undefined}
              />
              {out && !last && (
                <text x={cx} y={cy - 11 * k} textAnchor="middle" fontSize={12 * k} pointerEvents="none" fill="var(--critical-ink)" fontWeight={700}>
                  {p.flag === "high" ? "↑" : "↓"}
                </text>
              )}
              {last && (() => {
                // The current value in a tag beside its point: reading a grid
                // of charts should not mean opening a table each time.
                const label = `${czNum(p.value)}${out ? (p.flag === "high" ? " ↑" : " ↓") : ""}`;
                const w = label.length * 7.4 * k + 14 * k;
                const h = 20 * k;
                const left = cx + 12 + w > W - PAD.right ? cx - 12 - w : cx + 12;
                const top = Math.min(Math.max(PAD.top, cy - h / 2), PAD.top + innerH - h);
                return (
                  <g pointerEvents="none">
                    <rect x={left} y={top} width={w} height={h} rx={6} fill="var(--surface-1)" stroke={out ? "var(--status-critical)" : "var(--border-strong)"} strokeWidth={1} />
                    <text x={left + w / 2} y={top + h / 2 + 4.5 * k} textAnchor="middle" fontSize={13 * k} fontWeight={700} fill={out ? "var(--critical-ink)" : "var(--ink-1)"}>
                      {label}
                    </text>
                  </g>
                );
              })()}
            </g>
          );
        })}

        {hover !== null && active && (() => {
          const lines = [
            czDate(active.date),
            `${czExact(active.value, active.valueRaw)}${unit ? ` ${unit}` : ""}`,
            active.flag === "high" ? "nad rozmezím" : active.flag === "low" ? "pod rozmezím" : active.refLow !== null || active.refHigh !== null ? "v rozmezí" : "",
          ].filter(Boolean);
          if (active.unconfirmed) lines.push("nepotvrzeno");
          const w = Math.max(84 * k, ...lines.map((l, i) => l.length * (i === 1 ? 6.9 : 5.6) * k + 18 * k));
          const h = (16 + lines.length * 14) * k;
          const px = x(hover);
          const py = y(active.value as number);
          const left = px + 14 + w > W - PAD.right ? px - 14 - w : px + 14;
          const top = Math.min(Math.max(PAD.top, py - h / 2), H - padBottom - h);
          const out = isOut(active);
          return (
            <g className="chart-tip" pointerEvents="none">
              <line x1={px} x2={px} y1={PAD.top} y2={H - padBottom} stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="3 3" opacity={0.55} />
              <rect x={left} y={top} width={w} height={h} rx={7} fill="var(--surface-1)" stroke="var(--border-strong)" strokeWidth={1} />
              {lines.map((l, i) => (
                <text key={i} x={left + 9 * k} y={top + (14 + i * 14) * k} fontSize={(i === 1 ? 12.5 : 10.5) * k} fontWeight={i === 1 ? 700 : 400} fill={i === 1 ? (out ? "var(--critical-ink)" : "var(--ink-1)") : "var(--ink-2)"}>
                  {l}
                </text>
              ))}
            </g>
          );
        })()}

        {pts.map((p, i) => {
          const MIN_GAP = 46 * k;
          const prevShown = pts.slice(0, i).reduce((acc, _, j) => (x(j) >= acc ? x(j) : acc), -Infinity);
          if (i > 0 && i < pts.length - 1 && x(i) - prevShown < MIN_GAP) return null;
          const half = czMonthYear(p.date).length * 12 * k * 0.26;
          const lx = Math.min(Math.max(x(i), half), W - half);
          return (
            <text key={i} x={lx} y={H - 7} textAnchor="middle" fontSize={12 * k} fill="var(--ink-muted)">
              {czMonthYear(p.date)}
            </text>
          );
        })}
      </svg>

      <figcaption className="muted" style={{ minHeight: "1.4em", marginTop: 4 }}>
        {active
          ? `${czDate(active.date)}: ${czExact(active.value, active.valueRaw)}${unit ? ` ${unit}` : ""}` +
            (active.flag === "high" ? " — nad rozmezím" : active.flag === "low" ? " — pod rozmezím" : "") +
            (active.unconfirmed ? " · nepotvrzeno" : "")
          : d.bLow !== null || d.bHigh !== null
            ? `Referenční rozmezí ${d.bLow !== null ? czNum(d.bLow) : ""}${d.bLow !== null && d.bHigh !== null ? "–" : ""}${d.bHigh !== null ? czNum(d.bHigh) : ""}${unit ? ` ${unit}` : ""}` +
              (d.offPlot.length ? ` · ${d.offPlot.map((o) => `${o.label} ${czNum(o.value)} mimo výřez`).join(", ")}` : "")
            : "Bez referenčního rozmezí."}
      </figcaption>
    </figure>
  );
}

/**
 * The same picture at thumbnail size: tinted zones, the line, the last point.
 * No axes and no labels — the tile it sits in names the value; this only says
 * where the line has been relative to the range.
 */
export function Sparkline({ trend, width = 120, height = 40 }: { trend: Trend; width?: number; height?: number }) {
  const pts = numericPoints(trend);
  if (pts.length === 0) return null;
  const d = trendDomain(pts, 0.18);
  const P = 4;
  const x = xScale(pts, P, width - P * 2);
  const y = (v: number) => P + (height - P * 2) - ((v - d.yMin) / (d.yMax - d.yMin || 1)) * (height - P * 2);
  const inView = (v: number | null): v is number => v !== null && v >= d.yMin && v <= d.yMax;
  const last = pts[pts.length - 1];
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value as number).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {inView(d.bHigh) && <rect x={0} y={0} width={width} height={Math.max(0, y(d.bHigh))} fill="var(--status-critical-soft)" />}
      {inView(d.bLow) && <rect x={0} y={y(d.bLow)} width={width} height={Math.max(0, height - y(d.bLow))} fill="var(--status-critical-soft)" />}
      {inView(d.bHigh) && <line x1={0} x2={width} y1={y(d.bHigh)} y2={y(d.bHigh)} stroke="var(--status-critical)" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />}
      {inView(d.bLow) && <line x1={0} x2={width} y1={y(d.bLow)} y2={y(d.bLow)} stroke="var(--status-critical)" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />}
      {pts.length > 1 && <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />}
      <circle
        cx={x(pts.length - 1)}
        cy={y(last.value as number)}
        r={3.2}
        fill={last.unconfirmed ? "var(--surface-1)" : isOut(last) ? "var(--status-critical)" : "var(--series-1)"}
        stroke={last.unconfirmed ? (isOut(last) ? "var(--status-critical)" : "var(--series-1)") : "var(--surface-1)"}
        strokeWidth={1.5}
      />
    </svg>
  );
}
