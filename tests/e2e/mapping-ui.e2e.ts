/**
 * The three mapping screens with their switches on (VITE_UNRECOGNISED_TRENDS,
 * VITE_AUTO_ENTRIES): every new screen and state at the five widths in both
 * palettes, through the same invariant set as the rest of the portal, and the
 * decisions they save, driven once end to end.
 *
 *   npm run test:mapping-ui
 *   MAPPING_UI_SHOTS=/tmp/mojekrev-ui npm run test:mapping-ui   # + screenshots
 *
 * Its own build (`dist-mapping-ui`, test:mapping-ui), so the switch-off
 * build the portal audit sweeps is never the one served here. The account is
 * the demo patient of the portal audit, plus:
 *
 *   - S_Homocystein tot., which the shipped catalog does not file and the
 *     stubbed model answers only "medium" for — an unrecognised series;
 *   - S_Apolipoprotein AII in every report, and an auto-added entry for it
 *     (NČLP 00754) — the „přidáno automaticky" mark;
 *   - three saved decisions for the names screen: one the model made, one
 *     this account made, one another user made.
 *
 * No paid call: /api/map is the harness's stub, and every write is caught here.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page, Route } from "playwright";
import { audit, report, type Flaw } from "./lib/audit";
import { DESKTOP, MOBILE, SMALL, TABLET, WIDE, errorsOn, setTheme, type Harness } from "./lib/harness";
import { startPortal } from "./lib/portalHarness";

let app: Harness;
const COLLECT = process.env.AUDIT_COLLECT;
const SHOTS = process.env.MAPPING_UI_SHOTS;
const collected: Array<{ screen: string; flaws: Flaw[] }> = [];

beforeAll(async () => {
  app = await startPortal(Number(process.env.AUDIT_PORT ?? 4312));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
}, 120_000);

afterAll(async () => {
  await app?.stop();
  if (COLLECT) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(COLLECT, JSON.stringify({ total: collected.reduce((n, c) => n + c.flaws.length, 0), screens: collected }, null, 2));
  }
});

function judge(label: string, flaws: Flaw[]) {
  if (COLLECT) {
    collected.push({ screen: label, flaws });
    return;
  }
  expect(flaws, report(label, flaws)).toEqual([]);
}

const LAB = "Laboratoř Demo s.r.o.";
const APO = "S_Apolipoprotein AII";
const ENTRY = {
  code: "00754",
  nameCs: "Apolipoprotein AII (S; hmot. konc. [g/l])",
  unit: "g/l",
  material: "s",
  rawName: APO,
  model: "claude-haiku-5-5",
  at: "2026-10-20T09:12:00Z",
  mine: false,
};
const ALIASES = [
  { lab: LAB, rawName: "S_Sodík", unit: "mmol/l", canonicalId: "sodik", source: "model", model: "claude-haiku-5-5", code: "02484", mine: false },
  { lab: LAB, rawName: "S_Kyselina močová", unit: "µmol/l", canonicalId: "kyselina_mocova", source: "person", model: null, code: null, mine: true },
  { lab: LAB, rawName: "B_Leukocyty", unit: "10^9/l", canonicalId: "leukocyty", source: "person", model: null, code: null, mine: false },
];

/** What the screens wrote to the shared tables, in order. */
type Write = { method: string; url: string; body: Record<string, unknown> | null };

