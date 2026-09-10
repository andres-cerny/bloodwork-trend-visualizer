/**
 * The patient-identity guard, driven through the real upload flow.
 *
 * This is the one part of the app that unit tests structurally cannot reach.
 * The comparison has its own tests, and the waiting room has its own tests,
 * but neither can show that a doctor who uploads the wrong PDF is actually
 * stopped — that needs the Turnstile gate, the queue, pdf.js, the concurrent
 * per-page publishing and the dialog, in a browser, in that order. The guard
 * shipped once before without this and the dialog was never seen by anybody.
 *
 * No API key and no spend: `/api/extract` is stubbed, so what is exercised is
 * every line of the app between a chosen file and a rendered answer. The
 * transcription itself is not under test here — `tests/live` covers that.
 *
 *   npm run test:identity
 *
 * The build is its own, because the upload panel refuses to render without a
 * Turnstile site key and the key is baked in at build time. It leaves that
 * keyed build in `dist` — harmless, since `test:e2e`, `test:audit` and every
 * deploy build before they run, but it is why running this suite's vitest
 * directly and then auditing reports flaws that are not there.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page, Route } from "playwright";
import { readFileSync } from "node:fs";
import { DESKTOP, startApp, type Harness } from "./lib/harness";

let app: Harness;

beforeAll(async () => {
  app = await startApp(Number(process.env.E2E_UPLOAD_PORT ?? 4302));
}, 120_000);

afterAll(async () => {
  await app?.stop();
});

/** Digital PDFs with text layers, checked in for exactly this kind of test. */
const PDF = readFileSync("packages/lab-core/tests/fixtures/standard.pdf");
const PDF_2PAGE = readFileSync("packages/lab-core/tests/fixtures/multipage.pdf");

/** Who the stubbed extractor says the next uploaded page belongs to. */
interface Who {
  patient_name: string | null;
  patient_id: string | null;
}

const DEMO_PATIENT: Who = { patient_name: "Jan Ukázka", patient_id: "800101/0006" };
const OTHER_PATIENT: Who = { patient_name: "Petr Malý", patient_id: "750620/1234" };
const NOBODY: Who = { patient_name: null, patient_id: null };

/**
 * Boot the app with the network stubbed and the challenge already solved.
 *
 * `who` is read at request time rather than captured, so a test can change who
 * the next upload belongs to between two files.
 */
async function openApp(who: () => Who): Promise<Page> {
  return app.open(DESKTOP, { prepare: async (page) => {
    // Turnstile never loads in a test browser. Standing in for it here is
    // legitimate: what is under test is what happens *after* the gate, and the
    // gate itself is covered by packages/gate.
    await page.addInitScript(() => {
      (window as any).turnstile = {
        render: (_el: HTMLElement, opts: any) => opts.callback("e2e-token"),
      };
    });
    await page.route("**/api/session", (route: Route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ session: "e2e" }) }),
    );
    await page.route("**/api/status", (route: Route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          budget: { spentUsd: 0, budgetUsd: 10, frozen: false, remainingUsd: 10 },
          maxPages: 40,
        }),
      }),
    );
    await page.route("**/api/extract", (route: Route) => {
      const { patient_name, patient_id } = who();
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          mode: "text",
          costUsd: 0,
          budget: { spentUsd: 0, budgetUsd: 10, frozen: false, remainingUsd: 10 },
          // Two reads, because that is what the real endpoint returns and what
          // `reconcile` is written against.
          reads: ["a", "b"].map((model) => ({
            model,
            report_date: "2026-05-05",
            report_date_raw: "5. 5. 2026",
            lab_name: "E2E",
            patient_name,
            patient_id,
            measurements: [
              {
                raw_analyte_name: "ALT",
                value_raw: "0,90",
                unit_raw: "µkat/l",
                ref_range_raw: "0,17-0,78",
                row_index: 0,
                confidence: "high",
              },
            ],
          })),
        }),
      });
    });
  } });
}

