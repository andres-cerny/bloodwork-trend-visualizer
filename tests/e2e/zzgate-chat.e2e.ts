import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { audit, type Flaw } from "./lib/audit";

const PORT = 4399;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess;
let browser: Browser;
const collected: Array<{ screen: string; flaws: Flaw[] }> = [];
const probes: any[] = [];

beforeAll(async () => {
  server = spawn("npx", ["vite", "preview", "--config", "apps/chat/vite.config.ts", "--port", String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(BASE + "/"); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
  writeFileSync("/private/tmp/claude-501/-Users-ondrejcerny-dev-bloodwork-app/7485b30d-a0f1-4736-88a6-ed94ced7e6f7/scratchpad/chat-audit.json",
    JSON.stringify({ total: collected.reduce((n, c) => n + c.flaws.length, 0), screens: collected, probes }, null, 2));
});

const VPS: Array<[string, { width: number; height: number }]> = [
  ["360", { width: 360, height: 740 }],
  ["390", { width: 390, height: 844 }],
  ["834", { width: 834, height: 1112 }],
  ["1200", { width: 1200, height: 900 }],
  ["1512", { width: 1512, height: 950 }],
];

interface S { name: string; path: string; act?: (p: Page) => Promise<void>; only?: number[] }
const SCREENS: S[] = [
  { name: "picker", path: "/" },
  { name: "empty", path: "/sport" },
  { name: "answer (hruby)", path: "/sport?fx=hruby-souhrn" },
  { name: "answer end", path: "/sport?fx=hruby-souhrn", act: async (p) => { await p.evaluate(() => { const t = document.querySelector('[data-testid="thread"]') as HTMLElement; if (t) t.scrollTop = t.scrollHeight; }); await p.waitForTimeout(400); } },
  { name: "midstream", path: "/sport?fx=hruby-souhrn&step=8" },
  { name: "chart", path: "/sport?fx=palan-graf" },
  { name: "ambiguity", path: "/orto?fx=novak-dva" },
  { name: "documents", path: "/orto?fx=vondrusak-dokumentace" },
  { name: "cohort", path: "/orto?fx=predoperacni-mimo" },
  { name: "drawer open", path: "/sport?fx=hruby-souhrn", only: [360, 390, 834], act: async (p) => { await p.getByTestId("sidebar-toggle").click(); await p.waitForTimeout(400); } },
  { name: "sources open (mobile)", path: "/orto?fx=novak-dva", only: [360, 390, 834], act: async (p) => { await p.getByTestId("sources-toggle").last().click(); await p.waitForTimeout(700); } },
  { name: "sources open (hruby, mobile)", path: "/sport?fx=hruby-souhrn", only: [360, 390, 834], act: async (p) => { await p.getByTestId("sources-toggle").last().click(); await p.waitForTimeout(700); } },
  { name: "cite focus", path: "/sport?fx=hruby-souhrn", only: [1200, 1512], act: async (p) => { await p.getByTestId("cite-1").first().click(); await p.waitForTimeout(700); } },
  { name: "source expanded", path: "/sport?fx=hruby-souhrn", only: [1200, 1512], act: async (p) => { await p.locator(".src .src-head").last().click(); await p.waitForTimeout(700); } },
];

async function open(vp: { width: number; height: number }, theme: string, path: string) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((t) => localStorage.setItem("bloodwork-theme", t as string), theme);
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.evaluate((t) => { document.documentElement.dataset.theme = t as string; }, theme);
  await page.waitForTimeout(900);
  (page as any).__errors = errors;
  return page;
}

for (const [vn, vp] of VPS) {
  for (const theme of ["light", "dark"] as const) {
    describe(`chat ${vn} · ${theme}`, () => {
      for (const s of SCREENS) {
        if (s.only && !s.only.includes(vp.width)) continue;
        it(`${s.name}`, async () => {
          const page = await open(vp, theme, s.path);
          try {
            if (s.act) await s.act(page);
            const flaws = await audit(page, { ignore: ["iframe", ".cf-turnstile"] });
            const errs = (page as any).__errors as string[];
            const probe = await page.evaluate(() => {
              const out: any = {};
              const hint = document.querySelector(".src-hint") as HTMLElement | null;
              if (hint) {
                const cs = getComputedStyle(hint);
                const card = hint.closest(".src") as HTMLElement;
                out.hint = { color: cs.color, size: cs.fontSize, cardBg: getComputedStyle(card).backgroundColor, text: hint.textContent };
              }
              const div = document.querySelector(".src-divider") as HTMLElement | null;
              if (div) {
                const list = div.parentElement as HTMLElement;
                const kids = Array.from(list.children);
                out.divider = { text: div.textContent, idx: kids.indexOf(div), n: kids.length,
                  afterCount: kids.length - 1 - kids.indexOf(div),
                  top: div.getBoundingClientRect().top, listBottom: list.getBoundingClientRect().bottom };
              }
              const labels = Array.from(document.querySelectorAll(".src")).map((c) => {
                const l = c.querySelector(".src-label") as HTMLElement;
                const h = c.querySelector(".src-head") as HTMLElement;
                return { cls: c.className, labelLeft: l ? +l.getBoundingClientRect().left.toFixed(1) : null,
                  headLeft: h ? +h.getBoundingClientRect().left.toFixed(1) : null,
                  padLeft: h ? getComputedStyle(h).paddingLeft : null,
                  padTop: h ? getComputedStyle(h).paddingTop : null,
                  hasChip: !!c.querySelector(".src-n"), label: (l?.textContent || "").slice(0, 30) };
              });
              if (labels.length) out.cards = labels;
              return out;
            });
            probes.push({ screen: `${vn} ${theme} ${s.name}`, ...probe });
            collected.push({ screen: `${vn} ${theme} — ${s.name}`, flaws: [...flaws, ...errs.map((e) => ({ rule: "page-error", where: "-", detail: e }))] });
          } finally { await page.close(); }
        }, 90_000);
      }
    });
  }
}
