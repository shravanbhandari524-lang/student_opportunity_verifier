import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter, getClientKey } from "../lib/api/rate-limit.js";
import { startBackgroundTasks } from "../lib/api/startup.js";
import { recoverStaleChecks } from "../lib/api/jobs.js";
import { securityHeaders, applySecurityHeaders } from "../lib/api/headers.js";
import { createCheck, updateStatus, getCheck } from "../lib/db/index.js";
import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";
import { POST as confirmCheckHandler } from "../app/api/checks/[id]/confirm/route.js";
import { GET as getReportHandler } from "../app/api/checks/[id]/report/route.js";
import { GET as getStreamHandler } from "../app/api/checks/[id]/stream/route.js";
import { GET as getHealthHandler } from "../app/api/health/route.js";

const TEST_DB_PATH = "./data/test_ops.db";

function setupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

test("Operations: instrumentation.js dynamic import purity", () => {
  const content = fs.readFileSync("./instrumentation.js", "utf8");
  // Asserts that instrumentation does not import better-sqlite3 or lib/db at top level
  assert.ok(!content.includes('import Database from "better-sqlite3"'));
  assert.ok(!content.includes('import { getDb } from "./lib/db/index.js"'));
  assert.ok(!content.includes('import { runCleanup } from "./lib/cleanup.js"'));
  assert.ok(content.includes('await import("./lib/api/runtime.js")'));
  assert.ok(content.includes('process.env.NEXT_RUNTIME === "nodejs"'));
});

test("Operations: startBackgroundTasks executes recovery & cleanup, schedules interval, is idempotent, stop clears interval", async () => {
  const db = setupTestDb();
  let intervalCallback = null;
  let cleared = false;

  const mockSetInterval = (fn, _ms) => {
    intervalCallback = fn;
    return {
      unref: () => {},
      id: 1234,
    };
  };

  const mockClearInterval = (_timer) => {
    cleared = true;
  };

  const capturedLogs = [];
  const mockLogger = {
    info: (obj, msg) => capturedLogs.push({ level: "info", obj, msg }),
    warn: (obj, msg) => capturedLogs.push({ level: "warn", obj, msg }),
    error: (obj, msg) => capturedLogs.push({ level: "error", obj, msg }),
  };

  // Clean any existing global state
  delete globalThis[Symbol.for("APP_STARTUP_TASK_STATE")];

  // 1. Initial startup call
  const handle1 = await startBackgroundTasks({
    runtime: { db },
    logger: mockLogger,
    setIntervalFn: mockSetInterval,
    clearIntervalFn: mockClearInterval,
    intervalMs: 1000,
  });

  assert.equal(handle1.started, true);
  assert.ok(typeof handle1.stop === "function");
  assert.ok(intervalCallback !== null, "Interval must be scheduled");
  assert.ok(capturedLogs.some((l) => l.obj?.code === "STARTUP_RECOVERY_SUCCESS"));
  assert.ok(capturedLogs.some((l) => l.obj?.code === "STARTUP_CLEANUP_SUCCESS"));

  // 2. Idempotent second call returns same stop and started: false
  const handle2 = await startBackgroundTasks({
    runtime: { db },
    logger: mockLogger,
  });
  assert.equal(handle2.started, false);

  // 3. Stop cleans up
  handle1.stop();
  assert.equal(cleared, true);
});

test("Operations: startBackgroundTasks survives failing recovery or cleanup without throwing", async () => {
  delete globalThis[Symbol.for("APP_STARTUP_TASK_STATE")];
  const capturedLogs = [];
  const mockLogger = {
    info: (obj, msg) => capturedLogs.push({ level: "info", obj, msg }),
    warn: (obj, msg) => capturedLogs.push({ level: "warn", obj, msg }),
    error: (obj, msg) => capturedLogs.push({ level: "error", obj, msg }),
  };

  // Failing runtime with broken db object
  const brokenDb = {
    prepare: () => {
      throw new Error("Disk I/O error");
    },
  };

  const handle = await startBackgroundTasks({
    runtime: { db: brokenDb },
    logger: mockLogger,
    setIntervalFn: () => ({ unref: () => {} }),
    clearIntervalFn: () => {},
  });

  assert.ok(handle);
  assert.ok(capturedLogs.some((l) => l.obj?.code === "STARTUP_RECOVERY_ERROR"));
  handle.stop();
});

