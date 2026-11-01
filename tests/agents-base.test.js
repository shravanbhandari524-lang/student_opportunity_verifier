import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runAgent,
  buildOkResult,
  buildSkippedResult,
  buildCouldNotCheckResult,
  getMessageText,
  getRound,
  hasResultFor,
  quoteInText,
  limitNewEntities,
  getAnalysisText,
  verifyEvidence,
} from "../lib/agents/base.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

function makeSnapshot({
  id = "11111111-1111-4111-8111-111111111111",
  round = 1,
  text = "Test scholarship message offering 10000 stipend.",
  findings = [],
} = {}) {
  return {
    check: {
      id,
      status: "investigating",
      currentRound: round,
      language: "en",
      createdAt: "2026-10-21T00:00:00.000Z",
      expiresAt: "2026-10-22T00:00:00.000Z",
    },
    inputs: [
      {
        id: 1,
        checkId: id,
        type: "text",
        value: text,
      },
    ],
    entities: [],
    findings,
    events: [],
    control: {
      processedEntitiesByAgent: {},
    },
  };
}

describe("L4 Agents: Base Runner and Utilities", () => {
  // Test 1
  test("runAgent returns skipped with a reason when canRun is false and run is never called", async () => {
    let runCalled = false;
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => false,
      skippedReason: () => "no_message_text_available",
      run: async () => {
        runCalled = true;
        throw new Error("Should not be called");
      },
    };

    const snapshot = makeSnapshot();
    const res = await runAgent(agent, snapshot);

    assert.equal(runCalled, false);
    assert.equal(res.status, "skipped");
    assert.equal(res.reason, "no_message_text_available");
    assert.equal(res.flags.length, 0);
    assert.equal(res.verified.length, 0);
    assert.equal(res.newEntities.length, 0);
  });

  // Test 2
  test("timeout returns could_not_check (options.timeoutMs 50, never-resolving run)", async () => {
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: () => new Promise(() => {}), // never resolves
    };

    const snapshot = makeSnapshot();
    const res = await runAgent(agent, snapshot, {}, { timeoutMs: 50 });

    assert.equal(res.status, "could_not_check");
    assert.equal(res.reason, "timeout");
    assert.equal(res.flags.length, 0);
    assert.equal(res.verified.length, 0);
  });

  // Test 3
  test("thrown error returns could_not_check", async () => {
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: () => {
        throw new Error("Simulated sync crash inside agent");
      },
    };

    const snapshot = makeSnapshot();
    const res = await runAgent(agent, snapshot);

    assert.equal(res.status, "could_not_check");
    assert.equal(res.reason, "error");
    assert.equal(res.flags.length, 0);
  });

  // Test 4
  test("rejected promise returns could_not_check", async () => {
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: async () => {
        await Promise.resolve();
        throw new Error("Simulated async rejection inside agent");
      },
    };

    const snapshot = makeSnapshot();
    const res = await runAgent(agent, snapshot);

    assert.equal(res.status, "could_not_check");
    assert.equal(res.reason, "error");
    assert.equal(res.flags.length, 0);
  });

  // Test 5
  test("a result with an unregistered flag id becomes could_not_check invalid_result", async () => {
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: () => ({
        checkId: "11111111-1111-4111-8111-111111111111",
        agent: "message_analyst",
        kind: "agent",
        round: 1,
        status: "ok",
        reason: null,
        flags: [
          {
            id: "invented_fake_flag_that_does_not_exist",
            title: "Fake Flag",
            severity: "high",
            explanation: "Invalid flag id test",
            evidence: [{ type: "quote", value: "test" }],
          },
        ],
        verified: [],
        newEntities: [],
        processedEntities: [],
        unchecked: [],
        manualChecks: [],
        trace: [],
        notes: "",
        durationMs: 10,
      }),
    };

    const snapshot = makeSnapshot();
    const res = await runAgent(agent, snapshot);

    assert.equal(res.status, "could_not_check");
    assert.equal(res.reason, "invalid_result");
    assert.equal(res.flags.length, 0);
  });

  // Test 6
  test("a flag emitted by an agent for which canEmit is false becomes could_not_check invalid_result", async () => {
    // lookalike_domain is valid, but emitters: ["website_forensics"]. message_analyst is NOT authorized.
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: () => ({
        checkId: "11111111-1111-4111-8111-111111111111",
        agent: "message_analyst",
        kind: "agent",
        round: 1,
        status: "ok",
        reason: null,
        flags: [
          {
            id: "lookalike_domain",
            title: "Lookalike Domain",
            severity: "high",
            explanation: "Domain looks like legitimate portal",
            evidence: [{ type: "url", value: "https://example.com" }],
          },
        ],
        verified: [],
        newEntities: [],
        processedEntities: [],
        unchecked: [],
        manualChecks: [],
        trace: [],
        notes: "",
        durationMs: 10,
      }),
    };

    const snapshot = makeSnapshot();
    const res = await runAgent(agent, snapshot);

    assert.equal(res.status, "could_not_check");
    assert.equal(res.reason, "invalid_result");
    assert.equal(res.flags.length, 0);
  });

  // Test 7
  test("skipped and could_not_check results have all arrays empty and no classifierResult", () => {
    const skipped = buildSkippedResult({
      checkId: "11111111-1111-4111-8111-111111111111",
      agent: "message_analyst",
      reason: "no_text",
    });
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.flags.length, 0);
    assert.equal(skipped.verified.length, 0);
    assert.equal(skipped.newEntities.length, 0);
    assert.equal(skipped.processedEntities.length, 0);
    assert.equal(skipped.unchecked.length, 0);
    assert.equal(skipped.manualChecks.length, 0);
    assert.equal(skipped.classifierResult, undefined);

    const couldNotCheck = buildCouldNotCheckResult({
      checkId: "11111111-1111-4111-8111-111111111111",
      agent: "message_analyst",
      reason: "timeout",
    });
    assert.equal(couldNotCheck.status, "could_not_check");
    assert.equal(couldNotCheck.flags.length, 0);
    assert.equal(couldNotCheck.verified.length, 0);
    assert.equal(couldNotCheck.newEntities.length, 0);
    assert.equal(couldNotCheck.processedEntities.length, 0);
    assert.equal(couldNotCheck.unchecked.length, 0);
    assert.equal(couldNotCheck.manualChecks.length, 0);
    assert.equal(couldNotCheck.classifierResult, undefined);
  });

  // Test 8
  test("reasons never contain a sentinel string placed in the message text and in the thrown error message", async () => {
    const sentinel = "SECRET_SENTINEL_TOKEN_12345";
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: () => {
        throw new Error(`Crash with sensitive text: ${sentinel}`);
      },
    };

    const snapshot = makeSnapshot({ text: `Message with secret: ${sentinel}` });
    const res = await runAgent(agent, snapshot);

    assert.equal(res.status, "could_not_check");
    assert.equal(res.reason, "error");
    assert.equal(res.reason.includes(sentinel), false);
  });

  // Test 9
  test("runAgent accepts a deep-frozen snapshot and does not mutate it", async () => {
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: (snap) =>
        buildOkResult({
          checkId: snap.check.id,
          agent: "message_analyst",
          round: snap.check.currentRound,
          flags: [],
          notes: "No red flags found; this does not mean the offer is safe.",
          durationMs: 5,
        }),
    };

    const snapshot = deepFreeze(makeSnapshot());
    const originalText = snapshot.inputs[0].value;

    const res = await runAgent(agent, snapshot);
    assert.equal(res.status, "ok");
    assert.equal(snapshot.inputs[0].value, originalText);
  });

  // Test 10
  test("the timeout timer is cleared (the test file exits without hanging)", async () => {
    const agent = {
      name: "message_analyst",
      kind: "agent",
      canRun: () => true,
      run: async (snap) => {
        return buildOkResult({
          checkId: snap.check.id,
          agent: "message_analyst",
          round: snap.check.currentRound,
          flags: [],
          durationMs: 2,
        });
      },
    };

    const snapshot = makeSnapshot();
    const res = await runAgent(agent, snapshot, {}, { timeoutMs: 10000 });
    assert.equal(res.status, "ok");
  });

  // Test 11
  test("quoteInText matches case-insensitively with collapsed whitespace and rejects a non-substring", () => {
    const fullText = "Important Notice:\n\n  Please   pay  INR  500   registration   fee   to continue.";
    assert.equal(quoteInText("pay inr 500 registration fee", fullText), true);
    assert.equal(quoteInText("  PAY   INR   500  ", fullText), true);
    assert.equal(quoteInText("completely unrelated text", fullText), false);
    assert.equal(quoteInText("", fullText), false);
    assert.equal(quoteInText("pay inr 500", ""), false);
  });

  // Test 12
  test("limitNewEntities keeps 5 of 8 valid candidates in order and reports droppedCount 3", () => {
    const candidates = [
      { kind: "domain", value: "first.com", evidence: { type: "quote", value: "first" } },
      { kind: "domain", value: "second.com", evidence: { type: "quote", value: "second" } },
      { kind: "domain", value: "third.com", evidence: { type: "quote", value: "third" } },
      { kind: "domain", value: "fourth.com", evidence: { type: "quote", value: "fourth" } },
      { kind: "domain", value: "fifth.com", evidence: { type: "quote", value: "fifth" } },
      { kind: "domain", value: "sixth.com", evidence: { type: "quote", value: "sixth" } },
      { kind: "domain", value: "seventh.com", evidence: { type: "quote", value: "seventh" } },
      { kind: "domain", value: "eighth.com", evidence: { type: "quote", value: "eighth" } },
    ];

    const { accepted, droppedCount } = limitNewEntities(candidates, { agentName: "test_agent" });
    assert.equal(accepted.length, 5);
    assert.equal(droppedCount, 3);
    assert.equal(accepted[0].value, "first.com");
    assert.equal(accepted[1].value, "second.com");
    assert.equal(accepted[2].value, "third.com");
    assert.equal(accepted[3].value, "fourth.com");
    assert.equal(accepted[4].value, "fifth.com");
  });

  // Test 13
  test("limitNewEntities drops kinds url, upi, phone, email", () => {
    const candidates = [
      { kind: "url", value: "https://example.com/login", evidence: { type: "quote", value: "url" } },
      { kind: "upi", value: "test@upi", evidence: { type: "quote", value: "upi" } },
      { kind: "phone", value: "+919876543210", evidence: { type: "quote", value: "phone" } },
      { kind: "email", value: "hr@company.com", evidence: { type: "quote", value: "email" } },
    ];

    const { accepted, droppedCount } = limitNewEntities(candidates, { agentName: "test_agent" });
    assert.equal(accepted.length, 0);
    assert.equal(droppedCount, 4);
  });

  // Test 14
  test("drops entries with no evidence", () => {
    const candidates = [
      { kind: "domain", value: "valid.com" }, // no evidence object
      { kind: "domain", value: "valid2.com", evidence: null },
      { kind: "domain", value: "valid3.com", evidence: { type: "quote", value: "" } }, // empty value
      { kind: "domain", value: "valid4.com", evidence: { type: "quote", value: "   " } }, // whitespace
    ];

    const { accepted, droppedCount } = limitNewEntities(candidates, { agentName: "test_agent" });
    assert.equal(accepted.length, 0);
    assert.equal(droppedCount, 4);
  });

  // Test 15
  test("drops localhost, 127.0.0.1, 10.0.0.5, 192.168.1.1 and 169.254.169.254 domains/hosts", () => {
    const candidates = [
      { kind: "domain", value: "localhost", evidence: { type: "quote", value: "localhost" } },
      { kind: "domain", value: "127.0.0.1", evidence: { type: "quote", value: "loopback" } },
      { kind: "domain", value: "10.0.0.5", evidence: { type: "quote", value: "private10" } },
      { kind: "domain", value: "192.168.1.1", evidence: { type: "quote", value: "private192" } },
      { kind: "domain", value: "169.254.169.254", evidence: { type: "quote", value: "metadata" } },
      { kind: "domain", value: "valid-site.com", evidence: { type: "quote", value: "valid" } },
    ];

    const { accepted, droppedCount } = limitNewEntities(candidates, { agentName: "test_agent" });
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].value, "valid-site.com");
    assert.equal(droppedCount, 5);
  });

  // Test 16
  test("deduplicates after normalization (Example.com, www.example.com and example.com count once)", () => {
    const candidates = [
      { kind: "domain", value: "Example.com", evidence: { type: "quote", value: "e1" } },
      { kind: "domain", value: "www.example.com", evidence: { type: "quote", value: "e2" } },
      { kind: "domain", value: "example.com", evidence: { type: "quote", value: "e3" } },
    ];

    const { accepted, droppedCount } = limitNewEntities(candidates, { agentName: "test_agent" });
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].value, "example.com");
    assert.equal(droppedCount, 2);
  });

  // Test 17
  test("drops candidates already in existingEntityKeys", () => {
    const existing = new Set(["domain:already-seen.com", "company:Acme Corp"]);
    const candidates = [
      { kind: "domain", value: "already-seen.com", evidence: { type: "quote", value: "seen" } },
      { kind: "company", value: "Acme Corp", evidence: { type: "quote", value: "corp" } },
      { kind: "domain", value: "brand-new.com", evidence: { type: "quote", value: "new" } },
    ];

    const { accepted, droppedCount } = limitNewEntities(candidates, {
      agentName: "test_agent",
      existingEntityKeys: existing,
    });
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].value, "brand-new.com");
    assert.equal(droppedCount, 2);
  });

  // Test 18
  test("source-text purity test that lib/agents/*.js contains no lib/db, fs, node:fs, process.env, fetch or Date.now (deps.now is injected)", () => {
    const agentsDir = path.resolve(__dirname, "../lib/agents");
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".js"));
    const forbiddenPattern = /(lib\/db|node:fs|from\s+["']fs["']|process\.env|fetch|Date\.now)/;

    assert.ok(files.length > 0, "Expected at least one file in lib/agents");
    for (const file of files) {
      const content = fs.readFileSync(path.join(agentsDir, file), "utf8");
      const match = forbiddenPattern.exec(content);
      assert.equal(
        match,
        null,
        `File ${file} contains forbidden pattern: ${match ? match[0] : ""}`
      );
    }
  });

  // Test 19
  test("getAnalysisText and verifyEvidence include submitted form field values", () => {
    const snapshot = {
      inputs: [
        { type: "text", value: "Please send registration fee." },
      ],
      submission: {
        upiId: "rahul.payment@okaxis",
        phone: "+919876543210",
        company: "Google India",
      },
    };

    const text = getAnalysisText(snapshot);
    assert.ok(text.includes("rahul.payment@okaxis"), "Must include submitted upiId");
    assert.ok(text.includes("+919876543210"), "Must include submitted phone");
    assert.ok(text.includes("Google India"), "Must include submitted company");

    assert.equal(
      verifyEvidence({ type: "quote", value: "rahul.payment@okaxis" }, text),
      true,
      "Submitted UPI form field must verify as valid quote evidence"
    );
  });
});
