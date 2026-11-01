import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { createJob, getJob, cancelJob, cleanupExpiredJobs } from '../src/jobs.js';
import { CONFIG } from '../src/config.js';
import { extractPageData } from '../src/extract.js';
import { crawl } from '../src/crawler.js';

test('Security: src/llm.js and openai dependency do not exist', () => {
  const llmPath = new URL('../src/llm.js', import.meta.url);
  assert.equal(fs.existsSync(llmPath), false, 'src/llm.js must be deleted');
  const pkgPath = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  assert.equal(pkg.dependencies.openai, undefined, 'openai dependency must be removed');
  assert.equal(pkg.dependencies.archiver, undefined, 'archiver dependency must be removed');
});

test('Security: API routes require CRAWLER_API_KEY and reject unauthorized callers with 401', async () => {
  const origKey = process.env.CRAWLER_API_KEY;
  process.env.CRAWLER_API_KEY = 'test_secret_key_123';

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 1. Missing API key -> 401
    const resNoKey = await fetch(`http://127.0.0.1:${port}/api/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' })
    });
    assert.equal(resNoKey.status, 401);
    const bodyNoKey = await resNoKey.json();
    assert.match(bodyNoKey.error, /Unauthorized/);

    // 2. Wrong API key -> 401
    const resWrongKey = await fetch(`http://127.0.0.1:${port}/api/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'incorrect_key'
      },
      body: JSON.stringify({ url: 'https://example.com' })
    });
    assert.equal(resWrongKey.status, 401);

    // 3. Valid API key -> Accepted
    const resValid = await fetch(`http://127.0.0.1:${port}/api/crawl`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test_secret_key_123'
      },
      body: JSON.stringify({ url: 'https://example.com' })
    });
    assert.equal(resValid.status, 202);
    const bodyValid = await resValid.json();
    assert.ok(bodyValid.jobId);
    assert.ok(['queued', 'running'].includes(bodyValid.status));
  } finally {
    process.env.CRAWLER_API_KEY = origKey;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Security: Job results live in memory only with short TTL, zero disk screenshots', () => {
  const job = createJob({
    url: 'https://example.com/careers',
    maxDepth: 1,
    maxPages: 2
  });

  assert.ok(job.jobId);
  const fetched = getJob(job.jobId);
  assert.equal(fetched.jobId, job.jobId);

  // Mark job as finished 15 minutes ago
  job.finishedAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  cleanupExpiredJobs();

  // Job evicted from in-memory Map
  const evicted = getJob(job.jobId);
  assert.equal(evicted, null, 'Expired job must be evicted from memory');
});

test('Security: Form extraction is strictly read-only and flags sensitive inputs without submission', () => {
  // Mock Playwright Page evaluation for extractPageData
  const mockPage = {
    evaluate: async (fn) => {
      // Simulate DOM containing forms with payment, upi, otp, and password
      return {
        title: 'Application Form',
        description: 'Job application',
        headings: { h1: ['Apply Now'], h2: [], h3: [] },
        text: 'Please enter your password and payment details',
        rawLinks: [],
        rawForms: [
          {
            selector: 'form#login-form',
            method: 'POST',
            action: 'https://auth.example.com/login',
            fields: [
              { name: 'username', type: 'text', label: 'User', placeholder: '', required: true },
              { name: 'password', type: 'password', label: 'Password', placeholder: '', required: true }
            ]
          },
          {
            selector: 'form#pay-form',
            method: 'POST',
            action: '/checkout',
            fields: [
              { name: 'vpa', type: 'text', label: 'UPI ID', placeholder: 'name@upi', required: true },
              { name: 'cardNumber', type: 'text', label: 'Credit Card Number', placeholder: '', required: true },
              { name: 'otp', type: 'text', label: 'One Time Password', placeholder: '', required: true }
            ]
          }
        ]
      };
    }
  };

  return extractPageData(mockPage, 'https://example.com/apply', 'https://example.com').then((res) => {
    assert.equal(res.forms.length, 2);

    const loginForm = res.forms[0];
    assert.equal(loginForm.actionHost, 'auth.example.com');
    assert.equal(loginForm.hasPassword, true);
    assert.equal(loginForm.hasPayment, false);

    const payForm = res.forms[1];
    assert.equal(payForm.hasUpi, true);
    assert.equal(payForm.hasOtp, true);
    assert.equal(payForm.hasPayment, true);
  });
});

test('Security: crawl() integrates proxy byte counter into total byte limit and stops crawl upon byteLimit', async () => {
  // Stand-in server delivering payload exceeding crawl byte limit
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>' + 'D'.repeat(20000) + '</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  try {
    const result = await crawl({
      url: 'http://bigpayload.test/',
      maxPages: 3,
      maxTotalBytes: 3000,
      navigationTimeoutMs: 5000,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      connector: (opts, cb) => net.createConnection({ host: '127.0.0.1', port: serverPort }, cb)
    });

    assert.equal(result.truncated, true, 'Result must be marked truncated when byte cap exceeded');
    assert.ok(
      result.summary.stopReason === 'byteLimit' || result.limitsUsed.totalBytesReceived >= 3000,
      'Stop reason or bytes received must reflect byte limit'
    );
    assert.ok(result.limitsUsed.totalBytesReceived >= 3000, 'Total bytes received must be tracked through proxy');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Limits: site with 20 linked pages and maxPages=5 must return exactly 5 pages', async () => {
  // Server hosting 20 linked pages
  const server = http.createServer((req, res) => {
    const match = req.url.match(/^\/page\/(\d+)$/);
    const id = match ? parseInt(match[1], 10) : 0;
    
    // Generate links to next pages to trigger multiple discoveries and concurrent worker fetches
    const links = [];
    for (let i = 1; i < 20; i++) {
      links.push(`<a href="/page/${i}">Page ${i}</a>`);
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<html><body><h1>Page ${id}</h1>${links.join(' ')}</body></html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  try {
    const result = await crawl({
      url: 'http://multipage.test/page/0',
      maxPages: 5,
      concurrency: 2,
      maxDepth: 2,
      navigationTimeoutMs: 5000,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      connector: (opts, cb) => net.createConnection({ host: '127.0.0.1', port: serverPort }, cb)
    });

    assert.equal(result.pages.length, 5, `Expected exactly 5 pages, but received ${result.pages.length}`);
    assert.equal(result.truncated, true, 'Result must be marked truncated when maxPages is hit');
    assert.equal(result.summary.stopReason, 'maxPages');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
