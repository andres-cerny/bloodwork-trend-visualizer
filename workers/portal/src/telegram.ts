/**
 * One message to one Telegram chat, through the Bot API's sendMessage.
 *
 * This is the whole integration: no library, no webhook, no reading back.
 * The bot is Ondřej's, made with @BotFather, and the two chats it posts to
 * are his — one for help-desk messages, one for operations. Both are
 * secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_HELPDESK_CHAT`, `TELEGRAM_OPS_CHAT`),
 * and without them `notify` logs the text and reports that nothing was sent,
 * so every caller behaves the same whether the bot exists yet or not — that
 * is what lets the help desk and the watcher ship before the bot does.
 *
 * What may be posted is decided by the callers, not here: an e-mail, a
 * message's first lines, a report id, a status line. Never a value from a
 * report, never a page, never a printed name — Telegram is a third party,
 * and the privacy page does not list it as a processor of health data.
 */

export interface TelegramEnv {
  TELEGRAM_BOT_TOKEN?: string;
}

/** Telegram's own cap on one message; a longer text is cut, not refused. */
const MAX_MESSAGE = 4096;

/**
 * Post `text` to `chat`. True when Telegram accepted it, false when it was
 * not sent — no token, no chat, a refused request, a network error. Never
 * throws: a help-desk message must be stored and answered 200 whatever the
 * bot does, and the watcher must go on to its next check.
 */
export async function notify(env: TelegramEnv, chat: string | undefined, text: string): Promise<boolean> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = chat?.trim();
  if (!token || !chatId) {
    console.log(`telegram (not configured): ${text.split("\n")[0]}`);
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, MAX_MESSAGE), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // The status and nothing else: Telegram's body echoes the request, and
      // the request carried an address.
      console.error(`telegram refused: ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`telegram failed: ${e instanceof Error ? e.name : "error"}`);
    return false;
  }
}
