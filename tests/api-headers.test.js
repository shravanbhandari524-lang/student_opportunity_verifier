import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { securityHeaders, noStoreHeaders, applySecurityHeaders } from "../lib/api/headers.js";

describe("lib/api/headers.js", () => {
  it("securityHeaders returns standard security headers", () => {
    const sec = securityHeaders();
    assert.equal(sec["X-Content-Type-Options"], "nosniff");
    assert.equal(sec["X-Frame-Options"], "DENY");
    assert.equal(sec["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.equal(sec["Content-Security-Policy"], "default-src 'none'; frame-ancestors 'none'");
  });

  it("noStoreHeaders returns anti-caching headers", () => {
    const headers = noStoreHeaders();
    assert.equal(headers["Cache-Control"], "no-store, no-cache, must-revalidate, proxy-revalidate");
    assert.equal(headers["Pragma"], "no-cache");
    assert.equal(headers["Expires"], "0");
  });

  it("applySecurityHeaders attaches headers to response without mutating status or body", async () => {
    const orig = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const enhanced = applySecurityHeaders(orig, { "X-Custom": "test-val" });
    assert.equal(enhanced.status, 200);
    assert.equal(enhanced.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(enhanced.headers.get("X-Frame-Options"), "DENY");
    assert.equal(enhanced.headers.get("X-Custom"), "test-val");

    const json = await enhanced.json();
    assert.deepEqual(json, { ok: true });
  });
});
