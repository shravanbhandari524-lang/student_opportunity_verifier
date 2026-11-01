import test from "node:test";
import assert from "node:assert/strict";
import {
  isGoogleAuthConfigured,
  sanitizeReturnTo,
  createOAuthStateToken,
  verifyOAuthStateToken,
  createSessionJwt,
  verifySessionJwt,
  validateSameOrigin,
} from "../lib/auth.js";

const VALID_SECRET = "12345678901234567890123456789012";
const OTHER_SECRET = "abcdefabcdefabcdefabcdefabcdefab";

test("isGoogleAuthConfigured correctly checks environment variables", () => {
  assert.equal(isGoogleAuthConfigured({}), false);
  assert.equal(
    isGoogleAuthConfigured({
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      JWT_SECRET: "too-short",
    }),
    false
  );
  assert.equal(
    isGoogleAuthConfigured({
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      JWT_SECRET: VALID_SECRET,
    }),
    true
  );
});

test("sanitizeReturnTo prevents open redirects and enforces relative paths", () => {
  // Valid relative paths
  assert.equal(sanitizeReturnTo("/"), "/");
  assert.equal(sanitizeReturnTo("/history"), "/history");
  assert.equal(sanitizeReturnTo("/check/abc-123"), "/check/abc-123");
  assert.equal(sanitizeReturnTo("/check/abc-123?tab=flags"), "/check/abc-123?tab=flags");

  // Invalid / open redirect attempts
  assert.equal(sanitizeReturnTo(""), "/");
  assert.equal(sanitizeReturnTo(null), "/");
  assert.equal(sanitizeReturnTo(undefined), "/");
  assert.equal(sanitizeReturnTo("   "), "/");
  assert.equal(sanitizeReturnTo("//evil.com"), "/");
  assert.equal(sanitizeReturnTo("//evil.com/path"), "/");
  assert.equal(sanitizeReturnTo("/\\evil.com"), "/");
  assert.equal(sanitizeReturnTo("https://evil.com"), "/");
  assert.equal(sanitizeReturnTo("http://evil.com"), "/");
  assert.equal(sanitizeReturnTo("javascript:alert(1)"), "/");
  assert.equal(sanitizeReturnTo("/path\\with\\backslash"), "/");
  assert.equal(sanitizeReturnTo("relative/path"), "/");
  assert.equal(sanitizeReturnTo("/evil:subdomain"), "/");
});

test("OAuth state token signs and verifies payload with HS256", async () => {
  const payload = {
    state: "random-state-123",
    codeVerifier: "random-verifier-456",
    returnTo: "/check/test-id",
  };

  const token = await createOAuthStateToken(payload, VALID_SECRET);
  assert.ok(typeof token === "string" && token.length > 20);

  const verified = await verifyOAuthStateToken(token, VALID_SECRET);
  assert.deepEqual(verified, {
    state: "random-state-123",
    codeVerifier: "random-verifier-456",
    returnTo: "/check/test-id",
  });

  // Tampered or wrong secret
  const badToken = await verifyOAuthStateToken(token, OTHER_SECRET);
  assert.equal(badToken, null);

  const corrupted = await verifyOAuthStateToken(token + "corrupted", VALID_SECRET);
  assert.equal(corrupted, null);
});

test("Session JWT signs and verifies session payload with 7-day expiry", async () => {
  const payload = {
    sessionId: "sess-uuid-1",
    userId: "user-uuid-1",
  };

  const token = await createSessionJwt(payload, VALID_SECRET);
  assert.ok(typeof token === "string");

  const verified = await verifySessionJwt(token, VALID_SECRET);
  assert.deepEqual(verified, payload);

  // Wrong secret returns null
  assert.equal(await verifySessionJwt(token, OTHER_SECRET), null);
  assert.equal(await verifySessionJwt("invalid.jwt.token", VALID_SECRET), null);
});

test("validateSameOrigin verifies CSRF protection", () => {
  const clientUrl = "http://localhost:3000";

  // Valid Origin
  const req1 = new Request("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
  assert.equal(validateSameOrigin(req1, clientUrl), true);

  // Valid Host match
  const req2 = new Request("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { origin: "http://localhost:3000", host: "localhost:3000" },
  });
  assert.equal(validateSameOrigin(req2, clientUrl), true);

  // Evil origin
  const req3 = new Request("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { origin: "http://attacker.com" },
  });
  assert.equal(validateSameOrigin(req3, clientUrl), false);

  // Valid Referer fallback
  const req4 = new Request("http://localhost:3000/auth/logout", {
    method: "POST",
    headers: { referer: "http://localhost:3000/history" },
  });
  assert.equal(validateSameOrigin(req4, clientUrl), true);

  // Missing origin and referer
  const req5 = new Request("http://localhost:3000/auth/logout", {
    method: "POST",
  });
  assert.equal(validateSameOrigin(req5, clientUrl), false);
});
