/**
 * The gate every AI route passes through: proof a human started the session,
 * and a ledger that refuses once the demo's spend ceiling is reached.
 *
 * Shared by both capability workers. Sessions are HMAC tokens verified
 * statelessly, so two workers need no coordination beyond the same secret, and
 * the ledger is already sharded across KV keys, so two writers are no different
 * from one.
 *
 * Pricing is deliberately not here — it is pure arithmetic and lives in
 * @bw/agent-core, so that anything wanting to price a call does not drag
 * KVNamespace into a Node program.
 */
export * from "./turnstile";
export * from "./auth";
export * from "./budget";
