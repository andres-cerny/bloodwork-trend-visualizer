/**
 * Who this patient is, and what the whole series says — as facts, then as two
 * or three sentences of Czech.
 *
 * The opening screen used to carry one thin line of patient context, so a
 * doctor arriving at it knew neither who they were looking at nor what had
 * changed. This module answers both, deterministically: every sentence is
 * assembled from templates here, from numbers computed by `seriesShape`. No
 * model, no network, nothing interpretive — it describes movement and range
 * membership and never says what either *means*.
 *
 * ## Two rules it is built around
 *
 * **A withheld reading is never narrated.** Everything below reads the series
 * through `numericPoints` / `seriesShape`, which already drop a reading the app
 * believes is a misread. Narrating glucose "44,5" in the first paragraph a
 * patient sees would be the same defect as plotting it, one screen earlier.
 * `patientSummary.test.ts` asserts it rather than trusting the call chain.
 *
 * **Analyte names appear only in the nominative, never governed by anything.**
 * This is the same constraint `summary.ts` documents around `rangeTransition`,
 * one step further. Czech verbs agree with their subject's gender ("cholesterol
 * vzrostl" / "urea vzrostla" / "CRP vzrostlo") and Czech prepositions govern a
 * case ("u cholesterolu celkového", not "u Cholesterol celkový") — and the
 * subject here is a display name out of a 109-entry registry that carries
 * neither gender nor a declension paradigm. So:
 *
 *   - the sentences are **verbless**, exactly as the change summary is;
 *   - registry names occur **only as items of a colon-introduced list or in
 *     parentheses**, where the nominative is the correct form for any gender;
 *   - every other word in a sentence is one this module owns, so its agreement
 *     is fixed at authoring time and cannot be invalidated by the data.
 *
 * The alternative — carrying grammatical gender for all 109 analytes — buys
 * verbs at the cost of a second, silently-wrong-by-default field on every
 * registry entry, and would still not solve the case problem. Nominal style is
 * also how a Czech lab report actually reads.
 */
import { count, czDate, prettyUnit } from "./czech";
import type { LabReport } from "./models";
import { ageOn, parseRodneCislo } from "./rodneCislo";
import { czNum } from "./summary";
import {
  daysBetween,
  numericPoints,
  seriesShape,
  type SeriesShape,
  type Trend,
} from "./trends";

/** Everything the card renders, computed once. */
export interface PatientOverview {
  name: string | null;
  patientId: string | null;
  /** ISO, decoded from the rodné číslo. Null when it will not parse. */
  birthDate: string | null;
  /** Whole years at the most recent draw. Null without a usable birth date. */
  age: number | null;
  /**
   * Whether the rodné číslo agrees with its own check digit. `null` for the
   * nine-digit form, which has none — see `rodneCislo.ts`. `false` is worth
   * showing: it means the number was probably mistranscribed, and the birth
   * date beside it is therefore suspect.
   */
  idChecksumOk: boolean | null;
  firstDraw: string | null;
  lastDraw: string | null;
  /** Distinct dates a sample was taken on. */
  draws: number;
  followUpDays: number;
  /** "4 roky a 2 měsíce". Null with fewer than two dated draws. */
  followUp: string | null;
  /** Analyte display names outside their printed range at the latest draw. */
  outNow: string[];
  /**
   * Analytes whose reading at the latest draw the app withheld.
   *
   * Kept separate from `outNow` because they are neither in range nor out of
   * it — they are unresolved, and the card must say so rather than let the
   * filtering read as a clean result.
   */
  withheldNow: string[];
  /** Czech prose, at most three sentences. Never empty when a report is loaded. */
  sentences: string[];
}

