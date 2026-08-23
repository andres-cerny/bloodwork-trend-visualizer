/**
 * The bloodwork domain: parsing, normalising, trending and judging Czech lab
 * values. Everything here is deterministic — no model, no network. The LLM
 * only ever transcribes; every number a reader sees is computed in this
 * package, which is what makes a misread decimal catchable rather than
 * plausible.
 *
 * This root export must stay free of browser globals. It is imported by the
 * agent worker for its tools, by the benchmark harness and by the live tests,
 * none of which run in a browser. The one browser-dependent module, pdf/pdf.ts,
 * is reachable only as `@bw/lab-core/pdf` — that subpath is what keeps
 * pdfjs-dist and canvas out of workerd, and it is architecture rather than
 * tidiness.
 *
 * pdf/rows.ts is exported from here rather than from behind that subpath on
 * purpose: it is pure coordinate arithmetic over rows a caller already holds,
 * and bench/ and tests/live/ both depend on it outside any browser.
 */
export * from "./models";
export * from "./normalize";
export * from "./trends";
export * from "./registry";
export * from "./mapping";
export * from "./derived";
export * from "./summary";
export * from "./patientSummary";
export * from "./czech";
export * from "./rodneCislo";
export * from "./implausible";
export * from "./review";
export * from "./reconcile";
export * from "./correction";
export * from "./chartSpec";
export * from "./pdf/rows";
export * from "./chatContext";