/** Choose a PDF through the real file input, as clicking the drop zone does. */
async function upload(page: Page, name: string, buffer: Buffer = PDF): Promise<void> {
  await page.setInputFiles('.drop input[type="file"]', {
    name,
    mimeType: "application/pdf",
    buffer,
  });
}

const dialog = (page: Page) => page.locator('[role="alertdialog"]');

/** Wait for the guard's dialog, or fail saying it never came. */
async function waitForDialog(page: Page): Promise<void> {
  await dialog(page).waitFor({ state: "visible", timeout: 30_000 });
}

/** The reports listed in the rail — what has actually been loaded. */
const loadedCount = (page: Page) => page.locator(".reportlist > li").count();

describe("uploading a different patient's report", () => {
  it("asks instead of merging it into the loaded patient's trends", async () => {
    // The bug the guard exists for. Before it, this upload joined "Jan
    // Ukázka" silently and every trend afterwards described nobody.
    const page = await openApp(() => OTHER_PATIENT);
    await upload(page, "petr.pdf");
    await waitForDialog(page);

    const text = await dialog(page).innerText();
    expect(text).toContain("Jiný pacient?");
    // It names both sides rather than asserting a conclusion it cannot show.
    expect(text).toContain("Jan Ukázka");
    expect(text).toContain("Petr Malý");
    expect(text).toContain("750620/1234");
    // And says which file it is asking about.
    expect(text).toContain("petr.pdf");
    await page.close();
  });

  it("keeps the new patient out of the patient bar while it is asking", async () => {
    const page = await openApp(() => OTHER_PATIENT);
    await upload(page, "petr.pdf");
    await waitForDialog(page);

    // The header still describes only the patient the reader chose to load.
    const bar = await page.locator(".patient-bar").innerText();
    expect(bar).toContain("Jan Ukázka");
    expect(bar).not.toContain("Petr Malý");
    await page.close();
  });

  it("replaces the loaded patient when told to", async () => {
    const page = await openApp(() => OTHER_PATIENT);
    const before = await loadedCount(page);
    expect(before).toBeGreaterThan(0);

    await upload(page, "petr.pdf");
    await waitForDialog(page);
    await page.getByRole("button", { name: "Nahradit načtená data" }).click();
    await dialog(page).waitFor({ state: "detached", timeout: 10_000 });

    const bar = await page.locator(".patient-bar").innerText();
    expect(bar).toContain("Petr Malý");
    expect(bar).not.toContain("Jan Ukázka");
    // Only the upload survives: the demo reports are gone, not appended to.
    expect(await loadedCount(page)).toBe(1);
    await page.close();
  });

  it("keeps both when told to, and says on screen that it has two", async () => {
    const page = await openApp(() => OTHER_PATIENT);
    const before = await loadedCount(page);

    await upload(page, "petr.pdf");
    await waitForDialog(page);
    await page.getByRole("button", { name: "Přidat i tak" }).click();
    await dialog(page).waitFor({ state: "detached", timeout: 10_000 });

    expect(await loadedCount(page)).toBe(before + 1);
    // Two patients in one set is legitimate but must never be silent — the
    // card qualifies every number under it.
    const card = await page.locator(".patient-card").innerText();
    expect(card).toContain("2 pacienti");
    await page.close();
  });

  it("discards it entirely when told to, changing nothing that is loaded", async () => {
    const page = await openApp(() => OTHER_PATIENT);
    const before = await loadedCount(page);

    await upload(page, "petr.pdf");
    await waitForDialog(page);
    await page.getByRole("button", { name: "Zahodit" }).click();
    await dialog(page).waitFor({ state: "detached", timeout: 10_000 });

    expect(await loadedCount(page)).toBe(before);
    const bar = await page.locator(".patient-bar").innerText();
    expect(bar).toContain("Jan Ukázka");
    expect(bar).not.toContain("Petr Malý");

    // And it stays gone. The rest of the file's pages are still publishing.
    await page.waitForTimeout(1500);
    expect(await dialog(page).count()).toBe(0);
    expect(await loadedCount(page)).toBe(before);
    await page.close();
  });

  it("closes on Escape as a discard, the answer that changes nothing", async () => {
    const page = await openApp(() => OTHER_PATIENT);
    const before = await loadedCount(page);

    await upload(page, "petr.pdf");
    await waitForDialog(page);
    await page.keyboard.press("Escape");
    await dialog(page).waitFor({ state: "detached", timeout: 10_000 });

    expect(await loadedCount(page)).toBe(before);
    await page.close();
  });
});

