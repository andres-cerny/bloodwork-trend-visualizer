/**
 * Every SQL string the portal runs, as named constants.
 *
 * The constants are the contract the tests fake against: the fake D1
 * dispatches on these exact strings (the same pattern as the agent worker's
 * route tests), so a query added here without a fake branch fails loudly in
 * tests rather than silently returning nothing.
 *
 * Writes that must be single-use under a race — burning an invite, spending a
 * login token — are conditional UPDATEs checked via meta.changes, never a
 * SELECT-then-UPDATE pair.
 */
export const SQL = {
  inviteByCode: "SELECT code, used_by, used_at FROM invites WHERE code = ?1",
  // Spent means used_at is set. used_by is unlinked when an account is
  // deleted (the row it referenced is gone), and a code must not come back to
  // life because of that.
  burnInvite: "UPDATE invites SET used_by = ?2, used_at = ?3 WHERE code = ?1 AND used_at IS NULL",
  userByEmail: "SELECT id, email, created_at FROM users WHERE email = ?1",
  userById: "SELECT id, email, created_at FROM users WHERE id = ?1",
  insertUser: "INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)",
  deleteUser: "DELETE FROM users WHERE id = ?1",
  insertLoginToken:
    "INSERT INTO login_tokens (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
  loginTokenByHash:
    "SELECT token_hash, user_id, expires_at, used_at FROM login_tokens WHERE token_hash = ?1",
  spendLoginToken: "UPDATE login_tokens SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL",
  countRecentLoginTokens:
    "SELECT COUNT(*) AS n FROM login_tokens WHERE user_id = ?1 AND created_at > ?2",

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

  // Account deletion, in the order the foreign keys allow. Everything an
  // account owns is reachable from these five; there is nothing else.
  pageKeysForUser: "SELECT p.kv_key FROM report_pages p JOIN reports r ON r.id = p.report_id WHERE r.user_id = ?1",
  deletePagesForUser: "DELETE FROM report_pages WHERE report_id IN (SELECT id FROM reports WHERE user_id = ?1)",
  deleteReportsForUser: "DELETE FROM reports WHERE user_id = ?1",
  deleteTokensForUser: "DELETE FROM login_tokens WHERE user_id = ?1",
  unlinkInvites: "UPDATE invites SET used_by = NULL WHERE used_by = ?1",
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
}

export interface LoginTokenRow {
  token_hash: string;
  user_id: string;
  expires_at: number;
  used_at: number | null;
}