/** The account as described above; `writes` collects every PUT/DELETE to aliases and auto entries. */
async function account(page: Page, writes: Write[] = []) {
  await page.route("**/api/reports", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const reports = (await res.json()) as Array<{ measurements: Array<Record<string, unknown>> }>;
    reports.forEach((r, i) => {
      const v = 0.28 + ((i * 7) % 13) / 100;
      const raw = v.toFixed(2).replace(".", ",");
      r.measurements.push({
        rawAnalyteName: APO,
        valueRaw: raw,
        unitRaw: "g/l",
        refRangeRaw: "(0,20-0,50)",
        sourceSnippet: `${APO}   ${raw}   g/l   (0,20-0,50)`,
        sourcePage: 1,
        confidence: "high",
        canonicalId: null,
        value: Number(v.toFixed(2)),
        unit: "g/l",
        refRangeLow: 0.2,
        refRangeHigh: 0.5,
        refRangeText: null,
        flag: "normal",
        extractedBy: "claude-haiku-5-5",
        escalated: false,
        disagreement: null,
        corrected: false,
        bbox: null,
      });
    });
    await route.fulfill({ response: res, json: reports });
  });
  const shared = async (route: Route, list: unknown) => {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: list });
    writes.push({ method: req.method(), url: new URL(req.url()).pathname, body: req.postDataJSON() as Record<string, unknown> | null });
    return route.fulfill({ json: { ok: true, taught: true, removed: true, added: true } });
  };
  await page.route("**/api/aliases", (route) => shared(route, ALIASES));
  await page.route("**/api/auto-entries", (route) => shared(route, [ENTRY]));
}

const tab = async (page: Page, name: string) => {
  const t = page.getByRole("tab", { name, exact: true });
  if (!(await t.isVisible())) await page.locator(".tabs-toggle").click();
  await t.click();
};

/** Trendy, and the model's answer for the unrecognised name in (it arrives after the load). */
const trendy = async (page: Page) => {
  await tab(page, "Trendy");
  await page.locator("#tabpanel-trends .suggestions .chip.unrec").first().waitFor({ timeout: 10_000 });
};

const openUnrecognised = async (page: Page) => {
  await trendy(page);
  await page.locator("#tabpanel-trends .suggestions .btn", { hasText: "S_Homocystein tot." }).click();
  await page.locator(".trend-card.unrec").waitFor();
};

const openAutoTrend = async (page: Page) => {
  await trendy(page);
  await page.getByRole("button", { name: "Zobrazit parametr" }).click();
  await page.getByRole("searchbox", { name: "Hledat parametr" }).fill("apolipo");
  await page.locator(".picker-item", { hasText: "Apolipoprotein AII" }).click();
  await page.locator(".trend-card .auto-mark").waitFor();
};

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
  /** File-name slug for the screenshot. */
  slug: string;
  go: (page: Page) => Promise<void>;
  check?: (page: Page) => Promise<void>;
  /** A sheet is open: the screenshot is the viewport, not the page. */
  sheet?: boolean;
  /** The screenshot is of this element alone (a card at the foot of a long tab). */
  shot?: string;
}

