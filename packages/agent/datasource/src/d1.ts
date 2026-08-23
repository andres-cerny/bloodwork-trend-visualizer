/**
 * The narrow slice of D1 this package is allowed to see.
 *
 * Structural on purpose: this package compiles with `types: []` so it runs in
 * workerd and in node tests, and pulling @cloudflare/workers-types in here
 * would end that. A real D1Database satisfies this shape; the test fake
 * implements it over Maps. Nothing here may widen it — if a query needs a D1
 * feature this slice lacks, the question to ask first is why a filter over a
 * seeded demo corpus needs it.
 *
 * Every SQL string lives in this file. The fake dispatches on these exact
 * constants, which is the trade being made explicit: the tests pin the
 * queries, so changing a query means changing its fake in the same commit —
 * the same discipline parity_cases.json imposes on the parsers.
 */

export interface D1Rows<T> {
  results: T[];
}

export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Rows<T>>;
}

export interface D1Like {
  prepare(sql: string): D1Prepared;
}

export const SQL = {
  patientById: "SELECT id, full_name, birth_date, sex, note FROM patients WHERE id = ?1",
  patientsByName:
    "SELECT id, full_name, name_norm, birth_date, sex, note FROM patients " +
    "WHERE name_norm LIKE ?1 ORDER BY full_name, birth_date LIMIT 8",
  reportsForPatient:
    "SELECT payload FROM reports WHERE patient_id = ?1 ORDER BY report_date",
  cohortByDirection:
    "SELECT s.patient_id, p.full_name, p.birth_date, s.canonical_id, s.display_name, " +
    "s.unit, s.last_value, s.last_date, s.last_flag, s.delta, s.direction " +
    "FROM patient_analyte_summary s JOIN patients p ON p.id = s.patient_id " +
    "WHERE s.canonical_id = ?1 AND (?2 = 'any' OR s.direction = ?2) " +
    "AND (?3 = 'any' OR s.last_flag = ?3) " +
    "ORDER BY s.last_date DESC LIMIT 25",
  documentsForPatient:
    "SELECT id, doc_date, kind, title FROM documents WHERE patient_id = ?1 ORDER BY doc_date",
  documentById:
    "SELECT id, patient_id, doc_date, kind, title, body_text FROM documents WHERE id = ?1",
  searchDocuments:
    "SELECT id, doc_date, kind, title, body_text FROM documents " +
    "WHERE patient_id = ?1 AND body_norm LIKE ?2 ORDER BY doc_date DESC LIMIT 10",
  pagesForDocument:
    "SELECT page_num, image_url, width, height FROM document_pages " +
    "WHERE document_id = ?1 ORDER BY page_num",
} as const;

/**
 * The one name-normalisation rule, stated once for both languages.
 *
 * TypeScript here, Python in the seeder — the contract is: NFD, strip
 * combining marks, lowercase, collapse whitespace. It is deliberately this
 * small so the two implementations cannot meaningfully drift; if it ever
 * grows, it needs a parity fixture like the parsers have.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