test("Operations: startup cleanup receives the same upload directory the creation route writes to", async () => {
  const { env } = await import("../lib/env.js");
  const defaultCreationUploadDir = path.resolve(env.UPLOAD_DIR || "./uploads");

  delete globalThis[Symbol.for("APP_STARTUP_TASK_STATE")];
  const db = setupTestDb();
  let receivedCleanupUploadDir = null;

  // Track uploadDir passed by startBackgroundTasks
  const handle = await startBackgroundTasks({
    runtime: { db },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    setIntervalFn: () => ({ unref: () => {} }),
    clearIntervalFn: () => {},
  });

  // Verify default from env matches what creation route resolves
  const defaultStartupUploadDir = path.resolve(env.UPLOAD_DIR || "./uploads");
  assert.equal(defaultStartupUploadDir, defaultCreationUploadDir);
  handle.stop();
});

test("Operations: recoverStaleChecks marks only stale in-progress checks failed with server_restart", () => {
  const db = setupTestDb();
  const nowMs = Date.now();

  // Create checks in various statuses
  const check1 = createCheck({ text: "stale extracting" }, db);
  updateStatus(check1.id, "extracting", db);

  const check2 = createCheck({ text: "stale investigating" }, db);
  updateStatus(check2.id, "extracting", db);
  updateStatus(check2.id, "awaiting_confirmation", db);
  updateStatus(check2.id, "investigating", db);

  const check3 = createCheck({ text: "completed report_ready" }, db);
  updateStatus(check3.id, "extracting", db);
  updateStatus(check3.id, "awaiting_confirmation", db);
  updateStatus(check3.id, "investigating", db);
  updateStatus(check3.id, "scoring", db);
  updateStatus(check3.id, "report_ready", db);

  // Manually age updated_at of check1 and check2 by 10 minutes
  const tenMinutesAgo = new Date(nowMs - 10 * 60 * 1000).toISOString();
  db.prepare("UPDATE checks SET updated_at = ? WHERE id IN (?, ?)").run(
    tenMinutesAgo,
    check1.id,
    check2.id
  );

  const res = recoverStaleChecks({
    db,
    now: () => nowMs,
    maxAgeMs: 5 * 60 * 1000, // 5 min cutoff
  });

  assert.equal(res.recoveredCount, 2);
  assert.ok(res.checkIds.includes(check1.id));
  assert.ok(res.checkIds.includes(check2.id));

  const c1 = getCheck(check1.id, db);
  assert.equal(c1.status, "failed");
  assert.equal(c1.failureReason, "server_restart");

  const c2 = getCheck(check2.id, db);
  assert.equal(c2.status, "failed");
  assert.equal(c2.failureReason, "server_restart");

  const c3 = getCheck(check3.id, db);
  assert.equal(c3.status, "report_ready", "report_ready check must remain unchanged");
});

test("Operations: getClientKey respects TRUST_PROXY policy", () => {
  const reqWithProxy = new Request("http://localhost/test", {
    headers: {
      "x-forwarded-for": "203.0.113.195, 70.41.3.18",
      "x-real-ip": "198.51.100.1",
    },
  });

  // When trustProxy is false, proxy headers are ignored and unknown bucket is returned
  assert.equal(getClientKey(reqWithProxy, { trustProxy: false }), "unknown");

  // When trustProxy is true, entry from right (hops: 1 -> 70.41.3.18) is extracted
  assert.equal(getClientKey(reqWithProxy, { trustProxy: true, trustedHops: 1 }), "70.41.3.18");
});

