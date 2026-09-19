/**
 * Every portal screen, at every width, in both palettes, through the same
 * invariant set the demo is held to. This is the Phase 4 gate in
 * docs/plans/portal.md — the design is approved by this passing, not by
 * looking right at the one width it was drawn at.
 *
 *   npm run test:audit:portal
 *   AUDIT_COLLECT=out.json npm run test:audit:portal   # triage, never fails
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { audit, report, type Flaw } from "./lib/audit";
import { DESKTOP, MOBILE, SMALL, TABLET, WIDE, errorsOn, setTheme, type Harness } from "./lib/harness";
import { startPortal } from "./lib/portalHarness";

let app: Harness;
const COLLECT = process.env.AUDIT_COLLECT;
const collected: Array<{ screen: string; flaws: Flaw[] }> = [];
const FIXTURE = join(import.meta.dirname, "../../packages/lab-core/tests/fixtures/identity.pdf");

beforeAll(async () => {
  app = await startPortal(Number(process.env.AUDIT_PORT ?? 4302));
}, 120_000);

afterAll(async () => {
  await app?.stop();
  if (COLLECT) {
    const total = collected.reduce((n, c) => n + c.flaws.length, 0);
    writeFileSync(COLLECT, JSON.stringify({ total, screens: collected }, null, 2));
  }
});

function judge(label: string, flaws: Flaw[]) {
  if (COLLECT) {
    collected.push({ screen: label, flaws });
    return;
  }
  expect(flaws, report(label, flaws)).toEqual([]);
}

/**
 * Reach a tab the way a reader does at this width.
 *
 * A phone's strip carries three labels and a ⋯; the other three are one tap
 * behind it. Clicking blind would time out at 360 and 390 and pass at 1200,
 * which is the least useful failure a width sweep can produce — so the ⋯
 * gets opened when the tab is not on the strip, and the audit proves that
 * route works at every width it sweeps.
 */
const tab = async (page: Page, name: string) => {
  const t = page.getByRole("tab", { name, exact: true });
  if (!(await t.isVisible())) await page.locator(".tabs-toggle").click();
  await t.click();
};
const IGNORE = ["iframe"];

/**
 * The "i" after a parameter's name needs `about` texts on the catalog entry,
 * and the shipped registry.json may not carry them yet — the texts arrive
 * through the generator. So the sweep seeds its own: the fetch of
 * /registry.json is answered with the real file plus two sentences on every
 * entry that has none. What is audited is the button and the popover, not
 * the prose; the prose is the catalog's business.
 */
const withAbout = async (page: Page) => {
  await page.route("**/registry.json", async (route) => {
    const res = await route.fetch();
    const defs = (await res.json()) as Array<Record<string, unknown>>;
    for (const d of defs) {
      d.about ??= {
        what: `${d.displayNameCs} je látka, jejíž množství v krvi laboratoř měří.`,
        usedFor: "Používá se při posuzování funkce orgánu, který ji tvoří nebo odstraňuje.",
      };
    }
    await route.fulfill({ response: res, json: defs });
  });
};

/**
 * The popover must sit inside the viewport at every width, whole: 16px from
 * either side above 480px, and never past the right edge — the auditor
 * exempts a fixed element from its offscreen rule, so this is checked here.
 */
async function expectPopoverInView(page: Page) {
  const box = await page.locator(".about-pop").boundingBox();
  expect(box, "the popover is open").not.toBeNull();
  const { width, height } = page.viewportSize()!;
  const r = box!;
  expect(r.x, "left edge").toBeGreaterThanOrEqual(0);
  expect(r.x + r.width, "right edge").toBeLessThanOrEqual(width + 0.5);
  expect(r.y, "top edge").toBeGreaterThanOrEqual(0);
  expect(r.y + r.height, "bottom edge").toBeLessThanOrEqual(height + 0.5);
  // Its text, too: a box inside the viewport with a paragraph running past it
  // would pass the four lines above.
  const overflow = await page.locator(".about-pop").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "no horizontal overflow inside the popover").toBeLessThanOrEqual(0);
  // What it holds: the name the button announced, and the two paragraphs —
  // nothing of the person's row.
  const name = (await page.locator(".about-btn[aria-expanded='true']").getAttribute("aria-label"))?.replace(/^O parametru /, "");
  expect(await page.locator(".about-pop h4").innerText()).toBe(name);
  expect(await page.locator(".about-pop p").count()).toBe(2);
}

