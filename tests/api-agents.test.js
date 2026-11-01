import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createCheck, saveRoundResults, updateStatus, appendEvent } from "../lib/db/index.js";
import { AGENT_ORDER, AGENT_DISPLAY_NAMES } from "../lib/config/agents.js";
import { GET as getAgentsHandler } from "../app/api/checks/[id]/agents/route.js";

const TEST_DB_PATH = "./data/test_api_agents.db";

function setupTestEnvironment() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new Database(TEST_DB_PATH);
  runMigrations(db);

  const rateLimiters = {
    getCheck: createRateLimiter({ windowMs: 60000, maxRequests: 100 }),
  };

  const runtime = {
    db,
    rateLimiters,
  };

  return { db, runtime };
}

function cleanupTestEnvironment(db) {
  try {
    if (db && db.open) db.close();
  } catch {}
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
}

test("GET /api/checks/:id/agents - error cases: 404 and 410", async () => {
  const { db, runtime } = setupTestEnvironment();
  try {
    // 404 for unknown check
    const req404 = new Request("http://localhost/api/checks/00000000-0000-4000-8000-000000000000/agents");
    const res404 = await getAgentsHandler(req404, {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
      runtime,
    });
    assert.equal(res404.status, 404);
    const body404 = await res404.json();
    assert.equal(body404.code, "NOT_FOUND");

    // 410 for expired check
    const expiredId = "11111111-1111-4111-8111-111111111111";
    createCheck({ id: expiredId, status: "report_ready" }, db);
    db.prepare("UPDATE checks SET expires_at = ? WHERE id = ?").run(
      "2020-01-01T00:00:00.000Z",
      expiredId
    );

    const req410 = new Request(`http://localhost/api/checks/${expiredId}/agents`);
    const res410 = await getAgentsHandler(req410, {
      params: Promise.resolve({ id: expiredId }),
      runtime,
    });
    assert.equal(res410.status, 410);
    const body410 = await res410.json();
    assert.equal(body410.code, "CHECK_EXPIRED");
  } finally {
    cleanupTestEnvironment(db);
  }
});

