import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { CrawlResultSchema } from '../lib/contracts/crawl.js';
import { ApiErrorSchema } from '../lib/contracts/api-error.js';
import { API_ERROR_CODES, CRAWL_ERROR_CODES } from '../lib/contracts/enums.js';
import { getEnv } from '../lib/env.js';
import { runMigrations } from '../lib/db/migrations/index.js';

test('CrawlResult Contract: real fixture validates against CrawlResultSchema', () => {
  const fixturePath = new URL('../services/crawler/tests/fixtures/real-crawl-result.json', import.meta.url);
  assert.ok(fs.existsSync(fixturePath), 'Fixture real-crawl-result.json must exist');

  const rawJson = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const parsed = CrawlResultSchema.safeParse(rawJson);

  assert.equal(parsed.success, true, 'Fixture must strictly validate against CrawlResultSchema');
  const result = parsed.data;

  assert.ok(result.pages.length >= 1, 'Must contain at least 1 page');
  assert.equal(typeof result.pages[0].url, 'string');
  assert.equal(typeof result.pages[0].finalUrl, 'string');
  assert.equal(typeof result.pages[0].status, 'number');
  assert.equal(typeof result.pages[0].linkCount, 'number');

  assert.ok(result.forms.length >= 1, 'Must contain at least 1 form');
  assert.equal(result.forms[0].hasPassword, true);
  assert.equal(result.forms[0].hasUpi, true);

  assert.ok(result.externalDomains.includes('external-partner.org'));
  assert.equal(result.truncated, false);
  assert.equal(result.limitsUsed.maxPages, 3);
  assert.equal(result.limitsUsed.sameHostOnly, true);
});

test('CrawlResult Contract: validates error code variants and limits constraints', () => {
  const baseValid = {
    pages: [
      {
        url: 'https://example.com/',
        finalUrl: 'https://example.com/welcome',
        status: 200,
        title: 'Welcome',
        textExcerpt: 'Excerpt text',
        linkCount: 5
      }
    ],
    forms: [
      {
        actionHost: 'auth.example.com',
        method: 'POST',
        fieldTypes: ['text', 'password'],
        hasPassword: true,
        hasOtp: false,
        hasUpi: false,
        hasPayment: false
      }
    ],
    externalDomains: ['cdn.example.com'],
    truncated: true,
    limitsUsed: {
      maxPages: 10,
      maxDepth: 2,
      totalTimeSec: 45,
      totalBytesReceived: 512000,
      sameHostOnly: true
    }
  };

  for (const code of CRAWL_ERROR_CODES) {
    const candidate = { ...baseValid, errorCode: code };
    const res = CrawlResultSchema.safeParse(candidate);
    assert.equal(res.success, true, `Error code ${code} must be accepted`);
  }

  // Invalid error code is rejected
  const resBadCode = CrawlResultSchema.safeParse({ ...baseValid, errorCode: 'INVALID_CODE' });
  assert.equal(resBadCode.success, false);

  // Text excerpt exceeding 2000 chars is rejected
  const resOverExcerpt = CrawlResultSchema.safeParse({
    ...baseValid,
    pages: [{ ...baseValid.pages[0], textExcerpt: 'A'.repeat(2001) }]
  });
  assert.equal(resOverExcerpt.success, false);
});

test('API Error Codes: includes CRAWLER_UNAVAILABLE and CRAWL_NOT_ALLOWED', () => {
  assert.ok(API_ERROR_CODES.includes('CRAWLER_UNAVAILABLE'));
  assert.ok(API_ERROR_CODES.includes('CRAWL_NOT_ALLOWED'));

  const err1 = ApiErrorSchema.safeParse({
    code: 'CRAWLER_UNAVAILABLE',
    message: 'The crawler service is currently unavailable'
  });
  assert.equal(err1.success, true);

  const err2 = ApiErrorSchema.safeParse({
    code: 'CRAWL_NOT_ALLOWED',
    message: 'Entity does not qualify for crawl'
  });
  assert.equal(err2.success, true);
});

test('Environment: validates CRAWLER_URL and CRAWLER_API_KEY', () => {
  const parsed = getEnv({
    LLM_PROVIDER: 'mock',
    LLM_API_KEY: 'mock_key',
    LLM_MODEL: 'mock_model',
    CRAWLER_API_KEY: 'test_crawl_key'
  });

  assert.equal(parsed.CRAWLER_URL, 'http://127.0.0.1:3001', 'Default CRAWLER_URL must be 127.0.0.1:3001');
  assert.equal(parsed.CRAWLER_API_KEY, 'test_crawl_key');
});

test('Migration 012 & 013: crawl_results table creation, UNIQUE constraint, and cascade deletion', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Run migrations forward to version 13
  runMigrations(db);

  // 1. Table and indices exist
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes('crawl_results'), 'crawl_results table must exist after migration');

  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name);
  assert.ok(indices.includes('idx_crawl_results_check_id'), 'idx_crawl_results_check_id must exist');
  assert.ok(indices.includes('idx_crawl_results_entity_id'), 'idx_crawl_results_entity_id must exist');

  // 2. Insert check row
  const checkId = 'check_test_12345';
  db.prepare(`
    INSERT INTO checks (id, status, current_round, language, risk_level, score, confidence, created_at, updated_at, expires_at)
    VALUES (?, 'report_ready', 1, 'en', 'low', 10, 'high', datetime('now'), datetime('now'), datetime('now', '+1 day'))
  `).run(checkId);

  // 3. Insert running crawl_results row (result_json is null initially)
  const crawlId = 'crawl_test_999';
  const entityId = 'entity_domain_1';

  db.prepare(`
    INSERT INTO crawl_results (id, check_id, entity_id, status, started_at, created_at, updated_at)
    VALUES (?, ?, ?, 'running', datetime('now'), datetime('now'), datetime('now'))
  `).run(crawlId, checkId, entityId);

  const inserted = db.prepare('SELECT * FROM crawl_results WHERE id = ?').get(crawlId);
  assert.equal(inserted.id, crawlId);
  assert.equal(inserted.check_id, checkId);
  assert.equal(inserted.status, 'running');
  assert.equal(inserted.result_json, null);

  // 4. Verify UNIQUE(check_id, entity_id) constraint
  assert.throws(() => {
    db.prepare(`
      INSERT INTO crawl_results (id, check_id, entity_id, status, started_at, created_at, updated_at)
      VALUES ('crawl_duplicate', ?, ?, 'running', datetime('now'), datetime('now'), datetime('now'))
    `).run(checkId, entityId);
  }, /UNIQUE constraint failed/);

  // 5. Update to done with result_json
  const resultJson = JSON.stringify({ pages: [], forms: [], externalDomains: [], truncated: false, limitsUsed: { maxPages: 10, maxDepth: 2, totalTimeSec: 5, totalBytesReceived: 100, sameHostOnly: true } });
  db.prepare(`
    UPDATE crawl_results
    SET status = 'done', result_json = ?, finished_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(resultJson, crawlId);

  const doneRow = db.prepare('SELECT * FROM crawl_results WHERE id = ?').get(crawlId);
  assert.equal(doneRow.status, 'done');
  assert.ok(doneRow.finished_at);
  assert.ok(doneRow.result_json);

  // 6. Foreign key cascade delete: deleting checks row deletes crawl_results row
  db.prepare('DELETE FROM checks WHERE id = ?').run(checkId);
  const remaining = db.prepare('SELECT * FROM crawl_results WHERE id = ?').get(crawlId);
  assert.equal(remaining, undefined, 'crawl_results row must be deleted by cascade when parent check is deleted');

  db.close();
});
