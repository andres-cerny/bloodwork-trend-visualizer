/**
 * The photo checks (docs/plans/photo-capture.md, Phase B), on synthetic pages.
 *
 * The thresholds are calibrated on the real photo corpus by
 * `tests/bench/photo_checks.ts`; these tests pin the *mechanisms* — that each
 * fault moves the measure it is meant to move, and nothing else — so a
 * refactor cannot quietly turn a check into a constant.
 */
import { describe, expect, it } from "vitest";

import {
  assessPhoto,
  downscaleGrey,
  type Grey,
  lumaFromRgba,
  measurePhoto,
  QUALITY,
} from "../src/photo";

/** A deterministic PRNG, so every synthetic page is the same page. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * A lab sheet in miniature: rows of "words" (dark strokes 2–3 px wide, 12 px
 * tall) on paper at `paper`, a margin all round. Long edge 1024 unless asked.
 */
function page(opts: { width?: number; height?: number; paper?: number; ink?: number } = {}): Grey {
  const { width = 724, height = 1024, paper = 225, ink = 30 } = opts;
  const data = new Uint8Array(width * height).fill(paper);
  const r = rng(7);
  for (let y = 60; y < height - 60; y += 26) {
    let x = 50;
    while (x < width - 80) {
      const word = 20 + Math.floor(r() * 60);
      for (let sx = x; sx < Math.min(x + word, width - 50); sx += 5) {
        const sw = 2 + Math.floor(r() * 2);
        for (let yy = y; yy < y + 12; yy++) for (let xx = sx; xx < sx + sw; xx++) data[yy * width + xx] = ink;
      }
      x += word + 14 + Math.floor(r() * 30);
    }
  }
  return { data, width, height };
}

/** Separable box blur, `passes` times — three passes approximate a Gaussian. */
function blur(g: Grey, radius: number, passes = 3, dir: "both" | "x" = "both"): Grey {
  let cur = Float32Array.from(g.data);
  const { width: w, height: h } = g;
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src[yy * w + xx];
          n++;
        }
        out[y * w + x] = s / n;
      }
    return out;
  };
  for (let p = 0; p < passes; p++) {
    cur = pass(cur, true);
    if (dir === "both") cur = pass(cur, false);
  }
  return { data: Uint8Array.from(cur, (v) => Math.round(v)), width: w, height: h };
}

/** Lift a disc toward white and clip it: a lamp reflection. */
function reflect(g: Grey, cx: number, cy: number, r: number): Grey {
  const data = Uint8Array.from(g.data);
  for (let y = 0; y < g.height; y++)
    for (let x = 0; x < g.width; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < 1.4) {
        const lift = d < 1 ? 1 : Math.max(0, 1 - (d - 1) / 0.3); // a clipped core, a short falloff
        const i = y * g.width + x;
        data[i] = Math.min(255, Math.round(data[i] + (300 - data[i]) * lift));
      }
    }
  return { data, width: g.width, height: g.height };
}

const verdict = (g: Grey, longEdge?: number) => assessPhoto(measurePhoto(g, longEdge));

describe("a good photo", () => {
  it("is ok, with no reasons", () => {
    expect(verdict(page())).toEqual({ outcome: "ok", reasons: [] });
  });

  it("is ok at 3× the pixels: the analysis image fixes the scale", () => {
    const big = page({ width: 724 * 3, height: 1024 * 3 });
    expect(downscaleGrey(big).width).toBeLessThanOrEqual(1024);
    expect(verdict(big)).toEqual({ outcome: "ok", reasons: [] });
  });

  it("is ok when dark but legible: sharpness is a ratio, not an amount", () => {
    const dim = page({ paper: 120, ink: 20 });
    expect(Math.abs(measurePhoto(dim).sharpness - measurePhoto(page()).sharpness)).toBeLessThan(0.05);
    expect(verdict(dim).outcome).toBe("ok");
  });
});

describe("refuse — only what can never hold a row", () => {
  it("refuses a frame too small to hold print", () => {
    expect(verdict(page(), 200)).toEqual({ outcome: "refuse", reasons: ["too_small"] });
  });

  it("refuses a nearly uniform frame (lens cap, wall)", () => {
    const flat: Grey = { data: new Uint8Array(600 * 800).fill(40), width: 600, height: 800 };
    expect(verdict(flat).outcome).toBe("refuse");
    expect(verdict(flat).reasons).toContain("blank");
  });

  it("does not refuse a small photo that may still hold large print — it warns", () => {
    expect(verdict(page(), 600)).toEqual({ outcome: "warn", reasons: ["small"] });
  });
});

describe("blur", () => {
  it("warns on defocus", () => {
    expect(verdict(blur(page(), 3)).reasons).toContain("blurred");
  });

  /**
   * Shake smears one direction. Measured as a direction-averaged ratio this
   * page scores ~1.5 — above the threshold, so it passed as sharp; the worst
   * direction scores under it. (Verified 2026-09-26 by swapping the minimum
   * over directions for the mean of 0° and 90°: this test failed.)
   */
  it("warns on shake along one direction, which an averaged measure misses", () => {
    const shaken = blur(page(), 4, 3, "x");
    const m = measurePhoto(shaken);
    expect(m.sharpness).toBeLessThan(QUALITY.blurSharpness);
    expect(verdict(shaken).reasons).toContain("blurred");
  });

  it("does not warn on a slight softening the readers still read", () => {
    // A 3 px box on a 3× page: a third of a pixel at analysis scale, like the
    // simulated `glare` shots' 1.2 px blur on a 3024 px frame.
    const soft = blur(page({ width: 724 * 3, height: 1024 * 3 }), 1, 1);
    expect(verdict(soft).reasons).not.toContain("blurred");
  });
});

describe("glare", () => {
  it("warns when a reflection clips a large patch of the print", () => {
    const shot = reflect(page(), 360, 420, 240);
    expect(verdict(shot).reasons).toContain("glare");
  });

  /**
   * A digital render or an over-exposed shot has paper at 255, and its blank
   * margins clip exactly like a reflection. Without the headroom rule this page
   * warned "glare" (verified 2026-09-26 by removing it: this test failed).
   */
  it("does not call blank margins glare when the paper itself is white", () => {
    const white = page({ paper: 255 });
    const withMargin: Grey = { ...white, data: Uint8Array.from(white.data) };
    for (let i = (withMargin.height >> 1) * withMargin.width; i < withMargin.data.length; i++) withMargin.data[i] = 255;
    expect(measurePhoto(withMargin).highlight).toBeGreaterThan(QUALITY.glare);
    expect(verdict(withMargin).reasons).not.toContain("glare");
  });
});

describe("dark", () => {
  /**
   * With an absolute print threshold of 48 levels this page had no print at
   * all and was *refused* as blank (verified 2026-09-26) — a photo the stretch
   * would make legible. Relative to its paper, it carries print and warns.
   */
  it("warns, and does not refuse, when the paper is nearly black", () => {
    expect(verdict(page({ paper: 45, ink: 5 }))).toEqual({ outcome: "warn", reasons: ["dark"] });
  });
});

describe("luma", () => {
  it("uses the same Rec. 601 weights as the encode", () => {
    const g = lumaFromRgba(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1);
    expect([...g.data]).toEqual([76, 150, 29]);
  });
});
