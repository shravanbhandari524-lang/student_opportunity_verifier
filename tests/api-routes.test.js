import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";
process.env.UPLOAD_DIR = "./test_route_uploads";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createJobRunner } from "../lib/api/jobs.js";
import { createEventBus } from "../lib/api/event-bus.js";
import { ApiErrorSchema } from "../lib/contracts/api-error.js";
import { ReportSchema } from "../lib/contracts/report.js";
import { getCheck, getEntities, getInputs, getReport, createCheck, updateStatus, saveInputs, saveConfirmation, saveReport } from "../lib/db/index.js";
import { clearScamScenario } from "../lib/contracts/fixtures/scenarios/scenario-a.js";
import { genuineNoticeScenario } from "../lib/contracts/fixtures/scenarios/scenario-b.js";
import { ambiguousThinEvidenceScenario } from "../lib/contracts/fixtures/scenarios/scenario-c.js";
import { getAgentResults } from "../lib/db/index.js";
import { createScenarioGenerate } from "./helpers/mock-generate.js";

// Import route handlers
import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";
import { POST as confirmCheckHandler } from "../app/api/checks/[id]/confirm/route.js";
import { GET as getReportHandler } from "../app/api/checks/[id]/report/route.js";
import { GET as getHealthHandler } from "../app/api/health/route.js";

const TEST_UPLOADS_DIR = "./test_route_uploads";

function setupTestEnvironment() {
  const dbPath = path.join(os.tmpdir(), `test_routes_${crypto.randomUUID()}.db`);
  if (fs.existsSync(TEST_UPLOADS_DIR)) {
    fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_UPLOADS_DIR, { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const rateLimiters = {
    createCheck: createRateLimiter({ windowMs: 60 * 1000, max: 10 }),
    confirmCheck: createRateLimiter({ windowMs: 60 * 1000, max: 10 }),
    getCheck: createRateLimiter({ windowMs: 60 * 1000, max: 20 }),
    globalDaily: createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 100 }),
  };

  const jobRunner = createJobRunner({ maxConcurrent: 2 });
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
  };
}

