process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../lib/db/migrations/index.js';
import {
  createCheck,
  getCheck,
  updateStatus,
  addEntities,
  createCrawl,
  getCrawl,
  markCrawlDone,
  markCrawlFailed,
  deleteExpired
} from '../lib/db/index.js';
import { runCrawl } from '../lib/crawler.js';
import { runCleanup } from '../lib/cleanup.js';
import { POST, GET } from '../app/api/checks/[id]/crawl/route.js';
import { createRateLimiter } from '../lib/api/rate-limit.js';
import { createJobRunner } from '../lib/api/jobs.js';

function setupTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function setReportReady(checkId, db) {
  updateStatus(checkId, 'extracting', db);
  updateStatus(checkId, 'awaiting_confirmation', db);
  updateStatus(checkId, 'investigating', db);
  updateStatus(checkId, 'scoring', db);
  updateStatus(checkId, 'report_ready', db);
}

function createTestRuntime(db, { maxConcurrent = 1 } = {}) {
  const rateLimiters = {
    actionCheck: createRateLimiter({ windowMs: 60000, max: 15 }),
  };
  const crawlJobRunner = createJobRunner({ maxConcurrent });
  const jobRunner = createJobRunner({ maxConcurrent: 4 });
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  return { db, rateLimiters, crawlJobRunner, jobRunner, logger };
}

test('lib/crawler.js: missing CRAWLER_API_KEY returns CRAWLER_UNAVAILABLE with crawler_not_configured', async () => {
  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ jobId: '123' }), { status: 202 });
  };

  const res = await runCrawl('https://example.com', {
    apiKey: '',
    customEnv: { CRAWLER_API_KEY: '' },
    fetchFn: mockFetch
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, 'CRAWLER_UNAVAILABLE');
  assert.equal(res.reason, 'crawler_not_configured');
  assert.equal(fetchCalled, false, 'Must not make any network request when API key is missing');
});

test('lib/crawler.js: handles service down, busy, and invalid response', async () => {
  // 1. Service down (fetch throws network error)
  const resDown = await runCrawl('https://example.com', {
    apiKey: 'valid_key',
    fetchFn: async () => {
      throw new Error('fetch failed ECONNREFUSED');
    }
  });
  assert.equal(resDown.ok, false);
  assert.equal(resDown.code, 'CRAWLER_UNAVAILABLE');
  assert.equal(resDown.reason, 'service_down');

  // 2. Busy service (503 / 429)
  const resBusy = await runCrawl('https://example.com', {
    apiKey: 'valid_key',
    fetchFn: async () => {
      return new Response('Busy', { status: 503 });
    }
  });
  assert.equal(resBusy.ok, false);
  assert.equal(resBusy.code, 'CRAWLER_UNAVAILABLE');
  assert.equal(resBusy.reason, 'busy');

  // 3. Invalid response (poll returns malformed result)
  let pollCount = 0;
  const resInvalid = await runCrawl('https://example.com', {
    apiKey: 'valid_key',
    sleepFn: () => Promise.resolve(),
    fetchFn: async (url, opts) => {
      if (opts.method === 'POST') {
        return new Response(JSON.stringify({ jobId: 'job_inv_1' }), { status: 202 });
      }
      pollCount++;
      return new Response(
        JSON.stringify({
          jobId: 'job_inv_1',
          status: 'completed',
          result: { pages: 'invalid_pages_array' } // Invalid shape
        }),
        { status: 200 }
      );
    }
  });
  assert.equal(resInvalid.ok, false);
  assert.equal(resInvalid.code, 'CRAWLER_UNAVAILABLE');
  assert.equal(resInvalid.reason, 'invalid_response');
});

