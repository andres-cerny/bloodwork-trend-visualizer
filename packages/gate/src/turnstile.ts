/**
 * The action name a session challenge carries, and nothing else.
 *
 * Its own module because the browser needs it too: the widget sets
 * `data-action`, the worker checks it, and two string literals in two packages
 * is exactly how they drift apart. Importing it from the gate's barrel would
 * pull the KV ledger — and `KVNamespace` — into a browser bundle, which is the
 * same boundary mistake the agent's ./events subpath exists to prevent.
 */
export const TURNSTILE_ACTION = "session";
