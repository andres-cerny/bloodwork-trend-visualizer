/**
 * Every SQL string the portal runs, as named constants.
 *
 * The constants are the contract the tests fake against: the fake D1
 * dispatches on these exact strings (the same pattern as the agent worker's
 * route tests), so a query added here without a fake branch fails loudly in
 * tests rather than silently returning nothing.
 *
 * Writes that must be single-use under a race — burning an invite — are
 * conditional UPDATEs checked via meta.changes, never a SELECT-then-UPDATE
 * pair.
 */
export const SQL = {
  inviteByCode: "SELECT code, used_at, expires_at, user_id, email, consent_at FROM invites WHERE code = ?1",
  // Spent means used_at is set. used_by is unlinked when an account is
  // deleted (the row it referenced is gone), and a code must not come back to
  // life because of that. The expiry is checked here too, so a link that ran
  // out between the page's check and the submit still spends nothing.
  burnInvite:
    "UPDATE invites SET used_by = ?2, used_at = ?3 WHERE code = ?1 AND used_at IS NULL AND (expires_at IS NULL OR expires_at > ?3)",
  userByEmail:
    "SELECT id, email, created_at, password_hash, password_salt, password_iters, budget_usd, session_epoch, doc_allowance, doc_used FROM users WHERE email = ?1",
  userById:
    "SELECT id, email, created_at, password_hash, password_salt, password_iters, budget_usd, session_epoch, doc_allowance, doc_used FROM users WHERE id = ?1",
  insertUser:
    "INSERT INTO users (id, email, created_at, password_hash, password_salt, password_iters) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  // The account a mailed link opens (src/signup.ts): the address is the one
  // the link went to, so it is verified at birth, and the consent is the one
  // given on the form that asked for the mail.
  insertVerifiedUser:
    "INSERT INTO users (id, email, created_at, password_hash, password_salt, password_iters, consent_at, email_verified_at) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
  setPassword: "UPDATE users SET password_hash = ?2, password_salt = ?3, password_iters = ?4 WHERE id = ?1",
  // End every session of the account: cookies carry the number they were
  // minted under, and requireSession refuses one that is not the row's.
  // RETURNING, so the caller can mint the one session that goes on living
  // (the set-password link's) under the new number without a second read.
  bumpSessionEpoch: "UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?1 RETURNING session_epoch",
  deleteUser: "DELETE FROM users WHERE id = ?1",
  // The per-person ceiling, set by the operator against an e-mail — the id
  // is not something they have to hand. NULL puts the account back on
  // PORTAL_USD_LIMIT; tools/scripts/moje-krev-budget.mjs writes both.
  setUserBudget: "UPDATE users SET budget_usd = ?2 WHERE email = ?1",

  // The codes the worker mails (src/signup.ts). Bound to an account when the
  // address has one — a set-password link, exactly what --email mints — and
  // otherwise carrying the address and the consent, so using it opens the
  // account for that address and no other.
  insertBoundInvite: "INSERT INTO invites (code, note, created_at, expires_at, user_id) VALUES (?1, ?2, ?3, ?4, ?5)",
  insertPendingInvite:
    "INSERT INTO invites (code, note, created_at, expires_at, email, consent_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",

  // Mails asked for per IP hash (src/ratelimit.ts): the same shape as the
  // login failures, one row per request, pruned as they age out of the day.
  countSignupAttempts: "SELECT COUNT(*) AS n FROM signup_attempts WHERE ip_hash = ?1 AND at > ?2",
  insertSignupAttempt: "INSERT INTO signup_attempts (ip_hash, at) VALUES (?1, ?2)",
  pruneSignupAttempts: "DELETE FROM signup_attempts WHERE at < ?1",

  // Login failures per e-mail, whether or not the e-mail has an account:
  // the lockout must not be the one place that says which addresses exist.
  countLoginFailures: "SELECT COUNT(*) AS n FROM login_failures WHERE email = ?1 AND at > ?2",
  insertLoginFailure: "INSERT INTO login_failures (email, at) VALUES (?1, ?2)",
  pruneLoginFailures: "DELETE FROM login_failures WHERE at < ?1",
  clearLoginFailures: "DELETE FROM login_failures WHERE email = ?1",

  // Reports: the payload column is the lossless LabReport the client built;
  // the worker stores and returns it and never reads a value out of it.
  reportsForUser: "SELECT id, payload FROM reports WHERE user_id = ?1 ORDER BY report_date, created_at",
  reportOwner: "SELECT id, user_id FROM reports WHERE id = ?1",
  // The WHERE on the conflict branch is the owner check for an id that
  // already exists: a foreign id updates nothing, and meta.changes says so.
  upsertReport:
    "INSERT INTO reports (id, user_id, report_date, lab_name, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
    "ON CONFLICT(id) DO UPDATE SET report_date = excluded.report_date, lab_name = excluded.lab_name, payload = excluded.payload " +
    "WHERE reports.user_id = ?2",
  deleteReport: "DELETE FROM reports WHERE id = ?1 AND user_id = ?2",
  pagesForReport: "SELECT page_num, kv_key, width, height FROM report_pages WHERE report_id = ?1 ORDER BY page_num",
  upsertPage:
    "INSERT INTO report_pages (report_id, page_num, kv_key, width, height) VALUES (?1, ?2, ?3, ?4, ?5) " +
    "ON CONFLICT(report_id, page_num) DO UPDATE SET kv_key = excluded.kv_key, width = excluded.width, height = excluded.height",
  deletePages: "DELETE FROM report_pages WHERE report_id = ?1",
  settingsForUser: "SELECT settings FROM users WHERE id = ?1",
  saveSettings: "UPDATE users SET settings = ?2 WHERE id = ?1",

  // Synonyms taught by anyone, read by everyone. The last teacher of a name
  // wins the row; a delete is the teacher's alone.
  allSynonyms: "SELECT raw_name, canonical_id, taught_by FROM synonyms ORDER BY created_at",
  upsertSynonym:
    "INSERT INTO synonyms (raw_name, canonical_id, taught_by, created_at) VALUES (?1, ?2, ?3, ?4) " +
    "ON CONFLICT(raw_name) DO UPDATE SET canonical_id = excluded.canonical_id, taught_by = excluded.taught_by, created_at = excluded.created_at",
  deleteSynonym: "DELETE FROM synonyms WHERE raw_name = ?1 AND taught_by = ?2",

  // AI konzultace: the snapshot is stored as sent and served as stored. The
  // public read is by hash only — the row never says whose it is to the
  // reader, and the worker never inspects the text.
  insertShare:
    "INSERT INTO ai_shares (token_hash, user_id, snapshot, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  shareByHash: "SELECT snapshot, expires_at, revoked_at FROM ai_shares WHERE token_hash = ?1",
  liveShareForUser:
    "SELECT expires_at FROM ai_shares WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2 ORDER BY created_at DESC LIMIT 1",
  revokeSharesForUser: "UPDATE ai_shares SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL",
  // The live link's text replaced in place: the URL the person may already
  // have pasted somewhere keeps working, now with the newer text.
  updateLiveShare: "UPDATE ai_shares SET snapshot = ?2 WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?3",

  // Account deletion, in the order the foreign keys allow. Everything an
  // account owns is reachable from these, plus the failure counter keyed by
  // its e-mail; there is nothing else.
  pageKeysForUser: "SELECT p.kv_key FROM report_pages p JOIN reports r ON r.id = p.report_id WHERE r.user_id = ?1",
  deletePagesForUser: "DELETE FROM report_pages WHERE report_id IN (SELECT id FROM reports WHERE user_id = ?1)",
  deleteReportsForUser: "DELETE FROM reports WHERE user_id = ?1",
  deleteSharesForUser: "DELETE FROM ai_shares WHERE user_id = ?1",
  unlinkInvites: "UPDATE invites SET used_by = NULL, user_id = NULL WHERE used_by = ?1 OR user_id = ?1",
  // The taught spellings outlive the teacher: the fact is the app's, the
  // link to the account is what the deletion removes.
  unlinkSynonyms: "UPDATE synonyms SET taught_by = NULL WHERE taught_by = ?1",
  deleteDocumentsForUser: "DELETE FROM documents WHERE user_id = ?1",
  // A payment's record stays; whose it was does not.
  unlinkPurchases: "UPDATE purchases SET user_id = NULL WHERE user_id = ?1",

  // Documents (src/allowance.ts). Inserting the row is the claim on the id —
  // OR IGNORE and meta.changes say whether this call was the one that made
  // it — and the conditional UPDATE on the user row is the claim on the
  // slot: it moves doc_used only while one is left.
  insertDocument: "INSERT OR IGNORE INTO documents (id, user_id, created_at) VALUES (?1, ?2, ?3)",
  documentById: "SELECT id, user_id, pages_sent, pages_read, pages_failed, released_at FROM documents WHERE id = ?1",
  deleteDocument: "DELETE FROM documents WHERE id = ?1",
  takeDocument: "UPDATE users SET doc_used = doc_used + 1 WHERE id = ?1 AND doc_used < doc_allowance",
  // One page more on this document, if it is the owner's, still open, and
  // under the page cap. Zero changes is any of the three, refused.
  sendPage:
    "UPDATE documents SET pages_sent = pages_sent + 1 WHERE id = ?1 AND user_id = ?2 AND released_at IS NULL AND pages_sent < ?3",
  notePageRead: "UPDATE documents SET pages_read = pages_read + 1 WHERE id = ?1",
  notePageFailed: "UPDATE documents SET pages_failed = pages_failed + 1 WHERE id = ?1",
  // The slot goes back only for a document nothing was read from, and only
  // once every page sent has come back failed — a page still out at the
  // extractor (sent, neither read nor failed) keeps the slot, because its
  // read may yet land. The conditional UPDATE is what makes a second release,
  // one after a read, or one fired while pages are in flight change nothing.
  releaseDocument:
    "UPDATE documents SET released_at = ?3 WHERE id = ?1 AND user_id = ?2 AND pages_read = 0 AND pages_failed = pages_sent AND released_at IS NULL",
  giveBackDocument: "UPDATE users SET doc_used = doc_used - 1 WHERE id = ?1 AND doc_used > 0",
  allowanceForUser: "SELECT doc_allowance, doc_used FROM users WHERE id = ?1",

  // Purchases (src/stripe.ts): the event id is the idempotency key.
  insertPurchase:
    "INSERT OR IGNORE INTO purchases (event_id, user_id, package, amount_czk, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  creditDocuments: "UPDATE users SET doc_allowance = doc_allowance + ?2 WHERE id = ?1",

  // „Napište nám" (src/helpdesk.ts): stored whole, read by the operator with
  // tools/scripts/moje-krev-helpdesk.mjs. The worker never reads one back.
  insertMessage:
    "INSERT INTO messages (id, created_at, user_id, email, text, report_id, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  // The account's messages go with it; the fact that someone wrote stays
  // useless without the address, so the row is deleted, not unlinked.
  deleteMessagesForUser: "DELETE FROM messages WHERE user_id = ?1",
  // The privacy page's „do odpovědi a 12 měsíců po ní": an answered message
  // goes a year after the answer (src/watch.ts); an open one stays.
  pruneAnsweredMessages: "DELETE FROM messages WHERE answered_at IS NOT NULL AND answered_at < ?1",

  // Refusals the worker answered (src/events.ts): a route, a status, a code,
  // a hash of the account. Read newest-first beside a help-desk message, and
  // pruned by the scheduled check after 30 days.
  insertEvent:
    "INSERT INTO events (id, at, route, status, code, user_hash, request_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  eventsForUser: "SELECT at, route, status, code FROM events WHERE user_hash = ?1 ORDER BY at DESC LIMIT 20",
  recentEvents: "SELECT at, route, status, code FROM events ORDER BY at DESC LIMIT 20",
  pruneEvents: "DELETE FROM events WHERE at < ?1",
} as const;