test('POST & GET /api/checks/:id/crawl: pre-condition validations', async () => {
  const db = setupTestDb();
  const runtime = createTestRuntime(db);

  // 1. Check not found
  const reqNotFound = new Request('http://localhost/api/checks/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityId: '1' })
  });
  const resNotFound = await POST(reqNotFound, {
    params: Promise.resolve({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    runtime
  });
  assert.equal(resNotFound.status, 404);

  // Create real check in 'investigating' status
  const check = createCheck({ language: 'en' }, db);
  const checkId = check.id;

  // 2. Check not report_ready -> 409 STATE_CONFLICT
  const reqNotReady = new Request(`http://localhost/api/checks/${checkId}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityId: '1' })
  });
  const resNotReady = await POST(reqNotReady, {
    params: Promise.resolve({ id: checkId }),
    runtime
  });
  assert.equal(resNotReady.status, 409);

  // Transition check to report_ready
  setReportReady(checkId, db);

  // 3. Entity missing -> 400 CRAWL_NOT_ALLOWED
  const reqEntityMissing = new Request(`http://localhost/api/checks/${checkId}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entityId: '999' })
  });
  const resEntityMissing = await POST(reqEntityMissing, {
    params: Promise.resolve({ id: checkId }),
    runtime
  });
  assert.equal(resEntityMissing.status, 400);
  const bodyMissing = await resEntityMissing.json();
  assert.equal(bodyMissing.code, 'CRAWL_NOT_ALLOWED');

  // Add entities: one unconfirmed, one non-url, one private-ip, one confirmed domain
  addEntities(
    checkId,
    [
      { kind: 'domain', value: 'unconfirmed.com', source: 'extracted', confirmed: false },
      { kind: 'upi', value: 'merchant@upi', source: 'user', confirmed: true },
      { kind: 'url', value: 'http://127.0.0.1:8080/admin', source: 'user', confirmed: true },
      { kind: 'domain', value: 'legitimate-portal.org', source: 'user', confirmed: true }
    ],
    db
  );

  const entities = db.prepare('SELECT * FROM entities WHERE check_id = ?').all(checkId);
  const unconfirmedEnt = entities.find((e) => e.value === 'unconfirmed.com');
  const upiEnt = entities.find((e) => e.kind === 'upi');
  const privateEnt = entities.find((e) => e.value === 'http://127.0.0.1:8080/admin');
  const validEnt = entities.find((e) => e.value === 'legitimate-portal.org');

  // Mark all except unconfirmedEnt as confirmed
  db.prepare('UPDATE entities SET confirmed = 1 WHERE id IN (?, ?, ?)').run(upiEnt.id, privateEnt.id, validEnt.id);

  // 4. Unconfirmed entity -> 400 CRAWL_NOT_ALLOWED
  const resUnconf = await POST(
    new Request(`http://localhost/api/checks/${checkId}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(unconfirmedEnt.id) })
    }),
    { params: Promise.resolve({ id: checkId }), runtime }
  );
  assert.equal(resUnconf.status, 400);

  // 5. Non-URL entity -> 400 CRAWL_NOT_ALLOWED
  const resNonUrl = await POST(
    new Request(`http://localhost/api/checks/${checkId}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(upiEnt.id) })
    }),
    { params: Promise.resolve({ id: checkId }), runtime }
  );
  assert.equal(resNonUrl.status, 400);

  // 6. Private IP / SSRF violation -> 400 CRAWL_NOT_ALLOWED
  const resPrivate = await POST(
    new Request(`http://localhost/api/checks/${checkId}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(privateEnt.id) })
    }),
    { params: Promise.resolve({ id: checkId }), runtime }
  );
  assert.equal(resPrivate.status, 400);

  // 7. GET /api/checks/:id/crawl before any crawl -> status: 'not_started'
  const resGetInit = await GET(
    new Request(`http://localhost/api/checks/${checkId}/crawl?entityId=${validEnt.id}`),
    { params: Promise.resolve({ id: checkId }), runtime }
  );
  assert.equal(resGetInit.status, 200);
  const dataGetInit = await resGetInit.json();
  assert.equal(dataGetInit.status, 'not_started');
});

