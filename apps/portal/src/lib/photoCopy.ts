/**
 * What a photo's checks say on screen (docs/plans/photo-capture.md, "warn,
 * rarely refuse"). lab-core returns codes; the Czech lives here, one sentence
 * per code, so a test can hold every code to having one.
 *
 * Each sentence says what is wrong with the picture, never what the person did
 * wrong, and none promises what a retake will fix: glare and blur can be
 * retaken away, a sheet that is not a lab sheet cannot.
 */
import { count } from "@bw/lab-core";
import type { PhotoReason } from "@bw/lab-core/photo";

export const REASON_COPY: Record<PhotoReason, string> = {
  too_small: "Fotka má příliš málo bodů, aby se na ní dalo cokoli přečíst.",
  blank: "Na fotce není vidět žádný text — je prázdná, zakrytá nebo úplně tmavá.",
  small: "Fotka je malá — drobné písmo se z ní nemusí dát přečíst.",
  blurred: "Fotka je rozmazaná.",
  dark: "Fotka je tmavá.",
  glare: "Odlesk zakrývá část textu.",
  corner_cut: "Kus papíru je mimo záběr.",
  not_lab: "Nevypadá to jako laboratorní výsledky.",
};

export const CHECK_HEADING = {
  warn: "Fotku možná nepůjde dobře přečíst",
  refuse: "Tuto fotku nepůjde přečíst",
} as const;

/** Under the reasons, on a warning: what each button does, in one line. */
export const WARN_NOTE = "Novou fotku můžete pořídit hned; když nahrajete tuto, přečte se z ní, co půjde.";

/** The scan tip from the plan (Phase F): free, and it beats any photo. */
export const SCAN_TIP =
  "Tip: skenování v telefonu dá rovný obraz bez odlesků — v iPhonu Poznámky nebo Soubory → Naskenovat dokument, v Androidu Disk Google → Skenovat. Vznikne PDF, které sem nahrajete.";

/**
 * The review screen's caption for a photograph. Zero hits is "nic jsme
 * nenašli — zkontrolujte ručně", never "nic tam není": OCR on a photo misses
 * things, and a caption that sounds clean is the defect the old "no detection
 * on photos" rule existed to prevent.
 */
export function photoCaption(hits: number, ocr: "done" | "failed" | "skipped" | undefined): string {
  // A search that never ran is not "nothing found": say which it was.
  if (ocr === "failed") return "fotku se nepodařilo přečíst — začerněte ručně";
  if (ocr !== "done") return "začerněte ručně";
  if (hits === 0) return "nic jsme nenašli — zkontrolujte ručně";
  return `navrhli jsme ${count(hits, "pole", "pole", "polí")} k začernění — zkontrolujte a doplňte ručně`;
}
