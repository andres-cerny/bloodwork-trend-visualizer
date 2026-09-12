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
  inviteByCode: "SELECT code, used_at, expires_at, user_id FROM invites WHERE code = ?1",
  // Spent means used_at is set. used_by is unlinked when an account is
  // deleted (the row it referenced is gone), and a code must not come back to
  // life because of that. The expiry is checked here too, so a link that ran
  // out between the page's check and the submit still spends nothing.
  burnInvite:
    "UPDATE invites SET used_by = ?2, used_at = ?3 WHERE code = ?1 AND used_at IS NULL AND (expires_at IS NULL OR expires_at > ?3)",
  userByEmail:
    "SELECT id, email, created_at, password_hash, password_salt, password_iters, budget_usd FROM users WHERE email = ?1",
  userById:
    "SELECT id, email, created_at, password_hash, password_salt, password_iters, budget_usd FROM users WHERE id = ?1",
  insertUser:
    "INSERT INTO users (id, email, created_at, password_hash, password_salt, password_iters) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  setPassword: "UPDATE users SET password_hash = ?2, password_salt = ?3, password_iters = ?4 WHERE id = ?1",
  deleteUser: "DELETE FROM users WHERE id = ?1",
  // The per-person ceiling, set by the operator against an e-mail — the id
  // is not something they have to hand. NULL puts the account back on
  // PORTAL_USD_LIMIT; tools/scripts/moje-krev-budget.mjs writes both.
  setUserBudget: "UPDATE users SET budget_usd = ?2 WHERE email = ?1",

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
} as const;

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
}

export interface InviteRow {
  code: string;
  used_at: string | null;
  /** ISO 8601; null on codes minted before links expired. */
  expires_at: string | null;
  /** Set on a set-password link; null on a sign-up link. */
  user_id: string | null;
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