async function createTinyImage(format = "png") {
  const instance = sharp({
    create: {
      width: 50,
      height: 50,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  });
  if (format === "png") return await instance.png().toBuffer();
  if (format === "jpeg" || format === "jpg") return await instance.jpeg().toBuffer();
  throw new Error(`Unsupported test image format: ${format}`);
}

function verifySecurityHeaders(res) {
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(res.headers.get("Content-Security-Policy"), "default-src 'none'; frame-ancestors 'none'");
}

test("API Routes: POST /api/checks valid text-only creation", async () => {
  const runtime = setupTestEnvironment();
  const formData = new FormData();
  formData.append("text", "Urgent scholarship registration fee required");
  formData.append("upiId", "pay-scam@upi");
  formData.append("consent", "true");
  formData.append("language", "en");

  const req = new Request("http://localhost/api/checks", {
    method: "POST",
    body: formData,
  });

  const res = await createCheckHandler(req, { runtime });
  assert.equal(res.status, 201);
  verifySecurityHeaders(res);

  const data = await res.json();
  assert.ok(data.checkId);
  assert.equal(data.status, "created");

  // Await extraction job to complete
  await runtime.jobRunner.waitForAll(2000);

  // Verify DB state reaches awaiting_confirmation
  const check = getCheck(data.checkId, runtime.db);
  assert.equal(check.status, "awaiting_confirmation");
  assert.equal(check.language, "en");

  const inputs = getInputs(data.checkId, runtime.db);
  assert.ok(inputs.some((i) => i.type === "text" && i.value.includes("Urgent scholarship")));
  assert.ok(inputs.some((i) => i.type === "upi" && i.value === "pay-scam@upi"));
});

test("API Routes: POST /api/checks valid PNG and JPEG upload", async () => {
  const runtime = setupTestEnvironment();
  const pngBuffer = await createTinyImage("png");
  const jpegBuffer = await createTinyImage("jpeg");

  const formData = new FormData();
  formData.append("consent", "true");
  formData.append("images", new Blob([pngBuffer], { type: "image/png" }), "offer.png");
  formData.append("images", new Blob([jpegBuffer], { type: "image/jpeg" }), "letter.jpg");

  const req = new Request("http://localhost/api/checks", {
    method: "POST",
    body: formData,
  });

  const res = await createCheckHandler(req, { runtime });
  assert.equal(res.status, 201);
  const data = await res.json();

  // Await background extraction
  await runtime.jobRunner.waitForAll(2000);

  // Verify that images are cleared from disk and database after extraction per ARCHITECTURE & PRD
  const inputs = getInputs(data.checkId, runtime.db);
  const imageInputs = inputs.filter((i) => i.type === "image");
  assert.equal(imageInputs.length, 2);
  for (const img of imageInputs) {
    // Images are cleared after extraction in extract.js
    assert.equal(img.filePath, null);
  }

  // Upload dir must be empty
  const remainingFiles = fs.readdirSync(TEST_UPLOADS_DIR);
  assert.equal(remainingFiles.length, 0);
});

test("API Routes: POST /api/checks rejects spoofed image with 400 and writes nothing", async () => {
  const runtime = setupTestEnvironment();
  const fakePng = Buffer.from("THIS IS NOT A VALID PNG IMAGE HEADER", "utf-8");

  const formData = new FormData();
  formData.append("consent", "true");
  formData.append("images", new Blob([fakePng], { type: "image/png" }), "fake.png");

  const req = new Request("http://localhost/api/checks", {
    method: "POST",
    body: formData,
  });

  const res = await createCheckHandler(req, { runtime });
  assert.equal(res.status, 400);
  const errJson = await res.json();
  ApiErrorSchema.parse(errJson);
  assert.equal(errJson.code, "BAD_REQUEST");

  // Check no DB row created
  const checksCount = runtime.db.prepare("SELECT count(*) as count FROM checks").get().count;
  assert.equal(checksCount, 0);

  // Check upload dir has 0 files
  const files = fs.readdirSync(TEST_UPLOADS_DIR);
  assert.equal(files.length, 0);
});

test("API Routes: POST /api/checks validation failures (missing consent, bad language, no input, unknown field)", async () => {
  const runtime = setupTestEnvironment();

  // Missing consent
  const fd1 = new FormData();
  fd1.append("text", "Valid text");
  let res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd1 }), { runtime });
  assert.equal(res.status, 400);
  let err = await res.json();
  ApiErrorSchema.parse(err);
  assert.equal(err.code, "BAD_REQUEST");

  // Bad language
  const fd2 = new FormData();
  fd2.append("text", "Valid text");
  fd2.append("consent", "true");
  fd2.append("language", "fr");
  res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd2 }), { runtime });
  assert.equal(res.status, 400);

  // No primary input at all
  const fd3 = new FormData();
  fd3.append("company", "Fake Corp");
  fd3.append("consent", "true");
  res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd3 }), { runtime });
  assert.equal(res.status, 400);

  // Unknown field
  const fd4 = new FormData();
  fd4.append("text", "Valid text");
  fd4.append("consent", "true");
  fd4.append("maliciousField", "exploit");
  res = await createCheckHandler(new Request("http://localhost/api/checks", { method: "POST", body: fd4 }), { runtime });
  assert.equal(res.status, 400);
});

test("API Routes: POST /api/checks rate limit 429 after max requests with Retry-After", async () => {
  const runtime = setupTestEnvironment();
  runtime.rateLimiters.createCheck = createRateLimiter({ windowMs: 60 * 1000, max: 2 });

  const makeReq = () => {
    const fd = new FormData();
    fd.append("text", "Test text");
    fd.append("consent", "true");
    return new Request("http://localhost/api/checks", { method: "POST", body: fd });
  };

  const res1 = await createCheckHandler(makeReq(), { runtime });
  assert.equal(res1.status, 201);
  const res2 = await createCheckHandler(makeReq(), { runtime });
  assert.equal(res2.status, 201);

  // 3rd call is rate limited (max is 2)
  const res3 = await createCheckHandler(makeReq(), { runtime });
  assert.equal(res3.status, 429);
  assert.ok(res3.headers.get("Retry-After"));
  const err = await res3.json();
  ApiErrorSchema.parse(err);
  assert.equal(err.code, "RATE_LIMITED");
});

