import dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const BLOCKED_EXTENSIONS = new Set([
  'pdf', 'zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'exe', 'dmg',
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif',
  'mp3', 'mp4', 'wav', 'avi', 'mov', 'flv', 'mkv', 'webm',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'
]);

const SENSITIVE_KEYWORDS = ['logout', 'delete', 'checkout', 'payment'];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'instance-data',
  'metadata'
]);

const BLOCKED_SOCIAL_DOMAINS = [
  'instagram.com',
  'facebook.com',
  'linkedin.com'
];

// Cache robots.txt parsers per origin
const robotsCache = new Map();

/**
 * Checks if a hostname matches any blocked social media platform.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isBlockedSocialDomain(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');
  return BLOCKED_SOCIAL_DOMAINS.some(
    (domain) => host === domain || host.endsWith('.' + domain)
  );
}

/**
 * Checks whether two URLs belong to the same hostname/domain.
 *
 * @param {string} urlA
 * @param {string} urlB
 * @returns {boolean}
 */
export function isSameDomain(urlA, urlB) {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return a.hostname.toLowerCase() === b.hostname.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Parses and unwraps an IP string into a canonical IPv4 or IPv6 representation.
 * Handles decimal integers, hex, octal parts, and IPv4-mapped IPv6.
 *
 * @param {string} host
 * @returns {ipaddr.IPv4 | ipaddr.IPv6 | null}
 */
export function parseAndUnwrapIp(host) {
  if (!host) return null;
  let cleaned = host.trim();
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1);
  }

  // Pure integer / decimal notation like 2130706433
  if (/^\d+$/.test(cleaned)) {
    const num = Number(cleaned);
    if (!Number.isNaN(num) && num >= 0 && num <= 0xffffffff) {
      const part1 = (num >>> 24) & 255;
      const part2 = (num >>> 16) & 255;
      const part3 = (num >>> 8) & 255;
      const part4 = num & 255;
      cleaned = `${part1}.${part2}.${part3}.${part4}`;
    }
  }

  // Hex or octal notation parts, e.g. 0x7f.0.0.1 or 0177.0.0.1
  if (/^(0x[0-9a-fA-F]+|\d+)(\.(0x[0-9a-fA-F]+|\d+)){0,3}$/i.test(cleaned)) {
    const parts = cleaned.split('.');
    const normalizedParts = [];
    for (const p of parts) {
      let val;
      if (p.startsWith('0x') || p.startsWith('0X')) {
        val = parseInt(p, 16);
      } else if (p.length > 1 && p.startsWith('0')) {
        val = parseInt(p, 8);
      } else {
        val = parseInt(p, 10);
      }
      if (Number.isNaN(val) || val < 0 || val > 255) {
        return null;
      }
      normalizedParts.push(val);
    }
    while (normalizedParts.length < 4) {
      normalizedParts.push(0);
    }
    cleaned = normalizedParts.join('.');
  }

  try {
    if (ipaddr.IPv4.isValid(cleaned)) {
      return ipaddr.IPv4.parse(cleaned);
    }
    if (ipaddr.IPv6.isValid(cleaned)) {
      const addr = ipaddr.IPv6.parse(cleaned);
      if (addr.isIPv4MappedAddress()) {
        return addr.toIPv4Address();
      }
      return addr;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Checks if an IP string belongs to private, loopback, link-local, carrier-grade NAT,
 * or cloud metadata ranges.
 *
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const parsed = parseAndUnwrapIp(ip);
  if (!parsed) return false;

  const range = parsed.range();
  if (
    range === 'loopback' ||
    range === 'private' ||
    range === 'linkLocal' ||
    range === 'uniqueLocal' ||
    range === 'unspecified' ||
    range === 'carrierGradeNat' ||
    range === 'multicast' ||
    range === 'reserved'
  ) {
    return true;
  }

  const normalized = parsed.toString();
  // Cloud metadata addresses
  if (normalized === '169.254.169.254' || normalized === '100.100.100.200') {
    return true;
  }

  return false;
}

/**
 * Checks synchronous string safety (protocol, userinfo, blocked hostnames, social domains, raw IP ranges).
 *
 * @param {string} urlString
 * @returns {{ safe: boolean, reason?: string }}
 */
export function isBasicSafeUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { safe: false, reason: `Disallowed protocol: ${url.protocol}` };
    }

    if (url.username || url.password) {
      return { safe: false, reason: 'Credentials in URL are forbidden' };
    }

    const host = url.hostname.toLowerCase().trim().replace(/^\[|\]$/g, '');

    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) {
      return { safe: false, reason: `Blocked hostname: ${host}` };
    }

    if (isBlockedSocialDomain(host)) {
      return { safe: false, reason: `Blocked social media platform: ${host}` };
    }

    const parsedIp = parseAndUnwrapIp(host);
    if (parsedIp && isPrivateIp(parsedIp.toString())) {
      return { safe: false, reason: `Blocked private or loopback IP: ${host}` };
    }

    return { safe: true };
  } catch (err) {
    return { safe: false, reason: `Invalid URL: ${err.message}` };
  }
}

