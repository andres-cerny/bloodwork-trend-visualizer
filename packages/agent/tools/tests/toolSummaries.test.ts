/**
 * The call sites, not just the phrase table.
 *
 * summaries.test.ts pins the Czech; this pins that every tool that counts
 * something actually routes through it. Without this, the forms stay correct
 * and a hand-written `${n} pacientů` creeps back into runTool unnoticed —
 * which is exactly how the strings got wrong in the first place.
 *
 * The stubs return N of whatever the tool counts and nothing else. That is
 * enough: these assertions are about the summary line, and the summary is the
 * one part of a ToolResult the model never sees, so a thin source cannot make
 * the test agree with a wrong answer.
 */
import { describe, expect, it } from "vitest";
import type { CohortRow, DocumentStore, PatientDataSource, PatientLookup, PatientRef } from "@bw/datasource";
import type { LabReport } from "@bw/lab-core";
import { runTool, type ToolContext } from "../src/index";

const COUNTS = [0, 1, 2, 4, 5, 11];

function patient(i: number): PatientRef {
  return { id: `p${i}`, fullName: `Pacient ${i}`, birthDate: "1980-01-01", sex: "m", note: "" };
}

function directoryOf(patients: PatientRef[], cohort: CohortRow[]): PatientLookup {
  return {
    async findPatients() {
      return patients;
    },
    async getPatient(id) {
      return patients.find((p) => p.id === id) ?? null;
    },
    async cohort() {
      return cohort;
    },
  };
}

function cohortRow(i: number): CohortRow {
  return {
    patientId: `p${i}`,
    fullName: `Pacient ${i}`,
    birthDate: "1980-01-01",
    canonicalId: "ferritin",
    displayName: "Ferritin",
    unit: "µg/l",
    lastValue: 20 + i,
    lastDate: "2024-01-01",
    lastFlag: "low",
    delta: -1,
    direction: "falling",
  };
}

function documentsOf(n: number): DocumentStore {
  const docs = Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    docDate: "2024-01-01",
    kind: "physio_note" as const,
    title: `Zpráva ${i}`,
    bodyText: "rameno",
    pages: [],
  }));
  return {
    async listDocuments() {
      return docs.map(({ id, docDate, kind, title }) => ({ id, docDate, kind, title }));
    },
    async searchDocuments() {
      return docs.map((d) => ({ ...d, excerpt: d.bodyText }));
    },
    async getDocument(id) {
      return docs.find((d) => d.id === id) ?? null;
    },
  };
}

function sourceOf(analytes: number, reports: number): PatientDataSource {
  const list = Array.from({ length: analytes }, (_, i) => ({
    canonicalId: `a${i}`,
    displayName: `Parametr ${i}`,
    unit: "mmol/l",
  }));
  const draws: LabReport[] = Array.from({ length: reports }, (_, i) => ({
    id: `r${i}`,
    sourceFile: `r${i}.pdf`,
    reportDate: `2024-0${(i % 9) + 1}-01`,
    labName: "Lab",
    patientName: "Pacient",
    patientId: null,
    pages: [],
    measurements: [],
  }));
  return {
    async listAnalytes() {
      return list;
    },
    async getTrend() {
      return null;
    },
    async reports() {
      return draws;
    },
  };
}

describe("find_patient", () => {
  it("counts the matches in agreeing Czech", async () => {
    // One match takes the named-patient branch; the count branch starts at two.
    for (const n of [2, 4, 5, 11]) {
      const ctx: ToolContext = { source: null, directory: directoryOf(Array.from({ length: n }, (_, i) => patient(i)), []) };
      const r = await runTool("find_patient", { query: "pacient" }, ctx);
      expect(r.summary).toBe(
        `${n} ${n <= 4 ? "pacienti" : "pacientů"} v kartotéce — zeptej se, kterého myslí`,
      );
    }
  });

  it("says nobody rather than counting to zero", async () => {
    const ctx: ToolContext = { source: null, directory: directoryOf([], []) };
    expect((await runTool("find_patient", { query: "x" }, ctx)).summary).toBe("nikdo takový v kartotéce není");
  });
});

describe("cohort_query", () => {
  it("counts the cohort in agreeing Czech", async () => {
    for (const n of [1, 2, 4, 5, 11]) {
      const ctx: ToolContext = { source: null, directory: directoryOf([], Array.from({ length: n }, (_, i) => cohortRow(i))) };
      const r = await runTool("cohort_query", { canonicalId: "ferritin" }, ctx);
      expect(r.summary).toBe(`${n} ${n === 1 ? "pacient" : n <= 4 ? "pacienti" : "pacientů"} ve výběru`);
    }
  });
});

describe("search_documents and get_document", () => {
  it("counts the documents it matched", async () => {
    for (const n of [1, 2, 4, 5, 11]) {
      const ctx: ToolContext = { source: sourceOf(0, 0), documents: documentsOf(n) };
      const r = await runTool("search_documents", { query: "rameno" }, ctx);
      expect(r.summary).toBe(`nalezeno ${n === 1 ? "v 1 dokumentu" : n <= 4 ? `ve ${n} dokumentech` : `v ${n} dokumentech`}`);
    }
  });

  it("counts the documents it listed", async () => {
    const expected: Record<number, string> = {
      0: "vypsal 0 dokumentů",
      1: "vypsal 1 dokument",
      2: "vypsal 2 dokumenty",
      4: "vypsal 4 dokumenty",
      5: "vypsal 5 dokumentů",
      11: "vypsal 11 dokumentů",
    };
    for (const n of COUNTS) {
      const ctx: ToolContext = { source: sourceOf(0, 0), documents: documentsOf(n) };
      expect((await runTool("get_document", {}, ctx)).summary).toBe(expected[n]);
    }
  });
});

describe("list_analytes", () => {
  it("counts the parameters", async () => {
    const expected: Record<number, string> = {
      0: "vypsal 0 parametrů",
      1: "vypsal 1 parametr",
      2: "vypsal 2 parametry",
      4: "vypsal 4 parametry",
      5: "vypsal 5 parametrů",
      11: "vypsal 11 parametrů",
    };
    for (const n of COUNTS) {
      const ctx: ToolContext = { source: sourceOf(n, 0) };
      expect((await runTool("list_analytes", {}, ctx)).summary).toBe(expected[n]);
    }
  });
});

describe("summarize_changes", () => {
  it("counts the draws", async () => {
    const expected: Record<number, string> = {
      0: "porovnal 0 odběrů",
      1: "porovnal 1 odběr",
      2: "porovnal 2 odběry",
      4: "porovnal 4 odběry",
      5: "porovnal 5 odběrů",
      11: "porovnal 11 odběrů",
    };
    for (const n of COUNTS) {
      const ctx: ToolContext = { source: sourceOf(0, n) };
      expect((await runTool("summarize_changes", {}, ctx)).summary).toBe(expected[n]);
    }
  });
});

describe("computed_values", () => {
  it("counts nothing in the genitive plural, which is where zero belongs", async () => {
    const ctx: ToolContext = { source: sourceOf(0, 0) };
    expect((await runTool("computed_values", {}, ctx)).summary).toBe("spočítal 0 odvozených hodnot");
  });
});
