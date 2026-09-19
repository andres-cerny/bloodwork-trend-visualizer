/**
 * One mail out, through Resend's HTTP API — plain text, Czech, no HTML.
 *
 * The only mail this worker sends is a link the person just asked for, so
 * the adapter is one function and one shape. Without RESEND_API_KEY the mail
 * is written to the worker's log instead and the call succeeds as if it had
 * gone: that is the local path, where the operator copies the link out of
 * `wrangler dev`'s output and opens it themselves — and src/signup.ts lets a
 * request reach this fallback only under OPEN_SIGNUP_DEV_BYPASS, because in
 * production a link in the log is a credential in observability. With the
 * key and no MAIL_FROM there is nothing valid to send as, and the call fails
 * rather than guess a sender Resend would refuse anyway.
 *
 * Tests never reach Resend: the call goes through the global fetch, which
 * the plain-node tests stub — the same seam the extractor's tests use for
 * the model APIs.
 */

export interface MailEnv {
  RESEND_API_KEY?: string;
  /** `Moje krev <noreply@…>` on a domain Resend has verified. */
  MAIL_FROM?: string;
}

const RESEND_URL = "https://api.resend.com/emails";

/** Thrown when Resend refused or could not be reached; the caller says so. */
export class MailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailError";
  }
}

export async function sendMail(env: MailEnv, to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // Local development. The link is the whole point of the mail, and this
    // is the only place it appears — never in the HTTP response.
    console.log(`[mail not sent — RESEND_API_KEY unset]\nTo: ${to}\nSubject: ${subject}\n\n${text}`);
    return;
  }
  if (!env.MAIL_FROM) throw new MailError("MAIL_FROM is unset");

  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      // Without this a hung Resend hangs the request waiting on it.
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
    });
  } catch (e) {
    throw new MailError(`Resend unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    // Resend's error body names the reason (a domain not verified, a sender
    // it does not know); the status alone would send the operator guessing.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new MailError(`Resend answered ${res.status}: ${detail}`);
  }
}