/**
 * Resolves DNS for the given URL and blocks private/reserved IPs.
 *
 * @param {string} urlString
 * @param {(host: string) => Promise<Array<{ address: string, family: number }>>} [resolver]
 * @returns {Promise<{ safe: boolean, reason?: string }>}
 */
export async function isSafeUrlAsync(urlString, resolver = (host) => dns.lookup(host, { all: true })) {
  const basic = isBasicSafeUrl(urlString);
  if (!basic.safe) return basic;

  try {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^\[|\]$/g, '');

    const parsedIp = parseAndUnwrapIp(host);
    if (parsedIp) {
      if (isPrivateIp(parsedIp.toString())) {
        return { safe: false, reason: `Blocked IP: ${host}` };
      }
      return { safe: true };
    }

    // Resolve DNS (IPv4 + IPv6)
    const records = await resolver(host);
    if (!records || records.length === 0) {
      return { safe: false, reason: `DNS lookup returned no addresses for ${host}` };
    }

    for (const record of records) {
      if (isPrivateIp(record.address)) {
        return {
          safe: false,
          reason: `DNS resolved ${host} to blocked IP ${record.address}`
        };
      }
    }

    return { safe: true };
  } catch (err) {
    return { safe: false, reason: `DNS resolution failed: ${err.message}` };
  }
}

/**
 * Normalizes URL: resolves against base, strips hash, drops tracking params,
 * and removes trailing slash if not root.
 *
 * @param {string} rawUrl
 * @param {string} [baseUrl]
 * @returns {string|null}
 */
