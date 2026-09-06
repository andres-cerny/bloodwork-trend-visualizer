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
import { HELD_FIXTURE, startPortal } from "./lib/portalHarness";

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

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
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
    name: "trendy (picker open)",
    go: async (page) => {
      await tab(page, "Trendy").click();
      await page.getByRole("button", { name: /Přidat parametr/ }).click();
      await page.waitForTimeout(250);
    },
  },
  {
    name: "ověření (row selected)",
    go: async (page) => {
      await tab(page, "Ověření").click();
      await page.waitForTimeout(300);
      await page.locator("#tabpanel-verify tr.row-pick").nth(2).click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "přiřazení",
    go: async (page) => {
      await tab(page, "Přiřazení").click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "reporty",
    go: async (page) => {
      await tab(page, "Reporty").click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "sdílet s AI (bez odkazu)",
    go: async (page) => {
      await tab(page, "Sdílet s AI").click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "sdílet s AI (odkaz, náhled otevřený)",
    go: async (page) => {
      await tab(page, "Sdílet s AI").click();
      await page.getByRole("button", { name: "Vytvořit odkaz pro AI" }).click();
      await page.waitForSelector(".ai-line", { timeout: 10_000 });
      await page.getByText("Co AI uvidí").click();
      await page.waitForTimeout(300);
    },
  },
  {
    // The one screen with a page image and boxes over it. The upload stops
    // here for the reader's look, so the audit can reach it without the
    // extractor: the file is read in the browser, nothing is sent.
    name: "kontrola anonymizace",
    go: async (page) => {
      await tab(page, "Reporty").click();
      await page.locator('input[type="file"]').setInputFiles(FIXTURE);
      await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
      await page.waitForTimeout(500);
    },
  },
  {
    // The same file twice: the fake account holds this fixture's
    // fingerprint, so the pick stops here — two buttons, nothing opened.
    name: "nahrání (soubor už nahraný)",
    go: async (page) => {
      await tab(page, "Reporty").click();
      await page.locator('input[type="file"]').setInputFiles(HELD_FIXTURE);
      await page.waitForSelector(".job.duplicate", { timeout: 20_000 });
      await page.waitForTimeout(300);
    },
  },
  {
    // The same report from different bytes: past the review, the fake
    // extractor answers a stored report's date and laboratory, and the
    // read stops before saving with the same two buttons.
    name: "nahrání (stejné datum a laboratoř)",
    go: async (page) => {
      await tab(page, "Reporty").click();
      await page.locator('input[type="file"]').setInputFiles(FIXTURE);
      await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
      await page.getByRole("button", { name: "Ano, nahrát" }).click();
      await page.waitForSelector(".job.duplicate", { timeout: 40_000 });
      await page.waitForTimeout(300);
    },
  },
  {
    // A box selected: its ✕ is a control too, and must be reachable and
    // uncovered at every width — a thin box puts it above the ink.
    name: "kontrola anonymizace (pole vybrané)",
    go: async (page) => {
      await tab(page, "Reporty").click();
      await page.locator('input[type="file"]').setInputFiles(FIXTURE);
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
          const page = await app.open(viewport, screen.at);
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
