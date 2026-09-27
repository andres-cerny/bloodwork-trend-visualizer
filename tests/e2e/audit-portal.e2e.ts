/**
 * Every portal screen, at every width, in both palettes, through the same
 * invariant set the demo is held to. This is the Phase 4 gate in
 * docs/plans/portal.md — the design is approved by this passing, not by
 * looking right at the one width it was drawn at.
 *
 *   npm run test:audit:portal
 *   AUDIT_COLLECT=out.json npm run test:audit:portal   # triage, never fails
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { audit, report, type Flaw } from "./lib/audit";
import { DESKTOP, MOBILE, SMALL, TABLET, WIDE, errorsOn, setTheme, type Harness } from "./lib/harness";
import { png } from "./lib/imageFixtures";
import { textPdf } from "./lib/pdfFixtures";
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
 * Every link in a nav is a box of its own, 24px or taller. The tiny-target
 * rule exempts an inline link because the sentence around it is the
 * target; a link in a nav has no sentence, and until 2026-09-19 three door
 * cards and the three prose pages' „← Moje krev" rendered theirs inline,
 * 21px tall and exempt. This is the explicit floor the exemption cannot
 * reach: on every screen, whichever width.
 */
async function expectNavLinkBoxes(page: Page) {
  const links = await page.locator("nav a").evaluateAll((as) =>
    as.map((a) => {
      const r = a.getBoundingClientRect();
      return { text: a.textContent?.trim() ?? "", height: r.height, width: r.width, inline: getComputedStyle(a).display.startsWith("inline") };
    }),
  );
  for (const l of links) {
    if (l.width === 0 && l.height === 0) continue; // hidden with its panel
    expect(l.height, `nav link „${l.text}" is ${Math.round(l.height)}px tall`).toBeGreaterThanOrEqual(24);
    expect(l.inline, `nav link „${l.text}" is inline text, not a box`).toBe(false);
  }
}

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

/**
 * Cloudflare's widget never loads: the sweep is of our form, not their
 * iframe. The script URL answers with a stand-in that hands the form a token
 * at once, so a build with VITE_TURNSTILE_SITE_KEY in .env (the operator's
 * machine) sweeps the same screens as one without: the gate is "available"
 * either way and the form must get past it to show the sent sentence.
 */
const noWidget = async (page: Page) => {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.request().resourceType() === "script"
      ? route.fulfill({
          contentType: "application/javascript",
          body: `window.turnstile = { render(el, o) { el.appendChild(document.createElement("div")); setTimeout(() => o.callback("e2e-token"), 0); return "w"; }, reset() {}, remove() {} };
window.onTurnstileLoad && window.onTurnstileLoad();`,
        })
      : route.abort(),
  );
};

/**
 * A stranger at the door: /api/me says nobody is logged in, and the demo
 * patient is offered so the landing lays out its third button. The fake API
 * has no /api/processors, so the processor clause renders in its "not
 * knowing" form — both readers named — which is the longer one to lay out.
 */
const loggedOut = async (page: Page) => {
  await noWidget(page);
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "unauthorized", message: "Přihlaste se prosím." } }));
  await page.route("**/api/auth/demo", (route) => route.fulfill({ status: 200, json: { available: true } }));
};

/**
 * A read that finds values and no draw date: the fake API has no extractor,
 * so the page read is answered here — two readers agreeing on four rows of
 * the identity fixture, neither naming a date — and the page image the
 * store sends comes back as the demo's first page, so the date question has
 * a picture beside it. What follows the store is the screen under audit.
 */