export function normalizeUrl(rawUrl, baseUrl) {
  try {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return null;

    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith('mailto:') ||
      lower.startsWith('tel:') ||
      lower.startsWith('javascript:') ||
      lower.startsWith('data:')
    ) {
      return null;
    }

    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    parsed.hash = '';

    const searchParams = parsed.searchParams;
    const keysToDelete = [];
    for (const key of searchParams.keys()) {
      const k = key.toLowerCase();
      if (
        k.startsWith('utm_') ||
        k === 'fbclid' ||
        k === 'gclid' ||
        k === 'ref' ||
        k === 'source'
      ) {
        keysToDelete.push(key);
      }
    }
    for (const k of keysToDelete) {
      searchParams.delete(k);
    }
    searchParams.sort();

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Checks whether URL points to a static file extension or sensitive keyword.
 *
 * @param {string} urlString
 * @returns {boolean}
 */
export function shouldSkipUrl(urlString) {
  try {
    const url = new URL(urlString);
    const pathname = url.pathname.toLowerCase();

    const lastSegment = pathname.split('/').pop() || '';
    if (lastSegment.includes('.')) {
      const ext = lastSegment.split('.').pop();
      if (BLOCKED_EXTENSIONS.has(ext)) {
        return true;
      }
    }

    for (const kw of SENSITIVE_KEYWORDS) {
      if (pathname.includes(kw) || url.search.toLowerCase().includes(kw)) {
        return true;
      }
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Detects repeating crawl trap patterns in URL paths or queries.
 *
 * @param {string} urlString
 * @param {Map<string, number>} patternCounts
 * @param {number} [threshold=50]
 * @returns {{ trap: boolean, pattern?: string, reason?: string }}
 */
export function isCrawlTrap(urlString, patternCounts, threshold = 50) {
  try {
    const url = new URL(urlString);
    const segments = url.pathname.split('/').filter(Boolean);

    // Check segment repetition
    const segCounts = {};
    for (const seg of segments) {
      segCounts[seg] = (segCounts[seg] || 0) + 1;
      if (segCounts[seg] >= 4) {
        return { trap: true, reason: `Repeating path segment: "${seg}"` };
      }
    }

    const queryKeys = Array.from(url.searchParams.keys()).sort();
    const pattern = `${url.origin}/${segments.slice(0, 2).join('/')}?${queryKeys.join('&')}`;
    const count = patternCounts.get(pattern) || 0;
    if (count >= threshold) {
      return { trap: true, pattern, reason: `Exceeded pattern threshold (${threshold}) for ${pattern}` };
    }

    return { trap: false, pattern };
  } catch {
    return { trap: true, reason: 'Malformed URL' };
  }
}

/**
 * Parses robots.txt content into allow/disallow rules.
 *
 * @param {string} content
 * @returns {{ disallows: string[], allows: string[], sitemaps: string[] }}
 */
export function parseRobotsTxt(content) {
  const lines = (content || '').split('\n');
  const disallows = [];
  const allows = [];
  const sitemaps = [];

  let isTargetAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const [directive, ...valParts] = line.split(':');
    const val = valParts.join(':').trim();
    const key = (directive || '').trim().toLowerCase();

    if (key === 'user-agent') {
      const agent = val.toLowerCase();
      isTargetAgent = agent === '*' || agent.includes('deepcrawl');
    } else if (key === 'sitemap' && val) {
      sitemaps.push(val);
    } else if (isTargetAgent) {
      if (key === 'disallow' && val) {
        disallows.push(val);
      } else if (key === 'allow' && val) {
        allows.push(val);
      }
    }
  }

  return { disallows, allows, sitemaps };
}

/**
 * Checks if a URL path is allowed by robots.txt rules.
 *
 * @param {string} urlString
 * @param {{ disallows: string[], allows: string[] }} rules
 * @returns {boolean}
 */
export function matchesRobotsRules(urlString, rules) {
  try {
    const url = new URL(urlString);
    const pathAndQuery = url.pathname + url.search;

    for (const allow of rules.allows || []) {
      if (pathAndQuery.startsWith(allow)) {
        return true;
      }
    }

    for (const disallow of rules.disallows || []) {
      if (pathAndQuery.startsWith(disallow)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches and checks robots.txt for a given URL.
 *
 * @param {string} targetUrl
 * @param {(host: string) => Promise<Array<{ address: string, family: number }>>} [resolver]
 * @returns {Promise<boolean>}
 */
export async function isAllowedByRobotsTxt(targetUrl, resolver) {
  try {
    const url = new URL(targetUrl);
    const origin = url.origin;

    if (robotsCache.has(origin)) {
      return matchesRobotsRules(targetUrl, robotsCache.get(origin));
    }

    const robotsUrl = `${origin}/robots.txt`;
    const safeCheck = await isSafeUrlAsync(robotsUrl, resolver);
    if (!safeCheck.safe) {
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'deepcrawl/1.0' }
    });
    clearTimeout(timer);

    if (res.ok) {
      const text = await res.text();
      const parsed = parseRobotsTxt(text);
      robotsCache.set(origin, parsed);
      return matchesRobotsRules(targetUrl, parsed);
    }

    robotsCache.set(origin, { disallows: [], allows: [], sitemaps: [] });
    return true;
  } catch {
    return true;
  }
}
