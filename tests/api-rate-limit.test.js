import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, getClientKey } from "../lib/api/rate-limit.js";

describe("lib/api/rate-limit.js", () => {
  it("getClientKey: rotating proxy headers with trustProxy=false always use the unknown bucket", () => {
    const keys = new Set();
    const limiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

    for (let i = 1; i <= 25; i++) {
      const req = new Request("http://localhost/test", {
        headers: {
          "x-client-ip": `192.168.1.${i}`,
          "x-real-ip": `10.0.0.${i}`,
          "x-forwarded-for": `203.0.113.${i}, 198.51.100.${i}`,
          "cf-connecting-ip": `198.18.0.${i}`,
          "forwarded": `for=192.0.2.${i}`,
        },
      });
      const key = getClientKey(req, { trustProxy: false });
      assert.equal(key, "unknown");
      keys.add(key);
      limiter.check(key);
    }

    assert.equal(keys.size, 1, "Must have exactly 1 shared bucket 'unknown'");
    assert.equal(limiter.check("unknown").allowed, false, "All 25 requests must have hit the single shared bucket");
  });

  it("getClientKey: with trustProxy=true and hops=1, right-most entry decides and spoofed leftmost changes nothing", () => {
    const req1 = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "1.1.1.1, 70.41.3.18",
      },
    });
    const req2 = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "9.9.9.9, 1.2.3.4, 70.41.3.18",
      },
    });
    assert.equal(getClientKey(req1, { trustProxy: true, trustedHops: 1 }), "70.41.3.18");
    assert.equal(getClientKey(req2, { trustProxy: true, trustedHops: 1 }), "70.41.3.18");
  });

  it("getClientKey: with trustProxy=true and hops=2, uses second from the right", () => {
    const req = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "198.51.100.22, 203.0.113.195, 70.41.3.18",
      },
    });
    assert.equal(getClientKey(req, { trustProxy: true, trustedHops: 2 }), "203.0.113.195");
  });

  it("getClientKey: list shorter than hops or invalid IP falls back to unknown bucket", () => {
    const shortReq = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "70.41.3.18",
      },
    });
    assert.equal(getClientKey(shortReq, { trustProxy: true, trustedHops: 2 }), "unknown");

    const invalidReq = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "not-an-ip-address",
      },
    });
    assert.equal(getClientKey(invalidReq, { trustProxy: true, trustedHops: 1 }), "unknown");

    const missingReq = new Request("http://localhost/test");
    assert.equal(getClientKey(missingReq, { trustProxy: true, trustedHops: 1 }), "unknown");
  });

  it("getClientKey: groups IPv6 addresses by /64 prefix", () => {
    const req1 = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      },
    });
    const req2 = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "2001:db8:85a3::1",
      },
    });
    const reqDifferentPrefix = new Request("http://localhost/test", {
      headers: {
        "x-forwarded-for": "2001:db8:85a4::1",
      },
    });

    const key1 = getClientKey(req1, { trustProxy: true, trustedHops: 1 });
    const key2 = getClientKey(req2, { trustProxy: true, trustedHops: 1 });
    const keyDiff = getClientKey(reqDifferentPrefix, { trustProxy: true, trustedHops: 1 });

    assert.equal(key1, "2001:0db8:85a3:0000::/64");
    assert.equal(key2, "2001:0db8:85a3:0000::/64");
    assert.equal(key1, key2, "Same /64 prefix must produce identical bucket key");
    assert.notEqual(key1, keyDiff, "Different /64 prefix must produce different bucket key");
  });

  it("two different trusted keys do not share a bucket", () => {
    const limiter = createRateLimiter({ windowMs: 60 * 1000, max: 1 });

    const keyA = "198.51.100.1";
    const keyB = "198.51.100.2";

    assert.equal(limiter.check(keyA).allowed, true);
    assert.equal(limiter.check(keyA).allowed, false);

    // keyB has its own independent bucket
    assert.equal(limiter.check(keyB).allowed, true);
    assert.equal(limiter.check(keyB).allowed, false);
  });

  it("createRateLimiter enforces limit and computes retryAfterSeconds", () => {
    let mockTime = 1000;
    const limiter = createRateLimiter({
      windowMs: 60 * 1000,
      max: 2,
      now: () => mockTime,
    });

    const res1 = limiter.check("ip-1");
    assert.equal(res1.allowed, true);
    assert.equal(res1.remaining, 1);

    const res2 = limiter.check("ip-1");
    assert.equal(res2.allowed, true);
    assert.equal(res2.remaining, 0);

    // Third call within same window is blocked
    const res3 = limiter.check("ip-1");
    assert.equal(res3.allowed, false);
    assert.equal(res3.remaining, 0);
    assert.equal(res3.retryAfterSeconds, 60);

    // assertAllowed throws ApiError 429
    assert.throws(
      () => limiter.assertAllowed("ip-1"),
      (err) => err.code === "RATE_LIMITED" && err.status === 429
    );

    // After window passes, quota recovers
    mockTime += 61 * 1000;
    const res4 = limiter.check("ip-1");
    assert.equal(res4.allowed, true);
    assert.equal(res4.remaining, 1);
  });

  it("createRateLimiter evicts expired entries when reaching maxKeys", () => {
    let mockTime = 1000;
    const limiter = createRateLimiter({
      windowMs: 1000,
      max: 5,
      maxKeys: 3,
      now: () => mockTime,
    });

    limiter.check("key-1");
    limiter.check("key-2");
    limiter.check("key-3");
    assert.equal(limiter.size(), 3);

    // Advance time past window to expire existing keys
    mockTime += 2000;
    limiter.check("key-4");
    // Old expired keys were cleaned up
    assert.ok(limiter.size() <= 3);
  });

  it("reset clears specified key or all keys", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    limiter.check("key-a");
    limiter.check("key-b");
    assert.equal(limiter.size(), 2);

    limiter.reset("key-a");
    assert.equal(limiter.size(), 1);

    limiter.reset();
    assert.equal(limiter.size(), 0);
  });
});