describe("uploading another draw from the patient already loaded", () => {
  it("goes straight in, with nothing to answer", async () => {
    // The other direction, and the one that decides whether the guard is
    // usable at all: a warning on an ordinary upload is a warning nobody reads.
    const page = await openApp(() => DEMO_PATIENT);
    const before = await loadedCount(page);

    await upload(page, "another-draw.pdf");
    await page.waitForFunction(
      (n) => document.querySelectorAll(".reportlist > li").length > n,
      before,
      { timeout: 30_000 },
    );
    expect(await dialog(page).count()).toBe(0);

    const bar = await page.locator(".patient-bar").innerText();
    expect(bar).toContain("Jan Ukázka");
    expect(bar).not.toContain("pacienti");
    await page.close();
  });
});

describe("uploading a report whose header could not be read", () => {
  it("asks rather than assuming, and says it could not verify", async () => {
    // A scan whose header did not transcribe. Nothing was proven different,
    // which is exactly why it cannot be waved through.
    const page = await openApp(() => NOBODY);
    await upload(page, "scan.pdf");
    await waitForDialog(page);

    const text = await dialog(page).innerText();
    expect(text).toContain("Pacienta nelze ověřit");
    expect(text).toContain("Jan Ukázka");
    await page.close();
  });
});

describe("a file that dies partway through, before it could be identified", () => {
  it("still asks about what it read instead of swallowing it", async () => {
    // The waiting room holds an upload it cannot yet identify because the page
    // carrying the header may still be coming. When the budget runs out
    // mid-file that page never comes, so the uploader has to publish a final
    // report on the way out — without it the rows sit in the waiting room
    // forever, invisible, which is worse than the half-read file the app used
    // to show.
    let calls = 0;
    const page = await app.open(DESKTOP, { prepare: async (p) => {
      await p.addInitScript(() => {
        (window as any).turnstile = {
          render: (_el: HTMLElement, opts: any) => opts.callback("e2e-token"),
        };
      });
      await p.route("**/api/session", (route: Route) =>
        route.fulfill({ status: 200, body: JSON.stringify({ session: "e2e" }) }),
      );
      await p.route("**/api/status", (route: Route) =>
        route.fulfill({
          status: 200,
          body: JSON.stringify({
            budget: { spentUsd: 0, budgetUsd: 10, frozen: false, remainingUsd: 10 },
            maxPages: 40,
          }),
        }),
      );
      await p.route("**/api/extract", (route: Route) => {
        // One page lands carrying no header; the next exhausts the budget,
        // which is fatal and stops the file where it stands.
        if (calls++ === 0) {
          route.fulfill({
            status: 200,
            body: JSON.stringify({
              mode: "text",
              costUsd: 0,
              budget: { spentUsd: 10, budgetUsd: 10, frozen: false, remainingUsd: 0 },
              reads: ["a", "b"].map((model) => ({
                model,
                report_date: "2026-05-05",
                report_date_raw: "5. 5. 2026",
                lab_name: "E2E",
                ...NOBODY,
                measurements: [
                  {
                    raw_analyte_name: "ALT",
                    value_raw: "0,90",
                    unit_raw: "µkat/l",
                    ref_range_raw: "0,17-0,78",
                    row_index: 0,
                    confidence: "high",
                  },
                ],
              })),
            }),
          });
        } else {
          route.fulfill({
            status: 402,
            body: JSON.stringify({
              error: "budget_exhausted",
              message: "Rozpočet ukázky je vyčerpán.",
            }),
          });
        }
      });
    } });

    await upload(page, "half-read.pdf", PDF_2PAGE);
    await waitForDialog(page);
    expect(await dialog(page).innerText()).toContain("Pacienta nelze ověřit");
    await page.close();
  });
});
