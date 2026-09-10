/**
 * Booting the built app in a real browser, shared by the e2e suites.
 *
 * Each suite gets its own port so vitest can run the files concurrently
 * without two preview servers fighting over one socket.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";

/*
 * Phone widths, and there are two of them on purpose.
 *
 * MOBILE is the iPhone-class 390px the design was drawn at. SMALL is the
 * 360px an Android has been since the Galaxy S line settled on it, and it is
 * the width that finds things: a card with a 310px fixed grid track inside a
 * 14px-padded column fits at 390 and pushes the whole page sideways at 360,
 * so auditing only the wider phone reported a screen as clean that scrolled
 * horizontally on the commonest handset there is.
 */
export const SMALL = { width: 360, height: 740 };
export const MOBILE = { width: 390, height: 844 };
export const TABLET = { width: 834, height: 1112 };
export const DESKTOP = { width: 1200, height: 900 };
export const WIDE = { width: 1512, height: 950 };

/**
 * Everything but the viewport, named rather than positional: the two harnesses
 * want different things of it — the demo's suites install stubs and ask for a
 * touch context, the portal's opens a screen outside the logged-in shell — and
 * a bag of optional positionals ordered by whichever landed first is how a
 * caller ends up writing `open(vp, undefined, undefined, at)`.
 */
export interface OpenOptions {
  /**
   * Runs on the fresh page *before* it navigates, which is the only moment a
   * route stub or an init script can be installed: the upload suite has to
   * answer `/api/extract` and stand in for the Turnstile widget, and both are
   * consulted during the first paint.
   */
  prepare?: (page: Page) => Promise<void>;
  /**
   * Extra browser-context options. `hasTouch` is what makes Chromium report
   * `(pointer: coarse)`, and a rule that only exists on a phone can only be
   * checked on one.
   */
  context?: { hasTouch?: boolean; isMobile?: boolean };
  /**
   * A path other than the landing screen, and the selector that says it is up
   * — for screens outside the logged-in shell, like the portal's door.
   */
  at?: { path: string; ready: string };
}

export interface Harness {
  /** Open the app and wait until it has rendered. */
  open(viewport: { width: number; height: number }, options?: OpenOptions): Promise<Page>;
  stop(): Promise<void>;
}

async function waitForServer(url: string, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > timeoutMs) throw new Error(`server never came up at ${url}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

export async function startApp(port: number): Promise<Harness> {
  const base = `http://localhost:${port}/`;
  // Serve the built app, so this tests what would actually be deployed rather
  // than the dev server's transformed output.
  // The app has its own vite config now, and `npx vite preview` from the repo
  // root would find none — it would serve the root directory as a static tree.
  const server: ChildProcess = spawn(
    "npx",
    ["vite", "preview", "--config", "apps/bloodwork/vite.config.ts", "--port", String(port)],
    {
      stdio: "ignore",
      detached: false,
    },
  );
  await waitForServer(base);
  const browser: Browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });

  return {
    /**
     * Open the app and wait until it has rendered its own data.
     *
     * NOT `waitUntil: "networkidle"`. When a Turnstile site key is configured
     * the upload panel embeds Cloudflare's widget, which holds a blob request
     * open for the life of the page — the network is never idle, so every
     * navigation times out after 30s and the whole suite fails for a reason
     * that has nothing to do with the app.
     */
    async open(viewport, options) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2, ...options?.context });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      if (options?.prepare) await options.prepare(page);
      await page.goto(options?.at ? new URL(options.at.path, base).href : base, { waitUntil: "load" });
      await page.waitForSelector(options?.at?.ready ?? ".patient-bar", { timeout: 15_000 });
      (page as any).__errors = errors;
      return page;
    },
    async stop() {
      await browser?.close();
      server?.kill();
    },
  };
}

/** Page errors collected since the page was opened. */
export const errorsOn = (page: Page): string[] => ((page as any).__errors ?? []) as string[];

/** Force a theme, bypassing the switch, so both palettes can be audited. */
export async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.waitForTimeout(120);
}