const datelessRead = async (page: Page) => {
  const rows = [
    { raw_analyte_name: "S_Glukóza", value_raw: "5,32", unit_raw: "mmol/l", ref_range_raw: "(4,11-5,60)" },
    { raw_analyte_name: "S_Cholesterol", value_raw: "6,01", unit_raw: "mmol/l", ref_range_raw: "(2,90-5,00)" },
    { raw_analyte_name: "S_ALT", value_raw: "0,93", unit_raw: "μkat/l", ref_range_raw: "(0,17-0,78)" },
    { raw_analyte_name: "B_Hemoglobin", value_raw: "148", unit_raw: "g/l", ref_range_raw: "(135-175)" },
  ];
  const read = (model: string) => ({ model, report_date: null, lab_name: "Laboratoř Vzor a.s.", measurements: rows });
  await page.route("**/api/extract", (route) =>
    route.fulfill({
      json: {
        reads: [read("a"), read("b")],
        mode: "text",
        readersAttempted: 2,
        costUsd: 0,
        budget: { spentUsd: 0.12, budgetUsd: 5, frozen: false, remainingUsd: 4.88, month: "2026-08" },
      },
    }),
  );
  await page.route(/\/api\/reports\/[^/]+\/\d+$/, (route) =>
    route.request().method() === "PUT" ? route.fulfill({ json: { ok: true, imageUrl: "/api/pages/demo-0/1" } }) : route.fallback(),
  );
};

/** The identity fixture, through its review, into a dateless read; the question is up when this returns. */
const uploadDateless = async (page: Page) => {
  await tab(page, "Reporty");
  await page.locator('label.drop input[type="file"]').setInputFiles(FIXTURE);
  await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
  await page.getByRole("button", { name: "Ano, nahrát" }).click();
  await page.waitForSelector("#date-ask-title", { timeout: 20_000 });
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>(".date-ask-img");
    return !!img && img.complete && img.naturalWidth > 0;
  }, undefined, { timeout: 10_000 });
};

/** The lines of an electricity bill: text enough for a text layer, nothing a lab prints. */
const BILL = Array.from({ length: 20 }, (_, i) => `Polozka ${i + 1} odebrane mnozstvi podle smlouvy, cena bez DPH`);

