/**
 * Booting the built portal in a real browser, with the account faked.
 *
 * The portal is cookie-authenticated and its data lives in D1 and KV, none
 * of which a layout audit needs: it needs screens with realistic content in
 * them. So the built app is served by `vite preview`, whose /api proxy is
 * pointed at a small server here that answers as the worker would for one
 * logged-in person holding the synthetic demo patient's ten reports (the
 * identity fields emptied, the page images served from the demo's own
 * PNGs). No login, no network, no secrets — and the same screens the family
 * will see.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { Harness } from "./harness";

const ROOT = join(import.meta.dirname, "../../..");
const DEMO = join(ROOT, "apps/bloodwork/public/demo");

/** The demo patient as the portal stores them: no name, no number, pages by route. */
function demoReports(): { reports: unknown[]; pages: Map<string, string> } {
  const raw = JSON.parse(readFileSync(join(DEMO, "reports.json"), "utf-8")) as Array<Record<string, any>>;
  const pages = new Map<string, string>();
  const reports = raw.map((r) => ({
    ...r,
    patientName: null,
    patientId: null,
    pages: (r.pages as Array<Record<string, any>>).map((p) => {
      pages.set(`${r.id}/${p.pageNum}`, join(ROOT, "apps/bloodwork/public", p.imageUrl));
      return { pageNum: p.pageNum, imageWidth: p.imageWidth, imageHeight: p.imageHeight, imageUrl: `/api/pages/${r.id}/${p.pageNum}` };
    }),
  }));
  return { reports, pages };
}

function fakeApi(port: number): Promise<Server> {
  const { reports, pages } = demoReports();
  const json = (res: import("node:http").ServerResponse, data: unknown, status = 200) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const m = url.pathname.match(/^\/api\/pages\/([^/]+)\/(\d+)$/);
    if (req.method === "GET" && m) {
      const file = pages.get(`${m[1]}/${m[2]}`);
      if (!file) return json(res, { error: "not_found" }, 404);
      res.writeHead(200, { "content-type": "image/png" });
      return res.end(readFileSync(file));
    }
    switch (`${req.method} ${url.pathname}`) {
      case "GET /api/me":
        return json(res, { email: "audit@example.com", createdAt: "2026-01-01T00:00:00Z" });
      case "GET /api/status":
        return json(res, { budget: { spentUsd: 0.12, budgetUsd: 5, frozen: false, remainingUsd: 4.88, month: "2026-08" }, maxPages: 30 });
      case "GET /api/settings":
        return json(res, {});
      case "GET /api/reports":
        return json(res, reports);
      case "POST /api/auth/logout":
        res.writeHead(204);
        return res.end();
    }
    // Writes are acknowledged and forgotten; the audit reads, it does not keep.
    if (req.method === "PUT" || req.method === "DELETE") return json(res, { ok: true });
    return json(res, { error: "not_found" }, 404);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
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

export async function startPortal(port: number, apiPort = port + 100): Promise<Harness> {
  const api = await fakeApi(apiPort);
  const base = `http://localhost:${port}/`;
  const server: ChildProcess = spawn(
    "npx",
    ["vite", "preview", "--config", "apps/portal/vite.config.ts", "--port", String(port), "--strictPort"],
    { stdio: "ignore", detached: false, env: { ...process.env, PORTAL_API: `http://127.0.0.1:${apiPort}` } },
  );
  await waitForServer(base);
  const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

  return {
    /** Open the portal and wait until the account's data has rendered. */
    async open(viewport) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(base, { waitUntil: "load" });
      await page.waitForSelector(".watch", { timeout: 20_000 });
      (page as any).__errors = errors;
      return page;
    },
    async stop() {
      await browser?.close();
      server?.kill();
      api.close();
    },
  };
}

export type { Page };
