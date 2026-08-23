/**
 * Where the agent gets a patient's data.
 *
 * Two implementations now: whatever the reader loaded into their browser this
 * session (SessionSource), and a practice's seeded database (DatabaseSource
 * over D1). The interface predates the second on purpose — the tools were
 * written against it from the first tool, which is why the database arrived
 * without a tool changing.
 *
 * So no tool may ask which implementation it has, and no implementation may
 * return anything the deterministic layer has not already computed. That second
 * rule is what keeps "every number the model states is traceable" true when the
 * numbers stop coming from the same page as the question.
 */
import type { AnalyteDef, LabReport, Trend } from "@bw/lab-core";

export interface AnalyteRef {
  canonicalId: string;
  displayName: string;
  unit: string;
}

export interface PatientDataSource {
  /** What this patient has been measured for, at all. */
  listAnalytes(): Promise<AnalyteRef[]>;
  /** One analyte's series over time, already normalised and flagged. */
  getTrend(canonicalId: string): Promise<Trend | null>;
  /** The underlying reports, for tools that summarise across draws. */
  reports(): Promise<LabReport[]>;
}

export * from "./session";
export * from "./database";
export * from "./directory";
export * from "./documents";
export { normalizeName, SQL, type D1Like, type D1Prepared, type D1Rows } from "./d1";
export type { AnalyteDef };
