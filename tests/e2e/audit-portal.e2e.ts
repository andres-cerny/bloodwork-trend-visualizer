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

/**
 * The Souhrn table rows, at the width they are read at. Under 820px the row
 * carries the chart's sketch inside its "graf →" link — the sketch must sit
 * inside the row's box (a stretched svg or a wrapped word would leave it),
 * the link's tap box must be the 44px a thumb needs, and the row may not
 * have grown for it by more than the few pixels the stack costs over the
 * value and its unit (57 → 61 at 360; 64 is the ceiling). Above 820px the
 * sketch is gone and the Průběh column is the 104×30 it always was — the
 * desktop is proven untouched, not assumed.
 */
async function expectSketchRows(page: Page) {
  const { width } = page.viewportSize()!;
  const rows = page.locator("#sum-table-out tbody tr");
  // The two rows above the fold; the rest are display: none on a phone.
  const n = Math.min(await rows.count(), 2);
  expect(n, "out-of-range rows to measure").toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const box = (await row.boundingBox())!;
    if (width < 820) {
      const sketch = await row.locator(".sum-sketch .spark").boundingBox();
      expect(sketch, `row ${i}: the phone row carries the sketch`).not.toBeNull();
      expect(sketch!.x, `row ${i}: sketch left edge`).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(sketch!.x + sketch!.width, `row ${i}: sketch right edge`).toBeLessThanOrEqual(box.x + box.width + 0.5);
      expect(sketch!.y, `row ${i}: sketch top edge`).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(sketch!.y + sketch!.height, `row ${i}: sketch bottom edge`).toBeLessThanOrEqual(box.y + box.height + 0.5);
      expect(sketch!.width, `row ${i}: sketch wide enough to read`).toBeGreaterThanOrEqual(46);
      const go = (await row.locator(".sum-go").boundingBox())!;
      expect(go.height, `row ${i}: graf → tap box`).toBeGreaterThanOrEqual(44);
      expect(box.height, `row ${i}: the row did not grow for the sketch`).toBeLessThanOrEqual(64);
      expect(await row.locator(".sparkbtn").isVisible(), `row ${i}: the desktop's Průběh cell is hidden`).toBe(false);
    } else {
      expect(await row.locator(".sum-sketch").isVisible(), `row ${i}: no sketch in the link on a desktop`).toBe(false);
      const spark = (await row.locator(".sparkbtn .spark").boundingBox())!;
      expect([Math.round(spark.width), Math.round(spark.height)], `row ${i}: the Průběh sparkline`).toEqual([104, 30]);
    }
  }
  const sideways = await page.locator("#sum-table-out").evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth);
  expect(sideways, "the out-of-range table scrolls sideways").toBe(0);
}

// Souhrn is the landing tab since Přehled was dropped — its tile wall said
// what the summary groups and tables already say.
const SOUHRN: Screen = {
  name: "souhrn (výchozí)",
  go: async () => {},
  check: async (page) => {
    await expectSketchRows(page);
    // The clause about what the model does moved to /soukromi; under the
    // summary it was a footnote to every tab.
    expect(await page.getByText(/deterministický kód/).count(), "no model clause under Souhrn").toBe(0);
  },
};

