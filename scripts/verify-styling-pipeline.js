/**
 * scripts/verify-styling-pipeline.js
 *
 * Verifies that:
 * 1. CSS assets load with status 200
 * 2. Zero console errors occur on / and /check
 * 3. Takes desktop (1280px) and mobile (390px) screenshots confirming styling
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.TEST_APP_URL || "http://127.0.0.1:3000";
const OUT_DIR = path.resolve(process.cwd(), "docs/status/ui-screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: "desktop_1280", width: 1280, height: 900, isMobile: false },
  { name: "mobile_390", width: 390, height: 844, isMobile: true },
];

async function run() {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  const routes = [
    { name: "home", path: "/" },
    { name: "check_form", path: "/check" },
  ];

  for (const route of routes) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
      });
      const page = await context.newPage();

      const consoleErrors = [];
      const cssRequests = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      page.on("response", (res) => {
        const url = res.url();
        if (url.includes(".css") || res.headers()["content-type"]?.includes("text/css")) {
          cssRequests.push({ url, status: res.status() });
        }
      });

      console.log(`Navigating to ${route.path} (${vp.name})...`);
      const res = await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "networkidle" });

      if (res.status() !== 200) {
        throw new Error(`Failed to load ${route.path}: HTTP status ${res.status()}`);
      }

      await page.waitForTimeout(600);

      // Verify CSS loaded with 200
      console.log(`CSS responses for ${route.path} (${vp.name}):`, cssRequests);
      for (const cssReq of cssRequests) {
        if (cssReq.status !== 200 && cssReq.status !== 304) {
          throw new Error(`CSS failed to load with 200: ${cssReq.url} -> ${cssReq.status}`);
        }
      }

      // Check console errors
      if (consoleErrors.length > 0) {
        console.warn(`Console errors on ${route.path}:`, consoleErrors);
        // Exclude innocuous React devtools note if any
        const critical = consoleErrors.filter((e) => !e.includes("React DevTools"));
        if (critical.length > 0) {
          throw new Error(`Critical console error on ${route.path}: ${critical.join(", ")}`);
        }
      } else {
        console.log(`Zero console errors on ${route.path} (${vp.name})`);
      }

      // Capture screenshot
      const shotPath = path.join(OUT_DIR, `${route.name}_${vp.name}_light.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`Saved: ${shotPath}`);

      await context.close();
    }
  }

  await browser.close();
  console.log("All styling pipeline assertions passed successfully!");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
