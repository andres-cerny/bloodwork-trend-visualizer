/**
 * The data the reader loaded in their own browser this session.
 *
 * This preserves the privacy model the demo has always had: nothing about a
 * patient is stored anywhere, and the agent can only see what was handed to it
 * with the question. Reload and it is gone.
 */
import { buildTrends, type LabReport, type Trend } from "@bw/lab-core";
import type { AnalyteRef, PatientDataSource } from "./index";

export class SessionSource implements PatientDataSource {
  private readonly trends: Map<string, Trend>;

  constructor(private readonly loaded: LabReport[], displayName?: (id: string) => string) {
    this.trends = buildTrends(loaded, displayName ?? ((id) => id));
  }

  async listAnalytes(): Promise<AnalyteRef[]> {
    return [...this.trends.values()].map((t) => ({
      canonicalId: t.canonicalId,
      displayName: t.displayName,
      unit: t.unit,
    }));
  }

  async getTrend(canonicalId: string): Promise<Trend | null> {
    return this.trends.get(canonicalId) ?? null;
  }

  async reports(): Promise<LabReport[]> {
    return this.loaded;
  }
}
