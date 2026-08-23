/**
 * The database source against the fake D1, with the one parity that matters:
 * a DatabaseSource over seeded payloads must answer exactly what a
 * SessionSource fed the same reports answers. If those two ever diverge, the
 * demo's "same agent, different reach" claim is false.
 *
 * The fake dispatches on the SQL constants — changing a query means changing
 * its fake in the same commit, deliberately.
 */
import { describe, expect, it } from "vitest";
import {
  D1DocumentStore,
  DatabaseSource,
  PatientDirectory,
  SessionSource,
  SQL,
  normalizeName,
  type D1Like,
  type D1Prepared,
} from "../src/index";
import type { LabReport } from "@bw/lab-core";

/** A measurement row shaped the way the pipeline emits them. */
function meas(name: string, id: string, value: number, unit: string, lo: number, hi: number) {
  return {
    rawAnalyteName: name,
    valueRaw: String(value).replace(".", ","),
    unitRaw: unit,
    refRangeRaw: `(${lo}-${hi})`,
    sourceSnippet: `${name} ${value} ${unit}`,
    sourcePage: 1,
    confidence: "high",
    canonicalId: id,
    value,
    unit,
    refRangeLow: lo,
    refRangeHigh: hi,
    refRangeText: `${lo}-${hi}`,
    flag: value < lo ? "low" : value > hi ? "high" : "normal",
    extractedBy: "test",
    escalated: false,
    disagreement: null,
    corrected: false,
    bbox: null,
  };
}

function report(id: string, date: string, rows: ReturnType<typeof meas>[]): LabReport {
  return {
    id,
    sourceFile: `${id}.pdf`,
    reportDate: date,
    labName: "Laboratoř Test",
    patientName: "Test Pacient",
    patientId: null,
    pages: [],
    measurements: rows,
  } as unknown as LabReport;
}

const REPORTS = [
  report("r1", "2025-01-10", [
    meas("S_Hemoglobin", "hemoglobin", 148, "g/l", 135, 175),
    meas("S_Ferritin", "ferritin", 80, "µg/l", 30, 300),
  ]),
  report("r2", "2025-06-20", [
    meas("S_Hemoglobin", "hemoglobin", 139, "g/l", 135, 175),
    meas("S_Ferritin", "ferritin", 22, "µg/l", 30, 300),
  ]),
];

interface Tables {
  patients: Array<{
    id: string; full_name: string; name_norm: string; birth_date: string; sex: string; note: string;
  }>;
  reports: Array<{ patient_id: string; report_date: string; payload: string }>;
  summary: Array<Record<string, unknown>>;
  documents: Array<{
    id: string; patient_id: string; doc_date: string; kind: string; title: string;
    body_text: string; body_norm: string;
  }>;
  pages: Array<{ document_id: string; page_num: number; image_url: string; width: number; height: number }>;
}

/** Map-backed fake implementing exactly the queries in SQL — nothing more. */
function fakeD1(t: Tables): D1Like {
  const like = (hay: string, needle: string) =>
    hay.includes(needle.replaceAll("%", ""));
  return {
    prepare(sql: string): D1Prepared {
      const make = (args: unknown[]): D1Prepared => ({
        bind: (...values: unknown[]) => make(values),
        async first<T>() {
          const { results } = await this.all<T>();
          return results[0] ?? null;
        },
        async all<T>() {
          const a = args as string[];
          switch (sql) {
            case SQL.patientById:
              return { results: t.patients.filter((p) => p.id === a[0]) as T[] };
            case SQL.patientsByName:
              return { results: t.patients.filter((p) => like(p.name_norm, a[0])) as T[] };
            case SQL.reportsForPatient:
              return {
                results: t.reports
                  .filter((r) => r.patient_id === a[0])
                  .sort((x, y) => x.report_date.localeCompare(y.report_date)) as T[],
              };
            case SQL.cohortByDirection:
              return {
                results: t.summary
                  .filter(
                    (s) =>
                      s.canonical_id === a[0] &&
                      (a[1] === "any" || s.direction === a[1]) &&
                      (a[2] === "any" || s.last_flag === a[2]),
                  )
                  .map((s) => ({
                    ...s,
                    full_name: t.patients.find((p) => p.id === s.patient_id)?.full_name,
                    birth_date: t.patients.find((p) => p.id === s.patient_id)?.birth_date,
                  })) as T[],
              };
            case SQL.documentsForPatient:
              return { results: t.documents.filter((d) => d.patient_id === a[0]) as T[] };
            case SQL.documentById:
              return { results: t.documents.filter((d) => d.id === a[0]) as T[] };
            case SQL.searchDocuments:
              return {
                results: t.documents.filter(
                  (d) => d.patient_id === a[0] && like(d.body_norm, a[1]),
                ) as T[],
              };
            case SQL.pagesForDocument:
              return { results: t.pages.filter((p) => p.document_id === a[0]) as T[] };
            default:
              throw new Error(`fake D1 does not know this query: ${sql}`);
          }
        },
      });
      return make([]);
    },
  };
}

