/**
 * Every screen, at every width, in both palettes, checked for the geometric
 * defects that a state-reading test cannot see.
 *
 * This is a sweep, not a set of hand-written assertions: `audit()` knows the
 * invariants, this file knows the screens. Adding a screen to the list below
 * subjects it to all of them, and a new invariant added to the auditor is
 * enforced everywhere at once.
 *
 *   npm run test:audit
 */
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { audit, report, type Flaw } from "./lib/audit";
import { DESKTOP, MOBILE, TABLET, WIDE, errorsOn, setTheme, startApp, type Harness } from "./lib/harness";

let app: Harness;

/**
 * Triage mode. `AUDIT_COLLECT=<path> npm run test:audit` walks every screen,
 * writes one JSON file of everything it found and passes regardless — so a
 * redesign can be assessed in one run instead of one failure at a time.
 */
const COLLECT = process.env.AUDIT_COLLECT;
const collected: Array<{ screen: string; flaws: Flaw[] }> = [];

beforeAll(async () => {
  app = await startApp(Number(process.env.AUDIT_PORT ?? 4301));
}, 120_000);

afterAll(async () => {
  await app?.stop();
  if (COLLECT) {
    const total = collected.reduce((n, c) => n + c.flaws.length, 0);
    writeFileSync(COLLECT, JSON.stringify({ total, screens: collected }, null, 2));
  }
});

/** Assert a screen is clean, or bank its flaws when triaging. */
function judge(label: string, flaws: Flaw[]) {
  if (COLLECT) {
    collected.push({ screen: label, flaws });
    return;
  }
  expect(flaws, report(label, flaws)).toEqual([]);
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name });

/**
 * Cross-origin frames and the challenge widget are not ours to lay out, and
 * the browser will not let us measure inside them anyway.
 */
const IGNORE = ["iframe", ".cf-turnstile"];

/** A screen the audit visits: a name and the clicks that reach it. */
interface Screen {
  name: string;
  go: (page: Page) => Promise<void>;
  /** Rules this screen is genuinely allowed to break, with the reason. */
  skip?: string[];
}

/** Below 1080px the rail is an off-canvas drawer; its controls need it open. */
async function openRail(page: Page) {
  const toggle = page.locator("button.drawer-toggle").first();
  if ((await toggle.count()) > 0 && (await toggle.isVisible())) {
    await toggle.click();
    await page.waitForTimeout(350);
  }
}

async function closeRail(page: Page) {
  if ((await page.locator(".sidebar.open").count()) > 0) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
  }
}

async function addAnalyte(page: Page, query: string) {
  await page.getByRole("button", { name: /Přidat analyt/ }).click();
  await page.waitForTimeout(150);
  await page.getByLabel("Hledat analyt").fill(query);
  await page.waitForTimeout(150);
  const item = page.locator(".picker-item").first();
  if ((await item.count()) > 0) await item.click();
  await page.waitForTimeout(300);
}

const SCREENS: Screen[] = [
  {
    name: "trends (empty)",
    go: async () => {},
  },
  {
    name: "trends (two charts)",
    go: async (page) => {
      await addAnalyte(page, "chole");
      await addAnalyte(page, "gluk");
    },
  },
  {
    name: "trends (picker open)",
    go: async (page) => {
      await page.getByRole("button", { name: /Přidat analyt/ }).click();
      await page.waitForTimeout(250);
    },
  },
  {
    name: "summary",
    go: async (page) => {
      await tab(page, "📝 Souhrn změn").click();
      await page.waitForTimeout(300);
      // Expand the collapsed group too: a <details> body has its own layout.
      const d = page.locator("details > summary").first();
      if ((await d.count()) > 0) await d.click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: "verify (row selected)",
    go: async (page) => {
      await tab(page, "🔍 Ověření").click();
      await page.waitForTimeout(300);
      await page.locator("tr.row-pick").nth(4).click();
      await page.waitForTimeout(600);
    },
  },
  {
    name: "mapping",
    go: async (page) => {
      await tab(page, "🗂️ Přiřazení názvů").click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "mapping (everything expanded)",
    go: async (page) => {
      await tab(page, "🗂️ Přiřazení názvů").click();
      await page.waitForTimeout(400);
      // Alternatives and the occurrence tables have their own layout, and a
      // collapsed disclosure is not audited — so open every one of them.
      const more = page.getByRole("button", { name: /Další návrhy/ });
      for (let i = 0; i < (await more.count()); i++) await more.nth(i).click();
      // Visible ones only. Every tab panel is mounted now, so an unscoped
      // selector also finds the disclosures inside the hidden panels, and
      // clicking one of those times out. The intent is unchanged: open
      // everything the reader can actually see on this screen.
      const disclosures = page
        .locator("details:not([open]) > summary")
        .filter({ visible: true });
      for (let i = (await disclosures.count()) - 1; i >= 0; i--) {
        await disclosures.nth(i).click();
      }
      await page.waitForTimeout(400);
    },
  },
  {
    name: "mapping (picker open)",
    go: async (page) => {
      await tab(page, "🗂️ Přiřazení názvů").click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "Vybrat jiný analyt…" }).first().click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "chat",
    go: async (page) => {
      await tab(page, "💬 Zeptat se").click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "no patient loaded",
    go: async (page) => {
      await openRail(page);
      await page.getByRole("button", { name: "Odebrat všechny reporty" }).click();
      await page.getByRole("button", { name: "Ano, odebrat vše" }).click();
      await page.waitForTimeout(400);
      await closeRail(page);
    },
  },
];

const VIEWPORTS: Array<[string, { width: number; height: number }]> = [
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
          const page = await app.open(viewport);
          await setTheme(page, theme);
          try {
            await screen.go(page);
            // On a narrow viewport the rail is an off-canvas drawer; audit it
            // open as well, since that is the only way it is ever seen there.
            const flaws: Flaw[] = await audit(page, { ignore: IGNORE, skip: screen.skip });
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

describe("the rail as a drawer", () => {
  it("has no layout flaws when open on a phone", async () => {
    const page = await app.open(MOBILE);
    try {
      await openRail(page);
      expect(await page.locator(".sidebar.open").count(), "drawer never opened").toBe(1);
      const flaws = await audit(page, { ignore: IGNORE });
      judge("mobile drawer", flaws);
    } finally {
      await page.close();
    }
  }, 60_000);
});