const SCREENS: Screen[] = [
  {
    name: "trendy (nerozpoznané v nabídce)",
    slug: "1-trendy-nabidka",
    go: trendy,
    check: async (page) => {
      expect(await page.locator("#tabpanel-trends").getByText("nerozpoznáváme").count(), "the sentence about unrecognised names").toBe(1);
      expect(await page.locator("#tabpanel-trends").getByText("nezobrazuje").count(), "the old warning is gone").toBe(0);
    },
  },
  {
    name: "trendy (nerozpoznaný graf)",
    slug: "1-trendy-nerozpoznany-graf",
    go: openUnrecognised,
    check: async (page) => {
      const card = page.locator(".trend-card.unrec");
      expect(await card.locator(".chip.unrec").innerText()).toBe("nerozpoznáno");
      expect(await card.locator(".chip.alert").count(), "no range verdict on an unrecognised series").toBe(0);
      expect(await card.getByText(LAB).count()).toBe(1);
    },
  },
  {
    name: "trendy (přiřadit nerozpoznaný)",
    slug: "1-trendy-priradit",
    sheet: true,
    go: async (page) => {
      await openUnrecognised(page);
      await page.getByRole("button", { name: "Přiřadit ke známému parametru" }).click();
      await page.locator(".name-sheet").waitFor();
    },
    check: async (page) => {
      await expectSheetInView(page);
      expect(await page.locator(".name-sheet h2").innerText()).toBe("S_Homocystein tot.");
    },
  },
  {
    name: "trendy (přiřadit nerozpoznaný, hledání)",
    slug: "1-trendy-priradit-hledani",
    sheet: true,
    go: async (page) => {
      await openUnrecognised(page);
      await page.getByRole("button", { name: "Přiřadit ke známému parametru" }).click();
      await page.locator(".name-sheet").getByRole("button", { name: /parametr…$/ }).click();
      await page.locator(".name-sheet .picker.inline input").fill("homo");
    },
    check: expectSheetInView,
  },
  {
    name: "trendy (přidáno automaticky)",
    slug: "2-trendy-auto",
    go: openAutoTrend,
    check: async (page) => {
      expect(await page.locator(".trend-card h3").first().innerText()).toContain("Apolipoprotein AII");
      expect(await page.locator(".trend-card h3").first().innerText(), "the system part of the NČLP name stays out of the heading").not.toContain("hmot. konc.");
    },
  },
  {
    name: "přidáno automaticky (vysvětlení)",
    slug: "2-auto-vysvetleni",
    sheet: true,
    go: async (page) => {
      await openAutoTrend(page);
      await page.locator(".trend-card .auto-mark").click();
      await page.locator(".name-sheet").waitFor();
    },
    check: async (page) => {
      await expectSheetInView(page);
      expect(await page.locator(".name-sheet").getByText("00754").count()).toBe(1);
    },
  },
  {
    name: "přidáno automaticky (jiný parametr)",
    slug: "2-auto-jiny-parametr",
    sheet: true,
    go: async (page) => {
      await openAutoTrend(page);
      await page.locator(".trend-card .auto-mark").click();
      await page.getByRole("button", { name: "Přiřadit jinému parametru…" }).click();
      await page.locator(".name-sheet .picker.inline input").fill("apo");
    },
    check: expectSheetInView,
  },
  {
    name: "souhrn (přidáno automaticky)",
    slug: "2-souhrn-auto",
    go: async (page) => {
      await page.locator(".auto-mark").first().waitFor({ timeout: 10_000 });
    },
  },
  {
    name: "ověření (přidáno automaticky)",
    slug: "2-overeni-auto",
    go: async (page) => {
      await tab(page, "Ověření");
      await page.locator("#tabpanel-verify .auto-mark").first().waitFor({ timeout: 10_000 });
    },
  },
  {
    name: "reporty (jak čteme názvy)",
    slug: "3-reporty-nazvy",
    shot: ".names-card",
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator(".names-card").scrollIntoViewIfNeeded();
    },
    check: async (page) => {
      const card = page.locator(".names-card");
      expect(await card.locator(".who-auto").count()).toBeGreaterThan(0);
      expect(await card.getByText("vaše rozhodnutí").count()).toBe(1);
      expect(await card.getByText("jiný uživatel").count()).toBe(1);
      expect(await card.getByText("NČLP 00754").count()).toBe(1);
    },
  },
  {
    name: "reporty (nesedí — automatické rozhodnutí)",
    slug: "3-reporty-nesedi",
    sheet: true,
    go: async (page) => {
      await tab(page, "Reporty");
      await page.locator(".names-card").getByRole("button", { name: "Nesedí: S_Sodík" }).click();
      await page.locator(".name-sheet").waitFor();
    },
    check: expectSheetInView,
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
          const page = await app.open(viewport, { prepare: (p) => account(p) });
          await setTheme(page, theme);
          try {
            await screen.go(page);
            await page.waitForTimeout(200);
            const flaws = await audit(page, { ignore: ["iframe"] });
            expect(errorsOn(page), `page errors on ${screen.name}`).toEqual([]);
            judge(`${vpName} ${theme} — ${screen.name}`, flaws);
            await screen.check?.(page);
            if (SHOTS && (viewport === MOBILE || viewport === DESKTOP)) {
              const path = join(SHOTS, `${screen.slug}-${viewport.width}-${theme}.png`);
              if (screen.shot) await page.locator(screen.shot).screenshot({ path });
              else await page.screenshot({ path, fullPage: !screen.sheet });
            }
          } finally {
            await page.close();
          }
        }, 60_000);
      }
    });
  }
}

