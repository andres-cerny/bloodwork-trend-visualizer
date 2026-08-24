/**
 * Where the card's data comes from — live worker or committed fixture.
 *
 * One interface, two implementations, one rendering path: the UI tournament's
 * camera shoots fixture-fed screens (identical pixels, $0, no worker), and
 * the deployed app swaps in the live implementation without a component
 * noticing. The same trick the chat app's replayer proved: a fixture that
 * renders is proof the UI handles the real response grammar, because there is
 * no second grammar.
 *
 * The tenant is fixed here, not passed around: this app IS the CSM portal.
 * Fixtures hold ghost patients only — the real record must never enter one.
 */
import {
  getCardDocument,
  getCardPatients,
  getCardTrend,
  getCardVisit,
  getCardVisits,
  type CardDocument,
  type CardLabRow,
  type CardPatient,
  type CardPerfPoint,
  type CardPerfRow,
  type CardTrendPoint,
  type CardVisit,
  type CardVisitBase,
} from "@bw/api-client";

export const TENANT = "csm";

export interface TrendResponse {
  kind: "lab" | "perf";
  displayName: string;
  unit: string;
  points: Array<CardTrendPoint | CardPerfPoint>;
}

export interface VisitDetail {
  visit: CardVisitBase;
  labs: CardLabRow[];
  perf: CardPerfRow[];
  note: CardDocument | null;
}

export interface CardData {
  patients(): Promise<CardPatient[]>;
  visits(patient: string): Promise<CardVisit[]>;
  visit(patient: string, visit: string): Promise<VisitDetail>;
  trend(patient: string, kind: "lab" | "perf", metric: string): Promise<TrendResponse>;
  document(patient: string, doc: string): Promise<CardDocument>;
}

export const liveData: CardData = {
  patients: () => getCardPatients(TENANT).then((r) => r.patients),
  visits: (patient) => getCardVisits(TENANT, patient).then((r) => r.visits),
  visit: (patient, visit) => getCardVisit(TENANT, patient, visit),
  trend: (patient, kind, metric) => getCardTrend(TENANT, patient, kind, metric),
  document: (patient, doc) => getCardDocument(TENANT, patient, doc).then((r) => r.document),
};

/** The committed shape a captured fixture holds — see tools/ui-loop. */
export interface PortalFixture {
  patients: CardPatient[];
  byPatient: Record<
    string,
    {
      visits: CardVisit[];
      details: Record<string, VisitDetail>;
      trends: Record<string, TrendResponse>; // key: `${kind}:${metric}`
      documents: Record<string, CardDocument>;
    }
  >;
}

export function fixtureData(fx: PortalFixture): CardData {
  const of = (patient: string) => {
    const p = fx.byPatient[patient];
    if (!p) throw new Error(`fixture holds no patient ${patient}`);
    return p;
  };
  const pick = <T>(v: T | undefined, what: string): Promise<T> =>
    v === undefined ? Promise.reject(new Error(`fixture holds no ${what}`)) : Promise.resolve(v);
  return {
    patients: () => Promise.resolve(fx.patients),
    visits: (patient) => Promise.resolve(of(patient).visits),
    visit: (patient, visit) => pick(of(patient).details[visit], `visit ${visit}`),
    trend: (patient, kind, metric) => pick(of(patient).trends[`${kind}:${metric}`], `trend ${metric}`),
    document: (patient, doc) => pick(of(patient).documents[doc], `document ${doc}`),
  };
}
