/**
 * Who is in this practice — the one place identity is resolved.
 *
 * The rule this file exists to hold: the model NAMES a patient, the server
 * OPENS one. findPatients takes the model's query string and resolves it
 * deterministically — diacritic-insensitive, order-normalised — and whatever
 * it returns goes back to the reader for confirmation when it is not unique.
 * A patientRef never comes out of model text; it comes out of this lookup or
 * out of the reader's click, and getPatient validates every ref against the
 * practice before anything is answered about it.
 *
 * Cohort answers come from the seed-time summary table. The SQL is a WHERE
 * clause over columns lab-core computed; direction never gets re-derived here,
 * and the result is refs and last values — enough to answer "who", never a
 * record. Opening the record is a separate, reader-visible act.
 */
import { SQL, normalizeName, type D1Like } from "./d1";

export interface PatientRef {
  id: string;
  fullName: string;
  birthDate: string;
  sex: "m" | "f";
  note: string;
}

export interface CohortRow {
  patientId: string;
  fullName: string;
  birthDate: string;
  canonicalId: string;
  displayName: string;
  unit: string;
  lastValue: number;
  lastDate: string;
  lastFlag: string;
  delta: number | null;
  direction: "rising" | "falling" | "stable" | "single";
}

interface PatientRow {
  id: string;
  full_name: string;
  name_norm?: string;
  birth_date: string;
  sex: string;
  note: string;
}

const toRef = (r: PatientRow): PatientRef => ({
  id: r.id,
  fullName: r.full_name,
  birthDate: r.birth_date,
  sex: r.sex as "m" | "f",
  note: r.note,
});

export class PatientDirectory {
  constructor(private readonly db: D1Like) {}

  /**
   * "novak", "Novák Michal" and "michal novák" all find Michal Novák. Tokens
   * must all appear in the normalised name, in any order — a surname alone is
   * how a doctor actually asks.
   */
  async findPatients(query: string): Promise<PatientRef[]> {
    const tokens = normalizeName(query).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    const { results } = await this.db
      .prepare(SQL.patientsByName)
      .bind(`%${tokens[0]}%`)
      .all<PatientRow>();
    return results
      .filter((r) => {
        const norm = r.name_norm ?? normalizeName(r.full_name);
        return tokens.every((t) => norm.includes(t));
      })
      .map(toRef);
  }

  /** Validates a ref the client sent back. Null means refuse, never default. */
  async getPatient(id: string): Promise<PatientRef | null> {
    const row = await this.db.prepare(SQL.patientById).bind(id).first<PatientRow>();
    return row ? toRef(row) : null;
  }

  async cohort(
    canonicalId: string,
    direction: "rising" | "falling" | "stable" | "any",
    flag: "high" | "low" | "any",
  ): Promise<CohortRow[]> {
    const { results } = await this.db
      .prepare(SQL.cohortByDirection)
      .bind(canonicalId, direction, flag)
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      patientId: r.patient_id as string,
      fullName: r.full_name as string,
      birthDate: r.birth_date as string,
      canonicalId: r.canonical_id as string,
      displayName: r.display_name as string,
      unit: r.unit as string,
      lastValue: r.last_value as number,
      lastDate: r.last_date as string,
      lastFlag: r.last_flag as string,
      delta: (r.delta ?? null) as number | null,
      direction: r.direction as CohortRow["direction"],
    }));
  }
}
