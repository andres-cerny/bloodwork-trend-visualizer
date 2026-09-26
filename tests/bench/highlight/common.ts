/**
 * Shared loaders for the photo-highlight bench (docs/plans/photo-highlight.md).
 *
 * Data never lives in this directory. `BW_ROOT` names the checkout that holds
 * `data/`, `samples/` and `tests/bench/results/` (a worktree has none of them);
 * it defaults to the current directory. Everything written goes to
 * `$BW_ROOT/tests/bench/results/highlight/`, which is git-ignored.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const BW_ROOT = resolve(process.env.BW_ROOT ?? ".");
export const PHOTOS = join(BW_ROOT, "data/photos-sim");
export const RESULTS = join(BW_ROOT, "tests/bench/results/highlight");

export interface ReaderRow {
  raw_analyte_name?: string;
  value_raw?: string;
  unit_raw?: string;
  ref_range_raw?: string;
  source_snippet?: string;
}

/**
 * The reader whose rows are located: Sonnet under the final photo prompt
 * (`sonnet_vision_dF`, 3585/3585 on the 133 photos — lab-adaptability.md).
 * These are existing subagent reads; nothing is re-read here.
 */
export const READER_DIR = join(BW_ROOT, "tests/bench/results/subagent/photo/out/sonnet_vision_dF");

export function readerRows(photo: string): ReaderRow[] {
  const slug = `sim__${photo.replace(/\.jpg$/, "")}`;
  const d = JSON.parse(readFileSync(join(READER_DIR, `${slug}.json`), "utf8"));
  return (d.measurements ?? d.call?.extraction?.measurements ?? []) as ReaderRow[];
}

export interface Transforms {
  [photo: string]: {
    source_file: string;
    pages: number[];
    condition: string;
    photo_size: [number, number];
    pages_geo: Array<{ page: number; pdf_size: [number, number]; H: number[][] }>;
    flat?: Array<{ file: string; page: number; size: [number, number]; H: number[][] }>;
    flat_kind?: string;
  };
}

export function loadTransforms(): Transforms {
  return JSON.parse(readFileSync(join(RESULTS, "transforms.json"), "utf8"));
}

/** An image a locator looks at: the photo itself, or one oracle-flattened page of it. */
export interface View {
  photo: string;
  variant: "orig" | "flat";
  /** Absolute path of the image. */
  path: string;
  /** Short id used for file names. */
  id: string;
  size: [number, number];
  /** PDF points -> this image's pixels, per source page on it. */
  pages: Array<{ page: number; H: number[][] }>;
}

/**
 * Every view the bench scores. flat/dark/glare/crop have no geometry to undo,
 * so their flattened view is the original image (same file, same truth).
 */
export function views(t: Transforms): View[] {
  const out: View[] = [];
  for (const [photo, e] of Object.entries(t)) {
    const orig: View = {
      photo,
      variant: "orig",
      path: join(PHOTOS, photo),
      id: photo.replace(/\.jpg$/, ""),
      size: e.photo_size,
      pages: e.pages_geo.map((g) => ({ page: g.page, H: g.H })),
    };
    out.push(orig);
    if (!e.flat) {
      out.push({ ...orig, variant: "flat" });
      continue;
    }
    for (const f of e.flat) {
      out.push({
        photo,
        variant: "flat",
        path: join(RESULTS, "flat", f.file),
        id: f.file.replace(/\.jpg$/, ""),
        size: f.size,
        pages: [{ page: f.page, H: f.H }],
      });
    }
  }
  return out;
}
