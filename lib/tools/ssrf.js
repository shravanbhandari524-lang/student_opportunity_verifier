/**
 * lib/tools/ssrf.js
 *
 * SSRF Guard implementation:
 * - Allows only http and https protocols
 * - Ports 80 and 443 only (defaults: http -> 80, https -> 443)
 * - Rejects userinfo in URL (e.g. http://user:pass@example.com)
 * - Resolves hostname and validates all addresses with ipaddr.js
 * - Blocks private, loopback, link-local, unique-local, unspecified, carrier-grade NAT,
 *   multicast, reserved, and cloud metadata addresses (169.254.169.254, metadata.google.internal, etc.)
 * - Unwraps IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 -> 127.0.0.1)
 * - Checks literal IP hosts in decimal (e.g. 2130706433), hex (0x7f.1), octal forms after normalization
 * - Returns { valid: true, pinnedIp, allAddresses, urlObj } or throws a typed SSRFError.
 */

import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class SSRFError extends Error {
  /**
   * @param {string} message
   * @param {string} [code="BLOCKED"]
   */
  constructor(message, code = "BLOCKED") {
    super(message);
    this.name = "SSRFError";
    this.code = code;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "metadata",
]);

/**
 * Parses and unwraps an IP string into a canonical IPv4 or IPv6 representation.
 * Handles decimal, hex, octal notations, and IPv4-mapped IPv6.
 *
 * @param {string} host
 * @returns {ipaddr.IPv4 | ipaddr.IPv6 | null}
 */
export function parseAndUnwrapIp(host) {
  let cleaned = host.trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.slice(1, -1);
  }

  // Check if it is a pure integer / decimal IP like 2130706433
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

  // Check if it's hex or octal IP parts, e.g. 0x7f.1 or 0177.0.0.1
  if (/^(0x[0-9a-fA-F]+|\d+)(\.(0x[0-9a-fA-F]+|\d+)){0,3}$/i.test(cleaned)) {
    const parts = cleaned.split(".");
    const normalizedParts = [];
    for (const p of parts) {
      let val;
      if (p.startsWith("0x") || p.startsWith("0X")) {
        val = parseInt(p, 16);
      } else if (p.startsWith("0") && p.length > 1) {
        val = parseInt(p, 8);
      } else {
        val = parseInt(p, 10);
      }
      if (Number.isNaN(val) || val < 0 || val > 255) {
        return null;
      }
      normalizedParts.push(val);
    }
    if (normalizedParts.length === 4) {
      cleaned = normalizedParts.join(".");
    }
  }

  if (!ipaddr.isValid(cleaned)) {
    return null;
  }

  try {
    let addr = ipaddr.parse(cleaned);
    // Unwrap IPv4-mapped IPv6 (::ffff:127.0.0.1)
    if (addr.kind() === "ipv6") {
      const v6 = /** @type {ipaddr.IPv6} */ (addr);
      if (v6.isIPv4MappedAddress()) {
        addr = v6.toIPv4Address();
      }
    }
    return addr;
  } catch {
    return null;
  }
}

/**
 * Determines whether an IP address is private, loopback, or otherwise disallowed.
 *
 * Disallowed ranges:
 * - Loopback (127.0.0.0/8, ::1)
 * - Private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
 * - Link-local (169.254.0.0/16, fe80::/10)
 * - Unspecified (0.0.0.0, ::)
 * - Carrier-grade NAT (100.64.0.0/10)
 * - Multicast (224.0.0.0/4, ff00::/8)
 * - Reserved / Broadcast / Documentation / Benchmarking
 * - Cloud metadata (169.254.169.254)
 *
 * @param {ipaddr.IPv4 | ipaddr.IPv6} addr
 * @returns {boolean} True if the address is forbidden
 */
export function isForbiddenIp(addr) {
  const range = addr.range();

  // Forbidden ranges per ipaddr.js definitions
  const forbiddenRanges = new Set([
    "unspecified",
    "broadcast",
    "linkLocal",
    "loopback",
    "private",
    "reserved",
    "carrierGradeNat",
    "multicast",
    "uniqueLocal",
  ]);

  if (forbiddenRanges.has(range)) {
    return true;
  }

  const str = addr.toString();
  // Cloud metadata explicit check
  if (str === "169.254.169.254" || str === "::ffff:169.254.169.254") {
    return true;
  }

  return false;
}

/**
 * Validates a target URL against SSRF rules.
 * Resolves the hostname and ensures EVERY returned IP is strictly public.
 *
 * @param {string} urlString
 * @param {object} [options]
 * @param {(host: string) => Promise<string[]>} [options.resolve] Injected DNS resolver
 * @returns {Promise<{ valid: true, pinnedIp: string, allAddresses: string[], urlObj: URL }>}
 */
export async function assertPublicUrl(urlString, { resolve } = {}) {
  let urlObj;
  try {
    urlObj = new URL(urlString);
  } catch {
    throw new SSRFError("Invalid URL syntax", "INVALID_INPUT");
  }

  // Allowed schemes: http and https only
  if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
    throw new SSRFError(`Disallowed protocol scheme: '${urlObj.protocol}'. Only http and https are allowed.`, "BLOCKED");
  }

  // Reject userinfo
  if (urlObj.username || urlObj.password) {
    throw new SSRFError("URLs with embedded userinfo (username/password) are blocked", "BLOCKED");
  }

  // Allowed ports: 80, 443 only
  const port = urlObj.port ? Number(urlObj.port) : (urlObj.protocol === "https:" ? 443 : 80);
  if (port !== 80 && port !== 443) {
    throw new SSRFError(`Disallowed port: ${port}. Only ports 80 and 443 are allowed.`, "BLOCKED");
  }

  const hostname = urlObj.hostname.toLowerCase().trim();
  if (!hostname) {
    throw new SSRFError("URL hostname is empty", "INVALID_INPUT");
  }

  // Block known metadata hostnames
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    throw new SSRFError(`Blocked hostname: '${hostname}'`, "BLOCKED");
  }

  // Check if hostname is an IP literal
  const literalIp = parseAndUnwrapIp(hostname);
  if (literalIp) {
    if (isForbiddenIp(literalIp)) {
      throw new SSRFError(`Blocked IP literal address: '${literalIp.toString()}'`, "BLOCKED");
    }
    return {
      valid: true,
      pinnedIp: literalIp.toString(),
      allAddresses: [literalIp.toString()],
      urlObj,
    };
  }

  // Resolve hostname
  let addresses = [];
  if (resolve) {
    addresses = await resolve(hostname);
  } else {
    try {
      const records = await dns.lookup(hostname, { all: true });
      addresses = records.map((r) => r.address);
    } catch (dnsErr) {
      throw new SSRFError(`Failed to resolve hostname '${hostname}': ${dnsErr.message}`, "NETWORK");
    }
  }

  if (!addresses || addresses.length === 0) {
    throw new SSRFError(`No IP addresses resolved for host '${hostname}'`, "NETWORK");
  }

  // If ANY address resolves to a private or forbidden IP, BLOCK the entire request
  for (const addrStr of addresses) {
    const parsed = parseAndUnwrapIp(addrStr);
    if (!parsed || isForbiddenIp(parsed)) {
      throw new SSRFError(`Host '${hostname}' resolved to blocked address '${addrStr}'`, "BLOCKED");
    }
  }

  return {
    valid: true,
    pinnedIp: addresses[0],
    allAddresses: addresses,
    urlObj,
  };
}
