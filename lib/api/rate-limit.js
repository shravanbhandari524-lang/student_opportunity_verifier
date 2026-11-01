import net from "node:net";
import { apiError } from "./errors.js";

/**
 * Groups a valid IPv6 address by its /64 prefix (first four 16-bit blocks).
 *
 * @param {string} ip
 * @returns {string}
 */
export function groupIpv6Prefix(ip) {
  let norm = ip.toLowerCase();
  const zoneIdx = norm.indexOf("%");
  if (zoneIdx !== -1) norm = norm.slice(0, zoneIdx);

  // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:192.0.2.1)
  if (norm.includes(".")) {
    const lastColon = norm.lastIndexOf(":");
    const v4Part = norm.slice(lastColon + 1);
    if (net.isIPv4(v4Part)) {
      const octets = v4Part.split(".").map(Number);
      const hex1 = ((octets[0] << 8) | octets[1]).toString(16);
      const hex2 = ((octets[2] << 8) | octets[3]).toString(16);
      norm = `${norm.slice(0, lastColon)}:${hex1}:${hex2}`;
    }
  }

  const parts = norm.split("::");
  let blocks = [];
  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    blocks = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    blocks = norm.split(":");
  }

  const prefix = blocks.slice(0, 4).map((b) => (b || "0").padStart(4, "0")).join(":");
  return `${prefix}::/64`;
}

/**
 * Extracts a client identification key from the request.
 *
 * Rules (Spec C3):
 * - If trustProxy is false: Every client-supplied proxy and IP header
 *   (X-Client-IP, X-Real-IP, Forwarded, X-Forwarded-For, CF-Connecting-IP) is strictly ignored,
 *   and request.ip is NOT used. Returns the single shared "unknown" bucket.
 * - If trustProxy is true: Reads X-Forwarded-For, counts hops strictly from the right by trustedHops.
 *   NEVER uses the leftmost entry.
 *   If the list is shorter than trustedHops, empty, missing, or invalid, returns "unknown".
 *   Valid IPv4 addresses are returned trimmed.
 *   Valid IPv6 addresses are grouped by their /64 prefix.
 *
 * @param {Request} request
 * @param {object} [options]
 * @param {boolean} [options.trustProxy=false]
 * @param {number} [options.trustedHops=1]
 * @returns {string}
 */
export function getClientKey(request, options = {}) {
  const trustProxy = options.trustProxy ?? false;
  const trustedHops = options.trustedHops ?? 1;

  if (!trustProxy) {
    return "unknown";
  }

  const xff = request.headers.get("x-forwarded-for");
  if (!xff || typeof xff !== "string") {
    return "unknown";
  }

  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < trustedHops || trustedHops <= 0) {
    return "unknown";
  }

  // Count strictly from the right by trustedHops
  const selected = parts[parts.length - trustedHops];
  if (!selected) {
    return "unknown";
  }

  if (net.isIPv4(selected)) {
    return selected;
  }

  if (net.isIPv6(selected)) {
    return groupIpv6Prefix(selected);
  }

  return "unknown";
}

/**
 * In-memory sliding window rate limiter with maxKeys eviction and retry-after tracking.
 *
 * @param {object} config
 * @param {number} config.windowMs - Window length in ms
 * @param {number} config.max - Max requests permitted in window
 * @param {() => number} [config.now] - Clock function
 * @param {number} [config.maxKeys=10000] - Bound on key map size
 * @returns {{
 *   check: (key: string) => { allowed: boolean, remaining: number, retryAfterSeconds: number, resetMs: number },
 *   assertAllowed: (key: string) => void,
 *   reset: (key?: string) => void,
 *   size: () => number
 * }}
 */
export function createRateLimiter(config) {
  const windowMs = config.windowMs;
  const max = config.max;
  const nowFn = config.now || (() => Date.now());
  const maxKeys = config.maxKeys || 10000;

  // Map of key -> array of timestamps
  const store = new Map();

  function evictOldestIfNeeded() {
    if (store.size < maxKeys) return;
    const now = nowFn();
    for (const [k, timestamps] of store.entries()) {
      const fresh = timestamps.filter((t) => now - t < windowMs);
      if (fresh.length === 0) {
        store.delete(k);
      }
    }
    if (store.size >= maxKeys) {
      // Force remove the first key if still full
      const first = store.keys().next().value;
      if (first !== undefined) store.delete(first);
    }
  }

  function check(key) {
    const now = nowFn();
    const timestamps = store.get(key) || [];
    const valid = timestamps.filter((t) => now - t < windowMs);

    if (valid.length >= max) {
      // Oldest timestamp in window determines when slot frees up
      const oldest = valid[0];
      const resetMs = oldest + windowMs - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
        resetMs,
      };
    }

    valid.push(now);
    evictOldestIfNeeded();
    store.set(key, valid);

    return {
      allowed: true,
      remaining: max - valid.length,
      retryAfterSeconds: 0,
      resetMs: 0,
    };
  }

  function assertAllowed(key) {
    const result = check(key);
    if (!result.allowed) {
      const err = apiError(
        "RATE_LIMITED",
        `Too many requests. Please retry in ${result.retryAfterSeconds} seconds.`,
        429,
        { retryAfterSeconds: result.retryAfterSeconds }
      );
      throw err;
    }
  }

  function reset(key) {
    if (key !== undefined) {
      store.delete(key);
    } else {
      store.clear();
    }
  }

  function size() {
    return store.size;
  }

  return {
    check,
    assertAllowed,
    reset,
    size,
  };
}
