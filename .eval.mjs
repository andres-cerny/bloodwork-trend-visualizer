import { chromium } from "playwright";
const OUT = "/tmp/claude-0/-home-user-bloodwork-trend-visualizer/544a684b-642c-5494-ae78-6ed6aa59f825/scratchpad/eval";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:4180/", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.getByRole("tab", { name: "🔍 Ověření" }).click();
await p.waitForTimeout(1500);

// Is the source page an image or DOM?
const imgs = await p.locator("img").count();
console.log("img count on page:", imgs);
for (let i=0;i<imgs;i++){ console.log(" img src:", (await p.locator("img").nth(i).getAttribute("src")||"").slice(0,120)); }
const canv = await p.locator("canvas").count();
console.log("canvas count:", canv);

// click the S_ALT row (neshoda)
await p.getByText("S_ALT", { exact: true }).click();
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/v02-click-ALT.png` });
console.log("=== after ALT click, right panel ===");
console.log(await p.locator("text=Zdrojová stránka").locator("xpath=..").innerText().catch(()=>"n/a"));
await b.close();
