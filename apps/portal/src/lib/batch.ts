/**
 * The batch — files picked together — and the one screen that waits for it.
 *
 * On a first login someone picks every sheet they have at once. The queue
 * reads them in the background and each report reaches the account as its
 * read ends, which is right for the account and wrong for the eye: Souhrn
 * used to open on the first report and rearrange itself as the others
 * landed, five times in a row, on a screen the person had never seen
 * before. So while the account has no reports yet, the switch away from the
 * upload screen waits for the whole batch; a later upload, into an account
 * that has reports, keeps the pages updating as each document lands, because
 * then the person knows the screen and is free to move around it.
 *
 * A batch is the files taken in one pick or one drop, plus any added while
 * it still runs — the person who drops two PDFs and then remembers a third
 * meant them as one upload. It ends when every file has settled: stored,
 * failed with its message, or skipped at the review. A failure does not hold
 * the others; it counts as settled like any other end.
 *
 * Counted here, by the queue that owns the files (ui/UploadFlow.tsx); the
 * hold is decided here too and applied by the screen that switches
 * (ui/Portal.tsx). No timer anywhere: the batch ends when the last file
 * ends, whenever that is.
 */

/** Files picked together — one pick, one drop, or added while the batch still runs. */
export interface Batch {
  /** Files taken in since the batch opened. 0: no batch running. */
  total: number;
  /** Of those, ended — stored, failed or skipped. */
  settled: number;
}

export const NO_BATCH: Batch = { total: 0, settled: 0 };

export const isRunning = (b: Batch): boolean => b.total > 0 && b.settled < b.total;

/** Files picked: open a batch, or grow the running one. Nothing picked, nothing changes. */
export function pick(b: Batch, n: number): Batch {
  if (n <= 0) return b;
  return isRunning(b) ? { total: b.total + n, settled: b.settled } : { total: n, settled: 0 };
}

/** One file ended, however it ended. The last one closes the batch. */
export function settle(b: Batch): Batch {
  if (!isRunning(b)) return NO_BATCH;
  const settled = b.settled + 1;
  return settled >= b.total ? NO_BATCH : { total: b.total, settled };
}

/**
 * Whether the switch to Souhrn waits for the batch.
 *
 * True from the moment a batch opens on an account with no reports until
 * that batch ends; once holding, a report landing mid-batch does not lift
 * it, and a file added mid-batch extends it. A batch opened on an account
 * that has reports never holds — that is today's behaviour, kept.
 */
export function holdsSummary(held: boolean, b: Batch, reportsNow: number): boolean {
  if (!isRunning(b)) return false;
  return held || reportsNow === 0;
}

/** The line under the queue while the hold is on — says what it waits for, and how many. */
export function waitingLine(b: Batch): string {
  return b.total === 1 ? "Souhrn se otevře, až bude soubor přečten." : `Souhrn se otevře až po přečtení všech ${b.total} souborů.`;
}
