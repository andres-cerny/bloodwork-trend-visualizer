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

/**
 * Moje krev's four public forms, each its own action: a token solved on the
 * login form must not open registration, and the worker checks the action
 * against the form that posted it. Here for the same reason as above — the
 * widget and the worker both read them, and one spelling in two places is
 * how they part. The help desk's is the bare word it has always been; the
 * tokens Cloudflare already minted for it stay valid.
 */
export const PORTAL_TURNSTILE_ACTIONS = {
  register: "portal-register",
  login: "portal-login",
  forgot: "portal-forgot",
  helpdesk: "helpdesk",
} as const;
export type PortalTurnstileAction = (typeof PORTAL_TURNSTILE_ACTIONS)[keyof typeof PORTAL_TURNSTILE_ACTIONS];