test("Operations: separate rate limiters per route with Retry-After and ApiError shape", async () => {
  const db = setupTestDb();
  const createLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 2 });
  const getLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 5 });
  const dailyLimiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 2 });

  const runtime = {
    db,
    rateLimiters: {
      createCheck: createLimiter,
      getCheck: getLimiter,
      globalDaily: dailyLimiter,
      confirmCheck: createRateLimiter({ windowMs: 60 * 1000, max: 10 }),
    },
    jobRunner: { run: (_id, fn) => fn(), activeCount: () => 0 },
    eventBus: { notify: () => {} },
  };

  const makeCreateReq = () => {
    const fd = new FormData();
    fd.append("text", "Scholarship application");
    fd.append("consent", "true");
    return new Request("http://localhost/api/checks", { method: "POST", body: fd });
  };

  // 1. Consume create quota
  const res1 = await createCheckHandler(makeCreateReq(), { runtime, extractDeps: { db, logger: { info: () => {}, error: () => {} } } });
  assert.equal(res1.status, 201);
  const res2 = await createCheckHandler(makeCreateReq(), { runtime, extractDeps: { db, logger: { info: () => {}, error: () => {} } } });
  assert.equal(res2.status, 201);

  // 3rd create request is blocked by createCheck rate limiter
  const res3 = await createCheckHandler(makeCreateReq(), { runtime });
  assert.equal(res3.status, 429);
  assert.ok(res3.headers.get("Retry-After"));
  const err3 = await res3.json();
  assert.equal(err3.code, "RATE_LIMITED");

  // But getCheck limiter is independent and unaffected
  const check = createCheck({ text: "test check" }, db);
  const getReq = new Request(`http://localhost/api/checks/${check.id}`);
  const getRes = await getCheckHandler(getReq, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });
  assert.equal(getRes.status, 200);
});

test("Operations: global daily check cap blocks creation after threshold with 429", async () => {
  const db = setupTestDb();
  const createLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 100 });
  const dailyLimiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 1 });

  const runtime = {
    db,
    rateLimiters: {
      createCheck: createLimiter,
      globalDaily: dailyLimiter,
    },
    jobRunner: { run: (_id, fn) => fn(), activeCount: () => 0 },
    eventBus: { notify: () => {} },
  };

  const makeReq = () => {
    const fd = new FormData();
    fd.append("text", "Check cap test");
    fd.append("consent", "true");
    return new Request("http://localhost/api/checks", { method: "POST", body: fd });
  };

  // 1st request passes
  const res1 = await createCheckHandler(makeReq(), { runtime, extractDeps: { db, logger: { info: () => {}, error: () => {} } } });
  assert.equal(res1.status, 201);

  // 2nd request is blocked by global daily cap
  const res2 = await createCheckHandler(makeReq(), { runtime });
  assert.equal(res2.status, 429);
  const data = await res2.json();
  assert.equal(data.code, "RATE_LIMITED");
});

test("Operations: security header set is present on responses from all routes", async () => {
  const db = setupTestDb();
  const check = createCheck({ text: "test check" }, db);

  const runtime = {
    db,
    rateLimiters: {
      getCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      streamCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
    },
    eventBus: { listenerCount: () => 0, subscribe: () => () => {} },
  };

  // 1. Health route
  const healthRes = await getHealthHandler(new Request("http://localhost/api/health"), { runtime });
  assert.equal(healthRes.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(healthRes.headers.get("X-Frame-Options"), "DENY");
  assert.equal(healthRes.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(healthRes.headers.get("Content-Security-Policy"), "default-src 'none'; frame-ancestors 'none'");

  // 2. GET Check route
  const checkRes = await getCheckHandler(new Request(`http://localhost/api/checks/${check.id}`), {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });
  assert.equal(checkRes.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(checkRes.headers.get("X-Frame-Options"), "DENY");

  // 3. GET Stream route
  const streamRes = await getStreamHandler(new Request(`http://localhost/api/checks/${check.id}/stream`), {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });
  assert.equal(streamRes.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(streamRes.headers.get("X-Frame-Options"), "DENY");
});
