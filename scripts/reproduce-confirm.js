import { chromium } from "playwright";
import fs from "node:fs";
import Database from "better-sqlite3";

async function main() {
  const traceEntries = [];
  function log(msg) {
    console.log(msg);
    traceEntries.push(`[${new Date().toISOString()}] ${msg}`);
  }

  const db = new Database("./data/app.db");

  log("Starting reproduction with Playwright...");
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    log(`[BROWSER CONSOLE ${msg.type()}] ${msg.text()}`);
  });

  page.on("pageerror", (err) => {
    log(`[BROWSER PAGEERROR] ${err.message}\n${err.stack}`);
  });

  page.on("request", (req) => {
    const postData = req.postData();
    log(`-> REQUEST ${req.method()} ${req.url()}${postData ? ` | Body: ${postData.slice(0, 300)}` : ""}`);
  });

  page.on("response", async (res) => {
    let body = "";
    try {
      const text = await res.text();
      body = text.slice(0, 300);
    } catch (_e) {
      body = "<could not read body>";
    }
    log(`<- RESPONSE ${res.status()} ${res.request().method()} ${res.url()} | Body: ${body}`);
  });

  log("Navigating to http://localhost:3000/check");
  await page.goto("http://localhost:3000/check", { waitUntil: "networkidle" });

  // Click sample button: "Fake Internship (TechCorp)"
  log("Clicking sample button...");
  await page.click("button:has-text('Fake Internship (TechCorp)')");

  // Check consent is true
  const consentChecked = await page.isChecked("input[type='checkbox']");
  log(`Consent checked: ${consentChecked}`);

  // Submit the form
  log("Submitting check...");
  await page.click("button[type='submit']");

  // Wait for navigation to /check/<id>
  log("Waiting for navigation to /check/...");
  await page.waitForURL(/\/check\/[0-9a-fA-F-]+/, { timeout: 15000 });
  const checkUrl = page.url();
  const checkId = checkUrl.split("/check/")[1].split("?")[0].replace(/\/$/, "");
  log(`Navigated to check URL: ${checkUrl}, checkId: ${checkId}`);

  // Inspect DB status immediately
  let row = db.prepare("SELECT id, status, created_at, updated_at FROM checks WHERE id = ?").get(checkId);
  log(`DB check row after submit: ${JSON.stringify(row)}`);

  // Wait for Step 1 confirmation card to appear
  log("Waiting for confirmation UI...");
  await page.waitForSelector("button:has-text('Confirm & Start Multi-Agent Check')", { timeout: 15000 });
  log("Confirmation UI loaded.");

  row = db.prepare("SELECT id, status, created_at, updated_at FROM checks WHERE id = ?").get(checkId);
  log(`DB check row before clicking confirm: ${JSON.stringify(row)}`);

  // Click "Confirm & Start Multi-Agent Check →"
  log("Clicking 'Confirm & Start Multi-Agent Check →' button (rapid double click to simulate user action)...");
  // Simulate double-click or fast click
  await Promise.all([
    page.click("button:has-text('Confirm & Start Multi-Agent Check')"),
    page.click("button:has-text('Confirm & Start Multi-Agent Check')").catch(e => log(`Second click catch: ${e.message}`)),
  ]);

  // Let's observe for 3 seconds
  await page.waitForTimeout(3000);

  row = db.prepare("SELECT id, status, created_at, updated_at FROM checks WHERE id = ?").get(checkId);
  log(`DB check row 3s after click: ${JSON.stringify(row)}`);

  // Monitor for another 12 seconds
  await page.waitForTimeout(12000);

  row = db.prepare("SELECT id, status, created_at, updated_at FROM checks WHERE id = ?").get(checkId);
  log(`DB check row after 15s: ${JSON.stringify(row)}`);

  const events = db.prepare("SELECT seq, type, agent, status, summary FROM check_events WHERE check_id = ? ORDER BY seq ASC").all(checkId);
  log(`DB events count: ${events.length}`);
  if (events.length > 0) {
    log(`DB events sample: ${JSON.stringify(events.slice(0, 8))}`);
  }

  // Check what UI currently displays
  const bodyText = await page.innerText("body");
  log(`Current UI heading / text excerpt: ${bodyText.slice(0, 400).replace(/\n+/g, " ")}`);

  await browser.close();
  db.close();

  fs.writeFileSync("docs/confirm-bug-trace.md", `# Confirm Bug Trace\n\n\`\`\`\n${traceEntries.join("\n")}\n\`\`\`\n`);
  log("Saved trace to docs/confirm-bug-trace.md");
}

main().catch((err) => {
  console.error("Reproduction failed:", err);
  process.exit(1);
});
