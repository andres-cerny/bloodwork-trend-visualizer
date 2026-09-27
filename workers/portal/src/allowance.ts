/**
 * The allowance a person sees: documents, not dollars.
 *
 * A document is one upload — a PDF, or one set of photographs — of up to
 * MAX_PAGES_PER_REPORT pages. Every account has five for good; a purchase
 * (src/stripe.ts) or the operator (tools/scripts/moje-krev-budget.mjs
 * --documents) adds more. One is taken at the moment the browser opens the
 * document for extraction — before the first page is sent, once, whatever
 * the page count — and given back only if no page of it was ever read and
 * none is still out at the extractor. Deleting the report afterwards gives
 * nothing back: the read was paid for.
 *
 * The per-person USD ledger (src/ledger.ts) stays underneath as a fuse: a
 * document that somehow costs far more than a document should still trips
 * it, and the frozen sentence is still what the person sees then.
 *
 * Every write here is a conditional UPDATE or an OR IGNORE insert read
 * through meta.changes — never a SELECT followed by a write — because eight
 * pages of one document arrive at once and two uploads can be clicked
 * together, and the count must survive both.
 */
import { type DocumentRow, SQL, type UserRow } from "./db";

/** What every account starts with, and keeps. */
export const FREE_DOCUMENTS = 5;

export interface Allowance {
  /** The free part of the total — 5, or less if the operator lowered it. */
  free: number;
  /** Bought or granted, on top of the free ones. */
  purchased: number;
  used: number;
  remaining: number;
}

/** The account's allowance as the shell shows it: „Dokumenty: used z free+purchased". */
export function allowanceOf(row: Pick<UserRow, "doc_allowance" | "doc_used">): Allowance {
  const total = Math.max(0, row.doc_allowance);
  const used = Math.max(0, row.doc_used);
  return {
    free: Math.min(total, FREE_DOCUMENTS),
    purchased: Math.max(0, total - FREE_DOCUMENTS),
    used,
    remaining: Math.max(0, total - used),
  };
}

/** The row as it stands now — after a take or a release, for the answer. */
export async function readAllowance(db: D1Database, uid: string): Promise<Allowance> {
  const row = await db.prepare(SQL.allowanceForUser).bind(uid).first<Pick<UserRow, "doc_allowance" | "doc_used">>();
  return allowanceOf(row ?? { doc_allowance: 0, doc_used: 0 });
}

export type OpenOutcome =
  /** This call took the slot. */
  | { kind: "opened" }
  /** The same id was opened before by this account: a retry, nothing taken. */
  | { kind: "already" }
  /** No document left; nothing was taken. */
  | { kind: "exhausted" }
  /** The id belongs to another account's document. */
  | { kind: "foreign" };

/**
 * Open a document: claim the id, then the slot.
 *
 * The insert is the claim on the id — OR IGNORE, so a second call with the
 * same id changes nothing and is told so. Only the call that inserted goes
 * on to move doc_used, and only while a document is left; when none is, the
 * row it just made is removed again so the id can be opened later, after a
 * purchase. Two different ids opened at once each run their own conditional
 * UPDATE, and at most `remaining` of them succeed.
 */
export async function openDocument(db: D1Database, user: UserRow, id: string, nowIso: string, takeSlot = true): Promise<OpenOutcome> {
  const made = await db.prepare(SQL.insertDocument).bind(id, user.id, nowIso, takeSlot ? 1 : 0).run();
  if (!made.meta || made.meta.changes !== 1) {
    const row = await db.prepare(SQL.documentById).bind(id).first<DocumentRow>();
    return row && row.user_id === user.id ? { kind: "already" } : { kind: "foreign" };
  }
  // The demo: the row exists so pages can name it and be capped, but the
  // slot is nobody's to take — the account is the owner's, and the visitor
  // is a stranger. The USD fuse underneath still counts every page.
  if (!takeSlot) return { kind: "opened" };
  const taken = await db.prepare(SQL.takeDocument).bind(user.id).run();
  if (taken.meta && taken.meta.changes === 1) return { kind: "opened" };
  await db.prepare(SQL.deleteDocument).bind(id).run();
  return { kind: "exhausted" };
}

/**
 * One more page of this document goes to the extractor — if the document
 * is this account's, still open, and under the cap. False is any of the
 * three; the caller does not need to know which, the browser never sends a
 * page that would fail it.
 */
export async function sendPage(db: D1Database, user: UserRow, id: string, maxPages: number): Promise<boolean> {
  if (!id) return false;
  const r = await db.prepare(SQL.sendPage).bind(id, user.id, maxPages).run();
  return !!r.meta && r.meta.changes === 1;
}

/** A page of this document came back read. What decides a later release. */
export async function notePageRead(db: D1Database, id: string): Promise<void> {
  await db.prepare(SQL.notePageRead).bind(id).run();
}

/**
 * A page of this document came back failed — the extractor refused it, or
 * could not be reached. Together with pages_read it says when nothing is in
 * flight any more: a release before that would give the slot back while a
 * read is still on its way to being paid for.
 */
export async function notePageFailed(db: D1Database, id: string): Promise<void> {
  await db.prepare(SQL.notePageFailed).bind(id).run();
}

/**
 * Give the slot back, if nothing was read and nothing is still out. The
 * browser calls this when every page of a document failed; the conditional
 * UPDATE on the document row is the guard, so a release after a successful
 * page, one fired while a page is still at the extractor, or a second
 * release moves nothing. True means doc_used went down by one. A page whose
 * answer never arrives keeps the slot for good — the safe direction, since a
 * read the person got must not be one they did not pay for.
 */
