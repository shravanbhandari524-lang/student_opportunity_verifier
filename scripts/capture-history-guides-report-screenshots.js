/**
 * scripts/capture-history-guides-report-screenshots.js
 *
 * Captures 1280px desktop and 390px mobile screenshots (light and dark mode) for:
 * - /history (with mocked localStorage items across risk levels and expired status)
 * - /guides (forensic playbooks index)
 * - /guides/scholarship_scam (guide detail page)
 * - /check/[id] (final report state with risk badge, flags, checklist, etc.)
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
  await page.waitForTimeout(200);
}

async function capture(page, name, vpName, theme) {
  const filename = `${name}_${vpName}_${theme}.png`;
  const filepath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: true });
  console.log(`Saved screenshot: ${filename}`);
  return filepath;
}

async function run() {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  const reportCheckId = "395b5e10-0dc5-439a-9b01-afc52ac075bb";

  // Mock items to insert into localStorage for /history
  const mockHistory = [
    {
      id: reportCheckId,
      text: "TechCorp Solutions: Registration fee of INR 2,500 required for internship offer letter dispatch via WhatsApp.",
      riskLevel: "high",
      score: 100,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h ago
    },
    {
      id: "med-check-4b19-98a2-230981bbf110",
      text: "Global Young Researchers Fellowship 2026: Selected for paid stipend research paper drafting.",
      riskLevel: "medium",
      score: 45,
      createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), // 6h ago
    },
    {
      id: "low-check-88f1-aa12-9908123ccdd1",
      text: "Google Summer of Code 2026 Contributor invitation letter from legitimate open source organization.",
      riskLevel: "low",
      score: 0,
      createdAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(), // 14h ago
    },
    {
      id: "cv-check-99d0-1283-aaff23984012",
      text: "Telegram job offer: Part-time data review assistant, daily payouts to bank account directly.",
      riskLevel: "cannot_verify",
      score: null,
      createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(), // 20h ago
    },
    {
      id: "exp-check-00e1-4455-6677889900aa",
      text: "National Scholarship Trust 2025: Congratulations on shortlisting. Pay processing charge.",
      riskLevel: "high",
      score: 95,
      createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), // 26h ago (expired)
    },
  ];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });
    const page = await context.newPage();

    // 1. History Page (/history)
    await page.goto(`${BASE_URL}/history`, { waitUntil: "networkidle" });
    // Seed localStorage
    await page.evaluate((items) => {
      localStorage.setItem("ov_recent_checks", JSON.stringify(items));
    }, mockHistory);
    // Reload to pick up seeded localStorage
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    for (const theme of THEMES) {
      await setPageTheme(page, theme);
      await capture(page, "history", vp.name, theme);
    }

    // 2. Guides Index (/guides)
    await page.goto(`${BASE_URL}/guides`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    for (const theme of THEMES) {
      await setPageTheme(page, theme);
      await capture(page, "guides_index", vp.name, theme);
    }

    // 3. Guide Detail (/guides/scholarship_scam)
    await page.goto(`${BASE_URL}/guides/scholarship_scam`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    for (const theme of THEMES) {
      await setPageTheme(page, theme);
      await capture(page, "guide_detail", vp.name, theme);
    }

    // 4. Report View (/check/[id])
    await page.goto(`${BASE_URL}/check/${reportCheckId}`, { waitUntil: "networkidle" });
    // Wait for the report elements to render
    await page.waitForSelector("text=Assessed Risk Level", { timeout: 15000 });
    await page.waitForTimeout(800);

    for (const theme of THEMES) {
      await setPageTheme(page, theme);
      await capture(page, "check_final_report", vp.name, theme);
    }

    await context.close();
  }

  await browser.close();
  console.log("Finished capturing all History, Guides, and Report screenshots!");
}

run().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
