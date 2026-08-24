/**
 * The turn's evidence registry.
 *
 * A citation is a registry entry, not a convention: a tool describes what it
 * read, the server assigns the number, and the client renders the registry
 * exactly as sent — so a [n] the model invented points at nothing, visibly.
 * The numbering therefore lives here rather than in any tool, and it is stable
 * across rounds because one registry serves the whole turn.
 *
 * **One piece of evidence gets one number, however many tools read it.** Two
 * tools in a turn genuinely do land on the same printed row: get_trend walks a
 * whole series while summarize_changes cites that series' most recent value,
 * and both go through the same citeMeasuredRow. Registering both would put the
 * identical crop in the rail twice under two numbers, which reads as two
 * independent confirmations of a value that was only ever measured once — the
 * opposite of what a citation is for.
 *
 * So registering is idempotent on what the evidence *is*. For a lab source
 * that is the located row: the report, the page, the box, and the label naming
 * the value — the label included so that two rows of one page that the payload
 * could not locate (both boxes null) stay two cards rather than collapsing
 * into one. For a document it is the quoted window: two different excerpts of
 * one document are two different quotations and stay two sources.
 */
import type { SourceInfo } from "@bw/agent-tools";

export interface SourceRegistry {
  /** What the `sources` event carries, in registration order. */
  sources: Array<{ n: number } & SourceInfo>;
  /** Register one piece of evidence; returns its number, new or existing. */
  cite: (s: SourceInfo) => number;
}

/** What makes two citations the same piece of evidence. */
export function sourceKey(s: SourceInfo): string {
  return s.kind === "lab"
    ? `lab:${s.reportId}:${s.page}:${s.bbox?.join(",") ?? ""}:${s.label}`
    : `doc:${s.documentId}:${s.excerpt}`;
}

export function createSourceRegistry(): SourceRegistry {
  const sources: Array<{ n: number } & SourceInfo> = [];
  const seen = new Map<string, number>();
  return {
    sources,
    cite(s: SourceInfo) {
      const key = sourceKey(s);
      const already = seen.get(key);
      if (already !== undefined) return already;
      const n = sources.length + 1;
      sources.push({ n, ...s });
      seen.set(key, n);
      return n;
    },
  };
}
