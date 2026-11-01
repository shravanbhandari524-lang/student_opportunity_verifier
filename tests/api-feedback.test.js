import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";
import { POST as feedbackPost } from "../app/api/checks/[id]/feedback/route.js";
import { runMigrations } from "../lib/db/migrations/index.js";
import { setRuntimeForTests, resetRuntime, getRuntime } from "../lib/api/runtime.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";

const TEST_DIR = path.resolve("./data/test_feedback_suite");
const TEST_DB = path.join(TEST_DIR, "feedback_test.db");

describe("POST /api/checks/:id/feedback route handler", () => {
  let db;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    db = new Database(TEST_DB);
    runMigrations(db);

    const baseRuntime = getRuntime({ db });
    setRuntimeForTests({
      ...baseRuntime,
      db,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        actionCheck: createRateLimiter({ windowMs: 60000, max: 100 }),
      },
    });
  });

  afterEach(() => {
    resetRuntime();
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function seedCheck({
    id = "11111111-1111-4111-8111-111111111111",
    status = "report_ready",
    riskLevel = "high",
    score = 80,
    expiresAt = new Date(Date.now() + 86400000).toISOString(),
  } = {}) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO checks (id, status, current_round, language, risk_level, score, confidence, created_at, updated_at, expires_at)
      VALUES (?, ?, 1, 'en', ?, ?, 'high', ?, ?, ?)
    `).run(id, status, riskLevel, score, now, now, expiresAt);
    return id;
  }

  it("submits valid feedback with outcome and stores redacted comment in database", async () => {
    const checkId = seedCheck();
    const req = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verdict: "right",
        outcome: "lost_money",
        comment: "I lost money to upi scammer@okaxis. Call me at +91 98765 43210 or email victim@gmail.com",
      }),
    });

    const res = await feedbackPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(typeof json.id === "number");

    // Verify stored row in database
    const row = db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(json.id);
    assert.equal(row.check_id, checkId);
    assert.equal(row.verdict, "right");
    assert.equal(row.risk_level_shown, "high");
    // Assert redaction occurred in stored value
    assert.ok(!row.comment.includes("scammer@okaxis"));
    assert.ok(!row.comment.includes("98765 43210"));
    assert.ok(!row.comment.includes("victim@gmail.com"));
    assert.ok(row.comment.includes("[REDACTED_UPI]"));
    assert.ok(row.comment.includes("[REDACTED_PHONE]"));
    assert.ok(row.comment.includes("[REDACTED_EMAIL]"));
  });

  it("rejects invalid verdict or outcome with 400 BAD_REQUEST", async () => {
    const checkId = seedCheck();
    const reqBadVerdict = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "maybe" }),
    });
    const res1 = await feedbackPost(reqBadVerdict, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res1.status, 400);

    const reqBadOutcome = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "right", outcome: "invalid_enum" }),
    });
    const res2 = await feedbackPost(reqBadOutcome, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res2.status, 400);
  });

  it("accepts comment of exactly 500 characters and rejects 501 characters", async () => {
    const checkId = seedCheck();

    // 500 characters
    const req500 = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verdict: "right",
        comment: "A".repeat(500),
      }),
    });
    const res500 = await feedbackPost(req500, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res500.status, 200);

    // 501 characters on a second check
    const checkId2 = seedCheck({ id: "22222222-2222-4222-8222-222222222222" });
    const req501 = new Request(`http://localhost/api/checks/${checkId2}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verdict: "right",
        comment: "B".repeat(501),
      }),
    });
    const res501 = await feedbackPost(req501, { params: Promise.resolve({ id: checkId2 }) });
    assert.equal(res501.status, 400);
  });

  it("submits the exact UI payload from app/check/[id]/page.js and expects 200", async () => {
    const checkId = seedCheck();
    // UI mapping: helpful=true -> verdict: "right", comment: "Helpful assessment".slice(0, 500)
    const helpfulVerdict = true ? "right" : "wrong";
    const helpfulComment = ("Helpful assessment").slice(0, 500);

    const req = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verdict: helpfulVerdict,
        comment: helpfulComment,
      }),
    });

    const res = await feedbackPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(typeof json.id === "number");

    // Also test helpful=false mapped to verdict: "wrong" on a separate ready check
    const checkId2 = seedCheck({ id: "22222222-2222-4222-8222-222222222222" });
    const unhelpfulVerdict = false ? "right" : "wrong";
    const unhelpfulComment = ("Not helpful").slice(0, 500);

    const req2 = new Request(`http://localhost/api/checks/${checkId2}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        verdict: unhelpfulVerdict,
        comment: unhelpfulComment,
      }),
    });

    const res2 = await feedbackPost(req2, { params: Promise.resolve({ id: checkId2 }) });
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.equal(json2.ok, true);
  });

  it("returns 409 STATE_CONFLICT when check status is not report_ready", async () => {
    const nonReadyStatuses = ["created", "extracting", "awaiting_confirmation", "investigating", "scoring", "failed"];
    for (let i = 0; i < nonReadyStatuses.length; i++) {
      const st = nonReadyStatuses[i];
      const chkId = `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
      seedCheck({ id: chkId, status: st });

      const req = new Request(`http://localhost/api/checks/${chkId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict: "right" }),
      });
      const res = await feedbackPost(req, { params: Promise.resolve({ id: chkId }) });
      assert.equal(res.status, 409, `Expected 409 for status '${st}', got ${res.status}`);
      const json = await res.json();
      assert.equal(json.code, "STATE_CONFLICT");
    }
  });

  it("returns 404 NOT_FOUND for non-existent check and 410 for expired check", async () => {
    // 404
    const nonExistent = "00000000-0000-4000-8000-000000000000";
    const req404 = new Request(`http://localhost/api/checks/${nonExistent}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "right" }),
    });
    const res404 = await feedbackPost(req404, { params: Promise.resolve({ id: nonExistent }) });
    assert.equal(res404.status, 404);

    // 410
    const expiredId = seedCheck({
      id: "44444444-4444-4444-8444-444444444444",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const req410 = new Request(`http://localhost/api/checks/${expiredId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "right" }),
    });
    const res410 = await feedbackPost(req410, { params: Promise.resolve({ id: expiredId }) });
    assert.equal(res410.status, 410);
  });

  it("returns 409 on duplicate feedback submission", async () => {
    const checkId = seedCheck();
    const req1 = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "right" }),
    });
    const res1 = await feedbackPost(req1, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res1.status, 200);

    const req2 = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "wrong", comment: "Duplicate attempt" }),
    });
    const res2 = await feedbackPost(req2, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res2.status, 409);
    const json2 = await res2.json();
    assert.equal(json2.code, "STATE_CONFLICT");
    assert.match(json2.message, /already been submitted/);
  });

  it("stores exactly one feedback row when two simultaneous requests are received", async () => {
    const checkId = seedCheck();

    const makeReq = (v) => new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: v, comment: `Call from ${v}` }),
    });

    const [resA, resB] = await Promise.all([
      feedbackPost(makeReq("right"), { params: Promise.resolve({ id: checkId }) }),
      feedbackPost(makeReq("wrong"), { params: Promise.resolve({ id: checkId }) }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [200, 409], "One request must succeed (200) and one must be rejected (409)");

    // Count rows in database
    const count = db.prepare(`SELECT count(*) as c FROM feedback WHERE check_id = ?`).get(checkId).c;
    assert.equal(count, 1, "Exactly one row must exist in feedback table");
  });

  it("feedback row survives check deletion with check_id null and holds no check content", async () => {
    const checkId = seedCheck();
    const req = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "right", comment: "Great tool" }),
    });
    const res = await feedbackPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);

    // Delete check from database (simulating 24h expiry cleanup)
    db.prepare(`DELETE FROM checks WHERE id = ?`).run(checkId);

    // Assert feedback row survived with check_id set to NULL
    const feedbackRows = db.prepare(`SELECT * FROM feedback`).all();
    assert.equal(feedbackRows.length, 1);
    const fb = feedbackRows[0];
    assert.equal(fb.check_id, null, "Foreign key ON DELETE SET NULL must clear check_id");
    assert.equal(fb.verdict, "right");
    assert.equal(fb.risk_level_shown, "high");
    assert.equal(fb.comment, "Great tool");
    assert.ok(fb.created_at);

    // Assert every column does not contain check content or prompt text
    const cols = Object.keys(fb);
    assert.deepEqual(cols.sort(), ["check_id", "comment", "created_at", "id", "risk_level_shown", "verdict"].sort());
  });

  it("feedback never modifies check level, score, report or graph tables", async () => {
    const checkId = seedCheck({ riskLevel: "high", score: 95 });

    // Seed a report row
    db.prepare(`INSERT INTO reports (check_id, report_json, created_at) VALUES (?, ?, ?)`).run(
      checkId,
      JSON.stringify({ checkId, score: 95, riskLevel: "high" }),
      new Date().toISOString()
    );

    const checkBefore = db.prepare(`SELECT risk_level, score, confidence FROM checks WHERE id = ?`).get(checkId);
    const reportBefore = db.prepare(`SELECT report_json FROM reports WHERE check_id = ?`).get(checkId);
    const graphNodesCountBefore = db.prepare(`SELECT count(*) as c FROM graph_nodes`).get().c;
    const graphEdgesCountBefore = db.prepare(`SELECT count(*) as c FROM graph_edges`).get().c;

    const req = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "wrong", comment: "I disagree with score" }),
    });
    const res = await feedbackPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);

    const checkAfter = db.prepare(`SELECT risk_level, score, confidence FROM checks WHERE id = ?`).get(checkId);
    const reportAfter = db.prepare(`SELECT report_json FROM reports WHERE check_id = ?`).get(checkId);
    const graphNodesCountAfter = db.prepare(`SELECT count(*) as c FROM graph_nodes`).get().c;
    const graphEdgesCountAfter = db.prepare(`SELECT count(*) as c FROM graph_edges`).get().c;

    assert.deepEqual(checkAfter, checkBefore);
    assert.equal(checkAfter.confidence, "high");
    assert.deepEqual(reportAfter, reportBefore);
    assert.equal(graphNodesCountAfter, graphNodesCountBefore);
    assert.equal(graphEdgesCountAfter, graphEdgesCountBefore);
  });

  it("returns security headers on feedback response", async () => {
    const checkId = seedCheck();
    const req = new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "right" }),
    });
    const res = await feedbackPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);

    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.ok(res.headers.get("content-security-policy"));
  });

  it("enforces action rate limiter on feedback endpoint", async () => {
    // Configure tight rate limiter (max 2)
    const baseRuntime = getRuntime({ db });
    setRuntimeForTests({
      ...baseRuntime,
      db,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        actionCheck: createRateLimiter({ windowMs: 60000, max: 2 }),
      },
    });

    const check1 = seedCheck({ id: "55555555-5555-4555-8555-111111111111" });
    const check2 = seedCheck({ id: "55555555-5555-4555-8555-222222222222" });
    const check3 = seedCheck({ id: "55555555-5555-4555-8555-333333333333" });

    const makeReq = (id) => new Request(`http://localhost/api/checks/${id}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: "right" }),
    });

    const res1 = await feedbackPost(makeReq(check1), { params: Promise.resolve({ id: check1 }) });
    const res2 = await feedbackPost(makeReq(check2), { params: Promise.resolve({ id: check2 }) });
    const res3 = await feedbackPost(makeReq(check3), { params: Promise.resolve({ id: check3 }) });

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(res3.status, 429);
    const json3 = await res3.json();
    assert.equal(json3.code, "RATE_LIMITED");
    assert.ok(res3.headers.get("retry-after"));
  });

  it("the sixteenth action request inside window returns 429 and does not share state with stream or read limiters", async () => {
    // Setup runtime with RATE_LIMIT_ACTION_MAX=15
    const baseRuntime = getRuntime({ db });
    setRuntimeForTests({
      ...baseRuntime,
      db,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        actionCheck: createRateLimiter({ windowMs: 60000, max: 15 }),
        getCheck: createRateLimiter({ windowMs: 60000, max: 60 }),
        streamCheck: createRateLimiter({ windowMs: 60000, max: 10 }),
      },
    });

    const checkId = seedCheck();
    const makeReq = () => new Request(`http://localhost/api/checks/${checkId}/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.42",
      },
      body: JSON.stringify({ verdict: "right" }),
    });

    // Send 15 requests (first will succeed, subsequent 14 will return 409 because feedback already submitted for checkId, but all consume 1 action quota)
    for (let i = 1; i <= 15; i++) {
      const res = await feedbackPost(makeReq(), { params: Promise.resolve({ id: checkId }) });
      assert.ok(res.status === 200 || res.status === 409, `Request ${i} should be allowed by rate limiter`);
    }

    // The 16th request must be rate limited with 429
    const res16 = await feedbackPost(makeReq(), { params: Promise.resolve({ id: checkId }) });
    assert.equal(res16.status, 429, "The sixteenth action request must return 429");
    const json16 = await res16.json();
    assert.equal(json16.code, "RATE_LIMITED");

    // Verify stream and read limiters for the same client have not been exhausted
    const currentRt = getRuntime();
    const readCheck = currentRt.rateLimiters.getCheck.check("203.0.113.42");
    const streamCheck = currentRt.rateLimiters.streamCheck.check("203.0.113.42");
    assert.equal(readCheck.allowed, true, "getCheck limiter bucket must not share state with action limiter");
    assert.equal(readCheck.remaining, 59, "getCheck limiter bucket remaining should be 59 (consumed 1)");
    assert.equal(streamCheck.allowed, true, "streamCheck limiter bucket must not share state with action limiter");
    assert.equal(streamCheck.remaining, 9, "streamCheck limiter bucket remaining should be 9 (consumed 1)");
  });
});