export async function releaseDocument(db: D1Database, user: UserRow, id: string, nowIso: string): Promise<boolean> {
  const r = await db.prepare(SQL.releaseDocument).bind(id, user.id, nowIso).run();
  if (!r.meta || r.meta.changes !== 1) return false;
  await db.prepare(SQL.giveBackDocument).bind(user.id).run();
  return true;
}

/** Add documents to an account — a purchase or the operator's grant. */
export async function creditDocuments(db: D1Database, uid: string, n: number): Promise<boolean> {
  if (!Number.isInteger(n) || n <= 0) return false;
  const r = await db.prepare(SQL.creditDocuments).bind(uid, n).run();
  return !!r.meta && r.meta.changes === 1;
}

/** "5 dokumentů", "2 dokumenty", "1 dokument" — the worker bundles no lab-core. */
export const documents = (n: number) => `${n} ${n === 1 ? "dokument" : n >= 2 && n <= 4 ? "dokumenty" : "dokumentů"}`;

/** The refusal at zero, in the worker's words; the upload card has its own. */
export const noDocumentsMessage = (a: Allowance) =>
  a.purchased > 0
    ? `Máte vyčerpáno všech ${documents(a.free + a.purchased)}. Přikupte další v Reportech.`
    : `Máte vyčerpáno ${documents(a.free)} zdarma. Přikupte další v Reportech.`;

/* ---------------------------------------------------------------- routes */

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `GET /api/allowance` — `{ free, purchased, used, remaining }`, read fresh. */
export async function handleAllowance(db: D1Database, user: UserRow): Promise<Response> {
  return json(await readAllowance(db, user.id));
}

/**
 * `POST /api/documents {id}` — the one place a document is taken. The id is
 * the report id the browser minted, so the document and the report it
 * becomes share a name. 402 `no_documents` when none is left, with the
 * allowance so the card can say the numbers; 200 with the allowance after
 * the take otherwise. A retry with an id already open is a 200 too, and
 * takes nothing. A demo session opens without taking: the account is the
 * owner's, and five strangers must not exhaust it for the sixth.
 */
export async function handleOpenDocument(request: Request, db: D1Database, user: UserRow, demo = false): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!REPORT_ID.test(id)) return json({ error: "bad_request", message: "Neplatný dokument." }, 400);
  const outcome = await openDocument(db, user, id, new Date().toISOString(), !demo);
  const allowance = await readAllowance(db, user.id);
  switch (outcome.kind) {
    case "opened":
    case "already":
      return json({ ok: true, already: outcome.kind === "already", allowance });
    case "exhausted":
      return json({ error: "no_documents", message: noDocumentsMessage(allowance), allowance }, 402);
    case "foreign":
      return json({ error: "forbidden", message: "Dokument nepatří k tomuto účtu." }, 403);
  }
}

/**
 * `DELETE /api/documents/:id` — give the slot back if nothing was read.
 * `released` says whether it was; the allowance is the account's now either
 * way. Not a deletion of anything the person sees: the report, if one was
 * stored, stays.
 */
export async function handleReleaseDocument(db: D1Database, user: UserRow, id: string, demo = false): Promise<Response> {
  // Nothing was taken for a demo document, so nothing is given back — and
  // the owner's own documents are not touched by a visitor's release.
  const released = demo ? false : await releaseDocument(db, user, id, new Date().toISOString());
  return json({ ok: true, released, allowance: await readAllowance(db, user.id) });
}

/** Every this-many empty reads in 30 days is kept rather than given back. */
export const EMPTY_STRIKE = 3;
export const EMPTY_WINDOW_MS = 30 * 86_400_000;

/**
 * A read that produced nothing to store — no values at all, or the same
 * report the account already holds. The browser says so; the server cannot
 * check it (it never sees the rows), which is why the refund is bounded:
 * two such reads in 30 days are given back, every third is kept. Honest
 * mistakes cost nothing twice; a loop of free reads costs a document per
 * three.
 */
export async function refundEmpty(db: D1Database, user: UserRow, id: string, now = Date.now()): Promise<{ refunded: boolean; strike: number } | null> {
  const nowIso = new Date(now).toISOString();
  const marked = await db.prepare(SQL.markEmpty).bind(id, user.id, nowIso).run();
  if (!marked.meta || marked.meta.changes !== 1) return null;
  const row = await db.prepare(SQL.countEmpty).bind(user.id, new Date(now - EMPTY_WINDOW_MS).toISOString()).first<{ n: number }>();
  const strike = row?.n ?? 1;
  if (strike % EMPTY_STRIKE === 0) return { refunded: false, strike };
  const released = await db.prepare(SQL.releaseEmpty).bind(id, user.id, nowIso).run();
  if (!released.meta || released.meta.changes !== 1) return { refunded: false, strike };
  await db.prepare(SQL.giveBackDocument).bind(user.id).run();
  return { refunded: true, strike };
}

/**
 * `POST /api/documents/:id/empty` — the read of this document gave nothing
 * to store. 200 with `refunded` and the allowance; 404 for a document that
 * is not this account's open one, or was already reported.
 */
export async function handleEmptyDocument(db: D1Database, user: UserRow, id: string): Promise<Response> {
  const out = await refundEmpty(db, user, id);
  if (!out) return json({ error: "not_found", message: "Dokument nenalezen." }, 404);
  return json({ ok: true, ...out, allowance: await readAllowance(db, user.id) });
}
