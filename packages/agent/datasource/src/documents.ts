/**
 * A patient's documents — the evidence that is prose, not a lab table.
 *
 * Physio notes, imaging reports, performance evals. The store returns text
 * and page references; it never interprets. Search is LIKE over a corpus of
 * practice size — six patients, dozens of documents — and the excerpt window
 * is fixed here so a tool cannot decide to hand the model a whole document
 * when it asked for a match.
 *
 * Scoped to one patient at construction, like DatabaseSource: a tool holding
 * this store cannot search another patient's documents, because there is no
 * parameter with which to ask. And like DatabaseSource it validates that the
 * patient exists before answering anything — an empty list for a ref that
 * resolved to nobody would read as "this patient has no documents", which is
 * a statement about a person who was never looked up.
 */
import { SQL, type D1Like } from "./d1";

export type DocumentKind = "perf_eval" | "physio_note" | "imaging" | "op_report";

export interface DocumentRef {
  id: string;
  docDate: string;
  kind: DocumentKind;
  title: string;
}

export interface DocumentHit extends DocumentRef {
  /** The matched window, not the document. */
  excerpt: string;
}

export interface DocumentPageRef {
  pageNum: number;
  imageUrl: string;
  width: number;
  height: number;
}

export interface FullDocument extends DocumentRef {
  bodyText: string;
  pages: DocumentPageRef[];
}

export interface DocumentStore {
  listDocuments(): Promise<DocumentRef[]>;
  searchDocuments(query: string): Promise<DocumentHit[]>;
  getDocument(id: string): Promise<FullDocument | null>;
}

const EXCERPT_RADIUS = 240;

/**
 * Normalise for matching while remembering where each character came from, so
 * an index found in the normalised text cuts the excerpt from the original.
 * Same transform as the seeder writes into body_norm (NFD, strip combining
 * marks, lowercase) — the SQL LIKE is only a prefilter; this is the match.
 */
function normWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    // NFKD, not NFD: documents carry compatibility characters — VO₂max must
    // be findable by typing "vo2max". Names never do, so normalizeName stays NFD.
    const folded = text[i].normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const ch of folded) {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}

const foldQuery = (q: string) =>
  q.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export class D1DocumentStore implements DocumentStore {
  private validated: Promise<void> | null = null;

  constructor(
    private readonly db: D1Like,
    private readonly patientRef: string,
  ) {}

  /** Same guard, same memoisation, same reason as DatabaseSource.load(). */
  private ensurePatient(): Promise<void> {
    this.validated ??= (async () => {
      const row = await this.db.prepare(SQL.patientById).bind(this.patientRef).first();
      if (!row) {
        throw new Error(
          `unknown_patient: no patient ${this.patientRef} in this practice's database. ` +
            `An empty document list would be an answer about nobody.`,
        );
      }
    })();
    return this.validated;
  }

  async listDocuments(): Promise<DocumentRef[]> {
    await this.ensurePatient();
    const { results } = await this.db
      .prepare(SQL.documentsForPatient)
      .bind(this.patientRef)
      .all<{ id: string; doc_date: string; kind: DocumentKind; title: string }>();
    return results.map((r) => ({ id: r.id, docDate: r.doc_date, kind: r.kind, title: r.title }));
  }

  async searchDocuments(query: string): Promise<DocumentHit[]> {
    await this.ensurePatient();
    const needle = foldQuery(query);
    if (!needle) return [];
    const { results } = await this.db
      .prepare(SQL.searchDocuments)
      .bind(this.patientRef, `%${needle}%`)
      .all<{ id: string; doc_date: string; kind: DocumentKind; title: string; body_text: string }>();
    const hits: DocumentHit[] = [];
    for (const r of results) {
      const { norm, map } = normWithMap(r.body_text);
      const at = norm.indexOf(needle);
      // The prefilter can pass what the offset-mapped match rejects (body_norm
      // collapses whitespace differently); a miss here is a drop, not a crash.
      if (at < 0) continue;
      const start = Math.max(0, (map[at] ?? 0) - EXCERPT_RADIUS);
      const matchEnd = (map[at + needle.length - 1] ?? r.body_text.length - 1) + 1;
      const end = Math.min(r.body_text.length, matchEnd + EXCERPT_RADIUS);
      hits.push({
        id: r.id,
        docDate: r.doc_date,
        kind: r.kind,
        title: r.title,
        excerpt:
          (start > 0 ? "…" : "") + r.body_text.slice(start, end) + (end < r.body_text.length ? "…" : ""),
      });
    }
    return hits;
  }

  async getDocument(id: string): Promise<FullDocument | null> {
    await this.ensurePatient();
    const doc = await this.db
      .prepare(SQL.documentById)
      .bind(id)
      .first<{ id: string; patient_id: string; doc_date: string; kind: DocumentKind; title: string; body_text: string }>();
    // A document belonging to another patient is refused identically to one
    // that does not exist — the difference is not this caller's to observe.
    if (!doc || doc.patient_id !== this.patientRef) return null;
    const { results: pages } = await this.db
      .prepare(SQL.pagesForDocument)
      .bind(id)
      .all<{ page_num: number; image_url: string; width: number; height: number }>();
    return {
      id: doc.id,
      docDate: doc.doc_date,
      kind: doc.kind,
      title: doc.title,
      bodyText: doc.body_text,
      pages: pages.map((p) => ({
        pageNum: p.page_num,
        imageUrl: p.image_url,
        width: p.width,
        height: p.height,
      })),
    };
  }
}
