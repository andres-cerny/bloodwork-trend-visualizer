import { chromium } from "playwright";
const OUT = "/tmp/claude-0/-home-user-bloodwork-trend-visualizer/544a684b-642c-5494-ae78-6ed6aa59f825/scratchpad/eval";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:4180/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.getByRole("tab", { name: "🗂️ Namapování" }).click();
await p.waitForTimeout(1500);
await p.getByRole("button", { name: "Zobrazit v dokumentu" }).nth(2).click();
await p.waitForTimeout(1500);
// find highlight overlay element
const marks = await p.locator("[class*=highlight],[class*=mark],[style*=border]").count();
console.log("possible highlight els:", marks);
// scroll page down to see full source image
await p.mouse.wheel(0, 900);
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/m07-jump-scrolled.png` });
await p.mouse.wheel(0, 700);
await p.waitForTimeout(600);
await p.screenshot({ path: `${OUT}/m08-jump-scrolled2.png` });
// is any left row visually selected?
console.log("selected rows:", await p.locator("tr[class*=sel],tr[aria-selected=true]").count());
await b.close();
