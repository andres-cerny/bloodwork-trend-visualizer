/**
 * Tier-1 task files for arms C and M (docs/plans/photo-highlight.md, step 3).
 *
 * Each task is one image: a directory under $RESULTS/subagent/<arm>/<view id>/
 * holding `task.md` (the locate prompt from locate_prompts.ts, verbatim, plus
 * the reader's rows), and for arm M the numbered image and `marks.json` (mark
 * -> OCR row box). A subagent reads task.md, looks at the image it names and
 * writes `answer.json`. `subagent_collect.ts` turns answers into pred files.
 *
 *   BW_ROOT=<checkout with data> npx tsx tests/bench/highlight/subagent_dump.ts <photo id> ...
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { RESULTS, loadTransforms, readerRows, views, type View } from "./common";
import { LOCATE_BOX, LOCATE_MARK, rowList } from "./locate_prompts";
import { drawMarks } from "./marks";

const photos = process.argv.slice(2).map((p) => (p.endsWith(".jpg") ? p : `${p}.jpg`));
if (!photos.length) throw new Error("name the photos");

const all = views(loadTransforms());

/** The views an arm looks at for a photo: the original, plus the flattened pages when they differ. */
function taskViews(photo: string): View[] {
  const vs = all.filter((v) => v.photo === photo);
  const orig = vs.filter((v) => v.variant === "orig");
  const flat = vs.filter((v) => v.variant === "flat" && v.path !== orig[0].path);
  return [...orig, ...flat];
}

function task(arm: "C" | "M", image: string, prompt: string, rows: string, answer: string): string {
  return [
    `# Locate task (arm ${arm})`,
    ``,
    `Look at the image with the Read tool: ${image}`,
    ``,
    `Then follow the instructions between the lines exactly, and write only the JSON array it asks for to: ${answer}`,
    `(use the Write tool; no prose in that file).`,
    ``,
    `---`,
    prompt,
    ``,
    `Řádky:`,
    rows,
    `---`,
    ``,
  ].join("\n");
}

for (const photo of photos) {
  const rows = rowList(readerRows(photo));
  for (const v of taskViews(photo)) {
    const cdir = join(RESULTS, "subagent", "C", `${v.id}.${v.variant}`);
    mkdirSync(cdir, { recursive: true });
    writeFileSync(join(cdir, "task.md"), task("C", v.path, LOCATE_BOX, rows, join(cdir, "answer.json")));
    writeFileSync(join(cdir, "view.json"), JSON.stringify({ photo: v.photo, id: v.id, variant: v.variant, size: v.size }));

    const mdir = join(RESULTS, "subagent", "M", `${v.id}.${v.variant}`);
    mkdirSync(mdir, { recursive: true });
    const img = join(mdir, "marked.jpg");
    const marks = await drawMarks(v, img);
    writeFileSync(join(mdir, "marks.json"), JSON.stringify(marks));
    writeFileSync(join(mdir, "task.md"), task("M", img, LOCATE_MARK, rows, join(mdir, "answer.json")));
    writeFileSync(join(mdir, "view.json"), JSON.stringify({ photo: v.photo, id: v.id, variant: v.variant, size: v.size }));
    console.log(`${v.id}.${v.variant}: C + M (${Object.keys(marks).length} marks)`);
  }
}
