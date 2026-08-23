/**
 * A practice's database as the source. The stub this replaces threw
 * unconditionally; now it throws only for the case that must never look like
 * an answer — asking about a patient the database does not hold. An empty
 * result for a real patient is meaningful ("no labs on file"); the same reply
 * for a ref that resolved to nothing would let the agent state a fact about
 * nobody.
 *
 * Trends are built by the same lab-core call SessionSource uses, from the
 * lossless payloads. The SQL index tables are not consulted here — they serve
 * the directory and the cohort filter, where SQL is filtering rather than
 * computing. Reports are loaded once and memoised: a tool-using turn asks for
 * them several times, and the corpus is small because it is a practice, not a
 * hospital.
 */
import { buildTrends, type LabReport, type Trend } from "@bw/lab-core";
import type { AnalyteRef, PatientDataSource } from "./index";
import { SQL, type D1Like } from "./d1";

interface PatientRow {
  id: string;
  full_name: string;
  birth_date: string;
  sex: string;
  note: string;
}

export class DatabaseSource implements PatientDataSource {
  private loaded: Promise<{ reports: LabReport[]; trends: Map<string, Trend> }> | null = null;

  constructor(
    private readonly db: D1Like,
    private readonly patientRef: string,
    private readonly displayName: (id: string) => string = (id) => id,
  ) {}

  private load() {
    // Memoised as the promise, not the value, so concurrent tool calls in one
    // turn share a single query instead of racing three.
    this.loaded ??= (async () => {
      const patient = await this.db
        .prepare(SQL.patientById)
        .bind(this.patientRef)
        .first<PatientRow>();
      if (!patient) {
        throw new Error(
          `unknown_patient: no patient ${this.patientRef} in this practice's database. ` +
            `Answering would state a fact about nobody.`,
        );
      }
      const { results } = await this.db
        .prepare(SQL.reportsForPatient)
        .bind(this.patientRef)
        .all<{ payload: string }>();
      const reports = results.map((r) => JSON.parse(r.payload) as LabReport);
      return { reports, trends: buildTrends(reports, this.displayName) };
    })();
    return this.loaded;
  }

  async listAnalytes(): Promise<AnalyteRef[]> {
    const { trends } = await this.load();
    return [...trends.values()].map((t) => ({
      canonicalId: t.canonicalId,
      displayName: t.displayName,
      unit: t.unit,
    }));
  }

  async getTrend(canonicalId: string): Promise<Trend | null> {
    const { trends } = await this.load();
    return trends.get(canonicalId) ?? null;
  }

  async reports(): Promise<LabReport[]> {
    return (await this.load()).reports;
  }
}
