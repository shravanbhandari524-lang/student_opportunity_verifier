/**
 * scripts/capture-ui-screenshots.js
 *
 * Captures 390px (mobile) and 1280px (desktop) screenshots in both light and dark mode
 * across all core pages and check states:
 * - / (landing)
 * - /check (submission form with userNotes & handlePlatform)
 * - /check/[id] (awaiting_confirmation editor)
 * - /check/[id] (investigating progress with 6 agent cards)
 * - /check/[id] (final report with RiskBadge, flags, and checklist)
 * - /guides (scam archetypes index)
 * - /guides/internship_scam (guide detail)
 * - /report-fraud (triage & complaint generator)
 * - /about (architecture & DPDP Act 2023)
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.TEST_APP_URL || "http://127.0.0.1:3000";
const OUTPUT_DIR = path.resolve("docs/status/ui-screenshots");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { name: "mobile_390", width: 390, height: 844 },
  { name: "desktop_1280", width: 1280, height: 900 },
];

const THEMES = ["light", "dark"];

async function setPageTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem("ov_theme", t);
    document.documentElement.setAttribute("data-theme", t);
    if (t === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, theme);
  await page.waitForTimeout(100);
}

async function capture(page, pageName, vpName, theme) {
  const filename = `${pageName}_${vpName}_${theme}.png`;
  const filepath = path.join(OUTPUT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  console.log(`Saved screenshot: ${filename}`);
  return filepath;
}

async function run() {
  console.log(`Connecting to server at ${BASE_URL}...`);
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) {
    throw new Error(`Server health check failed: ${healthRes.status}`);
  }

  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Static Pages: Home, Check Form, Guides, Guide Detail, Report Fraud, About
  const staticPages = [
    { name: "home", path: "/" },
    { name: "check_form", path: "/check" },
    { name: "guides_index", path: "/guides" },
    { name: "guide_detail", path: "/guides/internship_scam" },
    { name: "report_fraud", path: "/report-fraud" },
    { name: "about", path: "/about" },
  ];

  for (const sp of staticPages) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}${sp.path}`, { waitUntil: "networkidle" });

      for (const theme of THEMES) {
        await setPageTheme(page, theme);
        await capture(page, sp.name, vp.name, theme);
      }
    }
  }

  // 2. Dynamic Check Lifecycle via UI Submission:
  console.log("Submitting test check on /check via browser UI...");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${BASE_URL}/check`, { waitUntil: "networkidle" });

  // Use Sample Offer: Fake Internship (TechCorp)
  const sampleBtn = page.locator("button:has-text('Fake Internship (TechCorp)')");
  if (await sampleBtn.isVisible()) {
    await sampleBtn.click();
  } else {
    await page.fill("textarea#text-input", "TechCorp offer: Pay Rs 2,500 security deposit to upi@techcorp.");
    await page.check("input[type='checkbox']");
  }

  // Ensure consent is checked
  const checkbox = page.locator("input[type='checkbox']");
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
  }

  // Submit form
  await page.click("button[type='submit']");
  await page.waitForURL(/\/check\/[0-9a-fA-F-]+/, { timeout: 30000 });
  const checkUrl = page.url();
  console.log(`Navigated to check URL: ${checkUrl}`);

  // Wait for confirmation editor state
  await page.waitForSelector("button:has-text('Confirm & Start Multi-Agent Check')", { timeout: 30000 });

  // Screenshot awaiting_confirmation
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const theme of THEMES) {
      await setPageTheme(page, theme);
      await capture(page, "check_confirm_state", vp.name, theme);
    }
  }

  // Confirm to trigger investigating state
  console.log("Confirming check to trigger investigation state...");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click("button:has-text('Confirm & Start Multi-Agent Check')");
  await page.waitForTimeout(800); // Allow first agents to initialize and SSE stream to connect

  // Screenshot investigating progress state
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const theme of THEMES) {
      await setPageTheme(page, theme);
      await capture(page, "check_progress_state", vp.name, theme);
    }
  }

  // Wait for check to reach final report
  console.log("Waiting for coordinator to complete and show Assessed Risk Level...");
  await page.waitForSelector("text=Assessed Risk Level", { timeout: 60000 });

  // Screenshot final report state
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const theme of THEMES) {
      await setPageTheme(page, theme);
      await capture(page, "check_final_report", vp.name, theme);
    }
  }

  await browser.close();
  console.log("All UI screenshots captured successfully!");
}

run().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
