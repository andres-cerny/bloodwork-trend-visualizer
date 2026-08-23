/**
 * The bloodwork domain: parsing, normalising, trending and judging Czech lab
 * values. Everything here is deterministic — no model, no network.
 *
 * This root export must stay free of browser globals. It is imported by the
 * agent worker for its tools, by the benchmark harness, and by the live tests,
 * all of which run outside a browser. The one browser-dependent module,
 * pdf/pdf.ts, is reachable only as `@bw/lab-core/pdf` — that subpath is what
 * keeps pdfjs-dist and canvas out of workerd.
 *
 * pdf/rows.ts is here rather than behind the subpath on purpose: it is pure
 * coordinate arithmetic over rows a caller already has, and bench/ and
 * tests/live/ both depend on it.
 *
 * TRANSITIONAL: these re-export from web/src while the move happens in three
 * steps — publish the surface, repoint every importer, then move the files.
 * The middle step is provable on its own precisely because this indirection
 * exists.
 */
export * from "../../../web/src/lib/models";
export * from "../../../web/src/lib/normalize";
export * from "../../../web/src/lib/trends";
export * from "../../../web/src/lib/registry";
export * from "../../../web/src/lib/mapping";
export * from "../../../web/src/lib/derived";
export * from "../../../web/src/lib/summary";
export * from "../../../web/src/lib/patientSummary";
export * from "../../../web/src/lib/czech";
export * from "../../../web/src/lib/rodneCislo";
export * from "../../../web/src/lib/implausible";
export * from "../../../web/src/lib/review";
export * from "../../../web/src/lib/reconcile";
export * from "../../../web/src/lib/correction";
export * from "../../../web/src/lib/chartSpec";
export * from "../../../web/src/pdf/rows";
