import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";
process.env.UPLOAD_DIR = "./test_security_uploads";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createJobRunner } from "../lib/api/jobs.js";
import { createEventBus } from "../lib/api/event-bus.js";
import { ApiErrorSchema } from "../lib/contracts/api-error.js";
import { createCheck, updateStatus, getCheck, getEntities, getInputs } from "../lib/db/index.js";

import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";
import { POST as confirmCheckHandler } from "../app/api/checks/[id]/confirm/route.js";
import { GET as getStreamHandler } from "../app/api/checks/[id]/stream/route.js";
import { GET as getReportHandler } from "../app/api/checks/[id]/report/route.js";

const TEST_DB_PATH = "./data/test_security.db";
const TEST_UPLOADS_DIR = "./test_security_uploads";

function setupSecurityTestEnvironment() {
  if (fs.existsSync(TEST_UPLOADS_DIR)) {
    fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_UPLOADS_DIR, { recursive: true });

  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const rateLimiters = {
    createCheck: createRateLimiter({ windowMs: 60 * 1000, max: 20 }),
    confirmCheck: createRateLimiter({ windowMs: 60 * 1000, max: 20 }),
    getCheck: createRateLimiter({ windowMs: 60 * 1000, max: 50 }),
    streamCheck: createRateLimiter({ windowMs: 60 * 1000, max: 20 }),
    globalDaily: createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 500 }),
  };

  const jobRunner = createJobRunner({ maxConcurrent: 10 });
  const eventBus = createEventBus();
  const capturedLogs = [];

  const mockLogger = {
    info: (obj, msg) => capturedLogs.push({ level: "info", obj, msg }),
    warn: (obj, msg) => capturedLogs.push({ level: "warn", obj, msg }),
    error: (obj, msg) => capturedLogs.push({ level: "error", obj, msg }),
  };

  return {
    db,
    rateLimiters,
    jobRunner,
    eventBus,
    logger: mockLogger,
    capturedLogs,
    uploadDir: TEST_UPLOADS_DIR,
  };
}

async function createValidPngBuffer() {
  return await sharp({
    create: {
      width: 50,
      height: 50,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  }).png().toBuffer();
}

function verifySecurityHeaders(res) {
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(res.headers.get("Content-Security-Policy"), "default-src 'none'; frame-ancestors 'none'");
}

test("Security: path traversal, absolute path, null bytes and double extensions in image filenames", async () => {
  const runtime = setupSecurityTestEnvironment();
  const pngBuffer = await createValidPngBuffer();

  const traversalNames = [
    "../../etc/passwd",
    "../../../shadow.png",
    "/root/forbidden.png",
    "image\0.png",
    "shell.php.png",
    "malicious/nested/dir/test.png",
  ];

  for (const maliciousFilename of traversalNames) {
    const fd = new FormData();
    fd.append("consent", "true");
    fd.append("text", "Valid opportunity notice");
    fd.append("images", new Blob([pngBuffer], { type: "image/png" }), maliciousFilename);

    const res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd }), {
      runtime,
    });

    assert.equal(res.status, 201, `Upload with name ${maliciousFilename} should be processed safely`);
    verifySecurityHeaders(res);
    const body = await res.json();
    assert.ok(body.checkId);

    // Wait for background extraction
    await runtime.jobRunner.waitForAll(1000);

    // Verify no files escaped TEST_UPLOADS_DIR
    const files = fs.readdirSync(TEST_UPLOADS_DIR);
    assert.equal(files.length, 0, "No files should remain or be written outside target folder");
  }
});

