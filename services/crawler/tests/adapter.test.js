import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptCrawlResult, mapErrorCode } from '../src/adapter.js';

test('adapter: mapErrorCode maps stop reasons and error strings', () => {
  assert.equal(mapErrorCode('byteLimit'), 'BYTE_LIMIT');
  assert.equal(mapErrorCode('timeLimit'), 'TIMEOUT');
  assert.equal(mapErrorCode('maxPages'), 'TOO_MANY_PAGES');
  assert.equal(mapErrorCode('other', ['Disallowed by robots.txt']), 'ROBOTS_DENIED');
  assert.equal(mapErrorCode('other', ['DNS lookup failed for site.test']), 'DNS_FAILED');
  assert.equal(mapErrorCode('other', ['Blocked request: 127.0.0.1']), 'BLOCKED_HOST');
  assert.equal(mapErrorCode('other', ['502 Bad Gateway upstream']), 'UPSTREAM_ERROR');
  assert.equal(mapErrorCode('normal', []), undefined);
});

test('adapter: transforms raw crawler output and enforces textExcerpt limit', () => {
  const longText = 'Z'.repeat(3000);
  const raw = {
    pages: [
      {
        url: 'https://test.org/apply',
        finalUrl: 'https://test.org/apply-final',
        statusCode: 200,
        title: 'Apply Now',
        text: longText,
        links: { internal: ['https://test.org/faq'], external: ['https://other.com'] }
      }
    ],
    forms: [
      {
        actionHost: 'test.org',
        method: 'POST',
        fields: [{ type: 'text' }, { type: 'password' }],
        hasPassword: true,
        hasOtp: false,
        hasUpi: false,
        hasPayment: false
      }
    ],
    externalDomains: ['other.com', 'other.com'],
    truncated: true,
    limitsUsed: {
      maxPages: 10,
      maxDepth: 2,
      totalTimeSec: 15,
      totalBytesReceived: 1024,
      sameHostOnly: true
    },
    summary: {
      durationMs: 15000,
      stopReason: 'byteLimit'
    },
    errors: []
  };

  const adapted = adaptCrawlResult(raw);

  assert.equal(adapted.pages.length, 1);
  assert.equal(adapted.pages[0].url, 'https://test.org/apply');
  assert.equal(adapted.pages[0].status, 200);
  assert.equal(adapted.pages[0].linkCount, 2);
  assert.equal(adapted.pages[0].textExcerpt.length, 2000, 'textExcerpt must be sliced to 2000 chars');

  assert.equal(adapted.forms.length, 1);
  assert.deepEqual(adapted.forms[0].fieldTypes, ['text', 'password']);
  assert.equal(adapted.forms[0].hasPassword, true);

  assert.deepEqual(adapted.externalDomains, ['other.com'], 'External domains must be deduplicated');
  assert.equal(adapted.truncated, true);
  assert.equal(adapted.errorCode, 'BYTE_LIMIT');
});
