import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runInvestigation } from "../lib/coordinator.js";
import { getDb, createCheck, saveInputs, replaceEntities, getAgentResults } from "../lib/db/index.js";

const TEST_DB = "./data/test_coordinator_activity.db";

function resetDb() {
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  return getDb(TEST_DB);
}

function cleanupDb(db) {
  try {
    if (db && db.open) db.close();
  } catch {}
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
}

test("coordinator activity: records live activity events, saves to agent_results, and generates fallback for uninstrumented agents", async () => {
  const db = resetDb();
  try {
    const checkId = "11111111-2222-4333-8444-555555555555";
    createCheck({ id: checkId, status: "awaiting_confirmation" }, db);
    saveInputs(checkId, [{ type: "text", value: "Internship at Acme Corp. Pay 500 to fee@upi" }], db);
    replaceEntities(checkId, [{ kind: "company", value: "Acme Corp", confirmed: true, source: "user" }], db);

    const emittedEvents = [];
    const onEvent = (ev) => {
      emittedEvents.push(ev);
    };

    // Agent 1: Instrumented agent that calls recorder
    const instrumentedAgent = {
      name: "payment_entity",
      kind: "check",
      canRun: () => true,
      run: async (snapshot, deps) => {
        deps.activity?.input("UPI ID detected", "fee@upi received for inspection");
        deps.activity?.step("Querying payment facts", "Checking handle provider registry", "rules");
        deps.activity?.finding("Flag fee_request", "Individual UPI requested for official fee", {
          flagId: "personal_upi_for_official_fee",
        });
        deps.activity?.verified("Valid VPA format");
        return {
          checkId,
          agent: "payment_entity",
          kind: "check",
          round: 1,
          status: "ok",
          flags: [
            {
              id: "personal_upi_for_official_fee",
              title: "Personal UPI ID for corporate fee",
              severity: "high",
              explanation: "Payment requested via personal UPI handle",
              evidence: [{ type: "quote", value: "fee@upi" }],
            },
          ],
          verified: ["Valid VPA format"],
          newEntities: [],
          processedEntities: ["upi:fee@upi"],
          unchecked: [],
          manualChecks: [],
          trace: [],
          notes: "Checked payment details",
          durationMs: 50,
        };
      },
    };

    // Agent 2: Uninstrumented agent (returns no activity, but has verified and unchecked)
    const uninstrumentedAgent = {
      name: "official_verifier",
      kind: "check",
      canRun: () => true,
      run: async () => {
        return {
          checkId,
          agent: "official_verifier",
          kind: "check",
          round: 1,
          status: "ok",
          flags: [],
          verified: ["Acme Corp is a registered entity"],
          newEntities: [],
          processedEntities: ["company:Acme Corp"],
          unchecked: ["MCA filing details"],
          manualChecks: [{ label: "Verify on MCA portal", url: "https://mca.gov.in" }],
          trace: [],
          notes: "Verified against registry",
          durationMs: 30,
        };
      },
    };

    // Agent 3: Ineligible agent (skipped)
    const skippedAgent = {
      name: "website_forensics",
      kind: "check",
      canRun: () => false,
      skippedReason: () => "no_domains_or_links_found",
    };

    // Agent 4: Failing agent (could_not_check)
    const failingAgent = {
      name: "classifier_client",
      kind: "check",
      canRun: () => true,
      run: async () => {
        return {
          checkId,
          agent: "classifier_client",
          kind: "check",
          round: 1,
          status: "could_not_check",
          reason: "classifier_service_unavailable",
          flags: [],
          verified: [],
          newEntities: [],
          processedEntities: [],
          unchecked: [],
          manualChecks: [],
          trace: [],
          notes: "FastAPI server did not respond",
          durationMs: 10,
        };
      },
    };

    const deps = {
      db,
      onEvent,
      agents: [instrumentedAgent, uninstrumentedAgent, skippedAgent, failingAgent],
      search: async () => ({ ok: true, results: [] }),
      generate: async () => ({ ok: true, text: "Report text" }),
    };

    const report = await runInvestigation(checkId, deps, { pipelineTimeoutMs: 10000 });
    assert.ok(report, "Investigation should return a report");

    // 1. Verify live emitted activity events
    const activityEvents = emittedEvents.filter((e) => e.type === "activity");
    assert.ok(activityEvents.length >= 4, `Expected at least 4 activity events, got ${activityEvents.length}`);

    // Check payment_entity live events
    const paymentEvents = activityEvents.filter((e) => e.agent === "payment_entity");
    assert.ok(paymentEvents.some((e) => e.entry?.title === "UPI ID detected"));
    assert.ok(paymentEvents.some((e) => e.entry?.title === "Querying payment facts"));

    // Check skipped agent live event
    const skippedEvents = activityEvents.filter((e) => e.agent === "website_forensics");
    assert.equal(skippedEvents.length, 1);
    assert.equal(skippedEvents[0].entry?.type, "limit");
    assert.equal(skippedEvents[0].entry?.status, "skipped");
    assert.match(skippedEvents[0].entry?.detail, /Add a link or website/);

    // 2. Verify persisted agent_results in DB
    const results = getAgentResults(checkId, db);
    assert.equal(results.length, 4);

    const paymentResult = results.find((r) => r.agent === "payment_entity");
    assert.ok(paymentResult);
    assert.ok(paymentResult.activity.length >= 4);
    assert.ok(typeof paymentResult.summary === "string" && paymentResult.summary.length > 0);

    const officialResult = results.find((r) => r.agent === "official_verifier");
    assert.ok(officialResult);
    // Uninstrumented agent must have synthesized fallback activity
    assert.ok(officialResult.activity.length > 0, "Uninstrumented agent must have non-empty activity");
    assert.ok(officialResult.activity.some((a) => a.type === "verified" && a.title.includes("Acme Corp")));
    assert.ok(officialResult.activity.some((a) => a.type === "manual" && a.title.includes("Verify on MCA")));
    assert.ok(officialResult.summary.includes("verified"), "Summary should reflect verified items");

    const forensicsResult = results.find((r) => r.agent === "website_forensics");
    assert.ok(forensicsResult);
    assert.equal(forensicsResult.activity.length, 1);
    assert.equal(forensicsResult.activity[0].status, "skipped");
    assert.match(forensicsResult.summary, /Check skipped/);

    const classifierResult = results.find((r) => r.agent === "classifier_client");
    assert.ok(classifierResult);
    assert.equal(classifierResult.activity.length, 1);
    assert.equal(classifierResult.activity[0].status, "failed");
    assert.match(classifierResult.summary, /Could not complete check/);
  } finally {
    cleanupDb(db);
  }
});
