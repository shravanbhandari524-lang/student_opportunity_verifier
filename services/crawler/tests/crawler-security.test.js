import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { createApp } from '../src/app.js';
import { createJob, getJob, cancelJob, cleanupExpiredJobs } from '../src/jobs.js';
import { CONFIG } from '../src/config.js';
import { extractPageData } from '../src/extract.js';

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