const SCREENS: Screen[] = [
  // The door, as the two links the operator sends open it. The login form
  // itself shares these classes and this card; the fake API answers /api/me,
  // so it cannot be reached here without a second server, and is not.
  { name: "registrace (živý odkaz)", at: { path: "/registrace?kod=audit-registrace", ready: ".door form" }, go: async () => {} },
  { name: "heslo (živý odkaz)", at: { path: "/heslo?kod=audit-heslo", ready: ".door form" }, go: async () => {} },
  { name: "registrace (mrtvý odkaz)", at: { path: "/registrace?kod=mrtvy", ready: ".door .notice" }, go: async () => {} },
  {
    // The public page, logged out. The model's clause — what it transcribes
    // and what it never computes — moved here from under Souhrn, so this is
    // where it must be.
    name: "soukromí",
    at: { path: "/soukromi", ready: ".privacy h1" },
    go: async () => {},
    check: async (page) => {
      expect(await page.getByText(/^Hodnoty, jednotky i meze počítá deterministický kód, ne model\./).count()).toBe(1);
    },
  },
  SOUHRN,
  {
    // A new account's first screen: one report, nothing to compare it with.
    // The account's reports are cut to the demo's latest — four rows out of
    // range — and Souhrn must list them rather than say it needs two draws
    // (it did, until 2026-09-19). The change columns are absent, the "i"
    // follows every name, and the head says whose values these are.
    name: "souhrn (jediný report)",
    prepare: async (page) => {
      await withAbout(page);
      await page.route("**/api/reports", async (route) => {
        const res = await route.fetch();
        const all = (await res.json()) as Array<{ reportDate: string | null }>;
        const latest = [...all].sort((a, b) => (a.reportDate ?? "").localeCompare(b.reportDate ?? "")).at(-1);
        await route.fulfill({ response: res, json: latest ? [latest] : [] });
      });
    },
    go: async (page) => {
      await page.waitForSelector("#sum-table-out", { timeout: 10_000 });
      await page.waitForTimeout(250);
    },
    check: async (page) => {
      const out = page.locator("#sum-table-out tbody tr");
      expect(await out.count(), "the latest report's out-of-range rows").toBe(4);
      expect(await page.locator("#sum-table-in tbody tr").count(), "and its in-range rows").toBeGreaterThan(0);
      expect(await page.getByText(/jediný odběr · /).first().isVisible(), "the head names the one draw").toBe(true);
      expect(await page.getByText("Změna od minule").count(), "no change column with one draw").toBe(0);
      expect(await page.getByText("Zatím není dost měření").count()).toBe(0);
      // Every name keeps its "i" — the same count of names and buttons.
      const names = await page.locator(".sum-table .sum-name").count();
      expect(await page.locator(".sum-table .about-btn").count(), "an i after every name").toBe(names);
      expect(names).toBeGreaterThan(4);
      // The tables sit in a scroll box, which the overflow invariant does not
      // see into; the flag chip at every width scrolled it 29 px at 360.
      for (const id of ["sum-table-out", "sum-table-in"]) {
        const sideways = await page.locator(`#${id}`).evaluate((t) => t.parentElement!.scrollWidth - t.parentElement!.clientWidth);
        expect(sideways, `${id} scrolls sideways`).toBe(0);
      }
      // One point is not a course: no sketch at either width, and the link
      // keeps the phone's 44px on its own.
      expect(await page.locator(".sum-table .sum-sketch").count(), "no sketch under one report").toBe(0);
      if (page.viewportSize()!.width < 820) {
        const go = (await page.locator("#sum-table-out .sum-go").first().boundingBox())!;
        expect(go.height, "graf → tap box with one report").toBeGreaterThanOrEqual(44);
      }
    },
  },
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
    // The mapping model's turn. It ran on its own at load — the fake API
    // answers with a catalog id the evidence lets through, so the applied
    // banner with its way back is already there — and "Zeptat se znovu" asks
    // about the names still waiting, which lays out the in-flight state and
    // the answers on the cards.
    name: "přiřazení (návrh modelu)",
    go: async (page) => {
      await tab(page, "Přiřazení");
      await page.waitForTimeout(400);
      await page.locator("#tabpanel-mapping").getByRole("button", { name: "Zeptat se znovu" }).click();
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
    // The ✕ on a stored report opens a "Smazat / Zrušit" pair in its row.
    // The list is a scroll box, so a row that outgrows it does not fail the
    // overflow invariant — it scrolls sideways, clips Zrušit and pushes the
    // next row's ✕ out of reach, which is what happened at 360 and 414 on
    // 2026-09-19. Measured here directly, because a scroll box hides it.
    name: "reporty (mazání reportu potvrzované)",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator(".reportlist .rl-x").first().click();
      await page.getByRole("button", { name: "Zrušit", exact: true }).waitFor();
      const sideways = await page.locator("ul.reportlist").evaluate((ul) => ul.scrollWidth - ul.clientWidth);
      if (sideways > 0) throw new Error(`the report list scrolls sideways by ${sideways}px with a row's delete confirmation open`);
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

/**
 * A sixth width, for one screen: 414 is the wider iPhone, and the sketch
 * column is sized by what the names and headers leave — 46px at 360, 64 at
 * 414 — so the row is measured at both ends of that range. The sweep's five
 * widths stay five; this is one screen, not a sixth column of the matrix.
 */
const PHONE_414 = { width: 414, height: 896 };
for (const theme of ["light", "dark"] as const) {
  describe(`phone 414 · ${theme}`, () => {
    it(`${SOUHRN.name} has no layout flaws`, async () => {
      const page = await app.open(PHONE_414);
      await setTheme(page, theme);
      try {
        const flaws = await audit(page, { ignore: IGNORE });
        expect(errorsOn(page), `page errors on ${SOUHRN.name}`).toEqual([]);
        judge(`phone 414 ${theme} — ${SOUHRN.name}`, flaws);
        await expectSketchRows(page);
      } finally {
        await page.close();
      }
    }, 60_000);
  });
}

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
