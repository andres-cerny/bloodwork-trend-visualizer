/**
 * The patient card's data: visits and performance results.
 *
 * Scoped to one patient at construction, like DatabaseSource, and for the
 * same reason — a card request that could name any patient in the query is a
 * card request that can name the wrong one. The patientRef came from the
 * directory or from the reader's pick, never from model text; this class
 * only ever filters by it.
 *
 * Everything here is a read over seed-time derivations. Visits were grouped
 * by the seeder, perf values were transcribed from the clinic's own printed
 * protocols — nothing is computed at read time beyond ordering, so the card
 * and the agent's tools cannot disagree about what a visit contains.
 */
import { SQL, type D1Like } from "./d1";

export type VisitKind = "annual" | "blood" | "perf_test" | "thb";

export interface VisitRow {
  id: string;
  visitDate: string;
  kind: VisitKind;
  title: string;
  noteDocumentId: string | null;
}

export interface PerfPoint {
  visitId: string;
  metricId: string;
  displayName: string;
  unit: string;
  value: number;
  refLow: number | null;
  refHigh: number | null;
  testDate: string;
}

export interface PerfMetricRef {
  metricId: string;
  displayName: string;
  unit: string;
  points: number;
  lastDate: string;
}

export class CardStore {
  private validated: Promise<void> | null = null;

  constructor(
    private readonly db: D1Like,
    private readonly patientRef: string,
  ) {}

  /**
   * Refuse before answering, like DatabaseSource and D1DocumentStore: an
   * empty timeline for a ref that resolved to nobody would render as „žádné
   * návštěvy" — a fact about a person who was never looked up. Memoised as
   * the promise so one card request validates once, not per query.
   */
  private validate() {
    this.validated ??= (async () => {
      const row = await this.db.prepare(SQL.patientById).bind(this.patientRef).first();
      if (!row) {
        throw new Error(
          `unknown_patient: no patient ${this.patientRef} in this practice's database. ` +
            `Answering would state a fact about nobody.`,
        );
      }
    })();
    return this.validated;
  }

  /** Every visit, newest first — the timeline as the card renders it. */
  async visits(): Promise<VisitRow[]> {
    await this.validate();
    const { results } = await this.db
      .prepare(SQL.visitsForPatient)
      .bind(this.patientRef)
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      id: r.id as string,
      visitDate: r.visit_date as string,
      kind: r.kind as VisitKind,
      title: r.title as string,
      noteDocumentId: (r.note_document_id ?? null) as string | null,
    }));
  }

  /** Which performance metrics this patient has at all, with series depth. */
  async listPerfMetrics(): Promise<PerfMetricRef[]> {
    await this.validate();
    const { results } = await this.db
      .prepare(SQL.perfMetricsForPatient)
      .bind(this.patientRef)
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      metricId: r.metric_id as string,
      displayName: r.display_name as string,
      unit: r.unit as string,
      points: r.points as number,
      lastDate: r.last_date as string,
    }));
  }

  /** Every performance point the patient has, metric-major, oldest first. */
  async allPerf(): Promise<PerfPoint[]> {
    await this.validate();
    const { results } = await this.db
      .prepare(SQL.perfAllForPatient)
      .bind(this.patientRef)
      .all<Record<string, unknown>>();
    return results.map((r) => this.toPoint(r));
  }

  /** One metric's series across visits, oldest first — chart order. */
  async perfTrend(metricId: string): Promise<PerfPoint[]> {
    await this.validate();
    const { results } = await this.db
      .prepare(SQL.perfTrendForPatient)
      .bind(this.patientRef, metricId)
      .all<Record<string, unknown>>();
    return results.map((r) => this.toPoint(r));
  }

  /** Every performance result recorded at one visit. */
  async perfForVisit(visitId: string): Promise<PerfPoint[]> {
    await this.validate();
    const { results } = await this.db
      .prepare(SQL.perfForVisit)
      .bind(this.patientRef, visitId)
      .all<Record<string, unknown>>();
    return results.map((r) => this.toPoint({ ...r, visit_id: visitId }));
  }

  private toPoint(r: Record<string, unknown>): PerfPoint {
    return {
      visitId: r.visit_id as string,
      metricId: r.metric_id as string,
      displayName: r.display_name as string,
      unit: r.unit as string,
      value: r.value as number,
      refLow: (r.ref_low ?? null) as number | null,
      refHigh: (r.ref_high ?? null) as number | null,
      testDate: r.test_date as string,
    };
  }
}
