import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {
  isBasicSafeUrl,
  isSafeUrlAsync,
  isPrivateIp,
  parseAndUnwrapIp,
  isBlockedSocialDomain,
  parseRobotsTxt,
  matchesRobotsRules,
  isCrawlTrap
} from '../src/urlGuard.js';

test('urlGuard: parseAndUnwrapIp handles decimal, hex, octal, and IPv4-mapped IPv6', () => {
  // Standard IPv4
  const v4 = parseAndUnwrapIp('127.0.0.1');
  assert.equal(v4.toString(), '127.0.0.1');

  // Decimal notation (2130706433 = 127.0.0.1)
  const dec = parseAndUnwrapIp('2130706433');
  assert.equal(dec.toString(), '127.0.0.1');

  // Hex notation (0x7f000001 = 127.0.0.1)
  const hex = parseAndUnwrapIp('0x7f.0.0.1');
  assert.equal(hex.toString(), '127.0.0.1');

  // Octal notation (0177.0.0.1 = 127.0.0.1)
  const oct = parseAndUnwrapIp('0177.0.0.1');
  assert.equal(oct.toString(), '127.0.0.1');

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 -> 127.0.0.1)
  const mapped = parseAndUnwrapIp('::ffff:127.0.0.1');
  assert.equal(mapped.toString(), '127.0.0.1');
});

test('urlGuard: isPrivateIp detects private, loopback, link-local, carrier-grade NAT, and cloud metadata', () => {
  // Loopback
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('127.0.0.2'), true);
  assert.equal(isPrivateIp('::1'), true);

  // Private RFC 1918
  assert.equal(isPrivateIp('10.0.5.1'), true);
  assert.equal(isPrivateIp('172.16.0.1'), true);
  assert.equal(isPrivateIp('172.31.255.255'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);

  // Link-local / Cloud metadata (AWS, GCP, Azure 169.254.169.254)
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('fe80::1'), true);

  // Carrier-grade NAT (100.64.0.0/10) and Alibaba metadata (100.100.100.200)
  assert.equal(isPrivateIp('100.64.0.1'), true);
  assert.equal(isPrivateIp('100.100.100.200'), true);

  // Public safe IPs
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('93.184.216.34'), false);
});

test('urlGuard: isBasicSafeUrl blocks disallowed schemes, credentials, and social media platforms', () => {
  // Disallowed schemes
  assert.equal(isBasicSafeUrl('ftp://example.com').safe, false);
  assert.equal(isBasicSafeUrl('file:///etc/passwd').safe, false);
  assert.equal(isBasicSafeUrl('javascript:alert(1)').safe, false);

  // Credentials in URL
  assert.equal(isBasicSafeUrl('http://admin:secret@example.com').safe, false);

  // Blocked hostnames
  assert.equal(isBasicSafeUrl('http://localhost:3000').safe, false);
  assert.equal(isBasicSafeUrl('http://sub.localhost').safe, false);
  assert.equal(isBasicSafeUrl('http://metadata.google.internal').safe, false);

  // Blocked social media platforms
  assert.equal(isBasicSafeUrl('https://instagram.com/careers').safe, false);
  assert.equal(isBasicSafeUrl('https://www.instagram.com/p/123').safe, false);
  assert.equal(isBasicSafeUrl('https://facebook.com/jobs').safe, false);
  assert.equal(isBasicSafeUrl('https://m.facebook.com/').safe, false);
  assert.equal(isBasicSafeUrl('https://linkedin.com/jobs/view/123').safe, false);
  assert.equal(isBasicSafeUrl('https://in.linkedin.com/in/someone').safe, false);

  // Public domain allowed
  assert.equal(isBasicSafeUrl('https://example.com/careers').safe, true);
});

test('urlGuard: isSafeUrlAsync resolves DNS and catches DNS resolving to private IP', async () => {
  // Test stubbing dns.lookup to simulate DNS resolving to loopback
  const origLookup = dns.lookup;
  dns.lookup = async (host) => {
    if (host === 'evil-internal.test') {
      return [{ address: '127.0.0.1', family: 4 }];
    }
    if (host === 'evil-metadata.test') {
      return [{ address: '169.254.169.254', family: 4 }];
    }
    if (host === 'good-domain.test') {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    return origLookup(host, { all: true });
  };

  try {
    const evil1 = await isSafeUrlAsync('http://evil-internal.test/jobs');
    assert.equal(evil1.safe, false);
    assert.match(evil1.reason, /blocked IP 127\.0\.0\.1/);

    const evil2 = await isSafeUrlAsync('http://evil-metadata.test/compute');
    assert.equal(evil2.safe, false);
    assert.match(evil2.reason, /blocked IP 169\.254\.169\.254/);

    const good = await isSafeUrlAsync('http://good-domain.test/internships');
    assert.equal(good.safe, true);
  } finally {
    dns.lookup = origLookup;
  }
});

test('urlGuard: respects robots.txt parse and allow/disallow rules', () => {
  const robotsText = `
User-agent: *
Disallow: /admin
Disallow: /private/
Allow: /private/public-notice
Disallow: /checkout
Sitemap: https://example.com/sitemap.xml
  `;

  const parsed = parseRobotsTxt(robotsText);
  assert.deepEqual(parsed.disallows, ['/admin', '/private/', '/checkout']);
  assert.deepEqual(parsed.allows, ['/private/public-notice']);

  // Disallowed
  assert.equal(matchesRobotsRules('https://example.com/admin', parsed), false);
  assert.equal(matchesRobotsRules('https://example.com/admin/settings', parsed), false);
  assert.equal(matchesRobotsRules('https://example.com/private/secret', parsed), false);

  // Allowed exception
  assert.equal(matchesRobotsRules('https://example.com/private/public-notice', parsed), true);
  assert.equal(matchesRobotsRules('https://example.com/careers', parsed), true);
});

test('urlGuard: detects repeating crawl trap patterns', () => {
  const patternCounts = new Map();
  const trapUrl = 'https://example.com/calendar/next/next/next/next/event';
  const trapCheck = isCrawlTrap(trapUrl, patternCounts, 5);
  assert.equal(trapCheck.trap, true);
  assert.match(trapCheck.reason, /Repeating path segment/);
});
