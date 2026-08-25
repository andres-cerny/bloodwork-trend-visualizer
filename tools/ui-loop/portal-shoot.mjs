/**
 * The portal tournament's camera — fixed walk, two viewports, both palettes,
 * fixture mode only (?fx=1: no session, no worker, identical pixels).
 *
 * Variant-blind: navigates by the URL affordances and test ids portal-spec.md
 * makes MUSTs, so every contestant produces the same labeled shots.
 *
 *   node tools/ui-loop/portal-shoot.mjs --base http://localhost:4173 --out shots/A
 *
 * Patient/visit/metric ids come from the committed fixture; --fixture points
 * at it so the walk never hardcodes an id the corpus could rename.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const BASE = arg("base", "http://localhost:4173");
const OUT = arg("out", "shots/x");
const FIXTURE = arg("fixture", "apps/portal/src/fixtures/portal.json");

const fx = JSON.parse(readFileSync(FIXTURE, "utf-8"));
const P = fx.patients[0].id; // the story-richest ghost is seeded first
const byP = fx.byPatient[P];
const annual = byP.visits.find((v) => v.kind === "annual" && v.hasNote);
// The ghosts have full note coverage (honest gaps belong to the real record),
// so the "gap" state is the SPARSE patient's timeline — the one whose story
// is years of nothing between visits.
const sparse = Object.entries(fx.byPatient).sort((a, b) => a[1].visits.length - b[1].visits.length)[0][0];
const labTrend = Object.keys(byP.trends).find((k) => k.startsWith("lab:"));
const perfTrend = Object.keys(byP.trends).find((k) => k.startsWith("perf:vo2max"))
  ?? Object.keys(byP.trends).find((k) => k.startsWith("perf:"));

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const STATES = [
  { name: "picker", path: "/?fx=1", viewports: [MOBILE, DESKTOP] },
  { name: "home", path: `/?fx=1&p=${P}`, viewports: [MOBILE, DESKTOP] },
  { name: "timeline", path: `/?fx=1&p=${P}&view=timeline`, viewports: [MOBILE, DESKTOP] },
  { name: "visit-annual", path: `/?fx=1&p=${P}&v=${annual?.id}`, viewports: [MOBILE, DESKTOP] },
  { name: "timeline-sparse", path: `/?fx=1&p=${sparse}&view=timeline`, viewports: [MOBILE] },
  { name: "chart-lab", path: `/?fx=1&p=${P}&t=${labTrend}`, viewports: [MOBILE, DESKTOP] },
  { name: "chart-perf", path: `/?fx=1&p=${P}&t=${perfTrend}`, viewports: [MOBILE, DESKTOP] },
  { name: "note", path: `/?fx=1&p=${P}&v=${annual?.id}`, viewports: [MOBILE],
    act: async (page) => page.getByTestId("note").first().scrollIntoViewIfNeeded() },
  // The results list with its word-sized trends. Without this state the
  // sparklines live below every framed fold, and a pass-2 critic could not
  // tell a candidate that omitted them from one that draws them.
  { name: "results-rows", path: `/?fx=1&p=${P}`, viewports: [MOBILE, DESKTOP],
    act: async (page) => page.locator('[data-testid^="row-"]').first().scrollIntoViewIfNeeded() },
  { name: "book-dead-end", path: `/?fx=1&p=${P}`, viewports: [MOBILE],
    act: async (page) => page.getByTestId("book").first().click() },
  { name: "visit-scrolled", path: `/?fx=1&p=${P}&v=${annual?.id}`, viewports: [MOBILE],
    act: async (page) => page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)) },
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
        await page.waitForTimeout(700);
        if (state.act) { await state.act(page); await page.waitForTimeout(400); }
        await page.screenshot({ path: `${OUT}/${label}.png` });
      } catch (e) {
        failures++;
        console.error(`✗ ${label}: ${e.message?.split("\n")[0]}`);
      } finally {
        await page.close();
      }
    }
  }
}

await browser.close();
console.log(failures ? `${failures} state(s) failed` : `all states shot → ${OUT}`);
process.exit(failures ? 1 : 0);
