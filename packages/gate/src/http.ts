/**
 * The gate both capability workers run before doing anything expensive.
 *
 * Kept identical between them on purpose: a session is valid or it is not, and
 * a ledger is frozen or it is not. What differs is only which capability's
 * ledger is asked, which is the argument.
 */
import { budgetState, verifySession, type SessionClaims } from "@bw/gate";
import type { Capability } from "@bw/gate";

export interface BaseEnv {
  BUDGET: KVNamespace;
  ANTHROPIC_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  /**
   * Hostnames this deployment serves, comma-separated. Deployment-specific on
   * purpose: production must not list localhost, or a challenge solved locally
   * mints production sessions.
   */
  TURNSTILE_HOSTNAMES?: string;
  SESSION_SECRET: string;
  BUDGET_USD_LIMIT?: string;
  MAX_PAGES_PER_SESSION?: string;
  SESSION_TTL_SECONDS?: string;
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export const budgetLimit = (env: BaseEnv) => parseFloat(env.BUDGET_USD_LIMIT ?? "20") || 20;
export const maxPages = (env: BaseEnv) => parseInt(env.MAX_PAGES_PER_SESSION ?? "12", 10) || 12;
export const sessionTtl = (env: BaseEnv) => parseInt(env.SESSION_TTL_SECONDS ?? "1800", 10) || 1800;

export async function guard(
  request: Request,
  env: BaseEnv,
  cap: Capability,
): Promise<{ blocked: Response } | { claims: SessionClaims }> {
  const token = request.headers.get("x-demo-session");
  const claims = await verifySession(env.SESSION_SECRET, token);
  if (!claims) {
    return {
      blocked: json(
        { error: "session_invalid", message: "Ověření vypršelo. Načtěte stránku znovu." },
        401,
      ),
    };
  }
  const state = await budgetState(env.BUDGET, cap, budgetLimit(env));
  if (state.frozen) {
    return {
      blocked: json(
        {
          error: "budget_exhausted",
          message: "Demo vyčerpalo svůj rozpočet na AI funkce. Ukázková data zůstávají dostupná.",
          budget: state,
        },
        402,
      ),
    };
  }
  return { claims };
}