/** "A", "A a B", "A, B a C" — the Czech list, whose final joiner is "a". */
function joinCz(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} a ${items[items.length - 1]}`;
}

/**
 * How long the follow-up ran, in the units a person would say it in.
 *
 * Calendar arithmetic rather than days ÷ 365: "4 roky a 2 měsíce" has to match
 * the two dates printed beside it, and a divisor that drifts by a leap day
 * produces a card that contradicts itself.
 */
export function czSpan(fromIso: string, toIso: string): string | null {
  const f = fromIso.split("-").map(Number);
  const t = toIso.split("-").map(Number);
  if (f.length !== 3 || t.length !== 3 || f.some(isNaN) || t.some(isNaN)) return null;
  let years = t[0] - f[0];
  let months = t[1] - f[1];
  if (t[2] < f[2]) months -= 1;
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  if (years < 0) return null;
  const days = daysBetween(fromIso, toIso);
  if (years === 0 && months === 0) return count(days, "den", "dny", "dnů");
  if (years === 0) return count(months, "měsíc", "měsíce", "měsíců");
  // "5 let", not "5 roků": the suppletive plural is the standard written form.
  const y = count(years, "rok", "roky", "let");
  if (months === 0) return y;
  return `${y} a ${count(months, "měsíc", "měsíce", "měsíců")}`;
}

/** Whole percent with an explicit sign, matching the change summary's format. */
function pct(rel: number): string {
  return `${rel > 0 ? "+" : "−"}${Math.round(Math.abs(rel) * 100)} %`;
}

/** One analyte and the shape of its whole series. */
interface Shaped {
  name: string;
  unit: string;
  shape: SeriesShape;
}

const OUT_FLAGS = new Set(["high", "low"]);
const isOut = (flag: string) => OUT_FLAGS.has(flag);

/** How big the whole-series move is, for ranking. Relative where possible. */
function magnitude(s: SeriesShape): number {
  return s.relChange !== null ? Math.abs(s.relChange) : Math.abs(s.change);
}

/**
 * "ALT +67 % (0,61 → 1,02 µkat/l)".
 *
 * The name leads and is in the nominative; everything after it is this
 * module's own words and punctuation, so no agreement question arises.
 */
function item(sh: Shaped): string {
  const u = sh.unit ? ` ${sh.unit}` : "";
  // A move that rounds to zero percent is not a move. "−0 %" printed beside
  // two different numbers reads as a bug, and it is the whole-percent
  // rounding, not the data, that produced it.
  const rounds = sh.shape.relChange !== null && Math.round(Math.abs(sh.shape.relChange) * 100) > 0;
  const rel = rounds ? `${pct(sh.shape.relChange as number)} ` : "";
  return `${sh.name} ${rel}(${czNum(sh.shape.first.value)} → ${czNum(sh.shape.last.value)}${u})`;
}

/** Moving further from the range it has already left. */
function worsening(sh: Shaped): boolean {
  const f = sh.shape.last.flag;
  if (!isOut(f)) return false;
  return (
    (f === "high" && sh.shape.direction === "rising") ||
    (f === "low" && sh.shape.direction === "falling")
  );
}

/** Still outside the range, but moving back towards it. */
function recovering(sh: Shaped): boolean {
  const f = sh.shape.last.flag;
  if (!isOut(f)) return false;
  return (
    (f === "high" && sh.shape.direction === "falling") ||
    (f === "low" && sh.shape.direction === "rising")
  );
}

/**
 * The prose. At most three sentences, in the order a reader wants them: what
 * is out of range now, what has been moving away from it across the whole
 * series, and what has come back.
 */
function sentencesFor(
  shapes: Shaped[],
  outNow: Shaped[],
  withheldNow: string[],
  lastDraw: string | null,
  draws: number,
): string[] {
  const out: string[] = [];
  if (!lastDraw) return ["Zatím žádné datované měření."];
  const on = czDate(lastDraw);

  // 1 — the state at the most recent draw. Computed from that draw's own
  // flags, not from a series, so it is still true of a first-ever report.
  // A run out of range is a different fact from "high today", and worth one
  // mention: the *longest* run, marked on the analyte it belongs to. Annotating
  // every one of them turns a four-item list into four parentheticals, and a
  // trailing "(Triacylglyceroly — 7 odběrů po sobě)" instead names the same
  // analyte twice in one sentence. Neither reads.
  const longest = outNow
    .filter((sh) => sh.shape.outStreak >= 3)
    .sort((a, b) => b.shape.outStreak - a.shape.outStreak)[0];
  const withStreak = (sh: Shaped) =>
    sh === longest
      ? `${sh.name} (${count(sh.shape.outStreak, "odběr", "odběry", "odběrů")} po sobě)`
      : sh.name;

  // Anything the app withheld at this draw is named here. It is the reason
  // sentence 1 can never be a bare all-clear: a withheld abnormal reading is
  // an open question, not a normal result.
  const toCheck = withheldNow.length
    ? ` ${count(withheldNow.length, "hodnota", "hodnoty", "hodnot")} k ověření: ${joinCz(withheldNow)}.`
    : "";

  if (outNow.length > 0) {
    const shown = outNow.slice(0, 4).map(withStreak);
    const extra = outNow.length - shown.length;
    const list = extra > 0 ? `${shown.join(", ")} a další ${extra}` : joinCz(shown);
    out.push(`Mimo referenční rozmezí k poslednímu odběru ${on}: ${list}.${toCheck}`);
  } else if (withheldNow.length > 0) {
    // Deliberately not "žádná hodnota mimo rozmezí". Everything measured that
    // the app trusts is in range; what it does not trust is unresolved, and
    // saying otherwise would be the app hiding its own doubt.
    out.push(
      `K poslednímu odběru ${on} žádná ověřená hodnota mimo referenční rozmezí.${toCheck}`,
    );
  } else if (shapes.length > 0 || draws > 0) {
    out.push(`K poslednímu odběru ${on} žádná hodnota mimo referenční rozmezí.`);
  }

  // Nothing has two comparable readings: say so instead of describing a change
  // that was never measured. An empty card would be better than a false one,
  // and this is better than either.
  if (shapes.length === 0) {
    out.push(
      draws <= 1
        ? "Zatím jediný odběr: popis vývoje až od druhého."
        : "Zatím žádný analyt se dvěma porovnatelnými měřeními.",
    );
    return out;
  }

  const ranked = [...shapes].sort((a, b) => magnitude(b.shape) - magnitude(a.shape));

  // 2 — the whole-series move. This is the sentence the card exists for: the
  // change summary compares the last two draws and reports ALT at "+5 %",
  // where the same series across four years is +67 %.
  // A rise and a fall share no noun in Czech, so they get a sentence each —
  // rather than one sentence and the other direction silently dropped. That
  // dropped a haemoglobin falling 120 → 70 whenever anything was rising
  // faster, which is the single worst thing this paragraph could omit.
  //
  // Only over a real span: two reports dated the same day give spanDays 0, and
  // "napříč celou sérií" is not true of one day.
  const worse = ranked.filter((sh) => worsening(sh) && sh.shape.spanDays > 0);
  if (worse.length > 0) {
    for (const dir of ["rising", "falling"] as const) {
      const same = worse.filter((sh) => sh.shape.direction === dir).slice(0, 2);
      if (same.length === 0) continue;
      const lead = dir === "rising" ? "Nárůst" : "Pokles";
      out.push(
        `${lead} napříč celou sérií, ne jen mezi posledními dvěma odběry: ` +
          `${same.map(item).join(", ")}.`,
      );
    }
  } else {
    // Nothing is out of range, so the notable fact is a steady drift inside
    // it. Monotone only, and 15 % at least: inside a wide interval a bouncing
    // percent change is assay noise, not a finding.
    const drift = ranked.find(
      (s) => !isOut(s.shape.last.flag) && s.shape.monotone && magnitude(s.shape) >= 0.15,
    );
    if (drift) {
      out.push(`Nejvýraznější dlouhodobý posun v rámci rozmezí: ${item(drift)}.`);
    }
  }

  // 3 — what improved. "Back inside the range it started outside of" is a
  // description, not a judgement, which is the only kind of improvement this
  // module is entitled to report.
  const returned = ranked.filter((s) => isOut(s.shape.first.flag) && !isOut(s.shape.last.flag));
  if (returned.length > 0) {
    out.push(`Zpět v referenčním rozmezí oproti prvnímu odběru: ${returned.slice(0, 2).map(item).join(", ")}.`);
  } else {
    const back = ranked.find((s) => recovering(s) && magnitude(s.shape) >= 0.05);
    if (back) out.push(`Pohyb zpět k rozmezí, zatím mimo ně: ${item(back)}.`);
  }

  return out;
}

/**
 * Everything the patient card shows, from the loaded reports and the trends
 * already built from them.
 *
 * Degrades by omission rather than by placeholder: an uploaded report carries
 * no name and no rodné číslo, and the fields derived from them are then null
 * — the card leaves them out instead of printing a dash that looks like a
 * value the app checked for and failed to find.
 */
export function patientOverview(
  reports: LabReport[],
  trends: Map<string, Trend>,
): PatientOverview {
  const dates = [...new Set(reports.map((r) => r.reportDate).filter((d): d is string => !!d))].sort();
  const firstDraw = dates[0] ?? null;
  const lastDraw = dates[dates.length - 1] ?? null;

  const patientId = reports.find((r) => r.patientId)?.patientId ?? null;
  const rc = parseRodneCislo(patientId);
  const birthDate = rc?.birthDate ?? null;
  // Age *at the most recent draw*, not today: the card is a description of
  // this set of reports, and the draw range is printed beside it.
  const age = birthDate && lastDraw ? ageOn(birthDate, lastDraw) : null;

  const shapes: Shaped[] = [];
  const outNow: Shaped[] = [];
  const withheldNow: string[] = [];
  for (const t of trends.values()) {
    const unit = prettyUnit(t.unit);
    const shape = seriesShape(t);
    if (shape) shapes.push({ name: t.displayName, unit, shape });
    // A reading the app withheld at the most recent draw must be named. The
    // filtering that keeps a misread decimal out of every number is right, but
    // on its own it turned a withheld abnormal result into the sentence "no
    // value outside the reference range" — an all-clear the app had no
    // evidence for. constraints.md: every doubt reaches the screen.
    if (lastDraw && t.points.some((q) => q.date === lastDraw && q.suspect !== null)) {
      withheldNow.push(t.displayName);
    }
    // Out-of-range *now* means measured at the most recent draw, not "the last
    // time we saw it". A vitamin D measured once in 2022 and never since was
    // being reported as out of range "k poslednímu odběru 14. 4. 2026", which
    // is simply a false sentence. The demo hides this because all ten reports
    // carry all twenty-two analytes; a real upload does not.
    const pts = numericPoints(t);
    const last = pts[pts.length - 1];
    if (last && last.date === lastDraw && isOut(last.flag)) {
      outNow.push({
        name: t.displayName,
        unit,
        // A single-draw analyte has no shape; a zeroed stand-in keeps the
        // ranking and streak logic total without inventing a movement.
        shape: shape ?? {
          first: last,
          last,
          count: 1,
          spanDays: 0,
          change: 0,
          relChange: null,
          direction: "flat",
          outOfRangeCount: 1,
          newlyOut: false,
          outStreak: 1,
          monotone: true,
        },
      });
    }
  }
  outNow.sort((a, b) => magnitude(b.shape) - magnitude(a.shape) || a.name.localeCompare(b.name, "cs"));

  const followUpDays = firstDraw && lastDraw ? daysBetween(firstDraw, lastDraw) : 0;

  return {
    name: reports.find((r) => r.patientName)?.patientName ?? null,
    patientId,
    birthDate,
    age,
    idChecksumOk: rc?.checksumOk ?? null,
    firstDraw,
    lastDraw,
    draws: dates.length,
    followUpDays,
    followUp: firstDraw && lastDraw && firstDraw !== lastDraw ? czSpan(firstDraw, lastDraw) : null,
    outNow: outNow.map((s) => s.name),
    withheldNow,
    sentences: sentencesFor(shapes, outNow, withheldNow, lastDraw, dates.length),
  };
}