export interface EventRow {
  at: number;
  route: string;
  status: number;
  code: string | null;
}

export interface ReportRow {
  id: string;
  payload: string;
}

export interface PageRow {
  page_num: number;
  kv_key: string;
  width: number | null;
  height: number | null;
}

export interface UserRow {
  id: string;
  email: string;
  created_at: string;
  /** All three null for an account that has never set a password. */
  password_hash: string | null;
  password_salt: string | null;
  password_iters: number | null;
  /**
   * This account's monthly ceiling in USD, or null to follow
   * PORTAL_USD_LIMIT. Zero is a value, not an absence — see `limitFor`.
   */
  budget_usd: number | null;
  /** The generation of sessions that is live; a cookie names one. */
  session_epoch: number;
  /** Documents this account may open in all: 5 free plus what was bought or granted. */
  doc_allowance: number;
  /** Documents it has opened for extraction; never lowered by a deletion. */
  doc_used: number;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  pages_sent: number;
  pages_read: number;
  /** Pages the extractor answered with anything but a read; sent − read − failed is in flight. */
  pages_failed: number;
  released_at: string | null;
}

export interface InviteRow {
  code: string;
  used_at: string | null;
  /** ISO 8601; null on codes minted before links expired. */
  expires_at: string | null;
  /** Set on a set-password link; null on a sign-up link. */
  user_id: string | null;
  /** The address a mailed sign-up code went to; null on an operator's code. */
  email: string | null;
  /** When that address consented on the registration form; null otherwise. */
  consent_at: string | null;
}

export interface AiShareRow {
  snapshot: string;
  expires_at: number;
  revoked_at: number | null;
}

export interface SynonymRow {
  raw_name: string;
  canonical_id: string;
  taught_by: string | null;
}
