import { chromium } from "playwright";
const OUT = "/tmp/claude-0/-home-user-bloodwork-trend-visualizer/544a684b-642c-5494-ae78-6ed6aa59f825/scratchpad/eval";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:4180/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.getByRole("tab", { name: "🗂️ Namapování" }).click();
await p.waitForTimeout(1500);
const ku = p.getByText("Kyselina močová", { exact: true }).first();
await ku.scrollIntoViewIfNeeded();
await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/m03-uric-candidate.png` });

// click "Nechat nenamapované — proč?"
await p.getByRole("button", { name: /Nechat nenamapované/ }).first().click();
await p.waitForTimeout(900);
await p.screenshot({ path: `${OUT}/m04-nechat-nenamapovane.png` });
console.log("=== after 'Nechat nenamapované' ===");
console.log((await p.locator("body").innerText()).slice(250,2200));
await b.close();