test("API Routes: POST /api/checks busy runner returns 503 and leaves no orphan check or file", async () => {
  const runtime = setupTestEnvironment();
  // Fill runner capacity
  const release1 = new Promise((resolve) => setTimeout(resolve, 5000));
  const release2 = new Promise((resolve) => setTimeout(resolve, 5000));
  runtime.jobRunner.run("busy-1", () => release1);
  runtime.jobRunner.run("busy-2", () => release2);

  const pngBuffer = await createTinyImage("png");
  const fd = new FormData();
  fd.append("consent", "true");
  fd.append("images", new Blob([pngBuffer], { type: "image/png" }), "busy.png");

  const req = new Request("http://localhost/api/checks", { method: "POST", body: fd });
  const res = await createCheckHandler(req, { runtime });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "10");

  const err = await res.json();
  ApiErrorSchema.parse(err);
  assert.equal(err.code, "SERVICE_UNAVAILABLE");

  // Verify no checks or orphan files left behind
  const count = runtime.db.prepare("SELECT count(*) as count FROM checks").get().count;
  assert.equal(count, 0);
  const files = fs.readdirSync(TEST_UPLOADS_DIR);
  assert.equal(files.length, 0);
});

test("API Routes: GET /api/checks/:id validates id, 404 for unknown, 410 for expired", async () => {
  const runtime = setupTestEnvironment();

  // Malformed ID
  const resMalformed = await getCheckHandler(new Request("http://localhost/api/checks/not-uuid"), {
    runtime,
    params: Promise.resolve({ id: "not-uuid" }),
  });
  assert.equal(resMalformed.status, 400);

  // Unknown ID
  const unknownId = "11111111-1111-4111-8111-111111111111";
  const resUnknown = await getCheckHandler(new Request(`http://localhost/api/checks/${unknownId}`), {
    runtime,
    params: Promise.resolve({ id: unknownId }),
  });
  assert.equal(resUnknown.status, 404);

  // Expired Check
  const expiredCheck = createCheck({}, runtime.db);
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  runtime.db.prepare("UPDATE checks SET expires_at = ? WHERE id = ?").run(yesterday, expiredCheck.id);

  const resExpired = await getCheckHandler(new Request(`http://localhost/api/checks/${expiredCheck.id}`), {
    runtime,
    params: Promise.resolve({ id: expiredCheck.id }),
  });
  assert.equal(resExpired.status, 410);
  const err = await resExpired.json();
  ApiErrorSchema.parse(err);
  assert.equal(err.code, "CHECK_EXPIRED");
});

test("API Routes: GET /api/checks/:id returns only allowed fields and no secrets", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ status: "awaiting_confirmation" }, runtime.db);
  saveInputs(check.id, [{ type: "text", value: "Secret text content" }, { type: "image", filePath: "/internal/path/img.png" }], runtime.db);

  const res = await getCheckHandler(new Request(`http://localhost/api/checks/${check.id}`), {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });
  assert.equal(res.status, 200);
  verifySecurityHeaders(res);

  const data = await res.json();
  assert.deepEqual(Object.keys(data).sort(), ["check", "entities", "text"].sort());
  assert.deepEqual(Object.keys(data.check).sort(), [
    "id",
    "status",
    "currentRound",
    "language",
    "riskLevel",
    "score",
    "confidence",
    "failureReason",
    "createdAt",
    "updatedAt",
    "expiresAt",
  ].sort());

  // Strict secrecy asserts: no internal filePath, row IDs, or stacks
  assert.equal(JSON.stringify(data).includes("/internal/path/img.png"), false);
});

