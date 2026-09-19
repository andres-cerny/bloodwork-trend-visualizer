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
  // Per page load — every scene opens a fresh page, and its load is the first call.
  let mapCalls = 0;
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
        // A password login, not the public demo link: the sweep is of the
        // screens a family member sees, deletions and address included.
        return json(res, { email: "audit@example.com", createdAt: "2026-01-01T00:00:00Z", demo: false });
      case "GET /api/status":
        return json(res, { budget: { spentUsd: 0.12, budgetUsd: 5, frozen: false, remainingUsd: 4.88, month: "2026-08" }, maxPages: 30 });
      case "GET /api/settings":
        return json(res, {});
      case "GET /api/reports":
        mapCalls = 0;
        return json(res, reports);
      // Nobody has taught anything: the shipped catalog is what the sweep sees.
      case "GET /api/synonyms":
        return json(res, []);
      // The mapping model, answering for the one blood name the demo leaves
      // unmapped. It runs on its own at load, so the load's call (the first
      // after GET /api/reports) answers "medium": the name stays on its card
      // with the model's suggestion under it, which is what the mapping
      // scenes lay out. "Zeptat se znovu" asks a second time and gets "high"
      // with a unit and interval that agree, so the screen files it and shows
      // the applied banner with its way back.
      case "POST /api/map":
        mapCalls += 1;
        return json(res, {
          model: "claude-haiku-4-5",
          suggestions: [
            { rawName: "S_Homocystein tot.", decision: "catalog", canonicalId: "homocystein", proposed: null, reason: "Zkratka tot. znamená celkový homocystein.", confidence: mapCalls === 1 ? "medium" : "high" },
          ],
          costUsd: 0.004,
          budget: { spentUsd: 0.124, budgetUsd: 5, frozen: false, remainingUsd: 4.876, month: "2026-08" },
        });
      case "POST /api/auth/logout":
        res.writeHead(204);
        return res.end();
      // AI konzultace: no link on arrival; minting answers a link-shaped URL
      // with a 24-hour expiry. Nothing is stored, nothing is fetched.
      case "GET /api/ai-share":
        return json(res, null);
      case "POST /api/ai-share":
        return json(res, {
          url: `http://localhost/ai/${"k7QmR2vX9pLw3f".repeat(4).slice(0, 43)}`,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
      // The two kinds of link the operator sends, and a dead one.
      case "GET /api/auth/invite/audit-registrace":
        return json(res, { kind: "signup" });
      case "GET /api/auth/invite/audit-heslo":
        return json(res, { kind: "password" });
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/auth/invite/")) {
      return json(res, { error: "invite_invalid", message: "Odkaz už neplatí. Napište mi a pošlu nový." }, 404);
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
    async open(viewport, options) {
      const at = options?.at;
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2, ...options?.context });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      if (options?.prepare) await options.prepare(page);
      await page.goto(at ? new URL(at.path, base).href : base, { waitUntil: "load" });
      // Souhrn is the landing tab; its change tables render once the
      // account's reports have loaded and trends are built.
      await page.waitForSelector(at?.ready ?? ".sum-table", { timeout: 20_000 });
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