// NFKD — the seeder contract for body_norm (VO₂max → vo2max); names carry no
// compatibility chars so it matches normalizeName for them too.
const strip = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

function seeded(): Tables {
  return {
    patients: [
      { id: "p-cerny", full_name: "Ondřej Černý", name_norm: strip("Ondřej Černý"), birth_date: "1999-03-04", sex: "m", note: "" },
      { id: "p-novak-88", full_name: "Michal Novák", name_norm: strip("Michal Novák"), birth_date: "1988-05-01", sex: "m", note: "" },
      { id: "p-novak-95", full_name: "Michal Novák", name_norm: strip("Michal Novák"), birth_date: "1995-11-12", sex: "m", note: "" },
    ],
    reports: REPORTS.map((r) => ({ patient_id: "p-cerny", report_date: r.reportDate ?? "", payload: JSON.stringify(r) })),
    summary: [
      { patient_id: "p-cerny", canonical_id: "ferritin", display_name: "Ferritin", unit: "µg/l", last_value: 22, last_date: "2025-06-20", last_flag: "low", delta: -58, direction: "falling" },
      { patient_id: "p-novak-88", canonical_id: "ferritin", display_name: "Ferritin", unit: "µg/l", last_value: 140, last_date: "2025-05-02", last_flag: "normal", delta: 5, direction: "stable" },
    ],
    documents: [
      {
        id: "d-eval-1", patient_id: "p-cerny", doc_date: "2025-06-09", kind: "perf_eval",
        title: "Zpráva ze sportovní prohlídky",
        body_text: "Spiroergometrie: VO₂max 61,2 ml/kg/min při 425 W. Závěr: sportu schopen.",
        body_norm: strip("Spiroergometrie: VO₂max 61,2 ml/kg/min při 425 W. Závěr: sportu schopen."),
      },
    ],
    pages: [{ document_id: "d-eval-1", page_num: 1, image_url: "/api/evidence/d-eval-1/1", width: 1600, height: 2263 }],
  };
}

describe("DatabaseSource", () => {
  it("answers exactly what a SessionSource over the same reports answers", async () => {
    const db = new DatabaseSource(fakeD1(seeded()), "p-cerny");
    const session = new SessionSource(REPORTS);

    expect(await db.listAnalytes()).toEqual(await session.listAnalytes());
    expect(await db.getTrend("ferritin")).toEqual(await session.getTrend("ferritin"));
    expect(await db.getTrend("neexistuje")).toBeNull();
    expect(await db.reports()).toEqual(REPORTS);
  });

  it("throws for a patient the practice does not hold, rather than answering about nobody", async () => {
    const db = new DatabaseSource(fakeD1(seeded()), "p-ghost");
    await expect(db.listAnalytes()).rejects.toThrow(/unknown_patient/);
  });
});

describe("PatientDirectory", () => {
  const dir = new PatientDirectory(fakeD1(seeded()));

  it("finds diacritic-insensitively, tokens in any order", async () => {
    expect((await dir.findPatients("cerny")).map((p) => p.id)).toEqual(["p-cerny"]);
    expect((await dir.findPatients("Novák Michal")).map((p) => p.id)).toEqual(["p-novak-88", "p-novak-95"]);
  });

  it("returns both Nováks so the reader disambiguates, never the code", async () => {
    const hits = await dir.findPatients("michal novak");
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((h) => h.birthDate)).size).toBe(2);
  });

  it("validates refs: null for the unknown, never a default", async () => {
    expect(await dir.getPatient("p-cerny")).not.toBeNull();
    expect(await dir.getPatient("p-ghost")).toBeNull();
  });

  it("cohort returns refs and aggregates, filtered — never records", async () => {
    const rows = await dir.cohort("ferritin", "falling", "any");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ patientId: "p-cerny", lastValue: 22, direction: "falling" });
    expect(Object.keys(rows[0])).not.toContain("payload");
  });
});

describe("D1DocumentStore", () => {
  const store = new D1DocumentStore(fakeD1(seeded()), "p-cerny");

  it("search folds diacritics and cuts the excerpt from the original text", async () => {
    const hits = await store.searchDocuments("VO2max");
    expect(hits).toHaveLength(1);
    expect(hits[0].excerpt).toContain("VO₂max 61,2 ml/kg/min");
  });

  it("refuses an unknown patient rather than reporting an empty shelf", async () => {
    const ghost = new D1DocumentStore(fakeD1(seeded()), "p-ghost");
    await expect(ghost.listDocuments()).rejects.toThrow(/unknown_patient/);
    await expect(ghost.searchDocuments("vo2max")).rejects.toThrow(/unknown_patient/);
  });

  it("another patient's document is indistinguishable from a missing one", async () => {
    const other = new D1DocumentStore(fakeD1(seeded()), "p-novak-88");
    expect(await other.getDocument("d-eval-1")).toBeNull();
    expect(await store.getDocument("d-eval-1")).not.toBeNull();
  });
});

describe("normalizeName", () => {
  it("is the documented contract: NFD, strip marks, lowercase, collapse", () => {
    expect(normalizeName("  Ondřej   ČERNÝ ")).toBe("ondrej cerny");
  });
});
