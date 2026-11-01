import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";
process.env.GOOGLE_CLIENT_ID = "mock-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "mock-google-client-secret";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:3000/auth/google/callback";
process.env.JWT_SECRET = "12345678901234567890123456789012";
process.env.CLIENT_URL = "http://localhost:3000";

import { SignJWT } from "jose";

import { getDb, upsertUser, createSession, createCheck, getCheck, getUserById } from "../lib/db/index.js";
import {
  createOAuthStateToken,
  createSessionJwt,
  serializeCookie,
  OAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "../lib/auth.js";
import { GET as getGoogleAuth } from "../app/auth/google/route.js";
import { GET as getGoogleCallback } from "../app/auth/google/callback/route.js";
import { POST as postLogout } from "../app/auth/logout/route.js";
import { GET as getAuthMe } from "../app/api/auth/me/route.js";
import { GET as getMeChecks } from "../app/api/me/checks/route.js";
import { DELETE as deleteMe } from "../app/api/me/route.js";
import { POST as postCreateCheck } from "../app/api/checks/route.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";

const TEST_SECRET = "12345678901234567890123456789012";

function setupTestDb() {
  const dbPath = path.join(tmpdir(), `auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = getDb(dbPath);
  return {
    db,
    cleanup: () => {
      try {
        db.close();
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      } catch {}
    },
  };
}

function mockRuntime(db) {
  return {
    db,
    rateLimiters: {
      auth: createRateLimiter({ windowMs: 60000, max: 100 }),
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  };
}

test("GET /auth/google redirects to Google auth URL and sets ov_oauth_state cookie", async () => {
  const { db, cleanup } = setupTestDb();
  try {
    const request = new Request("http://localhost:3000/auth/google?returnTo=/check/xyz-123");
    const response = await getGoogleAuth(request, { runtime: mockRuntime(db) });

    assert.equal(response.status, 302);
    const location = response.headers.get("Location");
    assert.ok(location.includes("accounts.google.com"));
    assert.ok(location.includes("state="));
    assert.ok(location.includes("code_challenge="));

    const setCookie = response.headers.get("Set-Cookie");
    assert.ok(setCookie.includes(OAUTH_COOKIE_NAME));
    assert.ok(setCookie.includes("HttpOnly"));
    assert.ok(setCookie.includes("SameSite=Lax"));
  } finally {
    cleanup();
  }
});

test("GET /auth/google/callback handles missing params and state mismatch", async () => {
  const { db, cleanup } = setupTestDb();
  try {
    // 1. Missing code or state
    const req1 = new Request("http://localhost:3000/auth/google/callback");
    const res1 = await getGoogleCallback(req1, { runtime: mockRuntime(db) });
    assert.equal(res1.status, 302);
    assert.ok(res1.headers.get("Location").includes("auth_error=missing_code"));

    // 2. Missing cookie
    const req2 = new Request("http://localhost:3000/auth/google/callback?code=mock_code&state=mock_state");
    const res2 = await getGoogleCallback(req2, { runtime: mockRuntime(db) });
    assert.equal(res2.status, 302);
    assert.ok(res2.headers.get("Location").includes("auth_error=missing_state_cookie"));

    // 3. State mismatch
    const stateToken = await createOAuthStateToken(
      { state: "expected_state", codeVerifier: "verifier", returnTo: "/" },
      TEST_SECRET
    );
    const req3 = new Request("http://localhost:3000/auth/google/callback?code=mock_code&state=different_state", {
      headers: {
        cookie: `${OAUTH_COOKIE_NAME}=${stateToken}`,
      },
    });
    const res3 = await getGoogleCallback(req3, { runtime: mockRuntime(db) });
    assert.equal(res3.status, 302);
    assert.ok(res3.headers.get("Location").includes("auth_error=state_mismatch"));
    assert.ok(res3.headers.get("Set-Cookie").includes("Max-Age=0"));
  } finally {
    cleanup();
  }
});

test("GET /api/auth/me returns null when unauthenticated and public profile when authenticated", async () => {
  const { db, cleanup } = setupTestDb();
  try {
    // 1. Unauthenticated
    const reqAnon = new Request("http://localhost:3000/api/auth/me");
    const resAnon = await getAuthMe(reqAnon, { runtime: mockRuntime(db) });
    assert.equal(resAnon.status, 200);
    const bodyAnon = await resAnon.json();
    assert.deepEqual(bodyAnon, { user: null });

    // 2. Authenticated
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    upsertUser(
      {
        id: userId,
        googleSub: "sub-123",
        email: "student@example.com",
        name: "Test Student",
        avatarUrl: "https://lh3.googleusercontent.com/avatar",
      },
      db
    );
    createSession(
      {
        id: sessionId,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      db
    );

    const sessionJwt = await createSessionJwt({ sessionId, userId }, TEST_SECRET);
    const reqAuth = new Request("http://localhost:3000/api/auth/me", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionJwt}`,
      },
    });
    const resAuth = await getAuthMe(reqAuth, { runtime: mockRuntime(db) });
    assert.equal(resAuth.status, 200);
    const bodyAuth = await resAuth.json();
    assert.deepEqual(bodyAuth, {
      user: {
        id: userId,
        name: "Test Student",
        email: "student@example.com",
        avatarUrl: "https://lh3.googleusercontent.com/avatar",
      },
    });

    // 3. Expired session
    const expiredSessionId = crypto.randomUUID();
    createSession(
      {
        id: expiredSessionId,
        userId,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
      db
    );
    const expiredJwt = await createSessionJwt({ sessionId: expiredSessionId, userId }, TEST_SECRET);
    const reqExp = new Request("http://localhost:3000/api/auth/me", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${expiredJwt}`,
      },
    });
    const resExp = await getAuthMe(reqExp, { runtime: mockRuntime(db) });
    assert.equal(resExp.status, 200);
    const bodyExp = await resExp.json();
    assert.deepEqual(bodyExp, { user: null });
  } finally {
    cleanup();
  }
});

test("POST /auth/logout enforces CSRF protection, deletes session, and clears cookie", async () => {
  const { db, cleanup } = setupTestDb();
  try {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    upsertUser({ id: userId, googleSub: "sub-logout", email: "logout@example.com", name: "Logout Test" }, db);
    createSession(
      {
        id: sessionId,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      db
    );
    const sessionJwt = await createSessionJwt({ sessionId, userId }, TEST_SECRET);

    // 1. Cross-origin attack rejected
    const reqCross = new Request("http://localhost:3000/auth/logout", {
      method: "POST",
      headers: {
        origin: "http://attacker.com",
        cookie: `${SESSION_COOKIE_NAME}=${sessionJwt}`,
      },
    });
    const resCross = await postLogout(reqCross, { runtime: mockRuntime(db) });
    assert.equal(resCross.status, 403);

    // 2. Same-origin valid logout
    const reqValid = new Request("http://localhost:3000/auth/logout", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `${SESSION_COOKIE_NAME}=${sessionJwt}`,
      },
    });
    const resValid = await postLogout(reqValid, { runtime: mockRuntime(db) });
    assert.equal(resValid.status, 200);
    const body = await resValid.json();
    assert.equal(body.ok, true);

    const setCookie = resValid.headers.get("Set-Cookie");
    assert.ok(setCookie.includes("Max-Age=0"));

    // Session deleted from DB
    const sessionInDb = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    assert.equal(sessionInDb, undefined);
  } finally {
    cleanup();
  }
});

test("GET /api/me/checks returns 401 when anonymous and user checks when authenticated", async () => {
  const { db, cleanup } = setupTestDb();
  try {
    // 1. Anonymous -> 401
    const reqAnon = new Request("http://localhost:3000/api/me/checks");
    const resAnon = await getMeChecks(reqAnon, { runtime: mockRuntime(db) });
    assert.equal(resAnon.status, 401);

    // 2. Authenticated user with 2 checks
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    upsertUser({ id: userId, googleSub: "sub-checks", email: "checks@example.com", name: "Checks Test" }, db);
    createSession(
      {
        id: sessionId,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      db
    );

    const checkId1 = crypto.randomUUID();
    const checkId2 = crypto.randomUUID();
    const otherUserCheckId = crypto.randomUUID();

    createCheck({ id: checkId1, userId, language: "en", status: "report_ready" }, db);
    createCheck({ id: checkId2, userId, language: "en", status: "created" }, db);
    createCheck({ id: otherUserCheckId, userId: null, language: "en", status: "created" }, db);

    const sessionJwt = await createSessionJwt({ sessionId, userId }, TEST_SECRET);
    const reqAuth = new Request("http://localhost:3000/api/me/checks", {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionJwt}`,
      },
    });

    const resAuth = await getMeChecks(reqAuth, { runtime: mockRuntime(db) });
    assert.equal(resAuth.status, 200);
    const bodyAuth = await resAuth.json();
    assert.equal(bodyAuth.checks.length, 2);
    const ids = bodyAuth.checks.map((c) => c.id);
    assert.ok(ids.includes(checkId1));
    assert.ok(ids.includes(checkId2));
    assert.ok(!ids.includes(otherUserCheckId));
  } finally {
    cleanup();
  }
});

