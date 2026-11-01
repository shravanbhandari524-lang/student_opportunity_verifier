/**
 * tests/tools-fetch.test.js
 *
 * Comprehensive offline unit tests for fetchPage and SSRF protection.
 * Stubs global fetch and uses mock DNS resolvers and mock transports.
 * NO real network traffic.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, SSRFError, parseAndUnwrapIp, isForbiddenIp } from "../lib/tools/ssrf.js";
import { createFetchPage, extractPageData } from "../lib/tools/fetchPage.js";

// Ensure global fetch is never called during tests
globalThis.fetch = () => {
  throw new Error("Network access forbidden in offline tests: global.fetch was called!");
};

test("SSRF - IP unwrapping and forbidden IP classification", () => {
  // IPv4 loopback & private
  const loopback = parseAndUnwrapIp("127.0.0.1");
  assert.ok(loopback);
  assert.equal(isForbiddenIp(loopback), true);

  const priv10 = parseAndUnwrapIp("10.0.0.1");
  assert.ok(priv10);
  assert.equal(isForbiddenIp(priv10), true);

  const priv172 = parseAndUnwrapIp("172.16.0.1");
  assert.ok(priv172);
  assert.equal(isForbiddenIp(priv172), true);

  const priv192 = parseAndUnwrapIp("192.168.1.1");
  assert.ok(priv192);
  assert.equal(isForbiddenIp(priv192), true);

  const metadata = parseAndUnwrapIp("169.254.169.254");
  assert.ok(metadata);
  assert.equal(isForbiddenIp(metadata), true);

  const zero = parseAndUnwrapIp("0.0.0.0");
  assert.ok(zero);
  assert.equal(isForbiddenIp(zero), true);

  // Decimal notation of 127.0.0.1: 2130706433
  const dec = parseAndUnwrapIp("2130706433");
  assert.ok(dec);
  assert.equal(dec.toString(), "127.0.0.1");
  assert.equal(isForbiddenIp(dec), true);

  // Hex notation 0x7f.1 -> 127.0.0.1
  const hex = parseAndUnwrapIp("0x7f.0.0.1");
  assert.ok(hex);
  assert.equal(hex.toString(), "127.0.0.1");
  assert.equal(isForbiddenIp(hex), true);

  // IPv4-mapped IPv6 ::ffff:127.0.0.1
  const mapped = parseAndUnwrapIp("::ffff:127.0.0.1");
  assert.ok(mapped);
  assert.equal(mapped.toString(), "127.0.0.1");
  assert.equal(isForbiddenIp(mapped), true);

  // IPv6 loopback [::1]
  const v6Loop = parseAndUnwrapIp("::1");
  assert.ok(v6Loop);
  assert.equal(isForbiddenIp(v6Loop), true);

  // Public IPv4
  const pubV4 = parseAndUnwrapIp("93.184.216.34");
  assert.ok(pubV4);
  assert.equal(isForbiddenIp(pubV4), false);

  // Public IPv6
  const pubV6 = parseAndUnwrapIp("2606:2800:220:1:248:1893:25c8:1946");
  assert.ok(pubV6);
  assert.equal(isForbiddenIp(pubV6), false);
});

test("SSRF - assertPublicUrl blocks forbidden schemes, ports, userinfo, and hosts", async () => {
  // Scheme restrictions
  await assert.rejects(
    () => assertPublicUrl("ftp://example.com/file"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );
  await assert.rejects(
    () => assertPublicUrl("file:///etc/passwd"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );
  await assert.rejects(
    () => assertPublicUrl("javascript:alert(1)"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );

  // Userinfo
  await assert.rejects(
    () => assertPublicUrl("https://admin:pass@example.com/"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );

  // Non-standard ports (allowed: 80, 443)
  await assert.rejects(
    () => assertPublicUrl("http://example.com:22/"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );
  await assert.rejects(
    () => assertPublicUrl("https://example.com:8080/"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );

  // Blocked hostnames
  await assert.rejects(
    () => assertPublicUrl("http://localhost/"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );
  await assert.rejects(
    () => assertPublicUrl("http://metadata.google.internal/"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );
  await assert.rejects(
    () => assertPublicUrl("http://server.local/"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );

  // IP literal forbidden
  await assert.rejects(
    () => assertPublicUrl("http://127.0.0.1/"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );
  await assert.rejects(
    () => assertPublicUrl("http://169.254.169.254/latest/meta-data"),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );
});

test("SSRF - assertPublicUrl DNS resolution blocks private addresses and mixed addresses", async () => {
  // Resolver returns private IP
  const mockResolvePrivate = async () => ["10.0.0.5"];
  await assert.rejects(
    () => assertPublicUrl("https://internal.test", { resolve: mockResolvePrivate }),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );

  // Resolver returns mixed public and private IPs (DNS rebinding / multi-A record evasion)
  const mockResolveMixed = async () => ["93.184.216.34", "192.168.1.1"];
  await assert.rejects(
    () => assertPublicUrl("https://mixed.test", { resolve: mockResolveMixed }),
    (err) => err instanceof SSRFError && err.code === "BLOCKED"
  );

  // Resolver returns strictly public IPs
  const mockResolvePublic = async () => ["93.184.216.34", "93.184.216.35"];
  const res = await assertPublicUrl("https://example.com/test", { resolve: mockResolvePublic });
  assert.equal(res.valid, true);
  assert.equal(res.pinnedIp, "93.184.216.34");
  assert.deepEqual(res.allAddresses, ["93.184.216.34", "93.184.216.35"]);
});

test("fetchPage - extracts clean title, meta description, text, and relative links resolved to absolute", async () => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Student Scholarship Portal - Apply Today</title>
        <meta name="description" content="Official scholarship program for undergrad students.">
        <style>body { font-family: sans-serif; }</style>
        <script>console.log('malicious script');</script>
      </head>
      <body>
        <noscript>Turn on JS</noscript>
        <iframe src="https://evil.test"></iframe>
        <h1>Welcome to the Opportunity</h1>
        <p>We provide verified internships and research grants.</p>
        <form action="/login"><input type="password" name="p"></form>
        <a href="/apply">Apply Here</a>
        <a href="https://partner.test/guidelines#section2">Guidelines</a>
        <a href="javascript:void(0)">Ignored</a>
        <a href="mailto:help@example.com">Contact</a>
      </body>
    </html>
  `;

  const extracted = extractPageData(html, "https://example.com/portal/index.html");
  assert.equal(extracted.title, "Student Scholarship Portal - Apply Today");
  assert.equal(extracted.metaDescription, "Official scholarship program for undergrad students.");
  assert.ok(extracted.text.includes("Welcome to the Opportunity"));
  assert.ok(extracted.text.includes("We provide verified internships and research grants."));
  assert.equal(extracted.text.includes("malicious script"), false);
  assert.equal(extracted.text.includes("Turn on JS"), false);

  assert.deepEqual(extracted.links, [
    "https://example.com/apply",
    "https://partner.test/guidelines",
  ]);
});

test("fetchPage - successful fetch connects to pinned IP and preserves Host header", async () => {
  let capturedOptions = null;
  const mockResolve = async () => ["93.184.216.34"];
  const mockRequest = async (options) => {
    capturedOptions = options;
    return {
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: Buffer.from("<html><head><title>Test Page</title></head><body>Hello World</body></html>"),
    };
  };

  const fetcher = createFetchPage({ resolve: mockResolve, request: mockRequest });
  const result = await fetcher("https://example.test/careers");

  assert.equal(result.ok, true);
  assert.equal(result.data.title, "Test Page");
  assert.equal(result.data.text, "Hello World");
  assert.equal(result.data.finalUrl, "https://example.test/careers");

  // Verify connection pinned to IP and Host preserved
  assert.equal(capturedOptions.pinnedIp, "93.184.216.34");
  assert.equal(capturedOptions.urlObj.hostname, "example.test");
});

test("fetchPage - blocks redirect to private IP", async () => {
  const mockResolve = async (host) => {
    if (host === "public.test") return ["93.184.216.34"];
    if (host === "internal.test") return ["10.0.0.1"];
    return ["127.0.0.1"];
  };

  const mockRequest = async ({ urlObj }) => {
    if (urlObj.hostname === "public.test") {
      return {
        statusCode: 302,
        headers: { location: "http://internal.test/secret" },
        body: Buffer.alloc(0),
      };
    }
    return {
      statusCode: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("Secret Data"),
    };
  };

  const fetcher = createFetchPage({ resolve: mockResolve, request: mockRequest });
  const result = await fetcher("https://public.test/redirect");

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BLOCKED");
  assert.ok(result.error.message.includes("blocked address"));
});

test("fetchPage - aborts when redirect loop exceeds 3 hops", async () => {
  const mockResolve = async () => ["93.184.216.34"];
  let hop = 0;
  const mockRequest = async () => {
    hop++;
    return {
      statusCode: 302,
      headers: { location: `https://public.test/hop${hop}` },
      body: Buffer.alloc(0),
    };
  };

  const fetcher = createFetchPage({ resolve: mockResolve, request: mockRequest });
  const result = await fetcher("https://public.test/start");

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UPSTREAM_ERROR");
  assert.ok(result.error.message.includes("Too many redirects"));
});

test("fetchPage - rejects unsupported content types", async () => {
  const mockResolve = async () => ["93.184.216.34"];
  const mockRequest = async () => ({
    statusCode: 200,
    headers: { "content-type": "application/pdf" },
    body: Buffer.from("%PDF-1.4..."),
  });

  const fetcher = createFetchPage({ resolve: mockResolve, request: mockRequest });
  const result = await fetcher("https://example.test/document.pdf");

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UPSTREAM_ERROR");
  assert.ok(result.error.message.includes("Unsupported Content-Type"));
});

test("fetchPage - handles oversized body (>1MB)", async () => {
  const mockResolve = async () => ["93.184.216.34"];
  const oversizedBuffer = Buffer.alloc(1.2 * 1024 * 1024, "a");
  const mockRequest = async () => ({
    statusCode: 200,
    headers: { "content-type": "text/html" },
    body: oversizedBuffer,
  });

  const fetcher = createFetchPage({ resolve: mockResolve, request: mockRequest });
  const result = await fetcher("https://example.test/large");

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UPSTREAM_ERROR");
  assert.ok(result.error.message.includes("exceeded size limit"));
});

test("fetchPage - handles timeout properly", async () => {
  const mockResolve = async () => ["93.184.216.34"];
  const mockRequest = async ({ signal }) => {
    return new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        reject(new Error("Request timeout/aborted"));
      });
    });
  };

  const fetcher = createFetchPage({ resolve: mockResolve, request: mockRequest });
  const result = await fetcher("https://example.test/slow", { timeoutMs: 50 });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "TIMEOUT");
});
