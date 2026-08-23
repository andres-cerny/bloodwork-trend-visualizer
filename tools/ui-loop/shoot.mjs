/**
 * The tournament's camera: one fixed walk through the scripted states, at two
 * viewports in both palettes, against whatever variant is serving on --base.
 *
 * Variant-blind on purpose — it navigates by URL and data-testid only (see
 * spec.md), so the same shots exist for every contestant and the evaluator
 * compares like with like.
 *
 *   node tools/ui-loop/shoot.mjs --base http://localhost:4173 --out shots/A
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const BASE = arg("base", "http://localhost:4173");
const OUT = arg("out", "shots/x");

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

/** Each state: path, optional per-page actions, which viewports it exists at. */
const STATES = [
  { name: "picker", path: "/", viewports: [MOBILE, DESKTOP] },
  { name: "empty", path: "/sport", viewports: [MOBILE, DESKTOP] },
  { name: "answer", path: "/sport?fx=hruby-souhrn", viewports: [MOBILE, DESKTOP] },
  { name: "answer-end", path: "/sport?fx=hruby-souhrn", viewports: [MOBILE, DESKTOP],
    act: async (page) => page.evaluate(() => {
      const t = document.querySelector('[data-testid="thread"]');
      if (t) t.scrollTop = t.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
    }) },
  { name: "midstream", path: "/sport?fx=hruby-souhrn&step=8", viewports: [MOBILE, DESKTOP] },
  { name: "chart", path: "/sport?fx=palan-graf", viewports: [MOBILE, DESKTOP] },
  { name: "ambiguity", path: "/orto?fx=novak-dva", viewports: [MOBILE, DESKTOP] },
  { name: "drawer", path: "/sport?fx=hruby-souhrn", viewports: [MOBILE],
    act: async (page) => page.getByTestId("sidebar-toggle").click() },
  { name: "cite-focus", path: "/sport?fx=hruby-souhrn", viewports: [DESKTOP],
    act: async (page) => page.getByTestId("cite-1").first().click() },
  { name: "sources-open", path: "/orto?fx=novak-dva", viewports: [MOBILE],
    act: async (page) => page.getByTestId("sources-toggle").last().click() },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let failures = 0;

for (const theme of ["light", "dark"]) {
  for (const state of STATES) {
    for (const vp of state.viewports) {
      const label = `${state.name}-${vp === MOBILE ? "mobile" : "desktop"}-${theme}`;
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2 });
      try {
        await page.addInitScript((t) => localStorage.setItem("bloodwork-theme", t), theme);
        await page.goto(`${BASE}${state.path}`, { waitUntil: "load" });
        // Replays are synchronous after load; give charts and images a beat.
        await page.waitForTimeout(900);
        if (state.act) { await state.act(page); await page.waitForTimeout(500); }
        await page.screenshot({ path: `${OUT}/${label}.png` });
        console.log(`ok  ${label}`);
      } catch (e) {
        failures++;
        console.log(`FAIL ${label}: ${String(e).split("\n")[0]}`);
        await page.screenshot({ path: `${OUT}/${label}-FAILED.png` }).catch(() => {});
      } finally {
        await page.close();
      }
    }
  }
}
await browser.close();
console.log(failures ? `${failures} state(s) failed` : "all states captured");
process.exit(failures ? 1 : 0);
