#!/usr/bin/env node
/**
 * scripts/crawler-live.js
 *
 * Runnable live verification script for crawler integration:
 *
 * PREREQUISITE: Start crawler service first in another terminal:
 *   npm run server --prefix services/crawler
 * (Or with custom env: CRAWLER_API_KEY=... PORT=3001 npm run server --prefix services/crawler)
 *
 * Then execute:
 *   node scripts/crawler-live.js
 *
 * This script:
 * 1. Exercises `runCrawl` against https://example.com/ (verifies exactly 1 page).
 * 2. Exercises `runCrawl` against https://quotes.toscrape.com/ with depth 1 (verifies >= 1 page, logs observation).
 * 3. Asserts each response validates against CrawlResultSchema.
 * 4. Exits with non-zero exit code if the crawler service is unreachable, an assertion fails,
 *    or schema validation fails.
 */

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import assert from "node:assert/strict";
import process from "node:process";
import { runCrawl } from "../lib/crawler.js";
import { CrawlResultSchema } from "../lib/contracts/crawl.js";
import { env } from "../lib/env.js";

async function main() {
  console.log("=== Crawler Live Verifier ===");
  console.log(`Connecting to Crawler Service at: ${env.CRAWLER_URL}`);

  // Target 1: https://example.com/
  console.log("\n[1/2] Crawling https://example.com/ (shallow single page)...");
  const result1 = await runCrawl("https://example.com/", {
    maxPages: 1,
    maxDepth: 0,
    apiKey: env.CRAWLER_API_KEY,
    crawlerUrl: env.CRAWLER_URL,
  });

  if (!result1.ok) {
    console.error(`ERROR: Failed crawling https://example.com/: code=${result1.code}, reason=${result1.reason}`);
    process.exit(1);
  }

  // Validate contract schema
  const parsed1 = CrawlResultSchema.safeParse(result1.result);
  if (!parsed1.success) {
    console.error("ERROR: CrawlResultSchema validation failed for example.com:", parsed1.error);
    process.exit(1);
  }

  assert.equal(
    result1.result.pages.length,
    1,
    `Expected exactly 1 page for example.com, got ${result1.result.pages.length}`
  );
  console.log(`✓ https://example.com/ crawled successfully: 1 page, title="${result1.result.pages[0]?.title}"`);

  // Target 2: https://quotes.toscrape.com/ with depth 1
  console.log("\n[2/2] Crawling https://quotes.toscrape.com/ (depth 1)...");
  const result2 = await runCrawl("https://quotes.toscrape.com/", {
    maxPages: 5,
    maxDepth: 1,
    apiKey: env.CRAWLER_API_KEY,
    crawlerUrl: env.CRAWLER_URL,
  });

  if (!result2.ok) {
    console.error(`ERROR: Failed crawling https://quotes.toscrape.com/: code=${result2.code}, reason=${result2.reason}`);
    process.exit(1);
  }

  const parsed2 = CrawlResultSchema.safeParse(result2.result);
  if (!parsed2.success) {
    console.error("ERROR: CrawlResultSchema validation failed for quotes.toscrape.com:", parsed2.error);
    process.exit(1);
  }

  assert.ok(
    result2.result.pages.length >= 1,
    `Expected at least 1 page for quotes.toscrape.com, got ${result2.result.pages.length}`
  );

  const formCount = result2.result.forms.length;
  const hasLoginForm = result2.result.forms.some((f) => f.hasPassword || (f.action && f.action.includes("login")));
  const externalDomains = result2.result.externalDomains;

  console.log(`✓ https://quotes.toscrape.com/ crawled successfully:`);
  console.log(`  - Pages crawled: ${result2.result.pages.length}`);
  console.log(`  - Forms found: ${formCount} (hasPassword/loginForm: ${hasLoginForm})`);
  console.log(`  - External domains referenced: ${externalDomains.length} (${externalDomains.slice(0, 3).join(", ")})`);
  console.log(`  - Limits used: maxPages=${result2.result.limitsUsed.maxPages}, totalBytes=${result2.result.limitsUsed.totalBytesReceived}`);

  console.log("\n=== Crawler Live Verification Succeeded ===");
}

main().catch((err) => {
  console.error("\nFATAL: crawler-live script failed:", err);
  process.exit(1);
});