test("API Routes: POST /api/checks/:id/confirm enforces state and invalid inputs", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ status: "created" }, runtime.db); // Not awaiting_confirmation

  // Confirm in created state -> 409 STATE_CONFLICT
  const reqWrongState = new Request(`http://localhost/api/checks/${check.id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: ["Verified text"] }),
  });
  const resWrongState = await confirmCheckHandler(reqWrongState, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });
  assert.equal(resWrongState.status, 409);
  const err1 = await resWrongState.json();
  ApiErrorSchema.parse(err1);
  assert.equal(err1.code, "STATE_CONFLICT");

  // Move to awaiting_confirmation
  updateStatus(check.id, "extracting", runtime.db);
  updateStatus(check.id, "awaiting_confirmation", runtime.db);

  // Invalid entity kind -> 400 VALIDATION_ERROR
  const reqBadKind = new Request(`http://localhost/api/checks/${check.id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entities: [{ kind: "invalid_kind_123", value: "test" }] }),
  });
  const resBadKind = await confirmCheckHandler(reqBadKind, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });
  assert.equal(resBadKind.status, 400);
  const err2 = await resBadKind.json();
  ApiErrorSchema.parse(err2);
  assert.equal(err2.code, "BAD_REQUEST");

  // Valid confirm -> 200 investigating
  const reqValid = new Request(`http://localhost/api/checks/${check.id}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: ["Confirmed message"],
      entities: [{ kind: "domain", value: "  SCAM-PORTAL.EXAMPLE  " }],
    }),
  });
  const resValid = await confirmCheckHandler(reqValid, {
    runtime,
    params: Promise.resolve({ id: check.id }),
    coordinatorDeps: {
      db: runtime.db,
      logger: runtime.logger,
      generate: async () => ({ ok: true, data: { summary: "Report", findings: [] } }),
      classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
      search: async () => ({ ok: true, data: { results: [] } }),
      readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
      graphLookup: () => ({ matched: false }),
    },
  });
  assert.equal(resValid.status, 200);
  const data = await resValid.json();
  assert.equal(data.status, "investigating");

  // Confirm twice is idempotent -> 200 with current status
  const resConfirmTwice = await confirmCheckHandler(reqValid, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });
  assert.equal(resConfirmTwice.status, 200);
  const twiceData = await resConfirmTwice.json();
  assert.equal(twiceData.status, "investigating");
});

test("API Routes: concurrent confirm requests call jobRunner.run exactly once", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ status: "awaiting_confirmation", language: "en" }, runtime.db);

  let jobRunCount = 0;
  const originalRun = runtime.jobRunner.run;
  runtime.jobRunner.run = (checkId, taskFn) => {
    jobRunCount++;
    return originalRun(checkId, taskFn);
  };

  const createReq = () =>
    new Request(`http://localhost/api/checks/${check.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: ["Concurrent confirm test message"],
        entities: [{ kind: "domain", value: "opportunity-portal.example" }],
      }),
    });

  const ctx = {
    runtime,
    params: Promise.resolve({ id: check.id }),
    coordinatorDeps: {
      db: runtime.db,
      logger: runtime.logger,
      generate: async () => ({ ok: true, data: { summary: "Report", findings: [], actions: [] } }),
      classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
      search: async () => ({ ok: true, data: { results: [] } }),
      readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
      rdapLookup: async () => ({ ok: true, data: { domain: "example.com", creationDate: "2020-01-01" } }),
      dnsRecords: async () => ({ ok: true, data: { a: ["93.184.216.34"], mx: [] } }),
      sslInfo: async () => ({ ok: true, data: { valid: true, issuer: "DigiCert" } }),
      waybackFirstSeen: async () => ({ ok: true, data: { firstSeenDate: "2020-01-01" } }),
      urlhausLookup: async () => ({ ok: true, data: { query_status: "no_results" } }),
      urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
      graphLookup: () => ({ matched: false }),
      now: () => Date.now(),
    },
  };

  // Dispatch two concurrent confirm requests simultaneously
  const [res1, res2] = await Promise.all([
    confirmCheckHandler(createReq(), ctx),
    confirmCheckHandler(createReq(), ctx),
  ]);

  assert.equal(res1.status, 200, "First confirm request should return 200");
  assert.equal(res2.status, 200, "Second concurrent confirm request should return 200");

  const body1 = await res1.json();
  const body2 = await res2.json();
  assert.equal(body1.status, "investigating");
  assert.equal(body2.status, "investigating");

  // Crucial assertion: jobRunner.run must be called exactly once
  assert.equal(jobRunCount, 1, "jobRunner.run must be called exactly once despite concurrent confirm requests");

  // Await background investigation completion so DB isn't locked for subsequent tests
  await runtime.jobRunner.waitForAll(5000);

  const finalCheck = getCheck(check.id, runtime.db);
  assert.ok(["investigating", "report_ready"].includes(finalCheck.status));
});

