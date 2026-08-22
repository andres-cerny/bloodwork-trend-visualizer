/**
 * The first thing on the opening screen: who this is, how long they have been
 * followed, and what the whole series says.
 *
 * The app used to open on an empty Trends tab with one thin line of patient
 * context in the top bar — a doctor arriving at it knew neither whose results
 * these were nor what had changed, and had to pick an analyte before the app
 * told them anything at all. This card answers both before the tab strip.
 *
 * Every word of the prose comes from `patientSummary.ts`: deterministic
 * templates over `seriesShape`, no model and no network. Read the header there
 * for why the sentences carry no verb.
 *
 * Nothing here is a placeholder. A birth date that could not be decoded, a
 * follow-up that does not exist because there is only one draw — those fields
 * are simply absent, because a dash sitting where a date belongs reads as a
 * fact the app checked, and it did not.
 */
import { Fragment, useMemo, type ReactNode } from "react";
import { count, czDate } from "../lib/czech";
import type { LabReport } from "../lib/models";
import { patientOverview } from "../lib/patientSummary";
import type { Trend } from "../lib/trends";

interface Props {
  reports: LabReport[];
  trends: Map<string, Trend>;
}

/** A "·" between meta items. One character, decorative, never announced. */
function Sep() {
  return (
    <span className="sep" aria-hidden="true">
      ·
    </span>
  );
}

export default function PatientCard({ reports, trends }: Props) {
  const o = useMemo(() => patientOverview(reports, trends), [reports, trends]);

  // Identity line: rodné číslo, then the birth date and age decoded from it.
  // Built as a list so the separators fall between whatever survives, rather
  // than being hard-coded around fields that may not be there.
  const meta: ReactNode[] = [];
  if (o.patientId) meta.push(<span className="pc-rc" key="rc">{o.patientId}</span>);
  if (o.birthDate) meta.push(<span key="born">nar. {czDate(o.birthDate)}</span>);
  // Age *at the most recent draw*, and it has to say so. Reference ranges are
  // age-dependent and the values were measured then, so the draw is the right
  // reference point — but on a report set that ends years ago the bare number
  // reads as the patient's age today, and is simply wrong.
  if (o.age !== null)
    meta.push(
      <span key="age">
        {count(o.age, "rok", "roky", "let")}{" "}
        <span className="pc-qual">v době odběru</span>
      </span>,
    );

  const period =
    o.firstDraw && o.lastDraw
      ? o.firstDraw === o.lastDraw
        ? czDate(o.lastDraw)
        : `${czDate(o.firstDraw)} – ${czDate(o.lastDraw)}`
      : null;

  const stats: Array<[string, string]> = [];
  if (o.draws > 0) stats.push(["Odběry", count(o.draws, "odběr", "odběry", "odběrů")]);
  if (o.followUp) stats.push(["Sledování", o.followUp]);
  // Deliberately not the date range: the sticky top bar carries it already,
  // 56px above, and repeating it here made three of the card's four identity
  // facts things the reader had just read. The span above says the same thing
  // in the form the card is for.
  void period;

  return (
    <section className="card patient-card" aria-labelledby="pc-name">
      <div className="pc-top">
        <div className="pc-who">
          <h2 id="pc-name">{o.name ?? "Neznámý pacient"}</h2>
          {meta.length > 0 && (
            <p className="pc-meta">
              {meta.map((m, i) => (
                <Fragment key={i}>
                  {i > 0 && <Sep />}
                  {m}
                </Fragment>
              ))}
              {/* A ten-digit rodné číslo that fails its own check digit was
                  almost certainly mistranscribed — which makes the birth date
                  printed beside it suspect. Saying so is the point; it is the
                  same rule as every other doubt in this app. */}
              {o.idChecksumOk === false && (
                <>
                  <Sep />
                  <span className="chip alert">kontrolní číslice nesouhlasí</span>
                </>
              )}
            </p>
          )}
        </div>
        {o.outNow.length > 0 && (
          <span className="chip alert pc-flag">
            {count(
              o.outNow.length,
              "hodnota mimo rozmezí",
              "hodnoty mimo rozmezí",
              "hodnot mimo rozmezí",
            )}
          </span>
        )}
      </div>

      {stats.length > 0 && (
        <dl className="pc-stats">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="pc-prose">{o.sentences.join(" ")}</p>
    </section>
  );
}
