/**
 * The scheduled check: is the app up, is the extractor up, how much has it
 * spent — and a line in Telegram when the answer changes.
 *
 * Runs every 15 minutes from the cron trigger in wrangler.jsonc. Three
 * questions, each answered from what a Worker can actually see:
 *
 *   1. The shell. GET `APP_URL/` and `APP_URL/api/processors` — the second
 *      goes shell → this worker → extractor, so a 200 there is the whole
 *      chain answering, not a static page. Anything but 200 on either is
 *      „aplikace neodpovídá".
 *   2. The extractor, directly, through the service binding's /api/status.
 *      Unreachable or non-200 is „extraktor neodpovídá".
 *   3. The extractor's spend, out of the same /api/status — its `budget` is
 *      the capability ledger, spend and ceiling. This worker has the ledger's
 *      KV bound too (BUDGET, for the per-person counters), but reading the
 *      extractor's shards here would restate @bw/gate's key scheme in a
 *      second place; asking the worker that owns them is the honest way.
 *
 * No alert storm. Up/down is remembered in KV and only a change posts — a
 * down line once, then a recovery line once. A spend threshold (80 %, then
 * 100 %) posts once per calendar month; the memory of that is in KV with a
 * two-month expiry. The state lives in the BUDGET namespace under `ops_`
 * keys rather than a new namespace: it is a handful of small counters of
 * the same kind that already live there (`pages_<sid>`, `user_spend_*`),
 * and PAGES is the person's images — nothing but a page belongs in it.
 *
 * The D1 export is not something a Worker can do or see; the handoff says
 * how it runs from Ondřej's machine. Without the Telegram secrets every
 * check still runs and logs its result.
 */
import { pruneEvents } from "./events";
import { notify, type TelegramEnv } from "./telegram";
import { triage, formatTriage, type TriageEnv } from "./triage";

export interface WatchEnv extends TelegramEnv, TriageEnv {
  DB: D1Database;
  BUDGET: KVNamespace;
  EXTRACT: Fetcher;
  TELEGRAM_OPS_CHAT?: string;
  /** The shell's public origin, e.g. https://moje-krev.example.workers.dev. Unset skips the app check. */
  APP_URL?: string;
}

/** Spend thresholds, in percent of the extractor's ceiling, each posted once a month. */
export const SPEND_THRESHOLDS = [80, 100] as const;

const STATE_KEY = (what: "app" | "extract") => `ops_state_${what}`;
const ALERTED_KEY = (month: string, pct: number) => `ops_budget_alerted_${month}_${pct}`;
/** A month's threshold memory outlives the month by a margin, then goes. */
const ALERTED_TTL = 62 * 86400;
const TIMEOUT_MS = 15_000;

type UpDown = "up" | "down";

export interface WatchReport {
  app: UpDown | "skipped";
  extract: UpDown;
  /** Spend as a percentage of the ceiling, or null when the extractor did not say. */
  spendPct: number | null;
  /** Every line posted (or logged) this run, in order. */
  posted: string[];
  pruned: number;
}

const czUsd = (n: number) => n.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** GET one URL; the status, or 0 when it did not answer. */
async function probe(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.status;
  } catch {
    return 0;
  }
}

const said = (status: number) => (status === 0 ? "bez odpovědi" : String(status));

/** Post to the ops chat when the state changed; remember the new state. */
async function transition(env: WatchEnv, what: "app" | "extract", now: UpDown, down: string, up: string, report: WatchReport): Promise<void> {
  const before = ((await env.BUDGET.get(STATE_KEY(what))) as UpDown | null) ?? "up";
  if (before === now) return;
  await env.BUDGET.put(STATE_KEY(what), now);
  const line = now === "down" ? down : up;
  report.posted.push(line);
  await notify(env, env.TELEGRAM_OPS_CHAT, line);
  if (now === "down") {
    const guess = await triage(env, { kind: "ops", text: line, userHash: null, extractor: null });
    if (guess) {
      const t = formatTriage(guess);
      report.posted.push(t);
      await notify(env, env.TELEGRAM_OPS_CHAT, t);
    }
  }
}