test("API Routes: End-to-end Pipeline Scenarios A, B, and C reach report_ready with valid reports", async () => {
  const runtime = setupTestEnvironment();

  async function runScenario(scenarioData) {
    const check = createCheck({ status: "created", language: "en" }, runtime.db);
    updateStatus(check.id, "extracting", runtime.db);
    updateStatus(check.id, "awaiting_confirmation", runtime.db);

    const entities = scenarioData.entities.map((e) => ({
      kind: e.kind,
      value: e.value,
      source: "user",
    }));

    const confirmReq = new Request(`http://localhost/api/checks/${check.id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: [scenarioData.submission.text || "Opportunity text"],
        entities,
      }),
    });

    const isScenarioA = scenarioData.name === "scenario-a-clear-scam";
    const isScenarioB = scenarioData.name === "scenario-b-genuine-notice";
    const scenarioKey = isScenarioA ? "A" : isScenarioB ? "B" : "C";

    const mockCoordinatorDeps = {
      db: runtime.db,
      logger: runtime.logger,
      generate: createScenarioGenerate(scenarioKey),
      classify: async () => {
        if (isScenarioA) return { ok: true, data: { probability: 0.95, label: "scam" } };
        if (isScenarioB) return { ok: true, data: { probability: 0.05, label: "benign" } };
        throw new Error("ECONNREFUSED");
      },
      search: async () => (isScenarioA || isScenarioB ? { ok: true, data: { results: [] } } : { ok: false, error: { code: "TIMEOUT" } }),
      readPage: async () => (isScenarioA || isScenarioB ? { ok: true, data: { title: "", description: "", text: "", links: [] } } : { ok: false, error: { code: "TIMEOUT" } }),
      rdapLookup: async (domain) => ({
        ok: true,
        data: {
          domain,
          found: true,
          registrationDate: isScenarioA ? "2026-10-15T00:00:00.000Z" : "2015-01-01T00:00:00.000Z",
          expirationDate: "2027-10-15T00:00:00.000Z",
          ageDays: isScenarioA ? 5 : 3000,
          registrar: "Registrar Inc",
          status: ["active"],
          evidenceUrl: `https://rdap.org/domain/${domain}`,
        },
      }),
      dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["93.184.216.34"], mx: [], txt: [] } }),
      sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "CA", daysRemaining: 60 } }),
      waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: isScenarioA ? null : "2015-05-01T00:00:00.000Z", totalSnapshots: isScenarioA ? 0 : 50 } }),
      lookalikeCheck: (domain) => ({ domain, isLookalike: isScenarioA, targetDomain: isScenarioA ? "scholarships.gov.in" : null, similarityScore: isScenarioA ? 0.88 : 0 }),
      urlhaus: async () => ({ ok: true, data: { listed: false } }),
      urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
      graphLookup: (kind, value) => {
        if (!isScenarioA && !isScenarioB) {
          return { ok: false, error: { code: "ECONNREFUSED", message: "Graph lookup unavailable" } };
        }
        return { matched: isScenarioA, reportCount: isScenarioA ? 15 : 0, connectedNodesCount: isScenarioA ? 2 : 0 };
      },
      now: () => Date.now(),
    };

    const confirmRes = await confirmCheckHandler(confirmReq, {
      runtime,
      params: Promise.resolve({ id: check.id }),
      coordinatorDeps: mockCoordinatorDeps,
    });
    assert.equal(confirmRes.status, 200);

    // Await background investigation completion
    await runtime.jobRunner.waitForAll(5000);

    // Guard assertion: message_analyst must not be could_not_check
    const analystResult = getAgentResults(check.id, runtime.db).find((r) => r.agent === "message_analyst");
    assert.notEqual(
      analystResult?.status,
      "could_not_check",
      `Guard failed: message_analyst unexpectedly degraded to could_not_check: ${analystResult?.reason}`
    );

    // Verify report endpoint
    const reportReq = new Request(`http://localhost/api/checks/${check.id}/report`);
    const reportRes = await getReportHandler(reportReq, {
      runtime,
      params: Promise.resolve({ id: check.id }),
    });
    assert.equal(reportRes.status, 200);
    verifySecurityHeaders(reportRes);

    const reportJson = await reportRes.json();
    assert.ok(reportJson.report);
    ReportSchema.parse(reportJson.report);
    assert.equal(reportJson.report.checkId, check.id);
    return reportJson.report;
  }

  const reportA = await runScenario(clearScamScenario);
  assert.equal(reportA.riskLevel, "high");

  const reportB = await runScenario(genuineNoticeScenario);
  assert.equal(reportB.riskLevel, "low");

  const reportC = await runScenario(ambiguousThinEvidenceScenario);
  assert.equal(reportC.riskLevel, "cannot_verify");
});