test('POST & GET /api/checks/:id/crawl: happy path, idempotency, retry on failure, and concurrency saturation', async () => {
  const db = setupTestDb();
  const runtime = createTestRuntime(db, { maxConcurrent: 1 });

  const check = createCheck({ language: 'en' }, db);
  const checkId = check.id;
  setReportReady(checkId, db);

  addEntities(checkId, [{ kind: 'domain', value: 'example-target.com', source: 'user', confirmed: true }], db);
  const entity = db.prepare('SELECT * FROM entities WHERE check_id = ?').get(checkId);

  const mockCrawlResult = {
    pages: [{ url: 'https://example-target.com/', finalUrl: 'https://example-target.com/', status: 200, title: 'Target', textExcerpt: 'Home', linkCount: 0 }],
    forms: [],
    externalDomains: [],
    truncated: false,
    limitsUsed: { maxPages: 10, maxDepth: 2, totalTimeSec: 2, totalBytesReceived: 500, sameHostOnly: true }
  };

  let serviceCrawlInvocations = 0;
  let crawlResolver;
  const mockCrawlerOptions = {
    apiKey: 'mock_key',
    fetchFn: async () => {
      serviceCrawlInvocations++;
      await new Promise((r) => {
        crawlResolver = r;
      });
      return new Response(JSON.stringify({ jobId: 'j1' }), { status: 202 });
    }
  };

  // Mock dnsResolver to allow example-target.com
  const dnsResolver = async () => ['93.184.216.34'];

  // 1. Initial POST triggers crawl -> 202 Accepted
  const postRes1 = await POST(
    new Request(`http://localhost/api/checks/${checkId}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(entity.id) })
    }),
    {
      params: Promise.resolve({ id: checkId }),
      runtime,
      dnsResolver,
      crawlerOptions: mockCrawlerOptions
    }
  );
  assert.equal(postRes1.status, 202);
  const postData1 = await postRes1.json();
  assert.equal(postData1.status, 'running');

  // 2. Idempotent second POST while running -> returns 200 with { status: "running" } without starting second job
  const postRes2 = await POST(
    new Request(`http://localhost/api/checks/${checkId}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(entity.id) })
    }),
    {
      params: Promise.resolve({ id: checkId }),
      runtime,
      dnsResolver,
      crawlerOptions: mockCrawlerOptions
    }
  );
  assert.equal(postRes2.status, 200);
  const postData2 = await postRes2.json();
  assert.equal(postData2.status, 'running');
  assert.equal(serviceCrawlInvocations, 1, 'Service must only be invoked once for running crawl');

  // 3. Concurrency limit saturation: another check attempting to crawl returns 503 SERVICE_UNAVAILABLE with Retry-After: 10
  const check2 = createCheck({ language: 'en' }, db);
  setReportReady(check2.id, db);
  addEntities(check2.id, [{ kind: 'domain', value: 'another-target.com', source: 'user', confirmed: true }], db);
  const ent2 = db.prepare('SELECT * FROM entities WHERE check_id = ?').get(check2.id);

  const postResSaturated = await POST(
    new Request(`http://localhost/api/checks/${check2.id}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(ent2.id) })
    }),
    {
      params: Promise.resolve({ id: check2.id }),
      runtime,
      dnsResolver,
      crawlerOptions: mockCrawlerOptions
    }
  );
  assert.equal(postResSaturated.status, 503);
  assert.equal(postResSaturated.headers.get('Retry-After'), '10');

  // 4. GET /api/checks/:id/crawl while running -> { status: "running" }
  const getRunning = await GET(
    new Request(`http://localhost/api/checks/${checkId}/crawl?entityId=${entity.id}`),
    { params: Promise.resolve({ id: checkId }), runtime }
  );
  assert.equal(getRunning.status, 200);
  const getRunningData = await getRunning.json();
  assert.equal(getRunningData.status, 'running');

  // Complete crawl in DB
  markCrawlDone(checkId, String(entity.id), mockCrawlResult, new Date().toISOString(), db);
  if (crawlResolver) crawlResolver();

  // 5. GET /api/checks/:id/crawl when done -> { status: "done", result }
  const getDone = await GET(
    new Request(`http://localhost/api/checks/${checkId}/crawl?entityId=${entity.id}`),
    { params: Promise.resolve({ id: checkId }), runtime }
  );
  assert.equal(getDone.status, 200);
  const getDoneData = await getDone.json();
  assert.equal(getDoneData.status, 'done');
  assert.equal(getDoneData.result.pages[0].url, 'https://example-target.com/');

  // 6. POST when already done -> returns 200 with result without invoking service
  const postResDone = await POST(
    new Request(`http://localhost/api/checks/${checkId}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(entity.id) })
    }),
    {
      params: Promise.resolve({ id: checkId }),
      runtime,
      dnsResolver,
      crawlerOptions: mockCrawlerOptions
    }
  );
  assert.equal(postResDone.status, 200);
  const postDoneData = await postResDone.json();
  assert.equal(postDoneData.status, 'done');
  assert.equal(postDoneData.result.pages.length, 1);

  // 7. Retrying a failed crawl:
  // Mark crawl as failed
  markCrawlFailed(checkId, String(entity.id), 'DNS_FAILED', new Date().toISOString(), db);
  const getFailed = await GET(
    new Request(`http://localhost/api/checks/${checkId}/crawl?entityId=${entity.id}`),
    { params: Promise.resolve({ id: checkId }), runtime }
  );
  assert.equal((await getFailed.json()).status, 'failed');

  // A new POST resets the failed crawl and starts again -> 202 Accepted
  const postRetry = await POST(
    new Request(`http://localhost/api/checks/${checkId}/crawl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId: String(entity.id) })
    }),
    {
      params: Promise.resolve({ id: checkId }),
      runtime,
      dnsResolver,
      crawlerOptions: { apiKey: 'key', fetchFn: async () => new Response(JSON.stringify({ jobId: 'j2' }), { status: 202 }) }
    }
  );
  assert.equal(postRetry.status, 202);
  const crawlReset = getCrawl(checkId, String(entity.id), db);
  assert.equal(crawlReset.status, 'running');
  assert.equal(crawlReset.errorCode, null);
});

test('Cleanup: stale sweep transitions running crawls > 5 min to failed with server_restart; cascade deletes crawl row', async () => {
  const db = setupTestDb();

  const check = createCheck({ language: 'en' }, db);
  const checkId = check.id;

  // Insert stale crawl started 10 minutes ago
  const staleStartTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  createCrawl(checkId, 'ent_1', staleStartTime, db);

  // Insert fresh crawl started 1 minute ago
  const freshStartTime = new Date(Date.now() - 60 * 1000).toISOString();
  createCrawl(checkId, 'ent_2', freshStartTime, db);

  // Run cleanup
  const cleanupRes = await runCleanup({ db, uploadDir: './data/test_cleanup_uploads' });
  assert.equal(cleanupRes.staleCrawlsRecovered >= 1, true, 'Must recover at least 1 stale crawl');

  const staleCrawl = getCrawl(checkId, 'ent_1', db);
  assert.equal(staleCrawl.status, 'failed');
  assert.equal(staleCrawl.errorCode, 'server_restart');

  const freshCrawl = getCrawl(checkId, 'ent_2', db);
  assert.equal(freshCrawl.status, 'running', 'Fresh crawl must remain running');

  // Cascade delete test: delete parent check and assert all crawl_results rows deleted
  db.prepare('DELETE FROM checks WHERE id = ?').run(checkId);
  const crawlRows = db.prepare('SELECT * FROM crawl_results WHERE check_id = ?').all(checkId);
  assert.equal(crawlRows.length, 0, 'Foreign key cascade must delete all crawl_results rows');
});