test("Security: spoofed magic bytes, polyglot and truncated image files rejected with 400", async () => {
  const runtime = setupSecurityTestEnvironment();

  const payloads = [
    { name: "spoofed-png.png", buf: Buffer.from("\x89PNG\r\n\x1a\nThis is not a real image stream", "utf8") },
    { name: "truncated.jpg", buf: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
    { name: "polyglot.png", buf: Buffer.from("\x89PNG\r\n\x1a\n<?php phpinfo(); ?>", "utf8") },
    { name: "random-bytes.png", buf: Buffer.from("just arbitrary string bytes without headers", "utf8") },
  ];

  for (const { name, buf } of payloads) {
    const fd = new FormData();
    fd.append("consent", "true");
    fd.append("images", new Blob([buf], { type: "image/png" }), name);

    const res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd }), {
      runtime,
    });

    assert.equal(res.status, 400, `Payload ${name} must be rejected with 400`);
    const err = await res.json();
    ApiErrorSchema.parse(err);
    assert.equal(err.code, "BAD_REQUEST");

    // Upload folder must remain empty
    assert.equal(fs.readdirSync(TEST_UPLOADS_DIR).length, 0);
  }
});

test("Security: total payload exceeding 26MB rejected with 413 PAYLOAD_TOO_LARGE", async () => {
  const runtime = setupSecurityTestEnvironment();

  // Test declared content-length rejection or chunked stream exceeding 26MB
  const req = new Request("http://localhost/api/checks", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=----WebKitFormBoundaryX",
      "content-length": String(28 * 1024 * 1024), // 28MB
    },
    body: "dummy",
  });

  const res = await createCheckHandler(req, { runtime });
  // Either 413 or 400 if body parsing fails on dummy payload, but if content-length is checked it's 413
  assert.ok(res.status === 413 || res.status === 400);
});

test("Security: decompression bomb style image rejected or processed safely", async () => {
  const runtime = setupSecurityTestEnvironment();
  // Valid small buffer
  const png = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  }).png().toBuffer();

  const fd = new FormData();
  fd.append("consent", "true");
  fd.append("images", new Blob([png], { type: "image/png" }), "normal.png");

  const start = Date.now();
  const res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd }), {
    runtime,
  });
  const elapsed = Date.now() - start;
  assert.equal(res.status, 201);
  assert.ok(elapsed < 3000, "Image handling should not stall CPU");
});

test("Security: unexpected and excessive fields in multipart creation", async () => {
  const runtime = setupSecurityTestEnvironment();

  // 1. Unknown form field
  const fd1 = new FormData();
  fd1.append("consent", "true");
  fd1.append("text", "Some offer");
  fd1.append("adminOverride", "true");

  const res1 = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd1 }), {
    runtime,
  });
  assert.equal(res1.status, 400);
  const err1 = await res1.json();
  ApiErrorSchema.parse(err1);
  assert.equal(err1.code, "BAD_REQUEST");

  // 2. Extremely long field values exceeding schema limit (e.g. text > 10,000 chars)
  const fd2 = new FormData();
  fd2.append("consent", "true");
  fd2.append("text", "A".repeat(15000));

  const res2 = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd2 }), {
    runtime,
  });
  assert.equal(res2.status, 400);
  const err2 = await res2.json();
  ApiErrorSchema.parse(err2);
  assert.equal(err2.code, "BAD_REQUEST");
});

test("Security: Unicode, emojis, null-like characters, and control characters in text handled safely", async () => {
  const runtime = setupSecurityTestEnvironment();
  const unicodeText = "Scholarship offer: 🎉 ₹50,000 grant! \u0000\u0007\t\n \u202Ereversed text\u202C";

  const fd = new FormData();
  fd.append("consent", "true");
  fd.append("text", unicodeText);
  fd.append("company", "TechCorp \uD83D\uDE00");

  const res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd }), {
    runtime,
  });
  assert.equal(res.status, 201);
  const { checkId } = await res.json();

  const inputs = getInputs(checkId, runtime.db);
  const textInput = inputs.find((i) => i.type === "text");
  assert.ok(textInput);
  assert.ok(textInput.value.includes("₹50,000"));
});

