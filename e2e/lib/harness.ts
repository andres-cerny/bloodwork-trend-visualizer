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

export interface Harness {
  open(viewport: { width: number; height: number }): Promise<Page>;
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
  const server: ChildProcess = spawn("npx", ["vite", "preview", "--port", String(port)], {
    stdio: "ignore",
    detached: false,
  });
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
    async open(viewport) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(base, { waitUntil: "load" });
      await page.waitForSelector(".patient-bar", { timeout: 15_000 });
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
