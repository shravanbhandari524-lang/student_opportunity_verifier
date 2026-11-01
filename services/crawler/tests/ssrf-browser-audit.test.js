import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { isSafeUrlAsync } from '../src/urlGuard.js';

test('SSRF Audit: Direct navigations and subframes to private IPs are intercepted and blocked', async () => {
  const blockedRequests = [];

  const testServer = http.createServer((req, res) => {
    if (req.url === '/page-with-private-iframe') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Test</h1><iframe src="http://127.0.0.1:9999/admin"></iframe></body></html>');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const port = testServer.address().port;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({
    acceptDownloads: false
  });

  await context.route('**/*', async (route) => {
    const reqUrl = route.request().url();
    if (reqUrl.startsWith(`http://127.0.0.1:${port}/`)) {
      return route.continue();
    }

    const safe = await isSafeUrlAsync(reqUrl);
    if (!safe.safe) {
      blockedRequests.push({ url: reqUrl, reason: safe.reason });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  try {
    // 1. Direct navigation to private IP is blocked
    const page1 = await context.newPage();
    try {
      await page1.goto('http://127.0.0.1:8080/admin', { timeout: 3000 });
      assert.fail('Should fail');
    } catch (err) {
      assert.match(err.message, /net::ERR_FAILED|BLOCKED|blockedbyclient/i);
    }
    await page1.close().catch(() => {});
    assert.ok(blockedRequests.some((r) => r.url.includes('127.0.0.1:8080')));

    // 2. Subframe to private IP is blocked
    const page2 = await context.newPage();
    await page2.goto(`http://127.0.0.1:${port}/page-with-private-iframe`, { waitUntil: 'domcontentloaded', timeout: 5000 });
    await new Promise((r) => setTimeout(r, 200));
    await page2.close().catch(() => {});
    assert.ok(
      blockedRequests.some((r) => r.url.includes('127.0.0.1:9999')),
      'Subframe to private IP must be intercepted and blocked'
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => testServer.close(resolve));
  }
});

test('SSRF Audit: Chromium DNS & Redirect Bypass Vulnerability Verification', async () => {
  // Test proves that Chromium follows HTTP redirects internally and resolves DNS independently.
  // When a server issues a 302 redirect, Chromium does not invoke context.route for the redirect target,
  // and Chromium resolves DNS on its own, bypassing Node-level checks (e.g. via DNS rebinding or redirect to metadata).
  let redirectHopIntercepted = false;

  const redirectServer = http.createServer((req, res) => {
    if (req.url === '/start-redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });

  await new Promise((resolve) => redirectServer.listen(0, '127.0.0.1', resolve));
  const port = redirectServer.address().port;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const context = await browser.newContext({ acceptDownloads: false });

  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('169.254.169.254')) {
      redirectHopIntercepted = true;
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${port}/start-redirect`, { timeout: 2000 });
  } catch {
    // Navigation error expected
  } finally {
    await browser.close();
    await new Promise((resolve) => redirectServer.close(resolve));
  }

  // Demonstration: In standard Playwright with route.continue(), redirectHopIntercepted is false
  // because Chromium resolves and follows the redirect chain internally in the network stack!
  assert.equal(
    redirectHopIntercepted,
    false,
    'Chromium handles HTTP redirect chains internally without invoking context.route on document navigations'
  );
});
