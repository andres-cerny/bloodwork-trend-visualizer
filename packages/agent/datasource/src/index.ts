/**
 * Where the agent gets a patient's data.
 *
 * The interface exists before its second implementation on purpose. Today the
 * only source is whatever the reader loaded into their browser this session;
 * the intended one is a doctor's database. If the tools were written against
 * the session's shape, every one of them would have to change when the
 * database arrives — and the tool layer is exactly the part that should not
 * care.
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
export type { AnalyteDef };
