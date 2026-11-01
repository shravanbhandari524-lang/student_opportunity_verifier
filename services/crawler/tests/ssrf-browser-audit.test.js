import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { chromium } from 'playwright';
import { isSafeUrlAsync } from '../src/urlGuard.js';
import { createSafeProxy } from '../src/safeProxy.js';

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

test('SSRF Audit Regression: Chromium with safeProxy blocks 302 redirect to private IP (canary hits = 0)', async () => {
  let canaryHits = 0;
  const canaryServer = http.createServer((req, res) => {
    canaryHits++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('INTERNAL_LEAK');
  });
  await new Promise((resolve) => canaryServer.listen(0, '127.0.0.1', resolve));
  const canaryPort = canaryServer.address().port;

  // Stand-in public server that returns 302 to canary
  const mockPublicServer = http.createServer((req, res) => {
    if (req.url === '/redirect-target') {
      res.writeHead(302, { Location: `http://127.0.0.1:${canaryPort}/secret` });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>Safe Home</body></html>');
  });
  await new Promise((resolve) => mockPublicServer.listen(0, '127.0.0.1', resolve));
  const mockPublicPort = mockPublicServer.address().port;

  // Safe proxy with injected resolver mapping mock-public.test to 93.184.216.34 (public),
  // and connector routing 93.184.216.34 to mockPublicPort
  const proxy = await createSafeProxy({
    resolver: async (host) => {
      if (host === 'mock-public.test') {
        return [{ address: '93.184.216.34', family: 4 }];
      }
      return [{ address: '127.0.0.1', family: 4 }];
    },
    connector: (connOpts, cb) => {
      if (connOpts.host === '93.184.216.34') {
        return net.createConnection({ host: '127.0.0.1', port: mockPublicPort }, cb);
      }
      return net.createConnection(connOpts, cb);
    }
  });

  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `http://127.0.0.1:${proxy.port}`,
      bypass: '<-loopback>'
    },
    args: ['--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1']
  });

  const context = await browser.newContext({ acceptDownloads: false });
  const page = await context.newPage();

  try {
    try {
      await page.goto('http://mock-public.test/redirect-target', { timeout: 3000 });
    } catch {
      // Expected navigation failure when redirect is blocked with 403
    }

    assert.equal(canaryHits, 0, 'Canary server on 127.0.0.1 must NEVER receive any hit via redirect');
  } finally {
    await browser.close();
    await proxy.close();
    await new Promise((resolve) => mockPublicServer.close(resolve));
    await new Promise((resolve) => canaryServer.close(resolve));
  }
});

test('SSRF Audit: Direct navigation, iframe, and img/fetch to loopback are blocked via <-loopback> (canary hits = 0)', async () => {
  let canaryHits = 0;
  const canaryServer = http.createServer((req, res) => {
    canaryHits++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CANARY_REACHED');
  });
  await new Promise((resolve) => canaryServer.listen(0, '127.0.0.1', resolve));
  const canaryPort = canaryServer.address().port;

  // Local site hosting iframe and fetch
  const hostServer = http.createServer((req, res) => {
    if (req.url === '/test-iframe') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><iframe src="http://127.0.0.1:${canaryPort}/iframe"></iframe></body></html>`);
      return;
    }
    if (req.url === '/test-fetch') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><img src="http://127.0.0.1:${canaryPort}/img.png"><script>fetch("http://127.0.0.1:${canaryPort}/api").catch(()=>{});</script></body></html>`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('OK');
  });
  await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
  const hostPort = hostServer.address().port;

  const proxy = await createSafeProxy({
    resolver: async (host) => {
      if (host === 'site.test') return [{ address: '93.184.216.34', family: 4 }];
      return [{ address: '127.0.0.1', family: 4 }];
    },
    connector: (connOpts, cb) => {
      if (connOpts.host === '93.184.216.34') {
        return net.createConnection({ host: '127.0.0.1', port: hostPort }, cb);
      }
      return net.createConnection(connOpts, cb);
    }
  });

  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `http://127.0.0.1:${proxy.port}`,
      bypass: '<-loopback>'
    },
    args: ['--disable-quic', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1']
  });

  const context = await browser.newContext({ acceptDownloads: false });

  try {
    // 1. Direct navigation to canary
    const p1 = await context.newPage();
    try {
      await p1.goto(`http://127.0.0.1:${canaryPort}/direct`, { timeout: 2000 });
    } catch {
      // Expected blocked
    }
    await p1.close();
    assert.equal(canaryHits, 0, 'Direct navigation must not reach canary');

    // 2. Iframe targeting canary
    const p2 = await context.newPage();
    await p2.goto('http://site.test/test-iframe', { waitUntil: 'domcontentloaded', timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    await p2.close();
    assert.equal(canaryHits, 0, 'Iframe navigation must not reach canary');

    // 3. Img / fetch targeting canary
    const p3 = await context.newPage();
    await p3.goto('http://site.test/test-fetch', { waitUntil: 'domcontentloaded', timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    await p3.close();
    assert.equal(canaryHits, 0, 'Img/fetch request must not reach canary');
  } finally {
    await browser.close();
    await proxy.close();
    await new Promise((resolve) => hostServer.close(resolve));
    await new Promise((resolve) => canaryServer.close(resolve));
  }
});