test("DELETE /api/me deletes user account, sets checks user_id to NULL, and clears session", async () => {
  const { db, cleanup } = setupTestDb();
  try {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    upsertUser({ id: userId, googleSub: "sub-del", email: "del@example.com", name: "Del Test" }, db);
    createSession(
      {
        id: sessionId,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      db
    );

    const checkId = crypto.randomUUID();
    createCheck({ id: checkId, userId, language: "en", status: "report_ready" }, db);

    const sessionJwt = await createSessionJwt({ sessionId, userId }, TEST_SECRET);

    // CSRF check
    const reqCross = new Request("http://localhost:3000/api/me", {
      method: "DELETE",
      headers: {
        origin: "http://attacker.com",
        cookie: `${SESSION_COOKIE_NAME}=${sessionJwt}`,
      },
    });
    const resCross = await deleteMe(reqCross, { runtime: mockRuntime(db) });
    assert.equal(resCross.status, 403);

    // Valid DELETE
    const reqValid = new Request("http://localhost:3000/api/me", {
      method: "DELETE",
      headers: {
        origin: "http://localhost:3000",
        cookie: `${SESSION_COOKIE_NAME}=${sessionJwt}`,
      },
    });
    const resValid = await deleteMe(reqValid, { runtime: mockRuntime(db) });
    assert.equal(resValid.status, 200);
    const body = await resValid.json();
    assert.equal(body.deleted, true);

    // User is deleted
    const userInDb = getUserById(userId, db);
    assert.equal(userInDb, null);

    // Session is cascaded/deleted
    const sessionInDb = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    assert.equal(sessionInDb, undefined);

    // Check survives with user_id = null
    const checkAfter = getCheck(checkId, db);
    assert.ok(checkAfter);
    assert.equal(checkAfter.userId, null);
  } finally {
    cleanup();
  }
});

test("POST /api/checks associates check with user_id when signed in, keeps null when anonymous", async () => {
  const { db, cleanup } = setupTestDb();
  try {
    const runtime = {
      db,
      rateLimiters: {
        createCheck: createRateLimiter({ windowMs: 60000, max: 100 }),
        globalDaily: createRateLimiter({ windowMs: 60000, max: 100 }),
      },
      createSemaphore: { acquire: () => true, release: () => {} },
      jobRunner: { run: (fn) => {}, activeCount: () => 0 },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };

    // 1. Anonymous creation
    const formAnon = new FormData();
    formAnon.append("text", "Check opportunity text anonymous");
    formAnon.append("language", "en");
    formAnon.append("consent", "true");

    const reqAnon = new Request("http://localhost:3000/api/checks", {
      method: "POST",
      body: formAnon,
    });
    const resAnon = await postCreateCheck(reqAnon, { runtime });
    assert.equal(resAnon.status, 201);
    const bodyAnon = await resAnon.json();
    const checkAnon = getCheck(bodyAnon.checkId, db);
    assert.equal(checkAnon.userId, null);

    // 2. Signed-in creation
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    upsertUser({ id: userId, googleSub: "sub-create", email: "create@example.com", name: "Create User" }, db);
    createSession({ id: sessionId, userId, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }, db);
    const sessionJwt = await createSessionJwt({ sessionId, userId }, TEST_SECRET);

    const formAuth = new FormData();
    formAuth.append("text", "Check opportunity text authenticated");
    formAuth.append("language", "en");
    formAuth.append("consent", "true");

    const reqAuth = new Request("http://localhost:3000/api/checks", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionJwt}`,
      },
      body: formAuth,
    });
    const resAuth = await postCreateCheck(reqAuth, { runtime });
    assert.equal(resAuth.status, 201);
    const bodyAuth = await resAuth.json();
    const checkAuth = getCheck(bodyAuth.checkId, db);
    assert.equal(checkAuth.userId, userId);
  } finally {
    cleanup();
  }
});
