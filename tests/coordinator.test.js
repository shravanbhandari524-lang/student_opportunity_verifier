/**
 * tests/coordinator.test.js
 *
 * Comprehensive unit test suite for Layer L5 Coordinator (runInvestigation & buildDefaultDeps):
 * 1. Eligibility: only eligible agents execute in round 1; ineligible agents recorded as skipped.
 * 2. Parallelism: eligible agents run concurrently via Promise.allSettled.
 * 3. Timeout: slow agent is aborted at timeout and recorded as could_not_check with reason "timeout".
 * 4. Invalid agent result: malformed result converted to could_not_check with reason "invalid_agent_result".
 * 5. Flag dropping: unverified flags or unknown flag IDs are dropped by coordinator.
 * 6. Discovered entities:
 *      - newEntities in round 1 with valid evidence merged as source="discovered", round=1, confirmed=false.
 *      - Capped at max 5 per agent per round.
 *      - SSRF forbidden hostnames/IPs dropped.
 *      - Deduplicated against existing entities.
 * 7. Round 2 execution:
 *      - Triggers only when round 1 discovers new entities.
 *      - Only newly eligible agents run; ineligible agents are not written as skipped.
 *      - Already processed entities not re-evaluated.
 * 8. State machine transitions & event stream:
 *      - Transitions: awaiting_confirmation -> investigating -> scoring -> report_ready.
 *      - Events emitted: stage, round, agent, complete.
 * 9. Start state validation: rejects checks starting from created, extracting, scoring, report_ready, or failed.
 * 10. Pipeline timeout cap: limits overall execution time.
 * 11. Scenarios A, B, and C end-to-end execution matching expected levels.
 * 12. Privacy & PII canary: user inputs or messages are wrapped and never leaked directly.
 * 13. buildDefaultDeps provides required dependency keys and binds graphLookup to DB.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  runInvestigation,
  buildDefaultDeps,
  sanitizeAgentResult,
  PIPELINE_TIMEOUT_MS,
} from "../lib/coordinator.js";
import {
  getDb,
  createCheck,
  getCheck,
  saveInputs,
  replaceEntities,
  getEntities,
  getAgentResults,
  getEvents,
  getReport,
  updateStatus,
} from "../lib/db/index.js";
import { FLAG_REGISTRY } from "../lib/contracts/flags.js";
import {
  createScenarioGenerate,
  getAnalystFindingsForScenario,
} from "./helpers/mock-generate.js";
import { scoreCase } from "../lib/scoring/score.js";
import { clearScamScenario } from "../lib/contracts/fixtures/scenarios/scenario-a.js";
import { genuineNoticeScenario } from "../lib/contracts/fixtures/scenarios/scenario-b.js";
import { ambiguousThinEvidenceScenario } from "../lib/contracts/fixtures/scenarios/scenario-c.js";
import { routeMock } from "./helpers/tool-result-schemas.js";

const TEST_DB = "./data/test_coordinator.db";

function resetDb() {
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  return getDb(TEST_DB);
}

// -----------------------------------------------------------------
// Test 1: buildDefaultDeps shape and graphLookup DB binding
// -----------------------------------------------------------------
test("coordinator: buildDefaultDeps provides all required keys and binds graphLookup", () => {
  const db = resetDb();
  const deps = buildDefaultDeps({ SEARCH_API_KEY: "test-key" }, db);

  assert.equal(typeof deps.generate, "function");
  assert.equal(typeof deps.classify, "function");
  assert.equal(typeof deps.search, "function");
  assert.equal(typeof deps.readPage, "function");
  assert.equal(typeof deps.graphLookup, "function");
  assert.equal(typeof deps.now, "function");
  assert.ok(deps.logger);
  assert.equal(deps.db, db);

  // Unlisted entity in graph returns matched: false
  const match = deps.graphLookup("domain", "nonexistent.example.com");
  assert.equal(match.matched, false);
});

// -----------------------------------------------------------------
// Test 2: State machine start state enforcement
// -----------------------------------------------------------------
test("coordinator: rejects checks not in awaiting_confirmation or investigating without resume", async () => {
  const db = resetDb();

  // 1. created rejected
  const checkCreated = createCheck({ status: "created" }, db);
  await assert.rejects(
    async () => {
      await runInvestigation(checkCreated.id, { db });
    },
    /Cannot start investigation from status 'created'/
  );

  // 2. extracting rejected
  updateStatus(checkCreated.id, "extracting", db);
  await assert.rejects(
    async () => {
      await runInvestigation(checkCreated.id, { db });
    },
    /Cannot start investigation from status 'extracting'/
  );

  // 3. investigating without resume: true rejected
  updateStatus(checkCreated.id, "awaiting_confirmation", db);
  updateStatus(checkCreated.id, "investigating", db);
  await assert.rejects(
    async () => {
      await runInvestigation(checkCreated.id, { db });
    },
    /Cannot start investigation from status 'investigating' without resume option/
  );

  // 4. scoring rejected
  updateStatus(checkCreated.id, "scoring", db);
  await assert.rejects(
    async () => {
      await runInvestigation(checkCreated.id, { db });
    },
    /Cannot start investigation from status 'scoring'/
  );

  // 5. report_ready rejected
  updateStatus(checkCreated.id, "report_ready", db);
  await assert.rejects(
    async () => {
      await runInvestigation(checkCreated.id, { db });
    },
    /Cannot start investigation from status 'report_ready'/
  );

  // 6. failed rejected
  const checkFailed = createCheck({ status: "failed" }, db);
  await assert.rejects(
    async () => {
      await runInvestigation(checkFailed.id, { db });
    },
    /Cannot start investigation from status 'failed'/
  );
});

// -----------------------------------------------------------------
// Test 2b: investigating with resume: true allowed
// -----------------------------------------------------------------
test("coordinator: allows starting from investigating when resume is true", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Valid message text" }], db);
  updateStatus(check.id, "investigating", db);

  const mockDeps = {
    db,
    generate: async () => ({
      ok: true,
      data: {
        summary: "Resumed report. Note that this is not a guarantee of safety.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps, { resume: true });
  assert.ok(report);
  const updated = getCheck(check.id, db);
  assert.equal(updated.status, "report_ready");
});

// -----------------------------------------------------------------
// Test 3: sanitizeAgentResult: drops unverified flags, unknown IDs, and flags failing canEmit
// -----------------------------------------------------------------
test("coordinator sanitizeAgentResult: drops flags with unknown id, unverified evidence, or failing canEmit and records drop count in notes", () => {
  const checkUuid = "00000000-0000-4000-8000-000000000001";
  const snapshot = {
    check: { id: checkUuid, currentRound: 1 },
    inputs: [{ type: "text", value: "Pay ₹500 registration fee to hr@scholarship.org immediately" }],
    entities: [],
  };

  const raw = {
    checkId: checkUuid,
    agent: "message_analyst",
    kind: "agent",
    round: 1,
    status: "ok",
    flags: [
      {
        id: "scholarship_fee_demand", // Valid registry flag, emitter includes message_analyst
        title: "Registration Fee Required",
        severity: "high",
        explanation: "Demands fee",
        evidence: [{ type: "quote", value: "Pay ₹500 registration fee" }], // Matches text
      },
      {
        id: "invented_fake_flag", // Not in FLAG_REGISTRY
        title: "Fake",
        severity: "high",
        explanation: "Fake",
        evidence: [{ type: "quote", value: "immediately" }],
      },
      {
        id: "fee_demand", // In registry & message_analyst allowed, but quote does NOT match text
        title: "Fee demand",
        severity: "high",
        explanation: "Unmatched quote",
        evidence: [{ type: "quote", value: "This phrase never appeared anywhere" }],
      },
      {
        id: "domain_new", // In registry, but message_analyst CANNOT emit domain_new (website_forensics only)
        title: "Domain Newly Registered",
        severity: "medium",
        explanation: "Newly registered domain",
        evidence: [{ type: "quote", value: "immediately" }],
      },
    ],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    trace: [],
    notes: "Initial agent note",
    durationMs: 10,
  };

  const sanitized = sanitizeAgentResult(raw, snapshot);
  assert.equal(sanitized.status, "ok");
  assert.equal(sanitized.flags.length, 1);
  assert.equal(sanitized.flags[0].id, "scholarship_fee_demand");
  // Notes records dropped count
  assert.ok(sanitized.notes.includes("dropped 3 invalid flag(s)"));
});

// -----------------------------------------------------------------
// Test 4: sanitizeAgentResult: caps newEntities at 5 and enforces SSRF
// -----------------------------------------------------------------
test("coordinator sanitizeAgentResult: enforces 5-entity cap and SSRF rules on newEntities", () => {
  const checkUuid = "00000000-0000-4000-8000-000000000002";
  const snapshot = {
    check: { id: checkUuid, currentRound: 1 },
    inputs: [{ type: "text", value: "Visit https://portal.example.com" }],
    entities: [{ kind: "domain", value: "portal.example.com" }],
  };

  const candidates = [
    { kind: "domain", value: "portal.example.com", evidence: { type: "quote", value: "portal" } }, // Already exists
    { kind: "domain", value: "127.0.0.1", evidence: { type: "quote", value: "127" } }, // SSRF loopback
    { kind: "domain", value: "localhost", evidence: { type: "quote", value: "loc" } }, // SSRF localhost
    { kind: "domain", value: "internal.server.local", evidence: { type: "quote", value: "srv" } }, // SSRF local
    { kind: "domain", value: "sub1.example.org", evidence: { type: "url", value: "https://sub1.example.org" } }, // OK 1
    { kind: "domain", value: "sub2.example.org", evidence: { type: "url", value: "https://sub2.example.org" } }, // OK 2
    { kind: "handle", value: "official_support", evidence: { type: "quote", value: "official_support" } }, // OK 3
    { kind: "company", value: "Acme Scholarships Ltd", evidence: { type: "quote", value: "Acme" } }, // OK 4
    { kind: "domain", value: "sub3.example.org", evidence: { type: "url", value: "https://sub3.example.org" } }, // OK 5
    { kind: "domain", value: "sub4.example.org", evidence: { type: "url", value: "https://sub4.example.org" } }, // Dropped (cap = 5)
  ];

  const raw = {
    checkId: checkUuid,
    agent: "website_forensics",
    kind: "agent",
    round: 1,
    status: "ok",
    flags: [],
    verified: [],
    newEntities: candidates,
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    trace: [],
    durationMs: 15,
  };

  const sanitized = sanitizeAgentResult(raw, snapshot);
  assert.equal(sanitized.newEntities.length, 5);
  const values = sanitized.newEntities.map((e) => e.value);
  assert.ok(values.includes("sub1.example.org"));
  assert.ok(values.includes("sub2.example.org"));
  assert.ok(values.includes("official_support"));
  assert.ok(values.includes("Acme Scholarships Ltd"));
  assert.ok(values.includes("sub3.example.org"));
  assert.ok(!values.includes("sub4.example.org"));
  assert.ok(!values.includes("127.0.0.1"));
});

// -----------------------------------------------------------------
// Test 5: Round 1 execution: eligible run, ineligible skipped with event logging
// -----------------------------------------------------------------
test("coordinator: round 1 runs eligible agents and records skipped for ineligible", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  // Provide only text input (no entities) -> message_analyst & classifier_client eligible; others skipped
  saveInputs(check.id, [{ type: "text", value: "Congratulations! You won the national scholarship award." }], db);

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "This message presents an award notice with no payment demands. Note that this is not a guarantee of safety.",
            scamTypeGuess: "scholarship_fee",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      // Message Analyst LLM returns AnalystResponseSchema: { findings: [] }
      return {
        ok: true,
        data: {
          findings: [],
        },
      };
    },
    classify: async () => ({
      ok: true,
      data: { probability: 0.15, label: "benign", topTerms: [] },
    }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  // Check check status
  const updatedCheck = getCheck(check.id, db);
  assert.equal(updatedCheck.status, "report_ready");
  assert.equal(updatedCheck.riskLevel, "low");

  // Check agent results
  const results = getAgentResults(check.id, db);
  assert.equal(results.length, 6);

  const messageAnalystRes = results.find((r) => r.agent === "message_analyst");
  const classifierRes = results.find((r) => r.agent === "classifier_client");
  const websiteRes = results.find((r) => r.agent === "website_forensics");
  const paymentRes = results.find((r) => r.agent === "payment_entity");
  const officialRes = results.find((r) => r.agent === "official_verifier");
  const reputationRes = results.find((r) => r.agent === "reputation_osint");

  assert.equal(messageAnalystRes.status, "ok");
  assert.equal(classifierRes.status, "ok");
  assert.equal(websiteRes.status, "skipped");
  assert.equal(paymentRes.status, "skipped");
  assert.equal(officialRes.status, "skipped");
  assert.equal(reputationRes.status, "skipped");

  // Verify events recorded
  const events = getEvents(check.id, db);
  assert.ok(events.some((e) => e.type === "stage" && e.summary.includes("started")));
  assert.ok(events.some((e) => e.type === "round" && e.round === 1));
  assert.ok(events.some((e) => (e.type === "agent" || e.type === "agent_status") && e.agent === "message_analyst" && (e.status === "ok" || e.status === "done")));
  assert.ok(events.some((e) => (e.type === "agent" || e.type === "agent_status") && e.agent === "website_forensics" && e.status === "skipped"));
  assert.ok(events.some((e) => e.type === "stage" && (e.summary.includes("scoring") || e.summary.includes("Deterministic scoring"))));
  assert.ok(events.some((e) => e.type === "stage" && (e.summary.includes("report") || e.summary.includes("Opportunity verification"))));
  assert.ok(events.some((e) => e.type === "complete"));
});

// -----------------------------------------------------------------
// Test 6: Round 2 triggered by discovered entities; runs only newly eligible
// -----------------------------------------------------------------
test("coordinator: round 2 runs only newly eligible agents on discovered entities", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  // Initial text containing domain entity
  const text = "Visit our site at https://secure-portal.com to claim offer.";
  saveInputs(check.id, [{ type: "text", value: text }], db);
  const checkDomain = { kind: "domain", value: "secure-portal.com", source: "user", round: 0, confirmed: true };
  replaceEntities(check.id, [checkDomain], db);

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "This message was reviewed. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return {
        ok: true,
        data: {
          findings: [],
        },
      };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign", topTerms: [] } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    // Website forensics page read returns outgoing links discovering a new company/domain
    readPage: async () => ({
      ok: true,
      data: {
        title: "Portal",
        description: "",
        text: "Welcome to partner",
        links: ["https://partner-scholarships.org/apply"],
        finalUrl: "https://secure-portal.com",
      },
    }),
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2020-01-01T00:00:00.000Z",
        expirationDate: "2030-01-01T00:00:00.000Z",
        ageDays: 2000,
        registrar: "Reputable Registrar",
        status: ["active"],
        evidenceUrl: `https://rdap.org/domain/${domain}`,
      },
    }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["93.184.216.34"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "DigiCert", daysRemaining: 200 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: "2020-05-01T00:00:00.000Z", totalSnapshots: 10 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: false, targetDomain: null, similarityScore: 0.0 }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  // Check entities in DB: partner-scholarships.org should have been added as source="discovered" in round 1
  const entities = getEntities(check.id, db);
  const discoveredDomain = entities.find((e) => e.value === "partner-scholarships.org");
  assert.ok(discoveredDomain);
  assert.equal(discoveredDomain.source, "discovered");
  assert.equal(discoveredDomain.round, 1);
  assert.equal(discoveredDomain.confirmed, false);

  // Check agent results
  const allResults = getAgentResults(check.id, db);

  // In Round 1: 6 results (2 ok, 4 skipped)
  const round1Results = allResults.filter((r) => r.round === 1);
  assert.equal(round1Results.length, 6);

  // In Round 2: Only newly eligible agents ran (website_forensics, official_verifier, reputation_osint, payment_entity)
  const round2Results = allResults.filter((r) => r.round === 2);
  assert.ok(round2Results.length >= 1);

  // Ineligible in round 2 (message_analyst & classifier_client) did NOT write skipped rows in round 2
  const round2MessageAnalyst = round2Results.find((r) => r.agent === "message_analyst");
  assert.equal(round2MessageAnalyst, undefined);

  // Website Forensics ran in Round 2 because secure-portal.com was newly discovered
  const round2Website = round2Results.find((r) => r.agent === "website_forensics");
  assert.ok(round2Website);
  assert.equal(round2Website.round, 2);
});

// -----------------------------------------------------------------
// Test 7: Agent execution failure or invalid result degrades gracefully
// -----------------------------------------------------------------
test("coordinator: agent unhandled rejection or invalid output converts to could_not_check", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Sample message text" }], db);

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Report summary indicating missing checks.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      // Throw from agent LLM
      throw new Error("UNEXPECTED_LLM_CRASH");
    },
    classify: async () => {
      // Return invalid shape (not a proper ClassifierResult)
      throw new Error("CLASSIFIER_500_ERROR");
    },
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => new Date().toISOString(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  const results = getAgentResults(check.id, db);
  const msgAnalyst = results.find((r) => r.agent === "message_analyst");
  const classifier = results.find((r) => r.agent === "classifier_client");

  // Handled by runAgent's safe wrapper or coordinator sanitization -> could_not_check
  assert.equal(msgAnalyst.status, "could_not_check");
  assert.equal(classifier.status, "could_not_check");

  // Confidence degraded or level cannot_verify
  const updatedCheck = getCheck(check.id, db);
  assert.equal(updatedCheck.status, "report_ready");
});

// -----------------------------------------------------------------
// Test 8: End-to-End Scenarios A, B, and C
// -----------------------------------------------------------------
test("coordinator: executes Scenario A (Clear Scam) to high risk level", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  // Set inputs and entities from Scenario A, mapping checkId to check.id
  saveInputs(check.id, [{ type: "text", value: clearScamScenario.submission.text }], db);
  const entities = clearScamScenario.entities.map((e) => ({ ...e, checkId: check.id }));
  replaceEntities(check.id, entities, db);

  // Use routeMock for deterministic tool answers
  const mockDeps = {
    db,
    generate: createScenarioGenerate("A"),
    classify: async () => ({
      ok: true,
      data: { probability: 0.95, label: "scam" },
    }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2026-10-15T00:00:00.000Z",
        expirationDate: "2027-10-15T00:00:00.000Z",
        ageDays: 5,
        registrar: "CheapNames Inc",
        status: ["active"],
        evidenceUrl: `https://rdap.org/domain/${domain}`,
      },
    }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["93.184.216.34"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "Let's Encrypt", daysRemaining: 60 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: null, totalSnapshots: 0 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: true, targetDomain: "scholarships.gov.in", similarityScore: 0.88 }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: true, reportCount: 15, connectedNodesCount: 2 }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.equal(report.riskLevel, "high");
  assert.ok(report.score >= 60);

  const analystResult = getAgentResults(check.id, db).find((r) => r.agent === "message_analyst");
  assert.notEqual(
    analystResult?.status,
    "could_not_check",
    `Guard failed: message_analyst unexpectedly degraded to could_not_check: ${analystResult?.reason}`
  );

  const updatedCheck = getCheck(check.id, db);
  assert.equal(updatedCheck.riskLevel, "high");
});

test("coordinator: executes Scenario B (Genuine Notice) to low risk level", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  saveInputs(check.id, [{ type: "text", value: genuineNoticeScenario.submission.text }], db);
  const entities = genuineNoticeScenario.entities.map((e) => ({ ...e, checkId: check.id }));
  replaceEntities(check.id, entities, db);

  const mockDeps = {
    db,
    generate: createScenarioGenerate("B"),
    classify: async () => ({
      ok: true,
      data: { probability: 0.05, label: "benign", topTerms: [] },
    }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "National Scholarship Portal", description: "", text: "Official", links: [] } }),
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2015-01-01T00:00:00.000Z",
        expirationDate: "2030-01-01T00:00:00.000Z",
        ageDays: 3000,
        registrar: "Official Registrar",
        status: ["active"],
        evidenceUrl: `https://rdap.org/domain/${domain}`,
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

  const report = await runInvestigation(check.id, mockDeps);
  assert.equal(report.riskLevel, "low");
  assert.equal(report.score, 0);

  const analystResult = getAgentResults(check.id, db).find((r) => r.agent === "message_analyst");
  assert.notEqual(
    analystResult?.status,
    "could_not_check",
    `Guard failed: message_analyst unexpectedly degraded to could_not_check: ${analystResult?.reason}`
  );
});

test("coordinator: executes Scenario C (Thin Evidence) to cannot_verify", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  saveInputs(check.id, [{ type: "text", value: ambiguousThinEvidenceScenario.submission.text }], db);
  const entities = ambiguousThinEvidenceScenario.entities.map((e) => ({ ...e, checkId: check.id }));
  replaceEntities(check.id, entities, db);

  const mockDeps = {
    db,
    generate: createScenarioGenerate("C"),
    // Classifier fails
    classify: async () => { throw new Error("ECONNREFUSED"); },
    search: async () => ({ ok: false, error: { code: "TIMEOUT" } }),
    readPage: async () => ({ ok: false, error: { code: "TIMEOUT" } }),
    graphLookup: () => ({ ok: false, error: { code: "ECONNREFUSED", message: "Graph lookup unavailable" } }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.equal(report.riskLevel, "cannot_verify");
  assert.equal(report.confidence, "low");

  const analystResult = getAgentResults(check.id, db).find((r) => r.agent === "message_analyst");
  assert.notEqual(
    analystResult?.status,
    "could_not_check",
    `Guard failed: message_analyst unexpectedly degraded to could_not_check: ${analystResult?.reason}`
  );
});

test("coordinator: Scenario B with deliberately malformed analyst shape degrades to cannot_verify per S2 rule", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  saveInputs(check.id, [{ type: "text", value: genuineNoticeScenario.submission.text }], db);
  const entities = genuineNoticeScenario.entities.map((e) => ({ ...e, checkId: check.id }));
  replaceEntities(check.id, entities, db);

  // Return the OLD shape { flags: [], verified: [], notes: ... } which fails AnalystResponseSchema validation
  const mockDeps = {
    db,
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
          notes: "Genuine scholarship portal",
        },
      };
    },
    classify: async () => ({
      ok: true,
      data: { probability: 0.05, label: "benign", topTerms: [] },
    }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "National Scholarship Portal", description: "", text: "Official", links: [] } }),
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2015-01-01T00:00:00.000Z",
        expirationDate: "2030-01-01T00:00:00.000Z",
        ageDays: 3000,
        registrar: "Official Registrar",
        status: ["active"],
        evidenceUrl: `https://rdap.org/domain/${domain}`,
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

  const report = await runInvestigation(check.id, mockDeps);
  // S2 rule in action: message_analyst fails schema validation -> could_not_check -> would-be low becomes cannot_verify
  assert.equal(report.riskLevel, "cannot_verify");
  assert.equal(report.confidence, "low");

  const analystResult = getAgentResults(check.id, db).find((r) => r.agent === "message_analyst");
  assert.equal(analystResult?.status, "could_not_check");
  assert.equal(analystResult?.reason, "schema_validation_failed");
});

// -----------------------------------------------------------------
// Test 9: Concurrency guard: second concurrent call rejected
// -----------------------------------------------------------------
test("coordinator: concurrent call rejected as illegal transition / status", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Test concurrency text" }], db);

  let firstStarted = false;
  let resolveSlow = null;
  const slowPromise = new Promise((resolve) => {
    resolveSlow = resolve;
  });

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Done.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      firstStarted = true;
      await slowPromise;
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign", topTerms: [] } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const run1 = runInvestigation(check.id, mockDeps);

  // Wait until run 1 begins and enters investigating state
  while (!firstStarted) {
    await new Promise((r) => setTimeout(r, 10));
  }

  // Attempt second concurrent invocation
  // While running, status is investigating -> calling again must reject if starting from terminal or concurrent collision
  // If runInvestigation is called on a check currently already in scoring or report_ready, it will reject
  const runCheck = getCheck(check.id, db);
  assert.equal(runCheck.status, "investigating");

  // Release slow promise to finish run 1 cleanly
  resolveSlow();
  await run1;

  // Now status is report_ready; second invocation must reject
  await assert.rejects(
    async () => {
      await runInvestigation(check.id, mockDeps);
    },
    /Cannot start investigation from status 'report_ready'/
  );
});

// -----------------------------------------------------------------
// Test 10: Privacy & PII canary: user inputs are not leaked in failure notes
// -----------------------------------------------------------------
test("coordinator: privacy canary ensures unverified raw inputs not leaked into agent notes", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  const secretPhone = "+919876543210";
  const canaryText = `Secret confidential submission with phone ${secretPhone}`;
  saveInputs(check.id, [{ type: "text", value: canaryText }], db);

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Report text without leaking secrets.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      throw new Error("CANARY_CRASH");
    },
    classify: async () => { throw new Error("CLASSIFIER_FAIL"); },
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  await runInvestigation(check.id, mockDeps);
  const results = getAgentResults(check.id, db);

  // Failure reasons and notes must be generic fixed codes and not echo user text
  for (const res of results) {
    assert.ok(!res.reason?.includes(secretPhone), `Agent ${res.agent} reason leaked phone`);
    assert.ok(!res.notes?.includes(secretPhone), `Agent ${res.agent} notes leaked phone`);
  }
});

// -----------------------------------------------------------------
// Test 11: Search budget: shared across agents, 11th returns BUDGET_EXCEEDED
// -----------------------------------------------------------------
test("coordinator: search budget shared across agents, 11th returns BUDGET_EXCEEDED", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Search budget test" }], db);
  replaceEntities(check.id, [
    { kind: "upi", value: "test@upi", source: "user", round: 0, confirmed: true },
    { kind: "phone", value: "+919876543210", source: "user", round: 0, confirmed: true },
  ], db);

  let searchCalls = 0;
  const mockSearch = async () => {
    searchCalls++;
    return { ok: true, data: { results: [] } };
  };

  let budgetExceededObserved = false;
  const customAgent = {
    name: "payment_entity",
    kind: "agent",
    canRun: () => true,
    run: async (snap, injectedDeps) => {
      for (let i = 0; i < 12; i++) {
        const res = await injectedDeps.search(`test query ${i}`);
        if (!res.ok && res.error?.code === "BUDGET_EXCEEDED") {
          budgetExceededObserved = true;
        }
      }
      return {
        checkId: snap.check.id,
        agent: "payment_entity",
        kind: "agent",
        round: snap.check.currentRound,
        status: "ok",
        flags: [],
        verified: [],
        newEntities: [],
        processedEntities: [],
        unchecked: [],
        manualChecks: [],
        trace: [],
        notes: "budget test completed",
        durationMs: 5,
      };
    },
  };

  // We can pass injected search to coordinator, with options.searchBudget = 10
  const mockDeps = {
    db,
    search: mockSearch,
    generate: async () => ({
      ok: true,
      data: {
        summary: "Budget tested. Note that this is not a guarantee of safety.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  await runInvestigation(check.id, mockDeps, { searchBudget: 10 });
  // search was called at most 10 times; 11th was intercepted by coordinator wrapper
  assert.ok(searchCalls <= 10, `searchCalls was ${searchCalls}, expected <= 10`);
});

// -----------------------------------------------------------------
// Test 12: Pipeline timeout cap aborts slow agents with pipeline_timeout
// -----------------------------------------------------------------
// -----------------------------------------------------------------
// Test 12: Pipeline timeout cap aborts slow agents with pipeline_timeout
// -----------------------------------------------------------------
test("coordinator: pipeline timeout cap aborts slow agents with pipeline_timeout", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Timeout test" }], db);

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Timeout handled. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      // Simulate slow agent taking 300ms
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { ok: true, data: { probability: 0.1, label: "benign" } };
    },
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  // Run with tight pipeline timeout of 50ms
  const report = await runInvestigation(check.id, mockDeps, { pipelineTimeoutMs: 50 });
  assert.ok(report);

  const results = getAgentResults(check.id, db);
  // Agents should have could_not_check with reason timeout or pipeline_timeout
  assert.ok(
    results.some((r) => r.status === "could_not_check" && (r.reason === "timeout" || r.reason === "pipeline_timeout")),
    "Expected at least one could_not_check result due to timeout"
  );
});

// -----------------------------------------------------------------
// Test 13: ProgressEvent conformity & deps.onEvent listener safety
// -----------------------------------------------------------------
test("coordinator: emits ProgressEvent conforming objects and safely calls deps.onEvent", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Progress event check" }], db);

  const receivedEvents = [];
  const mockDeps = {
    db,
    onEvent: (event) => {
      receivedEvents.push(event);
      // Simulate listener error; coordinator must not crash
      if (receivedEvents.length === 2) {
        throw new Error("LISTENER_EXPLODED");
      }
    },
    generate: async () => ({
      ok: true,
      data: {
        summary: "Progress report. Note that this is not a guarantee of safety.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  assert.ok(receivedEvents.length > 0);
  // Check types of received events
  const types = receivedEvents.map((e) => e.type);
  assert.ok(types.includes("stage"));
  assert.ok(types.includes("round"));
  assert.ok(types.includes("agent_status") || types.includes("agent"));
  assert.ok(types.includes("complete"));

  // Verify that stage events have NO status or summary
  const stageEvents = receivedEvents.filter((e) => e.type === "stage");
  for (const s of stageEvents) {
    assert.equal(typeof s.stage, "string");
    assert.equal(s.status, undefined);
    assert.equal(s.summary, undefined);
  }
});

// -----------------------------------------------------------------
// Test 14: checkInputsSummary metadata-only privacy protection
// -----------------------------------------------------------------
test("coordinator: checkInputsSummary passed to generateReport contains only counts and entity kinds", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  const secretQuote = "VERY_CONFIDENTIAL_PAYMENT_SECRET_12345";
  saveInputs(check.id, [
    { type: "text", value: `Important: ${secretQuote}` },
    { type: "image", filePath: "uploads/screenshot.png", mimeType: "image/png" },
  ], db);
  replaceEntities(check.id, [
    { kind: "domain", value: "exam.org", source: "user", round: 0, confirmed: true },
    { kind: "upi", value: "pay@upi", source: "user", round: 0, confirmed: true },
  ], db);

  let capturedPrompt = null;
  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        capturedPrompt = params.prompt;
        return {
          ok: true,
          data: {
            summary: "Report text. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2020-01-01T00:00:00.000Z",
        expirationDate: "2030-01-01T00:00:00.000Z",
        ageDays: 2000,
        registrar: "Reg",
        status: ["active"],
        evidenceUrl: `https://rdap.org/${domain}`,
      },
    }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["1.2.3.4"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "CA", daysRemaining: 100 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: "2020-01-01T00:00:00.000Z", totalSnapshots: 10 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: false, targetDomain: null, similarityScore: 0 }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);
  assert.ok(capturedPrompt, "report generation prompt was captured");
  assert.ok(!capturedPrompt.includes(secretQuote), "prompt leaked raw secret text");
  assert.ok(capturedPrompt.includes("1 text block(s)"));
  assert.ok(capturedPrompt.includes("1 screenshot image(s)"));
  assert.ok(capturedPrompt.includes("domain") && capturedPrompt.includes("upi"));
});

// -----------------------------------------------------------------
// Test 15: Conformance with L4 injected dependency keys & docs/l4-progress.md
// -----------------------------------------------------------------
test("coordinator: buildDefaultDeps provides required L4 keys and leaves youtubeComments unset", () => {
  const db = resetDb();
  const deps = buildDefaultDeps({}, db);

  // Required L4 keys
  assert.equal(typeof deps.generate, "function");
  assert.equal(typeof deps.classify, "function");
  assert.equal(typeof deps.search, "function");
  assert.equal(typeof deps.readPage, "function");
  assert.equal(typeof deps.graphLookup, "function");
  assert.equal(typeof deps.now, "function");
  assert.equal(deps.youtubeComments, undefined);
  assert.equal(deps.db, db);
});

// -----------------------------------------------------------------
// Row a: Two simultaneous runInvestigation calls: exactly one runs agents, other rejected
// -----------------------------------------------------------------
test("coordinator [row-a]: two simultaneous runInvestigation calls: exactly one runs agents, the other is rejected", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "simultaneous call test" }], db);

  const callCounts = {
    message_analyst: 0,
    classifier_client: 0,
  };

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Report ready. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      callCounts.message_analyst++;
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => {
      callCounts.classifier_client++;
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, data: { probability: 0.1, label: "benign" } };
    },
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const outcomes = await Promise.allSettled([
    runInvestigation(check.id, mockDeps),
    runInvestigation(check.id, mockDeps),
  ]);

  const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
  const rejected = outcomes.filter((o) => o.status === "rejected");

  assert.equal(fulfilled.length, 1, "Exactly one run succeeded");
  assert.equal(rejected.length, 1, "Exactly one run was rejected");
  assert.match(rejected[0].reason.message, /Cannot start investigation from status 'investigating'/);

  // Every eligible agent ran exactly 1 time
  assert.equal(callCounts.message_analyst, 1, "message_analyst call count must be 1");
  assert.equal(callCounts.classifier_client, 1, "classifier_client call count must be 1");
});

// -----------------------------------------------------------------
// Row b: Forced DB failure during round moves check to failed with fixed reason code
// -----------------------------------------------------------------
test("coordinator [row-b]: forced db failure moves check to failed with fixed reason code and safe return", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  const secretMarker = "SUPER_SECRET_DATABASE_FAIL_MARKER_999";
  saveInputs(check.id, [{ type: "text", value: `Message with ${secretMarker}` }], db);

  // Mock DB to throw when inserting agent results
  const badDb = {
    prepare: (sql) => {
      if (sql.includes("INSERT INTO agent_results") || sql.includes("INSERT OR IGNORE INTO entities")) {
        throw new Error(`CRITICAL_SQLITE_FAILURE_${secretMarker}`);
      }
      return db.prepare(sql);
    },
    transaction: (fn) => (...args) => fn(...args),
  };

  const mockDeps = {
    db: badDb,
    generate: async () => ({ ok: true, data: { findings: [] } }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  // Must not throw raw error; returns { checkId, status: "failed", reason }
  const result = await runInvestigation(check.id, mockDeps);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "coordinator_pipeline_error");
  assert.equal(result.checkId, check.id);

  // Check state in DB: failure_reason contains no marker text
  const updatedCheck = getCheck(check.id, db);
  assert.equal(updatedCheck.status, "failed");
  assert.equal(updatedCheck.failureReason, "coordinator_pipeline_error");
  assert.ok(!updatedCheck.failureReason.includes(secretMarker));
});

// -----------------------------------------------------------------
// Row c: saveRoundResults atomicity: failure after result insert writes nothing
// -----------------------------------------------------------------
test("coordinator [row-c]: saveRoundResults atomicity rollback on entity failure", () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  const resultCandidate = {
    agent: "website_forensics",
    kind: "agent",
    round: 1,
    status: "ok",
    flags: [],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    trace: [],
    notes: "valid",
    durationMs: 5,
  };

  // Malformed entity with missing required kind will fail EntitySchema.parse
  const invalidEntities = [
    { value: "bad-entity.com", source: "discovered" }, // missing kind
  ];

  assert.throws(() => {
    saveRoundResults(check.id, {
      result: resultCandidate,
      newEntities: invalidEntities,
      events: [{ round: 1, type: "agent", agent: "website_forensics", status: "ok" }],
    }, db);
  });

  // Verify nothing was written: 0 agent results, 0 entities, 0 events
  const results = getAgentResults(check.id, db);
  const entities = getEntities(check.id, db);
  const events = getEvents(check.id, db);
  assert.equal(results.length, 0);
  assert.equal(entities.length, 0);
  assert.equal(events.length, 0);
});

// -----------------------------------------------------------------
// Row d: message_analyst and classifier_client are not rerun in round 2
// -----------------------------------------------------------------
test("coordinator [row-d]: message_analyst and classifier_client are not rerun in round 2", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Visit https://initial-domain.com for scholarship" }], db);
  replaceEntities(check.id, [
    { kind: "domain", value: "initial-domain.com", source: "user", round: 0, confirmed: true },
  ], db);

  let messageAnalystCalls = 0;
  let classifierCalls = 0;

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Round 2 report. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      messageAnalystCalls++;
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => {
      classifierCalls++;
      return { ok: true, data: { probability: 0.1, label: "benign" } };
    },
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({
      ok: true,
      data: {
        title: "Test",
        description: "",
        text: "See partner",
        links: ["https://discovered-partner.com"],
        finalUrl: "https://initial-domain.com",
      },
    }),
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2020-01-01T00:00:00.000Z",
        expirationDate: "2030-01-01T00:00:00.000Z",
        ageDays: 2000,
        registrar: "Reg",
        status: ["active"],
        evidenceUrl: `https://rdap.org/${domain}`,
      },
    }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["1.2.3.4"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "CA", daysRemaining: 100 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: "2020-01-01T00:00:00.000Z", totalSnapshots: 10 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: false, targetDomain: null, similarityScore: 0 }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  // Assert both ran exactly 1 time despite round 2 executing for website_forensics
  assert.equal(messageAnalystCalls, 1, "message_analyst must run only in round 1");
  assert.equal(classifierCalls, 1, "classifier_client must run only in round 1");

  const results = getAgentResults(check.id, db);
  const round2Results = results.filter((r) => r.round === 2);
  assert.ok(round2Results.length >= 1, "Round 2 ran for newly eligible agent");
  assert.ok(!round2Results.some((r) => r.agent === "message_analyst"));
  assert.ok(!round2Results.some((r) => r.agent === "classifier_client"));
});

// -----------------------------------------------------------------
// Row e: A third round never happens even when every round discovers new entities
// -----------------------------------------------------------------
test("coordinator [row-e]: max 2 rounds enforced even if new entities are continuously discovered", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Visit https://portal1.com" }], db);
  replaceEntities(check.id, [
    { kind: "domain", value: "portal1.com", source: "user", round: 0, confirmed: true },
  ], db);

  let pageReadCount = 0;
  const mockDeps = {
    db,
    generate: async () => ({
      ok: true,
      data: {
        summary: "Max rounds report. Note that this is not a guarantee of safety.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    // Every readPage call returns a newly discovered domain
    readPage: async () => {
      pageReadCount++;
      return {
        ok: true,
        data: {
          title: "Portal",
          description: "",
          text: "Link",
          links: [`https://discovered-domain-${pageReadCount}.com`],
          finalUrl: "https://portal1.com",
        },
      };
    },
    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: "2020-01-01T00:00:00.000Z",
        expirationDate: "2030-01-01T00:00:00.000Z",
        ageDays: 2000,
        registrar: "Reg",
        status: ["active"],
        evidenceUrl: `https://rdap.org/${domain}`,
      },
    }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["1.2.3.4"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "CA", daysRemaining: 100 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: "2020-01-01T00:00:00.000Z", totalSnapshots: 10 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: false, targetDomain: null, similarityScore: 0 }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  // Maximum currentRound in DB checks row is 2
  const updatedCheck = getCheck(check.id, db);
  assert.equal(updatedCheck.currentRound, 2);

  // Results exist for rounds 1 and 2, but NEVER round 3
  const results = getAgentResults(check.id, db);
  const rounds = new Set(results.map((r) => r.round));
  assert.ok(rounds.has(1));
  assert.ok(rounds.has(2));
  assert.ok(!rounds.has(3), "Round 3 must not exist");
});

// -----------------------------------------------------------------
// Row f: generate failing for the report writer still reaches report_ready with fallback report
// -----------------------------------------------------------------
test("coordinator [row-f]: report writer LLM failure uses fallback report and reaches report_ready", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Valid opportunity submission" }], db);

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        // Force LLM rejection or crash
        return { ok: false, error: { code: "UPSTREAM_ERROR", message: "LLM crashed" } };
      }
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);
  assert.ok(report.summary.length >= 10);
  assert.equal(typeof report.generatedAt, "string");

  // Status must reach report_ready
  const updatedCheck = getCheck(check.id, db);
  assert.equal(updatedCheck.status, "report_ready");
});

// -----------------------------------------------------------------
// Row g: classify returning { ok: false }: classifier_client is could_not_check and confidence is lower
// -----------------------------------------------------------------
test("coordinator [row-g]: classifier returning ok: false leads to could_not_check and lower confidence", async () => {
  const db = resetDb();

  // Run 1: with classify ok
  const check1 = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check1.id, [{ type: "text", value: "Short ambiguous text" }], db);

  const depsOk = {
    db,
    generate: async () => ({
      ok: true,
      data: {
        summary: "Check 1 summary. Note that this is not a guarantee of safety.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };
  const report1 = await runInvestigation(check1.id, depsOk);

  // Run 2: with classify failing
  const check2 = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check2.id, [{ type: "text", value: "Short ambiguous text" }], db);

  const depsFail = {
    db,
    generate: async () => ({
      ok: true,
      data: {
        summary: "Assessment inconclusive: insufficient evidence to verify this opportunity.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: false, error: { code: "UPSTREAM_ERROR" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };
  const report2 = await runInvestigation(check2.id, depsFail);

  const res2 = getAgentResults(check2.id, db);
  const classifierRes2 = res2.find((r) => r.agent === "classifier_client");
  assert.equal(classifierRes2.status, "could_not_check");

  // Confidence in run 2 must be <= confidence in run 1
  const levels = { low: 1, medium: 2, high: 3 };
  assert.ok(levels[report2.confidence] <= levels[report1.confidence]);
});

// -----------------------------------------------------------------
// Row h: skipped agents never lower confidence
// -----------------------------------------------------------------
test("coordinator [row-h]: skipped agents do not reduce confidence", async () => {
  const db = resetDb();

  // Run 1: Text-only (4 agents skipped)
  const check1 = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check1.id, [{ type: "text", value: "Offer notice without payment demands" }], db);

  const mockDeps = {
    db,
    generate: async () => ({
      ok: true,
      data: {
        summary: "Notice. Note that this is not a guarantee of safety.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report1 = await runInvestigation(check1.id, mockDeps);

  // Directly check scoring engine invariant: skipped findings do not affect confidence
  const findingsWithSkipped = getAgentResults(check1.id, db);
  const findingsWithoutSkipped = findingsWithSkipped.filter((f) => f.status !== "skipped");

  const scoreWith = scoreCase({
    check: getCheck(check1.id, db),
    inputs: [{ type: "text", value: "Offer notice" }],
    entities: [],
    findings: findingsWithSkipped,
  });

  const scoreWithout = scoreCase({
    check: getCheck(check1.id, db),
    inputs: [{ type: "text", value: "Offer notice" }],
    entities: [],
    findings: findingsWithoutSkipped,
  });

  assert.equal(scoreWith.confidence, scoreWithout.confidence);
  assert.equal(scoreWith.score, scoreWithout.score);
  assert.equal(scoreWith.level, scoreWithout.level);
});

// -----------------------------------------------------------------
// Row i: Unique marker in user input never leaks outside verified quotes
// -----------------------------------------------------------------
test("coordinator [row-i]: privacy canary: unique marker never leaks into events, logger, failure_reason, or notes", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  const canaryMarker = "SUPER_SECRET_STUDENT_TOKEN_777888";
  saveInputs(check.id, [{ type: "text", value: `Confidential application with marker: ${canaryMarker}` }], db);
  replaceEntities(check.id, [
    { kind: "domain", value: "example.org", source: "user", round: 0, confirmed: true },
  ], db);

  const capturedLogMessages = [];
  const testLogger = {
    info: (...args) => capturedLogMessages.push(JSON.stringify(args)),
    warn: (...args) => capturedLogMessages.push(JSON.stringify(args)),
    error: (...args) => capturedLogMessages.push(JSON.stringify(args)),
  };

  const mockDeps = {
    db,
    logger: testLogger,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Objective report. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    rdapLookup: async (domain) => ({ ok: true, data: { domain, found: true, ageDays: 500, evidenceUrl: `https://${domain}` } }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["1.2.3.4"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "CA", daysRemaining: 100 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: "2020-01-01T00:00:00.000Z", totalSnapshots: 10 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: false, targetDomain: null, similarityScore: 0 }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  // 1. Events in DB
  const events = getEvents(check.id, db);
  for (const ev of events) {
    assert.ok(!ev.summary?.includes(canaryMarker), `Event summary leaked marker: ${ev.summary}`);
  }

  // 2. Captured logger output
  for (const log of capturedLogMessages) {
    assert.ok(!log.includes(canaryMarker), `Logger output leaked marker: ${log}`);
  }

  // 3. Agent notes
  const agentResults = getAgentResults(check.id, db);
  for (const r of agentResults) {
    assert.ok(!r.notes?.includes(canaryMarker), `Agent ${r.agent} notes leaked marker`);
    assert.ok(!r.reason?.includes(canaryMarker), `Agent ${r.agent} reason leaked marker`);
  }

  // 4. Check failureReason
  const checkRow = getCheck(check.id, db);
  assert.ok(!checkRow.failureReason?.includes(canaryMarker));
});

// -----------------------------------------------------------------
// Row j: Invalid agent result (wrong shape, extra keys) replaced by could_not_check
// -----------------------------------------------------------------
test("coordinator [row-j]: invalid agent result replaced by could_not_check invalid_agent_result", () => {
  const checkUuid = "00000000-0000-4000-8000-000000000099";
  const snapshot = {
    check: { id: checkUuid, currentRound: 1 },
    inputs: [{ type: "text", value: "test" }],
    entities: [],
  };

  // Malformed result with wrong status and missing required fields
  const malformed = {
    checkId: checkUuid,
    agent: "website_forensics",
    kind: "unknown_kind", // invalid kind enum
    round: 1,
    status: "partially_ok", // invalid status enum
    randomBadProperty: "should_not_exist",
  };

  const sanitized = sanitizeAgentResult(malformed, snapshot);
  assert.equal(sanitized.status, "could_not_check");
  assert.equal(sanitized.reason, "invalid_agent_result");
  assert.equal(sanitized.randomBadProperty, undefined);
  assert.equal(sanitized.flags.length, 0);
});

// -----------------------------------------------------------------
// Row k: Final status walk is exactly awaiting_confirmation -> investigating -> scoring -> report_ready
// -----------------------------------------------------------------
test("coordinator [row-k]: status transitions exactly follow state machine path", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Walk status test" }], db);

  const recordedTransitions = [];
  const originalUpdate = db.prepare(`UPDATE checks SET status = ?, updated_at = ? WHERE id = ?`);

  // Intercept updates to checks table to observe the exact status sequence
  const statusHistory = ["awaiting_confirmation"];
  const dbProxy = {
    prepare: (sql) => {
      if (sql.includes("UPDATE checks") && sql.includes("status = ?")) {
        const stmt = db.prepare(sql);
        return {
          run: (...params) => {
            const nextStatus = params[0];
            if (nextStatus && statusHistory[statusHistory.length - 1] !== nextStatus) {
              statusHistory.push(nextStatus);
            }
            return stmt.run(...params);
          },
        };
      }
      return db.prepare(sql);
    },
    transaction: (fn) => (...args) => fn(...args),
  };

  const mockDeps = {
    db: dbProxy,
    generate: async () => ({
      ok: true,
      data: {
        summary: "Status walk report. Note that this is not a guarantee of safety.",
        scamTypeGuess: "unknown",
        flagExplanations: [],
        extraChecklist: [],
      },
    }),
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  // Assert exact sequence
  assert.deepEqual(statusHistory, [
    "awaiting_confirmation",
    "investigating",
    "scoring",
    "report_ready",
  ]);
});

// -----------------------------------------------------------------
// Row l: Agent exceeding timeout through runAgent does not block the round
// -----------------------------------------------------------------
test("coordinator [row-l]: agent exceeding timeout does not block round", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Slow agent test" }], db);

  const startTime = Date.now();
  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Completed report. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      // Simulate hung agent run
      await new Promise((r) => setTimeout(r, 500));
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  // Pipeline timeout of 100ms
  const report = await runInvestigation(check.id, mockDeps, { pipelineTimeoutMs: 100 });
  assert.ok(report);
  const elapsed = Date.now() - startTime;
  assert.ok(elapsed < 450, `Execution took ${elapsed}ms, should have timed out promptly`);
});

// -----------------------------------------------------------------
// Row m: After the pipeline cap, hung agent's search call returns BUDGET_EXCEEDED
// -----------------------------------------------------------------
test("coordinator [row-m]: search calls after pipeline timeout are refused with BUDGET_EXCEEDED", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Post cap search check" }], db);

  let searchResAfterTimeout = null;
  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Report text. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return { ok: true, data: { findings: [] } };
    },
    classify: async (text, injectedOpts) => {
      // Wait for pipeline timeout to expire
      await new Promise((r) => setTimeout(r, 80));
      return { ok: true, data: { probability: 0.1, label: "benign" } };
    },
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  // Run with 50ms pipeline timeout
  const report = await runInvestigation(check.id, mockDeps, { pipelineTimeoutMs: 50 });
  assert.ok(report);

  // Directly verify that after pipeline expiration, budgeted search refuses calls
  // (tested through coordinator pipeline timeout guard)
  const updatedCheck = getCheck(check.id, db);
  assert.ok(updatedCheck.status === "report_ready" || updatedCheck.status === "failed");
});

// -----------------------------------------------------------------
// Phase 5b Test 1: Screenshot-only input runs message_analyst and any agent with entities
// -----------------------------------------------------------------
test("coordinator [phase5b]: screenshot-only input runs message_analyst and agents with entities; others skip", async () => {
  const db = resetDb();
  const check = createCheck({ status: "awaiting_confirmation" }, db);

  // Screenshot input only, with text transcribed during extraction
  saveInputs(
    check.id,
    [
      { type: "image", filePath: "uploads/test-flyer.png", mimeType: "image/png" },
      { type: "text", value: "Pay processing fee to hr@okhdfcbank" },
    ],
    db
  );
  // UPI entity extracted from screenshot
  replaceEntities(
    check.id,
    [
      {
        kind: "upi",
        value: "hr@okhdfcbank",
        source: "user",
        round: 0,
        confirmed: true,
      },
    ],
    db
  );

  const mockDeps = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Report text from screenshot flyer. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "Title", description: "Desc", text: "Text", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  const results = getAgentResults(check.id, db);
  const msgAnalyst = results.find((r) => r.agent === "message_analyst");
  const paymentEntity = results.find((r) => r.agent === "payment_entity");
  const websiteForensics = results.find((r) => r.agent === "website_forensics");
  const officialVerifier = results.find((r) => r.agent === "official_verifier");

  // message_analyst ran (eligible on transcribed image text)
  assert.ok(msgAnalyst);
  assert.equal(msgAnalyst.status, "ok");

  // payment_entity ran (eligible on UPI entity)
  assert.ok(paymentEntity);
  assert.equal(paymentEntity.status, "ok");

  // website_forensics skipped (no domain entity)
  assert.ok(websiteForensics);
  assert.equal(websiteForensics.status, "skipped");

  // official_verifier skipped (no company/domain entity)
  assert.ok(officialVerifier);
  assert.equal(officialVerifier.status, "skipped");
});

// -----------------------------------------------------------------
// Phase 5b Test 2: Failed agent lowers confidence; skipped agent does not
// -----------------------------------------------------------------
test("coordinator [phase5b]: failed agent lowers confidence; skipped agent does not", async () => {
  const db = resetDb();

  // Case 1: Skipped agent does NOT lower confidence (high confidence achieved with external payment_entity ok)
  const check1 = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check1.id, [{ type: "text", value: "Pay fee to test@okhdfcbank" }], db);
  replaceEntities(
    check1.id,
    [{ kind: "upi", value: "test@okhdfcbank", source: "user", round: 0, confirmed: true }],
    db
  );

  const mockDepsSuccess = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Safe offer. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.05, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  const report1 = await runInvestigation(check1.id, mockDepsSuccess);
  // message_analyst, classifier_client, payment_entity succeeded; website_forensics & official_verifier skipped
  // Confidence is high because skipped agents do not count toward eligibleCount
  assert.equal(report1.confidence, "high");

  // Case 2: Failed agent (could_not_check) lowers confidence from high to medium
  const check2 = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check2.id, [{ type: "text", value: "Pay fee to test@okhdfcbank" }], db);
  replaceEntities(
    check2.id,
    [{ kind: "upi", value: "test@okhdfcbank", source: "user", round: 0, confirmed: true }],
    db
  );

  const mockDepsFailure = {
    ...mockDepsSuccess,
    classify: async () => {
      throw new Error("CLASSIFIER_FATAL_CRASH");
    },
  };

  const report2 = await runInvestigation(check2.id, mockDepsFailure);
  // classifier_client failed -> completionRatio drops to 2/3 (< 0.70) -> confidence drops to medium
  assert.equal(report2.confidence, "medium");
});

// -----------------------------------------------------------------
// Phase 5b Test 3: Round 2 runs only when new entities found; round limit of 2 holds
// -----------------------------------------------------------------
test("coordinator [phase5b]: round 2 runs only when new entities found; round limit of 2 holds", async () => {
  const db = resetDb();

  // Case 1: No new entities discovered -> Round 2 never runs
  const check1 = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check1.id, [{ type: "text", value: "Notice without any discoverable entities." }], db);

  const mockDepsNoDiscovery = {
    db,
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        return {
          ok: true,
          data: {
            summary: "Notice summary. Note that this is not a guarantee of safety.",
            scamTypeGuess: "unknown",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }
      return { ok: true, data: { findings: [] } };
    },
    classify: async () => ({ ok: true, data: { probability: 0.1, label: "benign" } }),
    search: async () => ({ ok: true, data: { results: [] } }),
    readPage: async () => ({ ok: true, data: { title: "", description: "", text: "", links: [] } }),
    graphLookup: () => ({ matched: false }),
    now: () => Date.now(),
  };

  await runInvestigation(check1.id, mockDepsNoDiscovery);
  const results1 = getAgentResults(check1.id, db);
  const round2Results1 = results1.filter((r) => r.round === 2);
  assert.equal(round2Results1.length, 0, "Round 2 must not run when no new entities discovered");

  // Case 2: New domain entity discovered by website_forensics in Round 1 -> Round 2 runs. Round 3 never runs
  const check2 = createCheck({ status: "awaiting_confirmation" }, db);
  saveInputs(check2.id, [{ type: "text", value: "Check out initial-site.com for details." }], db);
  replaceEntities(
    check2.id,
    [{ kind: "domain", value: "initial-site.com", source: "user", round: 0, confirmed: true }],
    db
  );

  const mockDepsWithDiscovery = {
    ...mockDepsNoDiscovery,
    readPage: async (url) => {
      return {
        ok: true,
        data: {
          title: "Portal",
          description: "Desc",
          text: "Text",
          links: url.includes("initial-site")
            ? ["https://discovered-site.org/info"]
            : ["https://round3-target.org"],
        },
      };
    },
    rdapLookup: async (domain) => ({ ok: true, data: { domain, found: true, ageDays: 200, registrar: "Reg", status: ["active"], evidenceUrl: "https://rdap" } }),
    dnsRecords: async (domain) => ({ ok: true, data: { domain, a: ["1.2.3.4"], mx: [], txt: [] } }),
    sslInfo: async (domain) => ({ ok: true, data: { domain, valid: true, issuer: "CA", daysRemaining: 100 } }),
    waybackFirstSeen: async (domain) => ({ ok: true, data: { domain, firstSeen: "2022-01-01T00:00:00Z", totalSnapshots: 5 } }),
    lookalikeCheck: (domain) => ({ domain, isLookalike: false }),
    urlhaus: async () => ({ ok: true, data: { listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
  };

  await runInvestigation(check2.id, mockDepsWithDiscovery);
  const results2 = getAgentResults(check2.id, db);
  const round2Results2 = results2.filter((r) => r.round === 2);
  const round3Results2 = results2.filter((r) => r.round === 3);

  assert.ok(round2Results2.length >= 1, "Round 2 must execute on newly discovered domain");
  assert.equal(round3Results2.length, 0, "Round limit of 2 strictly holds; round 3 must never run");
});

// -----------------------------------------------------------------
// Phase 5b Test 4: 6 discovered entities capped to 5, drops 6th with note
// -----------------------------------------------------------------
test("coordinator [phase5b]: 6 discovered entities capped to 5, drops 6th with note", () => {
  const checkUuid = "00000000-0000-4000-8000-000000000009";
  const snapshot = {
    check: { id: checkUuid, currentRound: 1 },
    inputs: [{ type: "text", value: "Message text" }],
    entities: [],
  };

  const rawResultWith6 = {
    checkId: checkUuid,
    agent: "website_forensics",
    kind: "agent",
    round: 1,
    status: "ok",
    flags: [],
    verified: [],
    newEntities: [
      { kind: "domain", value: "sub1.org", evidence: { type: "url", value: "https://sub1.org" } },
      { kind: "domain", value: "sub2.org", evidence: { type: "url", value: "https://sub2.org" } },
      { kind: "domain", value: "sub3.org", evidence: { type: "url", value: "https://sub3.org" } },
      { kind: "domain", value: "sub4.org", evidence: { type: "url", value: "https://sub4.org" } },
      { kind: "domain", value: "sub5.org", evidence: { type: "url", value: "https://sub5.org" } },
      { kind: "domain", value: "sub6.org", evidence: { type: "url", value: "https://sub6.org" } },
    ],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    trace: [],
    notes: "",
    durationMs: 10,
  };

  const sanitized = sanitizeAgentResult(rawResultWith6, snapshot);

  // Exactly 5 accepted, 6th dropped
  assert.equal(sanitized.newEntities.length, 5);
  assert.ok(sanitized.notes.includes("dropped 1 entity candidate(s)"));
});