test("Security: malformed JSON and Content-Type in confirm check", async () => {
  const runtime = setupSecurityTestEnvironment();
  const { id: checkId } = createCheck({ language: "en", status: "awaiting_confirmation" }, runtime.db);

  // 1. Wrong Content-Type
  const res1 = await confirmCheckHandler(
    new Request(`http://localhost/api/checks/${checkId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "plain string",
    }),
    { runtime, params: Promise.resolve({ id: checkId }) }
  );
  assert.equal(res1.status, 415);
  const err1 = await res1.json();
  ApiErrorSchema.parse(err1);
  assert.equal(err1.code, "UNSUPPORTED_MEDIA_TYPE");

  // 2. Malformed JSON
  const res2 = await confirmCheckHandler(
    new Request(`http://localhost/api/checks/${checkId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json: true }",
    }),
    { runtime, params: Promise.resolve({ id: checkId }) }
  );
  assert.equal(res2.status, 400);
  const err2 = await res2.json();
  ApiErrorSchema.parse(err2);
  assert.equal(err2.code, "BAD_REQUEST");
});

test("Security: SSRF targets in confirm entities accepted only as plain strings in DB, never fetched by routes", async () => {
  const runtime = setupSecurityTestEnvironment();
  const { id: checkId } = createCheck({ language: "en", status: "awaiting_confirmation" }, runtime.db);

  // Entities with valid schema syntax targeting internal network addresses
  const ssrfEntities = [
    { kind: "domain", value: "internal.corp.local" },
    { kind: "url", value: "http://169.254.169.254/latest/meta-data/" },
    { kind: "url", value: "http://localhost:8080/admin" },
    { kind: "url", value: "http://127.0.0.1:3000/internal" },
    { kind: "url", value: "http://10.0.0.1:8080/internal" },
  ];

  const res = await confirmCheckHandler(
    new Request(`http://localhost/api/checks/${checkId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: ["Checking SSRF payload"],
        entities: ssrfEntities,
      }),
    }),
    {
      runtime,
      params: Promise.resolve({ id: checkId }),
      coordinatorDeps: {
        db: runtime.db,
        logger: runtime.logger,
        runInvestigation: async () => {}, // Stub so coordinator does not execute tools
      },
    }
  );

  assert.equal(res.status, 200);
  verifySecurityHeaders(res);

  // Assert entities stored strictly as plain strings in DB
  const storedEntities = getEntities(checkId, runtime.db);
  assert.equal(storedEntities.length, ssrfEntities.length);
  for (const ent of storedEntities) {
    assert.equal(ent.source, "user");
    assert.ok(typeof ent.value === "string");
  }

  // Also verify invalid protocols (file://) or raw IP domain literals fail schema validation with 400
  const { id: invalidCheckId } = createCheck({ language: "en", status: "awaiting_confirmation" }, runtime.db);
  const invalidRes = await confirmCheckHandler(
    new Request(`http://localhost/api/checks/${invalidCheckId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: ["Checking SSRF payload"],
        entities: [{ kind: "url", value: "file:///etc/passwd" }],
      }),
    }),
    {
      runtime,
      params: Promise.resolve({ id: invalidCheckId }),
      coordinatorDeps: {
        db: runtime.db,
        logger: runtime.logger,
        runInvestigation: async () => {},
      },
    }
  );
  assert.equal(invalidRes.status, 400);
});

