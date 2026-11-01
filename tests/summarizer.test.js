import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFallbackAgentSummary,
  buildFallbackFinalSummary,
  generateAgentSummary,
  generateFinalSummary,
} from "../lib/summarizer.js";

test("buildFallbackAgentSummary handles failed agent", () => {
  const summary = buildFallbackAgentSummary({
    agent_name: "website_forensics",
    status: "failed",
    error: "Connection refused to whois server",
  });
  assert.match(summary, /Agent website forensics execution failed: Connection refused to whois server\./);
});

test("buildFallbackAgentSummary handles skipped agent", () => {
  const summary = buildFallbackAgentSummary({
    agent_name: "payment_entity",
    status: "skipped",
    raw_output: { reason: "no payment handles or bank accounts provided" },
  });
  assert.match(summary, /Agent payment entity skipped: no payment handles or bank accounts provided\./);
});

test("buildFallbackAgentSummary handles flags found", () => {
  const summary = buildFallbackAgentSummary({
    agent_name: "message_analyst",
    status: "completed",
    raw_output: {
      flags: [
        { id: "unrealistic_stipend", title: "Unrealistic stipend" },
        { id: "urgency_pressure", title: "Urgency pressure" },
      ],
    },
  });
  assert.match(summary, /Identified 2 risk flag\(s\): Unrealistic stipend; Urgency pressure\./);
});

test("buildFallbackAgentSummary handles verified signals", () => {
  const summary = buildFallbackAgentSummary({
    agent_name: "official_verifier",
    status: "completed",
    raw_output: {
      flags: [],
      verified: [{ claim: "domain matches official corporate domain" }],
    },
  });
  assert.match(summary, /Verified 1 security signal\(s\)/);
});

test("buildFallbackFinalSummary formats HIGH risk with score", () => {
  const summary = buildFallbackFinalSummary({
    verdict: "high",
    final_score: 82,
    agents: [
      {
        raw_output: { flags: [{ id: "f1" }, { id: "f2" }] },
      },
    ],
  });
  assert.match(summary, /HIGH risk \(Score: 82\/100\)/);
  assert.match(summary, /Identified 2 severe risk indicator\(s\)/);
});

test("buildFallbackFinalSummary formats CANNOT_VERIFY with unavailable score and reason", () => {
  const summary = buildFallbackFinalSummary({
    verdict: "cannot_verify",
    final_score: "Unavailable",
    score_unavailable_reason: "Insufficient verifiable signals",
    agents: [],
  });
  assert.match(summary, /CANNOT_VERIFY \(Score: Unavailable\)/);
  assert.match(summary, /Insufficient verifiable signals/);
});

test("generateAgentSummary falls back cleanly on network/API failure without throwing", async () => {
  const agentEntry = {
    agent_name: "classifier_client",
    status: "completed",
    raw_output: { summary: "Scam probability 0.12 (benign threshold)" },
  };

  // Calling with invalid mock key should never throw and return a clean fallback
  const summary = await generateAgentSummary(agentEntry, { apiKey: "mock-invalid-key", timeoutMs: 500 });
  assert.ok(summary);
  assert.equal(typeof summary, "string");
  assert.match(summary, /benign threshold/);
});

test("generateFinalSummary falls back cleanly on error without throwing", async () => {
  const runRecord = {
    verdict: "low",
    final_score: 20,
    agents: [],
  };

  const summary = await generateFinalSummary(runRecord, { apiKey: "mock-invalid-key", timeoutMs: 500 });
  assert.ok(summary);
  assert.match(summary, /LOW risk/);
});