test("GET /api/checks/:id/agents - returns six agent cards in fixed order for awaiting_confirmation check", async () => {
  const { db, runtime } = setupTestEnvironment();
  try {
    const checkId = "22222222-2222-4222-8222-222222222222";
    createCheck({ id: checkId, status: "awaiting_confirmation" }, db);

    const req = new Request(`http://localhost/api/checks/${checkId}/agents`);
    const res = await getAgentsHandler(req, {
      params: Promise.resolve({ id: checkId }),
      runtime,
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get("Cache-Control"), /no-store/);
    assert.ok(res.headers.get("X-Content-Type-Options"));

    const data = await res.json();
    assert.ok(Array.isArray(data.agents));
    assert.equal(data.agents.length, 6);

    for (let i = 0; i < AGENT_ORDER.length; i++) {
      const card = data.agents[i];
      assert.equal(card.agent, AGENT_ORDER[i]);
      assert.equal(card.name, AGENT_DISPLAY_NAMES[AGENT_ORDER[i]]);
      assert.equal(card.status, "waiting");
      assert.equal(card.rawStatus, "waiting");
      assert.equal(card.durationMs, 0);
      assert.ok(typeof card.summary === "string");
      assert.deepEqual(card.flags, []);
      assert.deepEqual(card.activity, []);
    }
  } finally {
    cleanupTestEnvironment(db);
  }
});

test("GET /api/checks/:id/agents - maps completed results, skipped, and found_issues statuses correctly", async () => {
  const { db, runtime } = setupTestEnvironment();
  try {
    const checkId = "33333333-3333-4333-8333-333333333333";
    createCheck({ id: checkId, status: "report_ready" }, db);

    // Save results:
    // 1. message_analyst: ok with flags -> "found_issues"
    saveRoundResults(checkId, {
      result: {
        checkId,
        agent: "message_analyst",
        kind: "agent",
        round: 1,
        status: "ok",
        summary: "Found 1 high-severity scam offer flag.",
        activity: [
          {
            seq: 0,
            atMs: 120,
            type: "finding",
            status: "warn",
            title: "Urgent selection deadline",
            detail: "Offer pressures immediate payment",
            sources: [],
          },
        ],
        flags: [
          {
            id: "urgency_pressure",
            title: "Urgent action required",
            severity: "low",
            explanation: "Candidate pressured to respond immediately",
            evidence: [{ type: "quote", value: "Pay now" }],
          },
        ],
        verified: [],
        newEntities: [],
        processedEntities: [],
        unchecked: [],
        manualChecks: [],
        trace: [],
        durationMs: 450,
      },
      events: [],
    }, db);

    // 2. website_forensics: ok without flags -> "done"
    saveRoundResults(checkId, {
      result: {
        checkId,
        agent: "website_forensics",
        kind: "agent",
        round: 1,
        status: "ok",
        summary: "Domain registered 2005-01-06, about 21 years old.",
        activity: [
          {
            seq: 0,
            atMs: 200,
            type: "verified",
            status: "ok",
            title: "Established domain age",
            detail: "Registered 2005-01-06, about 21 years old",
            sources: [],
          },
        ],
        flags: [],
        verified: ["Domain age: 21 years"],
        newEntities: [],
        processedEntities: ["domain:google.com"],
        unchecked: [],
        manualChecks: [],
        trace: [],
        durationMs: 310,
      },
      events: [],
    }, db);

    // 3. payment_entity: skipped -> "not_applicable"
    saveRoundResults(checkId, {
      result: {
        checkId,
        agent: "payment_entity",
        kind: "agent",
        round: 1,
        status: "skipped",
        reason: "no_payment_info",
        summary: "Check skipped: No payment details, UPI ID, or phone number found.",
        activity: [
          {
            seq: 0,
            atMs: 0,
            type: "limit",
            status: "skipped",
            title: "Check skipped",
            detail: "No payment details, UPI ID, or phone number found. Add a UPI ID or phone to run this check.",
            sources: [],
          },
        ],
        flags: [],
        verified: [],
        newEntities: [],
        processedEntities: [],
        unchecked: [],
        manualChecks: [],
        trace: [],
        durationMs: 0,
      },
      events: [],
    }, db);

    // 4. classifier_client: could_not_check -> "could_not_check"
    saveRoundResults(checkId, {
      result: {
        checkId,
        agent: "classifier_client",
        kind: "agent",
        round: 1,
        status: "could_not_check",
        reason: "service_timeout",
        summary: "Could not complete check: service_timeout",
        activity: [
          {
            seq: 0,
            atMs: 1500,
            type: "limit",
            status: "failed",
            title: "Could not complete check",
            detail: "service_timeout",
            sources: [],
          },
        ],
        flags: [],
        verified: [],
        newEntities: [],
        processedEntities: [],
        unchecked: [],
        manualChecks: [],
        trace: [],
        durationMs: 1500,
      },
      events: [],
    }, db);

    const req = new Request(`http://localhost/api/checks/${checkId}/agents`);
    const res = await getAgentsHandler(req, {
      params: Promise.resolve({ id: checkId }),
      runtime,
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.agents.length, 6);

    const msgAnalyst = data.agents.find((a) => a.agent === "message_analyst");
    assert.equal(msgAnalyst.status, "found_issues");
    assert.equal(msgAnalyst.flags.length, 1);
    assert.equal(msgAnalyst.durationMs, 450);

    const forensics = data.agents.find((a) => a.agent === "website_forensics");
    assert.equal(forensics.status, "done");
    assert.equal(forensics.flags.length, 0);
    assert.equal(forensics.verified.length, 1);

    const payment = data.agents.find((a) => a.agent === "payment_entity");
    assert.equal(payment.status, "not_applicable");
    assert.equal(payment.rawStatus, "skipped");

    const classifier = data.agents.find((a) => a.agent === "classifier_client");
    assert.equal(classifier.status, "could_not_check");
    assert.equal(classifier.rawStatus, "could_not_check");

    const official = data.agents.find((a) => a.agent === "official_verifier");
    assert.equal(official.status, "not_applicable");
  } finally {
    cleanupTestEnvironment(db);
  }
});
