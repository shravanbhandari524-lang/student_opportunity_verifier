import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { launchCrawlBrowser } from '../src/crawler.js';

test('Production path & Redirect control: Positive redirect (A -> B) succeeds; Negative redirect (A -> Loopback) is blocked with 403 (canary hits = 0)', async () => {
  let canaryHits = 0;
  const canaryServer = http.createServer((req, res) => {
    canaryHits++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('INTERNAL_SECRET_LEAK');
  });
  await new Promise((resolve) => canaryServer.listen(0, '127.0.0.1', resolve));
  const canaryPort = canaryServer.address().port;

  // Server A (Stand-in public host A)
  const serverA = http.createServer((req, res) => {
    if (req.url === '/redirect-to-b') {
      res.writeHead(302, { Location: 'http://site-b.test/landing' });
      res.end();
      return;
    }
    if (req.url === '/redirect-to-canary') {
      res.writeHead(302, { Location: `http://127.0.0.1:${canaryPort}/secret` });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>Server A Home</body></html>');
  });
  await new Promise((resolve) => serverA.listen(0, '127.0.0.1', resolve));
  const portA = serverA.address().port;

  // Server B (Stand-in public host B)
  const serverB = http.createServer((req, res) => {
    if (req.url === '/landing') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Welcome to Host B</h1></body></html>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Host B Home');
  });
  await new Promise((resolve) => serverB.listen(0, '127.0.0.1', resolve));
  const portB = serverB.address().port;

  // Injectable resolver: maps site-a.test -> 93.184.216.34 and site-b.test -> 93.184.216.35
  const injectedResolver = async (host) => {
    if (host === 'site-a.test') return [{ address: '93.184.216.34', family: 4 }];
    if (host === 'site-b.test') return [{ address: '93.184.216.35', family: 4 }];
    return [{ address: '127.0.0.1', family: 4 }];
  };

  // Injectable connector: routes pinned IPs to local server ports
  const injectedConnector = (connOpts, cb) => {
    if (connOpts.host === '93.184.216.34') {
      return net.createConnection({ host: '127.0.0.1', port: portA }, cb);
    }
    if (connOpts.host === '93.184.216.35') {
      return net.createConnection({ host: '127.0.0.1', port: portB }, cb);
    }
    return net.createConnection(connOpts, cb);
  };

  const decisionLog = [];
  const crawlBrowser = await launchCrawlBrowser({
    resolver: injectedResolver,
    connector: injectedConnector,
    onDecision: (entry) => {
      // Per-request decision log: host, port, decision, status (no query strings)
      decisionLog.push({ host: entry.host, port: entry.port, decision: entry.decision, status: entry.status });
    }
  });

  const { context } = crawlBrowser;

  try {
    // Control A: POSITIVE CONTROL (redirect from stand-in host A to stand-in host B succeeds)
    const pagePos = await context.newPage();
    const posRes = await pagePos.goto('http://site-a.test/redirect-to-b', {
      waitUntil: 'domcontentloaded',
      timeout: 5000
    });
    const posContent = await pagePos.content();
    assert.equal(posRes.status(), 200, 'Host B must return 200 OK after redirect');
    assert.match(posContent, /Welcome to Host B/, 'Must reach destination on Host B');
    assert.equal(pagePos.url(), 'http://site-b.test/landing', 'Final URL must be Host B');
    await pagePos.close();

    // Check decision log for positive control
    const allowedA = decisionLog.find((d) => d.host === 'site-a.test' && d.decision === 'allow');
    const allowedB = decisionLog.find((d) => d.host === 'site-b.test' && d.decision === 'allow');
    assert.ok(allowedA, 'Hop 1 site-a.test must be allowed in decision log');
    assert.ok(allowedB, 'Hop 2 site-b.test must be allowed in decision log');

    // Control B: NEGATIVE CONTROL (redirect from stand-in host A to 127.0.0.1:<canaryPort> is blocked)
    const pageNeg = await context.newPage();
    let negRes = null;
    let negError = null;
    try {
      negRes = await pageNeg.goto('http://site-a.test/redirect-to-canary', { timeout: 3000 });
    } catch (err) {
      negError = err;
    }
    await pageNeg.close();

    // Either navigation threw network abort or received 403 Forbidden from safeProxy
    if (negRes) {
      assert.equal(negRes.status(), 403, 'Response status must be 403 Forbidden');
    } else {
      assert.ok(negError, 'Navigation must fail or return 403');
    }
    assert.equal(canaryHits, 0, 'Canary server on 127.0.0.1 must NEVER receive any hit via redirect');

    // Check decision log for negative control: Hop 1 allowed, Hop 2 refused 403
    const blockedLoopback = decisionLog.find(
      (d) => d.host === '127.0.0.1' && d.decision === 'block' && d.status === 403
    );
    assert.ok(blockedLoopback, 'Hop 2 to 127.0.0.1 must be refused with 403 block in decision log');
  } finally {
    await crawlBrowser.close();
    await new Promise((resolve) => serverA.close(resolve));
    await new Promise((resolve) => serverB.close(resolve));
    await new Promise((resolve) => canaryServer.close(resolve));
  }
});

test('Layer Independence: proxy alone with disableContextRoute=true blocks loopback navigation, iframe, img/fetch, and 302 redirect', async () => {
  let canaryHits = 0;
  const canaryServer = http.createServer((req, res) => {
    canaryHits++;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('CANARY_REACHED');
  });
  await new Promise((resolve) => canaryServer.listen(0, '127.0.0.1', resolve));
  const canaryPort = canaryServer.address().port;

  // Local site hosting iframe, fetch, and redirect
  const hostServer = http.createServer((req, res) => {
    if (req.url === '/test-iframe') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><iframe src="http://127.0.0.1:${canaryPort}/iframe"></iframe></body></html>`);
      return;
    }
    if (req.url === '/test-fetch') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><body><img src="http://127.0.0.1:${canaryPort}/img.png"><script>fetch("http://127.0.0.1:${canaryPort}/api").catch(()=>{});</script></body></html>`
      );
      return;
    }
    if (req.url === '/test-redirect') {
      res.writeHead(302, { Location: `http://127.0.0.1:${canaryPort}/from-redirect` });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('OK');
  });
  await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
  const hostPort = hostServer.address().port;

  // Launch browser with disableContextRoute: true (Proxy layer alone must enforce all SSRF protections)
  const crawlBrowser = await launchCrawlBrowser({
    disableContextRoute: true,
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

  const { context } = crawlBrowser;

  try {
    // 1. Direct navigation to canary
    const p1 = await context.newPage();
    try {
      await p1.goto(`http://127.0.0.1:${canaryPort}/direct`, { timeout: 2000 });
    } catch {
      // Expected proxy 403 block
    }
    await p1.close();
    assert.equal(canaryHits, 0, 'Proxy alone must block direct navigation to canary');

    // 2. Iframe targeting canary
    const p2 = await context.newPage();
    await p2.goto('http://site.test/test-iframe', { waitUntil: 'domcontentloaded', timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    await p2.close();
    assert.equal(canaryHits, 0, 'Proxy alone must block iframe targeting canary');

    // 3. Img / fetch targeting canary
    const p3 = await context.newPage();
    await p3.goto('http://site.test/test-fetch', { waitUntil: 'domcontentloaded', timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    await p3.close();
    assert.equal(canaryHits, 0, 'Proxy alone must block img/fetch targeting canary');

    // 4. Redirect to canary
    const p4 = await context.newPage();
    try {
      await p4.goto('http://site.test/test-redirect', { timeout: 3000 });
    } catch {
      // Expected proxy 403 block
    }
    await p4.close();
    assert.equal(canaryHits, 0, 'Proxy alone must block redirect targeting canary');
  } finally {
    await crawlBrowser.close();
    await new Promise((resolve) => hostServer.close(resolve));
    await new Promise((resolve) => canaryServer.close(resolve));
  }
});

test('Read-only: context.route aborts non-GET/HEAD methods (POST fetch and form.submit() receive 0 server hits)', async () => {
  let postHits = 0;
  let formHits = 0;

  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      if (req.url === '/api/post-data') {
        postHits++;
      } else if (req.url === '/api/submit-form') {
        formHits++;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('POST_RECEIVED');
      return;
    }

    if (req.url === '/page') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <body>
          <h1>Read Only Test Page</h1>
          <form id="test-form" method="POST" action="http://site.test/api/submit-form">
            <input type="text" name="data" value="malicious_payload">
          </form>
        </body>
        </html>
      `);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  const blockedRequests = [];
  const crawlBrowser = await launchCrawlBrowser({
    resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    connector: (connOpts, cb) => net.createConnection({ host: '127.0.0.1', port: serverPort }, cb),
    onBlockedRequest: (info) => {
      blockedRequests.push(info);
    }
  });

  const { context } = crawlBrowser;

  try {
    const page = await context.newPage();
    await page.goto('http://site.test/page', { waitUntil: 'domcontentloaded', timeout: 5000 });

    // 1. Attempt JavaScript fetch with method: 'POST'
    await page.evaluate(async () => {
      try {
        await fetch('http://site.test/api/post-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field: 'value' })
        });
      } catch {
        // Expected fetch abort
      }
    });

    // 2. Attempt form.submit() from script
    await page.evaluate(() => {
      try {
        document.getElementById('test-form').submit();
      } catch {
        // Expected submit abort
      }
    });

    // Wait short delay to allow any unintercepted async network packets
    await new Promise((r) => setTimeout(r, 400));
    await page.close();

    // Verify stand-in server hit counts are exactly 0
    assert.equal(postHits, 0, 'Server must receive 0 hits from script fetch(..., { method: "POST" })');
    assert.equal(formHits, 0, 'Server must receive 0 hits from form.submit()');

    // Verify blockedRequests recorded the non-GET attempts
    assert.ok(
      blockedRequests.some((r) => r.reason.includes('POST not allowed')),
      'Blocked requests log must contain non-GET rejection'
    );
  } finally {
    await crawlBrowser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