interface Screen {
  name: string;
  go: (page: Page) => Promise<void>;
  skip?: string[];
  /** A screen outside the logged-in shell: where to open, and what says it is up. */
  at?: { path: string; ready: string };
  /** Installed before the page navigates — a route stub the screen needs. */
  prepare?: (page: Page) => Promise<void>;
  /** Assertions of the screen's own, after the audit's invariants. */
  check?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  // The door, as the two links the operator sends open it. The login form
  // itself shares these classes and this card; the fake API answers /api/me,
  // so it cannot be reached here without a second server, and is not.
  { name: "registrace (živý odkaz)", at: { path: "/registrace?kod=audit-registrace", ready: ".door form" }, go: async () => {} },
  { name: "heslo (živý odkaz)", at: { path: "/heslo?kod=audit-heslo", ready: ".door form" }, go: async () => {} },
  { name: "registrace (mrtvý odkaz)", at: { path: "/registrace?kod=mrtvy", ready: ".door .notice" }, go: async () => {} },
  // Souhrn is the landing tab since Přehled was dropped — its tile wall said
  // what the summary groups and tables already say.
  { name: "souhrn (výchozí)", go: async () => {} },
  {
    name: "trendy (chart opened from a parameter name)",
    go: async (page) => {
      // The name is the door at every width; the sparkline only on a desktop.
      await page.locator(".sum-table .sum-name").first().click();
      await page.waitForSelector(".tc svg", { timeout: 10_000 });
      await page.waitForTimeout(300);
    },
  },
  {
    // The table under the chart: four columns, one "ověřit →" per reading,
    // and it has to be the card's width on a phone — this is the screen the
    // sideways scroll used to hide in.
    name: "trendy (tabulka hodnot otevřená)",
    go: async (page) => {
      await page.locator(".sum-table .sum-name").first().click();
      await page.waitForSelector(".tc svg", { timeout: 10_000 });
      await page.locator(".tc-table summary").first().click();
      await page.waitForTimeout(300);
    },
  },
  {
    // The "i" after a parameter's name in Souhrn, open: a popover beside the
    // name above 480px, a sheet from the bottom edge under it. The first
    // "i" on the screen is in the Zhoršilo se group, the row a reader
    // reaches first.
    name: "souhrn (o parametru otevřené)",
    prepare: withAbout,
    go: async (page) => {
      await page.locator(".about-btn").first().click();
      await page.waitForSelector(".about-pop", { timeout: 5_000 });
      await page.waitForTimeout(250);
    },
    check: expectPopoverInView,
  },
  {
    // The same "i" in the chart card's heading, over the chart: the popover
    // stacks above the plot and its hover readout.
    name: "trendy (o parametru otevřené)",
    prepare: withAbout,
    go: async (page) => {
      await page.locator(".sum-table .sum-name").first().click();
      await page.waitForSelector(".tc svg", { timeout: 10_000 });
      await page.locator(".trend-card .about-btn").first().click();
      await page.waitForSelector(".about-pop", { timeout: 5_000 });
      await page.waitForTimeout(250);
    },
    check: expectPopoverInView,
  },
  {
    name: "trendy (picker open)",
    go: async (page) => {
      await tab(page, "Trendy");
      await page.getByRole("button", { name: /Zobrazit parametr/ }).click();
      await page.waitForTimeout(250);
    },
  },
  {
    // The magnifier beside "Mimo rozmezí", open: the picker hangs under the
    // card's right edge and must stay on screen at 360.
    name: "souhrn (hledání otevřené)",
    go: async (page) => {
      await page.locator(".sum-search-btn").first().click();
      await page.waitForSelector(".picker input", { timeout: 5_000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "ověření (row selected)",
    go: async (page) => {
      await tab(page, "Ověření");
      await page.waitForTimeout(300);
      await page.locator("#tabpanel-verify tr.row-pick").nth(2).click();
      await page.waitForTimeout(600);
    },
  },
  {
    // The search beside "Přepsané řádky", open: on a desktop the table pane
    // is its own scroll box, and the picker must hang over it, not inside it.
    name: "ověření (hledání otevřené)",
    go: async (page) => {
      await tab(page, "Ověření");
      await page.waitForTimeout(300);
      await page.locator("#tabpanel-verify .sum-search-btn").click();
      await page.waitForSelector(".picker input", { timeout: 5_000 });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "přiřazení",
    go: async (page) => {
      await tab(page, "Přiřazení");
      await page.waitForTimeout(400);
    },
  },
  {
    name: "přiřazení (nový parametr)",
    go: async (page) => {
      await tab(page, "Přiřazení");
      await page.waitForTimeout(400);
      // One name waits: S_Homocystein tot., with a printed interval and a
      // unit. U_Bílkovina used to be here too and laid out the line that says
      // the lab printed no interval; it is urine, and since `trendable` the
      // mapping tab no longer asks about it.
      const found = page.locator("#tabpanel-mapping").getByRole("button", { name: "Založit nový parametr" });
      const n = await found.count();
      for (let i = 0; i < n; i++) await found.nth(i).click();
      await page.waitForTimeout(300);
    },
  },
  {
    // The mapping model's turn: the fake API answers with a catalog id the
    // evidence lets through, so this lays out the applied banner with its
    // way back, and the heading that replaces "není co řešit".
    name: "přiřazení (návrh AI)",
    go: async (page) => {
      await tab(page, "Přiřazení");
      await page.waitForTimeout(400);
      await page.locator("#tabpanel-mapping").getByRole("button", { name: "Nechat AI navrhnout přiřazení" }).click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "reporty",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.waitForTimeout(300);
    },
  },
  {
    name: "AI konzultace (bez odkazu)",
    go: async (page) => {
      await tab(page, "AI konzultace");
      await page.waitForTimeout(300);
    },
  },
  {
    name: "AI konzultace (odkaz, náhled otevřený)",
    go: async (page) => {
      await tab(page, "AI konzultace");
      await page.getByRole("button", { name: "Vytvořit odkaz pro AI" }).click();
      await page.waitForSelector(".ai-line", { timeout: 10_000 });
      await page.getByText("Co AI uvidí").click();
      await page.waitForTimeout(300);
    },
  },
  {
    // The context card, saved: the form fills, Uložit collapses it to the
    // summary line. The fake API acknowledges the PUT and keeps nothing.
    name: "AI konzultace (kontext uložený)",
    go: async (page) => {
      await tab(page, "AI konzultace");
      await page.getByRole("button", { name: "Muž" }).click();
      await page.getByLabel("Věk").selectOption("30-34");
      await page.getByLabel("Zajímá mě").selectOption("both");
      await page.getByLabel("Výška").fill("178");
      await page.getByLabel("Váha").fill("76");
      await page.getByLabel("Pohyb").fill("Silniční kolo 6–8 h týdně, 2× posilovna");
      await page.getByRole("button", { name: "Kreatin" }).click();
      await page.getByRole("button", { name: "Vitamin D" }).click();
      await page.getByLabel("Alkohol").selectOption("sometimes");
      await page.getByRole("button", { name: "Uložit a přidat k odkazu" }).click();
      await page.waitForSelector(".ctx-summary", { timeout: 10_000 });
      await page.waitForTimeout(300);
    },
  },
  {
    // The one screen with a page image and boxes over it. The upload stops
    // here for the reader's look, so the audit can reach it without the
    // extractor: the file is read in the browser, nothing is sent.
    name: "kontrola anonymizace",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator('label.drop input[type="file"]').setInputFiles(FIXTURE);
      await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
      await page.waitForTimeout(500);
    },
  },
  {
    // A box selected: its ✕ is a control too, and must be reachable and
    // uncovered at every width — a thin box puts it above the ink.
    name: "kontrola anonymizace (pole vybrané)",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator('label.drop input[type="file"]').setInputFiles(FIXTURE);
      await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "Začerněné pole 1" }).first().click();
      await page.waitForSelector(".review-x", { timeout: 5_000 });
      await page.waitForTimeout(200);
    },
  },
];

const VIEWPORTS: Array<[string, { width: number; height: number }]> = [
  ["small 360", SMALL],
  ["mobile 390", MOBILE],
  ["tablet 834", TABLET],
  ["desktop 1200", DESKTOP],
  ["wide 1512", WIDE],
];

for (const [vpName, viewport] of VIEWPORTS) {
  for (const theme of ["light", "dark"] as const) {
    describe(`${vpName} · ${theme}`, () => {
      for (const screen of SCREENS) {
        it(`${screen.name} has no layout flaws`, async () => {
          const page = await app.open(viewport, { at: screen.at, prepare: screen.prepare });
          await setTheme(page, theme);
          try {
            await screen.go(page);
            const flaws = await audit(page, { ignore: IGNORE, skip: screen.skip });
            expect(errorsOn(page), `page errors on ${screen.name}`).toEqual([]);
            judge(`${vpName} ${theme} — ${screen.name}`, flaws);
            await screen.check?.(page);
          } finally {
            await page.close();
          }
        }, 60_000);
      }
    });
  }
}
