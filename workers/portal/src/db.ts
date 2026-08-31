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
  inviteByCode: "SELECT code, used_by FROM invites WHERE code = ?1",
  burnInvite: "UPDATE invites SET used_by = ?2, used_at = ?3 WHERE code = ?1 AND used_by IS NULL",
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
} as const;

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
