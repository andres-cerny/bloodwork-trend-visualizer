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

interface Screen {
  name: string;
  go: (page: Page) => Promise<void>;
  skip?: string[];
  /** A screen outside the logged-in shell: where to open, and what says it is up. */
  at?: { path: string; ready: string };
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
          const page = await app.open(viewport, { at: screen.at });
          await setTheme(page, theme);
          try {
            await screen.go(page);
            const flaws = await audit(page, { ignore: IGNORE, skip: screen.skip });
            expect(errorsOn(page), `page errors on ${screen.name}`).toEqual([]);
            judge(`${vpName} ${theme} — ${screen.name}`, flaws);
          } finally {
            await page.close();
          }
        }, 60_000);
      }
    });
  }
}