test("API Routes: Scenario B with deliberately malformed analyst shape degrades to cannot_verify per S2 rule", async () => {
  const runtime = setupTestEnvironment();
  const scenarioData = genuineNoticeScenario;

  const formData = new FormData();
  formData.append("text", scenarioData.submission.text || "");
  formData.append("consent", "true");
  formData.append("language", scenarioData.submission.language || "en");
  if (scenarioData.submission.url) formData.append("url", scenarioData.submission.url);
  if (scenarioData.submission.company) formData.append("company", scenarioData.submission.company);

  const createReq = new Request("http://localhost/api/checks", {
    method: "POST",
    body: formData,
  });

  const extractDeps = {
    db: runtime.db,
    logger: runtime.logger,
    uploadDir: runtime.uploadDir,
    generate: async () => ({
      ok: true,
      data: {
        transcribedText: "",
        organisations: ["National Research Institute"],
        handles: [],
        urls: [scenarioData.submission.url],
        domains: ["research-portal.institute.edu.example"],
        upiIds: [],
        emails: [],
        phones: [],
        amounts: [],
      },
    }),
  };

  const createRes = await createCheckHandler(createReq, { runtime, extractDeps });
  assert.equal(createRes.status, 201);
  const { checkId } = await createRes.json();

  await runtime.jobRunner.waitForAll(5000);

  const entities = scenarioData.entities.map((e) => ({
    kind: e.kind,
    value: e.value,
    source: "user",
  }));

  const confirmReq = new Request(`http://localhost/api/checks/${checkId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [scenarioData.submission.text || "Opportunity text"],
      entities,
    }),
  });

  // Malformed analyst response: old shape with flags array instead of findings array
  const mockCoordinatorDeps = {
    db: runtime.db,
    logger: runtime.logger,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Report summary",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return {
        ok: true,
        data: {
          flags: [],
          verified: ["official domain matched"],
          notes: "Analysis ok",
        },
      };
    },
    classify: async () => ({ ok: true, data: { probability: 0.05, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2015-01-01T00:00:00.000Z",
        expirationDate: "2028-01-01T00:00:00.000Z",
        ageDays: 3000,
        registrar: "Registrar",
        status: ["active"],
        evidenceUrl: `https://rdap.org/${domain}`,
      },
    }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["93.184.216.34"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "Government CA", daysRemaining: 300 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: "2015-05-01T00:00:00.000Z", totalSnapshots: 100 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: false, targetDomain: null, similarityScore: 0.0 }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const confirmRes = await confirmCheckHandler(confirmReq, {
    runtime,
    params: Promise.resolve({ id: checkId }),
    coordinatorDeps: mockCoordinatorDeps,
  });
  assert.equal(confirmRes.status, 200);

  await runtime.jobRunner.waitForAll(5000);

  const reportReq = new Request(`http://localhost/api/checks/${checkId}/report`);
  const reportRes = await getReportHandler(reportReq, {
    runtime,
    params: Promise.resolve({ id: checkId }),
  });
  assert.equal(reportRes.status, 200);

  const reportJson = await reportRes.json();
  const report = ReportSchema.parse(reportJson.report);

  // Per S2 critical-agent rule: message_analyst failure downgrades would-be low to cannot_verify
  assert.equal(report.riskLevel, "cannot_verify");
  assert.equal(report.confidence, "low");

  const analystResult = getAgentResults(checkId, runtime.db).find((r) => r.agent === "message_analyst");
  assert.equal(analystResult?.status, "could_not_check");
  assert.equal(analystResult?.reason, "schema_validation_failed");
});

