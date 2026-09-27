/**
 * The photo-check corpus (docs/plans/photo-capture.md, Phase A), as one list,
 * and the one decode every free photo harness uses.
 *
 * Four git-ignored sources, each with the outcome a check should give:
 *
 *   data/photos-sim/      simulate_photos.py      — every file read in full by
 *                                                   both deployed readers: ok
 *   data/photos-bad/      simulate_bad_photos.py  — expected per file in its manifest
 *   data/not-lab/         SOURCES.md              — not a lab sheet: warn
 *   public sheet renders  tests/bench/results/adapt/renders/public — a lab, any lab: ok
 *
 * `readersFull` records what is known about the readers on each file: true for
 * the 133 simulated photos (docs/lab-adaptability.md, "The full corpus under the
 * final prompt": Sonnet 3,585/3,585 rows, 0 value errors); for the others it is
 * filled from subagent reads where those were run, and undefined otherwise.
 *
 * Decoding uses `sharp` (present through miniflare; bench-only, never shipped)
 * and reproduces what `encodePhoto` hands the checks: EXIF-rotated, long edge
 * capped at PHOTO_MAX_EDGE, RGBA.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PHOTO_MAX_EDGE } from "../../packages/lab-core/src/photo";

export const MAIN = process.env.BW_MAIN ?? join(import.meta.dirname, "..", "..");
const DATA = join(MAIN, "data");

export type Outcome = "ok" | "warn" | "refuse";

export interface CorpusPhoto {
  /** Stable id: `<set>/<file>`. */
  id: string;
  path: string;
  set: "sim" | "bad" | "notlab" | "public";
  condition: string;
  expected: Outcome;
  /** Page corners as fractions of the frame, clockwise from top-left, when known. */
  corners?: [number, number][] | null;
  source_file?: string | null;
  pages?: number[];
  readersFull?: boolean;
}

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, "utf8"));
}

export function loadCorpus(): CorpusPhoto[] {
  const out: CorpusPhoto[] = [];
  const sim = join(DATA, "photos-sim");
  const bad = join(DATA, "photos-bad");
  const angleCorners = existsSync(join(bad, "corners_angle.json")) ? readJson(join(bad, "corners_angle.json")) : {};
  if (existsSync(join(sim, "manifest.json"))) {
    for (const [name, m] of Object.entries<any>(readJson(join(sim, "manifest.json")))) {
      const full: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      out.push({
        id: `sim/${name}`, path: join(sim, name), set: "sim", condition: m.condition, expected: "ok",
        corners: m.condition === "angle" ? angleCorners[name] ?? null : m.condition === "twopage" ? null : full,
        source_file: m.source_file, pages: m.pages, readersFull: true,
      });
    }
  }
  if (existsSync(join(bad, "manifest.json"))) {
    for (const [name, m] of Object.entries<any>(readJson(join(bad, "manifest.json")))) {
      out.push({
        id: `bad/${name}`, path: join(bad, name), set: "bad", condition: m.condition, expected: m.expected,
        corners: m.corners, source_file: m.source_file, pages: m.pages,
      });
    }
  }
  const notlab = join(DATA, "not-lab");
  if (existsSync(notlab)) {
    for (const f of readdirSync(notlab).sort()) {
      if (!/\.(jpe?g|png)$/i.test(f)) continue;
      out.push({ id: `notlab/${f}`, path: join(notlab, f), set: "notlab", condition: "notlab", expected: "warn" });
    }
  }
  const pub = join(MAIN, "tests/bench/results/adapt/renders/public");
  if (existsSync(pub)) {
    for (const f of readdirSync(pub).sort()) {
      if (!/^[a-z0-9_]+\.png$/.test(f)) continue; // skip the .tileN.png halves
      out.push({ id: `public/${f}`, path: join(pub, f), set: "public", condition: "public", expected: "ok" });
    }
  }
  return out;
}

export interface Decoded {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** Long edge of the file as decoded, before the cap. */
  longEdge: number;
}

/** What `encodePhoto` has in hand before its stretch: rotated, capped, RGBA. */
export async function decodeForChecks(path: string, maxEdge = PHOTO_MAX_EDGE): Promise<Decoded> {
  const img = sharp(path).rotate();
  const meta = await img.metadata();
  const long = Math.max(meta.width ?? 0, meta.height ?? 0);
  const { data, info } = await img
    .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height, longEdge: long };
}