/** A modal sheet whole inside the viewport, and not scrolling sideways. */
async function expectSheetInView(page: Page) {
  const sheet = page.locator(".sheet");
  const box = (await sheet.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x, "left edge").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "right edge").toBeLessThanOrEqual(width + 0.5);
  expect(box.y, "top edge").toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, "bottom edge").toBeLessThanOrEqual(height + 0.5);
  expect(await sheet.evaluate((el) => el.scrollWidth - el.clientWidth), "the sheet scrolls sideways").toBe(0);
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
  // The words a stranger reads first: the landing at "/", the login form one
  // link on, and the two legal drafts with their banner.
  { name: "úvod (nepřihlášený)", at: { path: "/", ready: ".landing" }, prepare: loggedOut, go: async () => {} },
  { name: "přihlášení", at: { path: "/prihlaseni", ready: ".door form" }, prepare: loggedOut, go: async () => {} },
  { name: "podmínky", at: { path: "/podminky", ready: ".legal h1" }, prepare: loggedOut, go: async () => {} },
  {
    // The model's clause — what it transcribes and what it never computes —
    // moved here from under Souhrn, so this is where it must be.
    name: "soukromí",
    at: { path: "/soukromi", ready: ".legal h1" },
    prepare: loggedOut,
    go: async () => {},
    check: async (page) => {
      expect(await page.getByText(/^Hodnoty, jednotky i meze počítá deterministický kód, ne model\./).count()).toBe(1);
    },
  },
  // The door, as the two links the operator sends open it. The login form
  // itself shares these classes and this card.
  { name: "registrace (živý odkaz)", at: { path: "/registrace?kod=audit-registrace", ready: ".door form" }, go: async () => {} },
  { name: "heslo (živý odkaz)", at: { path: "/heslo?kod=audit-heslo", ready: ".door form" }, go: async () => {} },
  // Logged out: a dead link opened by someone already logged in goes on to
  // the portal instead (ui/InvitePage.tsx — the link clicked twice).
  { name: "registrace (mrtvý odkaz)", at: { path: "/registrace?kod=mrtvy", ready: ".door .notice" }, prepare: loggedOut, go: async () => {} },
  // The open door (docs/plans/multi-user.md, Goal 6). The Turnstile widget
  // is Cloudflare's iframe and is not swept — its script is refused here so
  // the screens are the same with and without a site key in .env; what is
  // audited is the form around it. The login form is reached by answering
  // /api/me with a 401, the way it is for a stranger.
  { name: "přihlášení (otevřená registrace)", at: { path: "/prihlaseni", ready: ".door form" }, prepare: loggedOut, go: async () => {} },
  { name: "registrace (otevřená)", at: { path: "/registrace", ready: ".door form" }, prepare: noWidget, go: async () => {} },
  {
    name: "registrace (odkaz odeslán)",
    at: { path: "/registrace", ready: ".door form" },
    prepare: noWidget,
    go: async (page) => {
      await page.getByLabel("E-mail").fill("audit@example.com");
      for (const box of await page.locator("label.consent input").all()) await box.check();
      await page.getByRole("button", { name: "Poslat odkaz" }).click();
      await page.waitForSelector(".door .sent", { timeout: 10_000 });
    },
    check: async (page) => {
      expect(await page.locator(".door .sent").innerText()).toBe("Poslali jsme odkaz na audit@example.com. Otevřete ho do 24 hodin.");
    },
  },
  { name: "zapomenuté heslo", at: { path: "/zapomenute-heslo", ready: ".door form" }, prepare: noWidget, go: async () => {} },
  { name: "heslo (odkaz z e-mailu, nový účet)", at: { path: "/heslo?kod=audit-email", ready: ".door form" }, go: async () => {} },
  // „Napište nám", as a logged-in person sees it: the address is the login's
  // and read-only, the message field is empty. The fake API answers /api/me,
  // so the logged-out form (address typed, widget) is the same card with one
  // more input and is not reached here.
  {
    name: "napište nám",
    at: { path: "/napiste-nam", ready: ".door form textarea" },
    go: async () => {},
    check: async (page) => {
      expect(await page.locator(".door input[readonly]").inputValue()).toBe("audit@example.com");
      expect(await page.getByRole("button", { name: "Odeslat" }).isDisabled(), "nothing to send yet").toBe(true);
    },
  },
  {
    // The sentence after sending, with the address it names.
    name: "napište nám (odesláno)",
    at: { path: "/napiste-nam", ready: ".door form textarea" },
    go: async (page) => {
      await page.locator(".door textarea").fill("Nahrávání se zastaví u druhé strany a nic neřekne.");
      await page.getByRole("button", { name: "Odeslat" }).click();
      await page.waitForSelector(".contact-sent", { timeout: 5_000 });
      await page.waitForTimeout(200);
    },
    check: async (page) => {
      expect(await page.locator(".contact-sent").innerText()).toContain("Odpovíme na audit@example.com, obvykle do dvou dnů.");
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
      // Where the change groups would be: one plain sentence, not the
      // elliptical „Jediný odběr — přesuny vůči rozmezí od druhého odběru."
      expect(await page.getByText("Zatím jeden odběr. Změny vůči rozmezí se ukážou po druhém.").count()).toBe(1);
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
    // „Potvrdit všechny řádky k ověření", pressed: the button has to be on
    // screen and reachable beside — or, on a phone, under — the checkbox at
    // every width, and afterwards the sentence with its Zpět joins the same
    // toolbar. The demo's first report carries two doubted rows, so the
    // button is live when the tab opens and disabled once pressed.
    name: "ověření (vše potvrzeno)",
    go: async (page) => {
      await tab(page, "Ověření");
      await page.waitForTimeout(300);
      const all = page.getByRole("button", { name: "Potvrdit všechny řádky k ověření" });
      if (!(await all.isVisible())) throw new Error("the confirm-all button is not visible on the Ověření tab");
      if (await all.isDisabled()) throw new Error("the confirm-all button is disabled although the first demo report has doubted rows");
      await all.click();
      await page.getByRole("button", { name: "Zpět", exact: true }).waitFor({ timeout: 5_000 });
      if (!(await all.isDisabled())) throw new Error("the confirm-all button stayed enabled after confirming every row");
      await page.waitForTimeout(200);
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
    // Under the report list: „Dokumenty: 3 z 5", Přikoupit, and the link.
    // The chip has to sit on one wrapping line at 360 without pushing the
    // card sideways, which the overflow invariant sees.
    name: "reporty (dokumenty)",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.waitForSelector(".allow-line", { timeout: 5_000 });
      await page.waitForTimeout(200);
    },
    check: async (page) => {
      expect(await page.locator(".allow-line").innerText()).toContain("Dokumenty: 3 z 5");
      expect(await page.getByRole("link", { name: "Proč přikoupit?" }).first().isVisible()).toBe(true);
    },
  },
  {
    // Přikoupit, open: a sheet from the bottom edge on a phone, a centred
    // card above 480. The fake shop is closed, so the sentence that says so
    // is laid out under both packages after a tap on the first Koupit.
    name: "reporty (koupit dokumenty otevřené)",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator(".allow-line").getByRole("button", { name: "Přikoupit" }).click();
      await page.waitForSelector(".sheet", { timeout: 5_000 });
      await page.locator(".pack .btn").first().click();
      await page.waitForSelector(".sheet .sheet-state", { timeout: 5_000 });
      await page.waitForTimeout(250);
    },
    check: async (page) => {
      const sheet = page.locator(".sheet");
      const box = (await sheet.boundingBox())!;
      const { width, height } = page.viewportSize()!;
      expect(box.x, "left edge").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "right edge").toBeLessThanOrEqual(width + 0.5);
      expect(box.y + box.height, "bottom edge").toBeLessThanOrEqual(height + 0.5);
      expect(await sheet.locator(".pack").count()).toBe(2);
      expect(await sheet.locator(".pack-cmp").count(), "a comparison line under each price").toBe(2);
      // A closed shop is a rule, not a failure: one muted state line, both
      // buttons disabled, and no .notice in signal red.
      expect(await sheet.locator(".sheet-state").innerText()).toBe("Obchod zatím není otevřený.");
      expect(await sheet.locator(".notice").count(), "no alert for a closed shop").toBe(0);
      for (const buy of await sheet.locator(".pack .btn").all()) {
        expect(await buy.isDisabled(), "Koupit after shop_closed").toBe(true);
        const b = (await buy.boundingBox())!;
        expect(b.height, "Koupit is the sheet's primary action, 44px tall").toBeGreaterThanOrEqual(44);
        // The package's full width: the button's box is the card's, less its padding.
        const pack = (await buy.locator("xpath=..").boundingBox())!;
        expect(pack.width - b.width, "Koupit spans the package").toBeLessThanOrEqual(30);
      }
      // The dialog holds focus: it opened on Zavřít.
      expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Zavřít");
      // No package outgrows the sheet.
      const sideways = await sheet.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(sideways, "the sheet scrolls sideways").toBe(0);
    },
  },
  // The page behind „Proč přikoupit?", logged out like /soukromi.
  { name: "proč přikoupit", at: { path: "/proc-prikoupit", ready: ".privacy h1" }, go: async () => {} },
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
    // A new account: no strip, the upload card is the whole screen, and the
    // report list says there is nothing yet.
    name: "první přihlášení (bez reportů)",
    at: { path: "/", ready: "label.drop" },
    prepare: async (page) => {
      await page.route("**/api/reports", (route) => (route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.fallback()));
    },
    go: async (page) => {
      await page.waitForTimeout(250);
    },
    check: async (page) => {
      expect(await page.getByRole("tab").count(), "no strip without data").toBe(0);
      expect(await page.getByText("Zatím nic. Nahrajte první PDF výše.").isVisible()).toBe(true);
    },
  },
  {
    // The first batch, mid-way: two files confirmed and reading, the line
    // under the drop target saying Souhrn waits for both. The extractor
    // never answers, so the screen stays exactly here for the sweep.
    name: "první nahrání (dávka běží)",
    at: { path: "/", ready: "label.drop" },
    prepare: async (page) => {
      await page.route("**/api/reports", (route) => (route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.fallback()));
      await page.route("**/api/extract", () => new Promise<void>(() => {}));
    },
    go: async (page) => {
      await page.locator('label.drop input[type="file"]').setInputFiles([{ name: "vysledky.pdf", mimeType: "application/pdf", buffer: readFileSync(FIXTURE) }, { name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: png(1200, 1600) }]);
      await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
      await page.getByRole("button", { name: "Ano, nahrát" }).click();
      // The photo's checks warn on the fixture (no letters: "not a lab sheet").
      await page.waitForSelector(".photo-check", { timeout: 40_000 });
      await page.getByRole("button", { name: "Nahrát i tak" }).click();
      await expect.poll(async () => (await page.locator(".review .sub").first().textContent()) ?? "", { timeout: 20_000 }).toContain("IMG_0042.jpg");
      await page.getByRole("button", { name: "Ano, nahrát" }).click();
      await page.waitForSelector(".batch-wait", { timeout: 20_000 });
      await expect.poll(() => page.locator("li.job.running").count(), { timeout: 20_000 }).toBe(2);
      await page.waitForTimeout(300);
    },
    check: async (page) => {
      expect(await page.locator(".batch-wait").textContent()).toBe("Souhrn se otevře až po přečtení všech 2 souborů.");
      expect(await page.getByRole("tab").count(), "the strip waits for the batch").toBe(0);
    },
  },
  {
    // A photo the checks warned on (docs/plans/photo-capture.md): the reasons,
    // the picture, the scan tip and three ways on. The fixture carries no
    // letters, so the local OCR finds no lab sheet in it.
    name: "fotka — upozornění",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator('label.drop input[type="file"]').setInputFiles([{ name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: png(1200, 1600) }]);
      await page.waitForSelector(".photo-check img", { timeout: 40_000 });
      await page.waitForTimeout(300);
    },
    check: async (page) => {
      expect(await page.getByRole("button", { name: "Nahrát i tak" }).count()).toBe(1);
    },
  },
  {
    // The refused variant: too few pixels to hold print. No note, no
    // "Nahrát i tak" — only "Zrušit" and "Vyfotit znovu".
    name: "fotka — odmítnutá",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator('label.drop input[type="file"]').setInputFiles([{ name: "IMG_0044.jpg", mimeType: "image/jpeg", buffer: png(200, 260) }]);
      await page.waitForSelector(".photo-check img", { timeout: 40_000 });
      await page.waitForTimeout(300);
    },
    check: async (page) => {
      expect(await page.getByRole("button", { name: "Nahrát i tak" }).count()).toBe(0);
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
  {
    // A PDF the checks want a second look at before a document is spent
    // (ui/FileCheck.tsx): two pages with two draw dates and nothing that
    // reads as a lab sheet, so the card lists both reasons and its primary
    // button asks the multi-date question.
    name: "soubor — upozornění",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator('label.drop input[type="file"]').setInputFiles({
        name: "vyuctovani-a-vysledky-dlouhy-nazev-souboru.pdf",
        mimeType: "application/pdf",
        // Twenty-odd lines a page: fewer and pdf.js's text layer counts as
        // a scan, which the checks only measure for length.
        buffer: textPdf([
          ["Vyuctovani elektriny za obdobi 2025", "Datum odberu: 3. 2. 2026", ...BILL],
          ["Vyuctovani elektriny, druha strana", "Datum odberu: 9. 3. 2026", ...BILL],
        ]),
      });
      await page.waitForSelector("#file-check-h", { timeout: 20_000 });
      await page.waitForTimeout(250);
    },
    check: async (page) => {
      expect(await page.locator(".photo-check-reasons li").count(), "both reasons listed").toBe(2);
      // Two reasons of two kinds (dates, not a lab sheet): the plain answer,
      // since „jeden report" would answer only the first.
      expect(await page.getByRole("button", { name: "Nahrát i tak" }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Zrušit", exact: true }).count()).toBe(1);
      for (const b of await page.locator(".photo-check .review-actions .btn").all()) {
        expect((await b.boundingBox())!.height, "a FileCheck button's tap box").toBeGreaterThanOrEqual(24);
      }
    },
  },
  {
    // A report stored without a date (ui/DateAsk.tsx): the sheet, the first
    // page beside the question, the date field and its two ways on.
    name: "datum odběru (dotaz)",
    prepare: datelessRead,
    go: async (page) => {
      await uploadDateless(page);
      await page.waitForTimeout(250);
    },
    check: async (page) => {
      await expectSheetInView(page);
      const save = page.getByRole("button", { name: "Uložit datum" });
      expect(await save.isDisabled(), "nothing to save before a date is typed").toBe(true);
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type), "the field has focus").toBe("date");
      expect(await page.getByRole("button", { name: "Později" }).isVisible()).toBe(true);
      await page.locator(".sheet input[type='date']").fill("2025-06-03");
      expect(await save.isDisabled(), "a real date enables Uložit").toBe(false);
    },
  },
  {
    // „Později": the report waits in Reporty with its ⚠️ line. That line
    // sits under an ellipsised .rl-meta, and it must wrap — and be drawn in
    // the critical ink, which the legacy .rl-meta colour used to win over.
    name: "reporty (datum chybí)",
    prepare: datelessRead,
    go: async (page) => {
      await uploadDateless(page);
      await page.getByRole("button", { name: "Později" }).click();
      await page.waitForSelector("#date-ask-title", { state: "detached", timeout: 5_000 });
      await tab(page, "Reporty");
      await page.waitForSelector(".reportlist .rl-warn", { timeout: 5_000 });
      await page.waitForTimeout(200);
    },
    check: async (page) => {
      const warn = page.locator(".reportlist .rl-warn").first();
      expect(await warn.evaluate((el) => el.scrollWidth - el.clientWidth), "the ⚠️ line is cut off").toBeLessThanOrEqual(0);
      const [color, ink] = await warn.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--critical-ink)";
        document.body.appendChild(probe);
        const out = [getComputedStyle(el).color, getComputedStyle(probe).color];
        probe.remove();
        return out;
      });
      expect(color, "the ⚠️ line in the critical ink").toBe(ink);
      const sideways = await page.locator("ul.reportlist").evaluate((ul) => ul.scrollWidth - ul.clientWidth);
      expect(sideways, "the report list scrolls sideways").toBe(0);
    },
  },
  {
    // The same report opened from its row: Ověření leads with the date field
    // (VerifyTab.tsx DateField) above the report picker.
    name: "ověření (datum chybí)",
    prepare: datelessRead,
    go: async (page) => {
      await uploadDateless(page);
      await page.getByRole("button", { name: "Později" }).click();
      await page.waitForSelector("#date-ask-title", { state: "detached", timeout: 5_000 });
      await tab(page, "Reporty");
      await page.locator(".reportlist .rl-warn").first().click();
      await page.waitForSelector("form.date-field", { timeout: 5_000 });
      await page.waitForTimeout(300);
    },
    check: async (page) => {
      expect(await page.locator("form.date-field").evaluate((el) => el.scrollWidth - el.clientWidth), "the date field scrolls sideways").toBeLessThanOrEqual(0);
      expect(await page.locator("form.date-field").getByRole("button", { name: "Uložit datum" }).isDisabled()).toBe(true);
    },
  },
  {
    // A read the server could not do: every try failed, and the log offers
    // „Zkusit znovu" (the redacted pages are still held) — the button row
    // under the entry's sentence.
    name: "nahrání (čtení selhalo, zkusit znovu)",
    prepare: async (page) => {
      await page.route("**/api/extract", (route) => route.fulfill({ status: 503, json: { error: "unavailable", message: "Služba je dočasně nedostupná — zkuste to prosím za chvíli." } }));
    },
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator('label.drop input[type="file"]').setInputFiles(FIXTURE);
      await page.waitForSelector(".review-canvas img", { timeout: 20_000 });
      await page.getByRole("button", { name: "Ano, nahrát" }).click();
      await page.waitForSelector(".job-actions .btn", { timeout: 30_000 });
      await page.waitForTimeout(250);
    },
    check: async (page) => {
      expect(await page.getByRole("button", { name: "Zkusit znovu" }).count()).toBe(1);
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
            await expectNavLinkBoxes(page);
            await screen.check?.(page);
          } finally {
            await page.close();
          }
        }, 60_000);
      }
    });
  }
}
