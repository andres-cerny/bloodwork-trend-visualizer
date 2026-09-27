/**
 * What is asked of a file before a document is spent on it, and of a read
 * report before it is stored.
 *
 * Every check here is local and free: the file's bytes, its text layer, the
 * reports the account already holds. They exist because a read costs the
 * operator money and the person a document, and each of these was a way to
 * spend both on nothing — a 30-page export, three reports in one PDF, a PDF
 * that is not a lab sheet, the same file picked twice.
 *
 * None of them decides for the person except where nothing sensible could
 * follow (a file too large to open, too many pages): the rest warn, and
 * „Nahrát i tak" goes on.
 */
import type { LabReport } from "@bw/lab-core";

/** Bytes a file may have before it is refused unread. A phone decodes a
 *  photo whole before scaling it, and a 50 MB file is where a tab dies. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** More pages than this and the person is asked whether it is one report. */
export const LONG_REPORT_PAGES = 6;

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** Why a file cannot even be opened, or null. */
export function sizeRefusal(file: { size: number }, isPhoto: boolean): string | null {
  if (file.size === 0) return "Soubor je prázdný (0 bajtů) — zkuste ho stáhnout nebo vyfotit znovu.";
  const max = isPhoto ? MAX_PHOTO_BYTES : MAX_PDF_BYTES;
  if (file.size > max)
    return `Soubor je příliš velký (${mb(file.size)}). Nejvýše ${mb(max)} ${isPhoto ? "na fotku — pošlete ji zmenšenou, nebo ji vyfoťte znovu" : "na PDF — laboratorní PDF bývají menší než 1 MB; zkuste ho uložit znovu"}.`;
  return null;
}

/** A file type the upload does not take, said once per file. */
export const UNSUPPORTED_COPY = "Tento typ souboru neumíme přečíst — nahrajte PDF z laboratoře nebo fotku papíru (JPEG, PNG).";

export const tooManyPagesCopy = (pages: number, max: number) =>
  `Soubor má ${pages} stran — to je víc, než umíme zpracovat jako jeden report (nejvýše ${max}). Pokud obsahuje více reportů, rozdělte ho a nahrajte každý zvlášť.`;

/** Reasons a file is worth a second look before it is sent. */
export type FileWarning = "long" | "multi_date" | "not_lab" | "unverified";

export const WARNING_COPY: Record<FileWarning, string> = {
  long: "Report je dlouhý. Nahrávejte ho, jen pokud jde opravdu o jeden report — za jeden dokument z nároku.",
  multi_date: "Strany nesou různá data odběru — vypadá to na více reportů v jednom souboru. Každý report je samostatný dokument; nahrajte je raději zvlášť.",
  not_lab: "Nevypadá to jako laboratorní výsledky. Pokud je přesto nahrajete a nic se v nich nenajde, dokument se vrátí — třetí takové nahrání za 30 dní se ale počítá.",
  unverified: "Fotku se nepodařilo přečíst v prohlížeči, takže jsme neověřili, že jde o laboratorní výsledky, ani nenavrhli, co začernit.",
};

/**
 * Dates printed right after a label that names the draw — „Datum odběru",
 * „Odběr", „Přijetí vzorku". Any date on the page would include the birth
 * date and the print date, and one report would look like three; the draw's
 * own label is what a lab prints once per report.
 */
const DRAW_LABEL = /(odb[ěe]r[ua]?|odebr[áa]no|p[řr][íi]jet[íi]|p[řr][íi]jem|datum\s+vy[šs]et[řr]en[íi])/i;
const DATE = /(\d{1,2})\s*\.\s*(\d{1,2})\s*\.\s*(\d{4}|\d{2})\b/;