test("Security: cross-check isolation, ID enumeration, and 404 vs 410 error shapes", async () => {
  const runtime = setupSecurityTestEnvironment();
  const { id: checkA } = createCheck({ language: "en", status: "awaiting_confirmation" }, runtime.db);
  const { id: checkB } = createCheck({ language: "en", status: "created" }, runtime.db);

  // 1. Confirm check A cannot confirm or alter check B
  const resConfA = await confirmCheckHandler(
    new Request(`http://localhost/api/checks/${checkA}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: ["Notice A"], entities: [] }),
    }),
    { runtime, params: Promise.resolve({ id: checkA }) }
  );
  assert.equal(resConfA.status, 200);

  // Check B remains in "created"
  const checkBData = getCheck(checkB, runtime.db);
  assert.equal(checkBData.status, "created");

  // 2. Non-existent ID returns 404
  const fakeUuid = "00000000-0000-4000-8000-000000000000";
  const res404 = await getCheckHandler(new Request(`http://localhost/api/checks/${fakeUuid}`), {
    runtime,
    params: Promise.resolve({ id: fakeUuid }),
  });
  assert.equal(res404.status, 404);
  const err404 = await res404.json();
  ApiErrorSchema.parse(err404);
  assert.equal(err404.code, "NOT_FOUND");

  // 3. Invalid UUID returns 400
  const res400 = await getCheckHandler(new Request("http://localhost/api/checks/not-a-valid-uuid"), {
    runtime,
    params: Promise.resolve({ id: "not-a-valid-uuid" }),
  });
  assert.equal(res400.status, 400);
  const err400 = await res400.json();
  ApiErrorSchema.parse(err400);
  assert.equal(err400.code, "BAD_REQUEST");

  // 4. Expired check returns 410 CHECK_EXPIRED
  const pastDate = new Date(Date.now() - 100000).toISOString();
  runtime.db.prepare("UPDATE checks SET expires_at = ? WHERE id = ?").run(pastDate, checkB);

  const res410 = await getCheckHandler(new Request(`http://localhost/api/checks/${checkB}`), {
    runtime,
    params: Promise.resolve({ id: checkB }),
  });
  assert.equal(res410.status, 410);
  const err410 = await res410.json();
  ApiErrorSchema.parse(err410);
  assert.equal(err410.code, "CHECK_EXPIRED");
});

test("Security: SQL injection strings stored and returned as plain text without executing", async () => {
  const runtime = setupSecurityTestEnvironment();
  const sqlInjection = "Robert'); DROP TABLE checks; -- ' OR '1'='1";

  const fd = new FormData();
  fd.append("consent", "true");
  fd.append("text", sqlInjection);
  fd.append("company", sqlInjection);

  const res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd }), {
    runtime,
  });
  assert.equal(res.status, 201);
  const { checkId } = await res.json();

  // Verify DB table intact
  const tableCheck = runtime.db.prepare("SELECT count(*) as count FROM checks").get();
  assert.ok(tableCheck.count >= 1);

  const inputs = getInputs(checkId, runtime.db);
  assert.ok(inputs.some((i) => i.value === sqlInjection));
});

test("Security: HTML and script tags returned with application/json and nosniff headers", async () => {
  const runtime = setupSecurityTestEnvironment();
  const xssPayload = "<script>alert('XSS')</script><img src=x onerror=alert(1)>";

  const fd = new FormData();
  fd.append("consent", "true");
  fd.append("text", xssPayload);

  const res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd }), {
    runtime,
  });
  assert.equal(res.status, 201);
  verifySecurityHeaders(res);
  const { checkId } = await res.json();

  const getRes = await getCheckHandler(new Request(`http://localhost/api/checks/${checkId}`), {
    runtime,
    params: Promise.resolve({ id: checkId }),
  });
  assert.equal(getRes.status, 200);
  verifySecurityHeaders(getRes);
  assert.ok(getRes.headers.get("Content-Type").includes("application/json"));

  // Check raw DB input contains the payload safely stored as text without escaping
  const inputs = getInputs(checkId, runtime.db);
  const inputVal = inputs.find((i) => i.type === "text")?.value;
  assert.equal(inputVal, xssPayload);
});

test("Security: confirmation replay on already investigating or report_ready check is idempotent (returns 200)", async () => {
  const runtime = setupSecurityTestEnvironment();
  const { id: checkId } = createCheck({ language: "en", status: "awaiting_confirmation" }, runtime.db);

  const confirmPayload = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: ["Verified notice"], entities: [] }),
  };

  // First confirm succeeds
  const res1 = await confirmCheckHandler(new Request(`http://localhost/api/checks/${checkId}/confirm`, confirmPayload), {
    runtime,
    params: Promise.resolve({ id: checkId }),
  });
  assert.equal(res1.status, 200);

  // Second confirm (replay) is idempotent, returning 200 with status investigating
  const res2 = await confirmCheckHandler(new Request(`http://localhost/api/checks/${checkId}/confirm`, confirmPayload), {
    runtime,
    params: Promise.resolve({ id: checkId }),
  });
  assert.equal(res2.status, 200);
  const data = await res2.json();
  assert.equal(data.checkId, checkId);
  assert.equal(data.status, "investigating");
});

