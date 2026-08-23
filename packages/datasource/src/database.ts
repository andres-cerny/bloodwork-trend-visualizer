/**
 * A doctor's database as the source.
 *
 * Declared, not implemented. Connecting it needs authentication, tenancy and a
 * privacy model that are their own project — but the shape is fixed here now so
 * the tool layer is written against it from the first tool rather than
 * retrofitted onto it later.
 *
 * It throws rather than returning empty results deliberately: a source that
 * silently reports "no analytes" would let the agent answer "there is no
 * cholesterol on file" when the truth is that nothing was ever connected.
 */
import type { LabReport, Trend } from "@bw/lab-core";
import type { AnalyteRef, PatientDataSource } from "./index";

export class DatabaseSource implements PatientDataSource {
  constructor(private readonly patientRef: string) {}

  private unimplemented(): never {
    throw new Error(
      `not_implemented: no database is connected (patient ${this.patientRef}). ` +
        `Answering from an empty source would be indistinguishable from answering ` +
        `from a patient with no results.`,
    );
  }

  async listAnalytes(): Promise<AnalyteRef[]> { this.unimplemented(); }
  async getTrend(_canonicalId: string): Promise<Trend | null> { this.unimplemented(); }
  async reports(): Promise<LabReport[]> { this.unimplemented(); }
}
