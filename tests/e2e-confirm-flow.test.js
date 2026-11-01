import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE_URL = process.env.TEST_APP_URL || "http://127.0.0.1:3000";

test("E2E: browser confirm flow with rapid double-click, live stream events, page refresh, and final report", async (t) => {
  // 1. Verify app server availability
  let serverOnline = false;
  try {
    const health = await fetch(`${BASE_URL}/api/health`);
    if (health.ok) serverOnline = true;
  } catch (_e) {}

  if (!serverOnline) {
    t.skip(`App server is not reachable at ${BASE_URL}. Skipping browser e2e test.`);
    return;
  }

  // 2. Launch browser
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: true,
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const failedRequests = [];

  page.on("console", (msg) => {
    console.log(`[E2E-BROWSER ${msg.type()}] ${msg.text()}`);
  });

  page.on("pageerror", (err) => {
    console.error(`[E2E-PAGEERROR] ${err.message}`);
  });

  page.on("request", (req) => {
    if (req.url().includes("/api/checks")) {
      console.log(`-> E2E REQ ${req.method()} ${req.url()}`);
    }
  });

  page.on("response", (res) => {
    if (res.url().includes("/api/checks")) {
      console.log(`<- E2E RES ${res.status()} ${res.url()}`);
    }
    if (res.status() === 409 || res.status() === 404) {
      failedRequests.push({ url: res.url(), status: res.status() });
    }
  });

  try {
    // 3. Step 1: Submit check on /check
    await page.goto(`${BASE_URL}/check`, { waitUntil: "networkidle" });

    // Use Sample Offer: Fake Internship (TechCorp)
    await page.click("button:has-text('Fake Internship (TechCorp)')");
    const isConsentChecked = await page.isChecked("input[type='checkbox']");
    assert.ok(isConsentChecked, "Consent must be checked");

    await page.click("button[type='submit']");

    // Wait for navigation to /check/<id>
    await page.waitForURL(/\/check\/[0-9a-fA-F-]+/, { timeout: 60000 });
    const checkUrl = page.url();
    const checkId = checkUrl.split("/check/")[1].split("?")[0].replace(/\/$/, "");
    assert.ok(checkId, "Expected valid checkId from URL");

    // 4. Step 2: Confirmation view
    const confirmButtonSelector = "button:has-text('Confirm & Start Multi-Agent Check')";
    await page.waitForSelector(confirmButtonSelector, { timeout: 30000 });

    const initialButton = page.locator(confirmButtonSelector);
    assert.ok(await initialButton.isVisible(), "Confirm button must be visible in awaiting_confirmation");
    assert.ok(await initialButton.isEnabled(), "Confirm button must initially be enabled");

    // 5. Test rapid double-clicking / fast repeat click
    // Both clicks are dispatched rapidly. The button must disable immediately and not produce 409.
    await initialButton.click({ clickCount: 2, delay: 50 }).catch(() => {});

    // Give browser 500ms to update DOM state
    await page.waitForTimeout(500);

    // Verify button is now disabled (or unmounted if already in phase 2)
    const isButtonStillVisible = await initialButton.isVisible().catch(() => false);
    if (isButtonStillVisible) {
      const isEnabled = await initialButton.isEnabled().catch(() => false);
      assert.equal(isEnabled, false, "Confirm button must be disabled immediately after click");
    }

    // Assert NO 409 conflict responses occurred
    const conflictErrors = failedRequests.filter((r) => r.status === 409);
    assert.equal(conflictErrors.length, 0, `Expected 0 409 Conflict errors, got: ${JSON.stringify(conflictErrors)}`);

    // 6. Step 3: Phase 2 - Multi-agent investigation in progress
    try {
      await page.waitForSelector("text=Multi-Agent Investigation in Progress", { timeout: 30000 });
    } catch (e) {
      console.log("Current body text on timeout:", (await page.innerText("body")).slice(0, 500));
      throw e;
    }

    // Wait for timeline events from at least 3 distinct specialist agents
    const agentsObserved = new Set();
    const startTime = Date.now();
    while (agentsObserved.size < 3 && Date.now() - startTime < 20000) {
      const pageText = await page.innerText("body").catch(() => "");
      if (pageText.includes("message_analyst") || pageText.includes("Message & Offer Analyst")) agentsObserved.add("message_analyst");
      if (pageText.includes("classifier_client") || pageText.includes("ML Scam Classifier")) agentsObserved.add("classifier_client");
      if (pageText.includes("website_forensics") || pageText.includes("Domain & Web Forensics")) agentsObserved.add("website_forensics");
      if (pageText.includes("payment_entity") || pageText.includes("Payment & UPI Verifier")) agentsObserved.add("payment_entity");
      if (pageText.includes("official_verifier") || pageText.includes("Official Registry Verifier")) agentsObserved.add("official_verifier");
      if (pageText.includes("reputation_osint") || pageText.includes("Community & OSINT Search")) agentsObserved.add("reputation_osint");

      if (agentsObserved.size >= 3) break;
      await page.waitForTimeout(1000);
    }

    assert.ok(
      agentsObserved.size >= 3,
      `Expected events from at least 3 agents in live timeline, observed ${agentsObserved.size}: ${Array.from(agentsObserved).join(", ")}`
    );

    // 7. Step 4: Refresh page during investigation
    // Assert page reloads without 404, does not reset to confirm view, and continues investigation/report
    await page.reload({ waitUntil: "networkidle" });

    // Verify not a 404 error page
    const pageTextAfterReload = await page.innerText("body");
    assert.ok(!pageTextAfterReload.includes("Unable to Load Check"), "Page must not show 404 / Unable to Load Check after reload");
    assert.ok(!pageTextAfterReload.includes("Check not found or expired"), "Check must not be 404 not found after reload");

    // 8. Step 5: Wait for final report to render
    // Investigation finishes within 60 seconds (accounting for 25s per-agent timeout)
    await page.waitForSelector("text=Assessed Risk Level", { timeout: 60000 });
    await page.waitForFunction(
      () => /What to Verify Next/i.test(document.body.innerText) || /Checklist/i.test(document.body.innerText),
      { timeout: 60000 }
    );

    const finalBodyText = await page.innerText("body");
    assert.ok(finalBodyText.includes("Opportunity Risk Assessment"), "Final report header must be displayed");
    assert.ok(/assessed risk level/i.test(finalBodyText), "Report must display Assessed Risk Level banner");
    assert.ok(
      finalBodyText.includes("HIGH RISK") || finalBodyText.includes("MEDIUM RISK") || finalBodyText.includes("CANNOT VERIFY") || finalBodyText.includes("LOW RISK"),
      "Report must display calculated risk level badge"
    );
    assert.ok(
      /What to Verify Next/i.test(finalBodyText) || /Checklist/i.test(finalBodyText),
      "Checklist must be visible"
    );

    // Assert NO 404 errors occurred during the entire user flow
    const notFoundErrors = failedRequests.filter((r) => r.status === 404 && r.url.includes("/api/checks"));
    assert.equal(notFoundErrors.length, 0, `Expected 0 404 errors for check routes, got: ${JSON.stringify(notFoundErrors)}`);
  } finally {
    await browser.close();
  }
});
