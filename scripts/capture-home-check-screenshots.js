import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.TEST_APP_URL || "http://127.0.0.1:3000";
const OUT_DIR = path.resolve(process.cwd(), "docs/status/ui-screenshots");

fs.mkdirSync(OUT_DIR, { recursive: true });

async function run() {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  const viewports = [
    { name: "desktop_1280", width: 1280, height: 900, isMobile: false },
    { name: "mobile_390", width: 390, height: 844, isMobile: true },
  ];

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });
    const page = await context.newPage();

    // 1. Home Page (/)
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const homePath = path.join(OUT_DIR, `home_${vp.name}_light.png`);
    await page.screenshot({ path: homePath, fullPage: true });
    console.log(`Saved: ${homePath}`);

    // 2. Check Form (/check)
    await page.goto(`${BASE_URL}/check`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const checkPath = path.join(OUT_DIR, `check_form_${vp.name}_light.png`);
    await page.screenshot({ path: checkPath, fullPage: true });
    console.log(`Saved: ${checkPath}`);

    await context.close();
  }

  await browser.close();
  console.log("Captured all home and check screenshots successfully!");
}

run().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