export function drawDateOf(lines: string[]): string | null {
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ");
    const label = DRAW_LABEL.exec(line);
    if (!label) continue;
    const m = DATE.exec(line.slice(label.index));
    if (!m) continue;
    const [, d, mo, y] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const day = Number(d);
    const month = Number(mo);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/** Distinct draw dates across pages, in page order; pages without one are skipped. */
export function drawDates(pages: string[][]): string[] {
  const out: string[] = [];
  for (const lines of pages) {
    const d = drawDateOf(lines);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * The same file, recognised — without a key back to it. The fingerprint is
 * stored on the report, and a plain SHA-256 of the original, named PDF would
 * let anyone holding that PDF (the lab, a forwarded e-mail) confirm which
 * de-identified report is whose. So it is salted with a random value of the
 * account's own (settings.fpSalt) and cut to 64 bits: plenty to tell one
 * account's few hundred files apart, and nothing a copy of the file can be
 * matched against without the account's settings too.
 */
export async function fingerprintOf(bytes: ArrayBuffer, salt: string): Promise<string> {
  const s = new TextEncoder().encode(salt);
  const all = new Uint8Array(s.length + bytes.byteLength);
  all.set(s, 0);
  all.set(new Uint8Array(bytes), s.length);
  const h = await crypto.subtle.digest("SHA-256", all);
  return [...new Uint8Array(h)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A fresh account salt for `fingerprintOf`. */
export const newFingerprintSalt = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

/* ------------------------------------------------------ after the read */

/** The same parameter in two reports: its canonical id, else its printed name. */
const keyOf = (m: LabReport["measurements"][number]) => m.canonicalId ?? `raw:${m.rawAnalyteName.trim().toLowerCase()}`;
const sameValue = (a: string, b: string) => a.replace(/\s+/g, "").replace(",", ".") === b.replace(/\s+/g, "").replace(",", ".");

export type SameDay =
  /** No report of that day, or one with other parameters (biochemie + krevní obraz). */
  | { kind: "none" }
  /** The same report again: same day, same parameters, same values. */
  | { kind: "duplicate"; other: LabReport }
  /** Same day, same parameters, different values: a repeat draw, or a misread. */
  | { kind: "repeat"; other: LabReport };

/**
 * A read report against the ones the account holds.
 *
 * Czech labs routinely send one draw as several PDFs — biochemie, krevní
 * obraz, moč — each with the same date, so a shared date alone means
 * nothing. What makes it the same report is the same parameters with the
 * same values; the same parameters with other values is a second draw that
 * day, which is real and is the person's to confirm.
 */
export function sameDayCheck(report: LabReport, existing: LabReport[]): SameDay {
  if (!report.reportDate) return { kind: "none" };
  const mine = new Map<string, string>();
  for (const m of report.measurements) if (!mine.has(keyOf(m))) mine.set(keyOf(m), m.valueRaw);
  if (mine.size === 0) return { kind: "none" };
  let repeat: LabReport | null = null;
  for (const other of existing) {
    if (other.id === report.id || other.reportDate !== report.reportDate) continue;
    const theirs = new Map<string, string>();
    for (const m of other.measurements) if (!theirs.has(keyOf(m))) theirs.set(keyOf(m), m.valueRaw);
    const shared = [...mine.keys()].filter((k) => theirs.has(k));
    // Mostly different parameters: another panel of the same draw.
    if (shared.length < Math.max(1, Math.min(mine.size, theirs.size) / 2)) continue;
    const equal = shared.filter((k) => sameValue(mine.get(k)!, theirs.get(k)!)).length;
    if (equal >= shared.length * 0.9) return { kind: "duplicate", other };
    repeat = repeat ?? other;
  }
  return repeat ? { kind: "repeat", other: repeat } : { kind: "none" };
}

/**
 * Why a report's date needs the person, or null. The stored `dateDoubt`
 * (readers disagreed, pages differed) first; then what the date itself
 * shows: missing, in the future, or before any lab here printed a PDF.
 */
export function dateDoubtOf(report: Pick<LabReport, "reportDate" | "dateDoubt">, today = new Date()): string | null {
  if (!report.reportDate) return "Datum odběru se v reportu nenašlo — bez něj se hodnoty neukážou v trendech.";
  if (report.dateDoubt) return report.dateDoubt;
  const d = new Date(`${report.reportDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Datum odběru se nepodařilo přečíst.";
  if (d.getTime() > today.getTime() + 86_400_000) return "Datum odběru je v budoucnosti — nejspíš je špatně přečtené.";
  if (d.getUTCFullYear() < 1990) return "Datum odběru je nezvykle staré — zkontrolujte ho prosím.";
  return null;
}

/**
 * The reports as the trend screens see them. A report dated in the future is
 * left out, like one with no date: it would become "the latest draw" that
 * every summary sentence speaks about. A report whose date is otherwise in
 * doubt stays in, each reading marked (`reportDateDoubt`) so review.ts plots
 * it unconfirmed and says why. Ověření and Reporty keep the reports as they
 * are — that is where the date is set.
 */
export function forTrends(reports: LabReport[], today = new Date()): LabReport[] {
  return reports.flatMap((r) => {
    if (!r.reportDate) return [r];
    const doubt = dateDoubtOf(r, today);
    if (!doubt) return [r];
    const d = new Date(`${r.reportDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.getTime() > today.getTime() + 86_400_000) return [];
    return [{ ...r, measurements: r.measurements.map((m) => ({ ...m, reportDateDoubt: doubt })) }];
  });
}