export async function runWatch(env: WatchEnv, now = new Date()): Promise<WatchReport> {
  const report: WatchReport = { app: "skipped", extract: "up", spendPct: null, posted: [], pruned: 0 };

  // 1. The shell, end to end.
  const origin = env.APP_URL?.trim().replace(/\/+$/, "");
  if (origin) {
    const [shell, chain] = await Promise.all([probe(`${origin}/`), probe(`${origin}/api/processors`)]);
    report.app = shell === 200 && chain === 200 ? "up" : "down";
    await transition(
      env,
      "app",
      report.app,
      `Moje krev — aplikace neodpovídá: GET / → ${said(shell)}, GET /api/processors → ${said(chain)}.`,
      `Moje krev — aplikace zase odpovídá (GET / → 200, GET /api/processors → 200).`,
      report,
    );
  } else {
    console.log("watch: APP_URL unset, the shell is not probed");
  }

  // 2. The extractor, and 3. its spend, from one answer.
  const res = await env.EXTRACT.fetch(new Request("https://extract/api/status")).catch(() => null);
  const status = res?.status ?? 0;
  report.extract = status === 200 ? "up" : "down";
  await transition(
    env,
    "extract",
    report.extract,
    `Moje krev — extraktor neodpovídá: GET /api/status → ${said(status)}.`,
    `Moje krev — extraktor zase odpovídá (GET /api/status → 200).`,
    report,
  );

  if (res && status === 200) {
    const data = (await res.json().catch(() => ({}))) as { budget?: { spentUsd?: number; budgetUsd?: number; frozen?: boolean } };
    const spent = data.budget?.spentUsd;
    const limit = data.budget?.budgetUsd;
    if (typeof spent === "number" && typeof limit === "number" && limit > 0) {
      const pct = (spent / limit) * 100;
      report.spendPct = Math.round(pct * 10) / 10;
      const month = now.toISOString().slice(0, 7);
      for (const threshold of SPEND_THRESHOLDS) {
        if (pct < threshold) continue;
        const key = ALERTED_KEY(month, threshold);
        if (await env.BUDGET.get(key)) continue;
        await env.BUDGET.put(key, now.toISOString(), { expirationTtl: ALERTED_TTL });
        const line =
          threshold >= 100
            ? `Moje krev — extraktor je zamrzlý: útrata ${czUsd(spent)} z ${czUsd(limit)} USD. Každé nahrání teď odpovídá „společný limit je vyčerpán". Ledger se sám nenuluje — docs/moje-krev-handoff.md, „Ledger extraktoru".`
            : `Moje krev — útrata extraktoru ${czUsd(spent)} z ${czUsd(limit)} USD (${Math.floor(pct)} %). Nový účet stojí nejvýš 1,50 USD; při 100 % nahrávání zamrzne pro všechny.`;
        report.posted.push(line);
        await notify(env, env.TELEGRAM_OPS_CHAT, line);
        const guess = await triage(env, {
          kind: "ops",
          text: line,
          userHash: null,
          extractor: { status, spentUsd: spent, budgetUsd: limit, frozen: data.budget?.frozen ?? pct >= 100 },
        });
        if (guess) {
          const t = formatTriage(guess);
          report.posted.push(t);
          await notify(env, env.TELEGRAM_OPS_CHAT, t);
        }
      }
    }
  }

  // Housekeeping that rides along: the events table forgets its month.
  try {
    report.pruned = await pruneEvents(env, Math.floor(now.getTime() / 1000));
  } catch (e) {
    console.error(`watch: events not pruned: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
  }

  console.log(JSON.stringify({ watch: { app: report.app, extract: report.extract, spendPct: report.spendPct, posted: report.posted.length, pruned: report.pruned } }));
  return report;
}