test("API Routes: GET /api/checks/:id/report returns 409 before report_ready", async () => {
  const runtime = setupTestEnvironment();
  const check = createCheck({ status: "awaiting_confirmation" }, runtime.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/report`);
  const res = await getReportHandler(req, {
    runtime,
    params: Promise.resolve({ id: check.id }),
  });

  assert.equal(res.status, 409);
  const err = await res.json();
  ApiErrorSchema.parse(err);
  assert.equal(err.code, "STATE_CONFLICT");
});

test("API Routes: Privacy invariant asserts canary marker never leaks into server logs", async () => {
  const runtime = setupTestEnvironment();
  const canaryMarker = "CANARY_SENSITIVE_TEXT_98765";

  const formData = new FormData();
  formData.append("text", `Notice containing ${canaryMarker}`);
  formData.append("upiId", "canary@okaxis");
  formData.append("company", `CanaryCorp_${canaryMarker}`);
  formData.append("consent", "true");

  const createReq = new Request("http://localhost/api/checks", { method: "POST", body: formData });
  await createCheckHandler(createReq, { runtime });

  // Assert canaryMarker does not exist anywhere in captured logs
  for (const log of runtime.capturedLogs) {
    const logStr = JSON.stringify(log);
    assert.ok(!logStr.includes(canaryMarker), `Log leaked canary marker: ${logStr}`);
  }
});

test("API Routes: GET /api/health returns 200 with standard uptime and headers", async () => {
  const req = new Request("http://localhost/api/health");
  const res = await getHealthHandler(req);

  assert.equal(res.status, 200);
  verifySecurityHeaders(res);
  const data = await res.json();
  assert.equal(data.status, "ok");
  assert.equal(typeof data.uptime, "number");
  assert.equal(typeof data.timestamp, "string");
});

test("API Routes: MAX_CONCURRENT_CREATES semaphore bounds parallel creates and releases slot in finally", async () => {
  const runtime = setupTestEnvironment();

  // Create a controlled semaphore with max 2
  let active = 0;
  let maxSeen = 0;
  const semaphore = {
    acquire() {
      if (active >= 2) return false;
      active++;
      if (active > maxSeen) maxSeen = active;
      return true;
    },
    release() {
      if (active > 0) active--;
    },
    getActiveCount() {
      return active;
    },
  };

  runtime.createSemaphore = semaphore;

  // Make 2 calls acquire the slots
  assert.equal(semaphore.acquire(), true);
  assert.equal(semaphore.acquire(), true);
  assert.equal(semaphore.getActiveCount(), 2);

  // A 3rd request must receive 503 SERVICE_UNAVAILABLE with Retry-After header
  const formData = new FormData();
  formData.append("text", "Scholarship opportunity");
  formData.append("consent", "true");

  const req = new Request("http://localhost/api/checks", { method: "POST", body: formData });
  const res503 = await createCheckHandler(req, { runtime });

  assert.equal(res503.status, 503);
  assert.equal(res503.headers.get("retry-after"), "10");
  const body503 = await res503.json();
  assert.equal(body503.code, "SERVICE_UNAVAILABLE");

  // Releasing the slots restores capacity
  semaphore.release();
  semaphore.release();
  assert.equal(semaphore.getActiveCount(), 0);

  // Normal request proceeds and slot is released in finally
  const normalReq = new Request("http://localhost/api/checks", { method: "POST", body: formData });
  const normalRes = await createCheckHandler(normalReq, { runtime });
  assert.equal(normalRes.status, 201);
  assert.equal(semaphore.getActiveCount(), 0, "Slot must be released in finally block");
});