describe("the decisions, driven once", () => {
  it("an unrecognised series assigned joins its parameter as the person's lab-scoped decision, and comes back on undo", async () => {
    const writes: Write[] = [];
    const page = await app.open(MOBILE, { prepare: (p) => account(p, writes) });
    try {
      await openUnrecognised(page);
      await page.getByRole("button", { name: "Přiřadit ke známému parametru" }).click();
      await page.locator(".name-sheet").getByRole("button", { name: /parametr…$/ }).click();
      await page.locator(".name-sheet .picker.inline input").fill("homocystein");
      await page.locator(".name-sheet .picker-item", { hasText: "Homocystein" }).first().click();
      // The recognised card is open, the unrecognised one gone, and the decision saved.
      await page.locator(".banner.undo-banner").waitFor();
      expect(await page.locator(".trend-card.unrec").count()).toBe(0);
      expect(await page.locator(".trend-card h3").first().innerText()).toContain("Homocystein");
      const put = writes.find((w) => w.method === "PUT" && w.url === "/api/aliases");
      expect(put?.body).toMatchObject({ lab: LAB, rawName: "S_Homocystein tot.", unit: "µmol/l", canonicalId: "homocystein", source: "person" });
      expect(await page.locator("#tabpanel-trends .suggestions .chip.unrec").count()).toBe(0);
      // Undo: the decision withdrawn, the series back under the lab's name.
      await page.locator(".banner.undo-banner").getByRole("button", { name: "Vrátit zpět" }).click();
      expect(writes.some((w) => w.method === "DELETE" && w.url === "/api/aliases" && w.body?.rawName === "S_Homocystein tot.")).toBe(true);
      await tab(page, "Trendy");
      await page.getByRole("button", { name: "Vyčistit" }).click();
      await page.locator("#tabpanel-trends .suggestions .chip.unrec").first().waitFor();
      expect(errorsOn(page)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("„nechat bez přiřazení“ on an auto-added parameter saves „not this one“ for its lab and unit, and its readings become unrecognised", async () => {
    const writes: Write[] = [];
    const page = await app.open(MOBILE, { prepare: (p) => account(p, writes) });
    try {
      await openAutoTrend(page);
      await page.locator(".trend-card .auto-mark").click();
      await page.getByRole("button", { name: "Nechat bez přiřazení" }).click();
      const put = writes.find((w) => w.method === "PUT" && w.url === "/api/aliases");
      expect(put?.body).toMatchObject({ lab: LAB, rawName: APO, unit: "g/l", canonicalId: null, source: "person" });
      // The shared entry itself is not withdrawn by a person's correction.
      expect(writes.some((w) => w.url === "/api/auto-entries")).toBe(false);
      // The readings stay on screen, as the unrecognised series they now are.
      await page.locator(".trend-card.unrec", { hasText: APO }).waitFor();
      expect(await page.locator(".auto-mark").count()).toBe(0);
      expect(errorsOn(page)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);

  it("one's own decision on the names screen is withdrawn after a confirmation", async () => {
    const writes: Write[] = [];
    const page = await app.open(MOBILE, { prepare: (p) => account(p, writes) });
    try {
      await tab(page, "Reporty");
      const card = page.locator(".names-card");
      await card.getByRole("button", { name: "Vrátit zpět: S_Kyselina močová" }).click();
      await card.getByRole("button", { name: "Vrátit", exact: true }).click();
      const del = writes.find((w) => w.method === "DELETE" && w.url === "/api/aliases");
      expect(del?.body).toMatchObject({ lab: LAB, rawName: "S_Kyselina močová", unit: "µmol/l" });
      expect(await card.getByText("vaše rozhodnutí").count()).toBe(0);
      expect(errorsOn(page)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 60_000);
});
