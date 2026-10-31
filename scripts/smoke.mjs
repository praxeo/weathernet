// Headless render check against a running dev server (scripts/dev-server.mjs):
// page errors, console errors, failed local requests, horizontal overflow on a
// phone, and desktop/mobile screenshots.
//
//   node scripts/smoke.mjs http://localhost:8787 /tmp/shots
//
// Playwright comes from `playwright` if installed, else PLAYWRIGHT_MODULE
// (e.g. the global install: /opt/node-tools/node_modules/playwright/index.js).
import { mkdirSync, writeFileSync } from "node:fs";
import proc from "node:process";

const [url = "http://localhost:8787/", out = "smoke-out"] = proc.argv.slice(2);
mkdirSync(out, { recursive: true });
const pw = await import(proc.env.PLAYWRIGHT_MODULE || "playwright");
const { chromium } = pw.default || pw;

const problems = [];
const browser = await chromium.launch();
for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`[${name}] console: ${m.text()}`); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(new URL(url).origin)) problems.push(`[${name}] HTTP ${r.status()} ${r.url()}`); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${out}/${name}-top.png` });
  // Visit every section so the lazy ones (map, satellite, cams, history) load.
  for (const id of ["local", "now", "stories", "map", "cams", "satellite", "history", "learn"]) {
    await page.evaluate((i) => document.getElementById(i)?.scrollIntoView(), id);
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(5000);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  if (sw > viewport.width + 1) problems.push(`[${name}] page is ${sw}px wide in a ${viewport.width}px viewport`);
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
}
await browser.close();
writeFileSync(`${out}/problems.txt`, problems.join("\n") + "\n");
proc.stdout.write(problems.length ? `${problems.length} problem(s):\n${problems.join("\n")}\n` : "clean\n");
proc.exitCode = problems.length ? 1 : 0;
