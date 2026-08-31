/**
 * The one e-mail the portal sends: a login link.
 *
 * Resend in production; in dev, with no API key configured and DEV_MAGIC_LINK
 * explicitly set, the link is returned to the caller instead of mailed. The
 * two are mutually exclusive on purpose — a deployment holding a real key
 * never echoes a login link into a response body, whatever its vars say.
 */

export interface MailEnv {
  RESEND_API_KEY?: string;
  /** Sender; Resend's onboarding address only delivers to the account owner. */
  MAIL_FROM?: string;
  /** "1" returns the link from /api/auth/login instead of sending. Dev only. */
  DEV_MAGIC_LINK?: string;
}

export type SendResult = { sent: true } | { sent: false; devLink: string } | { sent: false; error: string };

export async function sendLoginLink(env: MailEnv, to: string, link: string): Promise<SendResult> {
  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: env.MAIL_FROM ?? "Kapka <onboarding@resend.dev>",
        to: [to],
        subject: "Přihlášení do Kapky",
        text:
          `Dobrý den,\n\n` +
          `přihlásíte se otevřením tohoto odkazu (platí 15 minut):\n\n${link}\n\n` +
          `Pokud jste o přihlášení nežádali, e-mail ignorujte — bez odkazu se nikdo nepřihlásí.\n\nKapka`,
      }),
    }).catch(() => null);
    if (!res || !res.ok) return { sent: false, error: `resend_${res ? res.status : "unreachable"}` };
    return { sent: true };
  }
  if (env.DEV_MAGIC_LINK === "1") return { sent: false, devLink: link };
  return { sent: false, error: "mail_not_configured" };
}