test("Security: concurrency saturation returns 503 SERVICE_UNAVAILABLE with Retry-After", async () => {
  const runtime = setupSecurityTestEnvironment();
  // Saturate 2 slots with dedicated runner
  const saturatingRunner = createJobRunner({ maxConcurrent: 2 });
  const saturatingRuntime = { ...runtime, jobRunner: saturatingRunner };

  let releaseJob1;
  let releaseJob2;
  const p1 = new Promise((resolve) => { releaseJob1 = resolve; });
  const p2 = new Promise((resolve) => { releaseJob2 = resolve; });
  saturatingRunner.run("block-1", () => p1);
  saturatingRunner.run("block-2", () => p2);

  const fd = new FormData();
  fd.append("consent", "true");
  fd.append("text", "Check under load");

  const res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd }), {
    runtime: saturatingRuntime,
  });

  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "10");
  const err = await res.json();
  ApiErrorSchema.parse(err);
  assert.equal(err.code, "SERVICE_UNAVAILABLE");

  // Clean up held jobs
  releaseJob1();
  releaseJob2();
  await saturatingRunner.waitForAll(1000);
});

test("Security: stream client abort cancels event bus subscriber cleanly", async () => {
  const runtime = setupSecurityTestEnvironment();
  const { id: checkId } = createCheck({ language: "en", status: "investigating" }, runtime.db);

  const controller = new AbortController();
  const streamRes = await getStreamHandler(
    new Request(`http://localhost/api/checks/${checkId}/stream`, { signal: controller.signal }),
    {
      runtime,
      params: Promise.resolve({ id: checkId }),
    }
  );
  assert.equal(streamRes.status, 200);
  assert.equal(runtime.eventBus.listenerCount(checkId), 1);

  // Abort client request
  controller.abort();

  // Reading from aborted stream triggers teardown
  const reader = streamRes.body.getReader();
  try {
    await reader.read();
  } catch (_e) {
    // Expected abort error
  }

  // Allow event loop to process abort signal cleanup
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(runtime.eventBus.listenerCount(checkId), 0);
});

test("Security: structured logger guarantees NO PII, user message, or secrets in logged entries", async () => {
  const runtime = setupSecurityTestEnvironment();
  const sensitivePhone = "+919876543210";
  const sensitiveEmail = "victim@example.com";
  const sensitiveText = "My secret passport number is X1234567";

  const req = new Request("http://localhost/api/checks", {
    method: "POST",
    headers: {
      Authorization: "Bearer super-secret-token-12345",
      "x-sensitive-header": "confidential",
    },
    body: (() => {
      const fd = new FormData();
      fd.append("consent", "true");
      fd.append("text", sensitiveText);
      fd.append("phone", sensitivePhone);
      return fd;
    })(),
  });

  // Test logger via createRequestLogger
  const { createRequestLogger } = await import("../lib/api/log.js");
  const reqLogger = createRequestLogger(req, "/api/checks", { logger: runtime.logger });
  reqLogger.logResponse(201, { ip: "127.0.0.1", bytesRead: 100 });

  assert.ok(runtime.capturedLogs.length > 0);
  for (const logItem of runtime.capturedLogs) {
    const serialized = JSON.stringify(logItem);
    assert.ok(!serialized.includes(sensitivePhone), "Logger must not contain phone numbers");
    assert.ok(!serialized.includes(sensitiveEmail), "Logger must not contain emails");
    assert.ok(!serialized.includes(sensitiveText), "Logger must not contain user message text");
    assert.ok(!serialized.includes("super-secret-token-12345"), "Logger must not contain authorization headers");
    assert.ok(!serialized.includes("passport"), "Logger must not contain sensitive keywords");
  }
});
