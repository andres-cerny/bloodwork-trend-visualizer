/**
 * The CSM chevron mark — Centrum sportovní medicíny's logo, redrawn.
 *
 * Inline SVG rather than the clinic's PNG: it scales to any header, ships no
 * binary, and stays crisp on the picker and the favicon-sized chip alike. The
 * geometry is the brand's — five bars with pointed ends, solid at the top and
 * fading downward — in the brand red that the tenant layer deliberately keeps out of
 * the tokens: red means „out of range" everywhere else in this kit, so the
 * only place the brand red exists is inside this drawing, where it cannot be
 * mistaken for a flag. Both palettes get the same mark; a logo does not theme.
 */

const BARS = [1, 0.78, 0.56, 0.38, 0.24];
const RED = "#e6314c";

export function CsmMark({ size = 28, title = "Centrum sportovní medicíny" }: {
  size?: number;
  title?: string;
}) {
  const barH = 12;
  const gap = 7;
  const tip = 9;
  const w = 100;
  const h = BARS.length * barH + (BARS.length - 1) * gap;
  return (
    <svg
      width={size}
      height={(size * h) / w}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={title}
    >
      {BARS.map((opacity, i) => {
        const y = i * (barH + gap);
        const mid = y + barH / 2;
        return (
          <polygon
            key={i}
            points={`${tip},${y} ${w - tip},${y} ${w},${mid} ${w - tip},${y + barH} ${tip},${y + barH} 0,${mid}`}
            fill={RED}
            fillOpacity={opacity}
          />
        );
      })}
    </svg>
  );
}
