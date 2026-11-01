import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  RunRecordSchema,
  AgentEntrySchema,
  AgentStepSchema,
  RunListItemSchema,
} from "../lib/contracts/run-record.js";

test("RunRecordSchema validates valid fixture", () => {
  const fixturePath = path.resolve(process.cwd(), "lib/contracts/fixtures/valid/run-record.json");
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  const parsed = RunRecordSchema.parse(raw);
  assert.equal(parsed.run_id, "test-run-1234-5678");
  assert.equal(parsed.final_score, 75);
  assert.equal(parsed.agents.length, 1);
  assert.equal(parsed.agents[0].agent_name, "message_analyst");
  assert.equal(parsed.agents[0].status, "completed");
  assert.equal(parsed.agents[0].steps.length, 1);
});

test("RunRecordSchema handles unavailable score with reason", () => {
  const record = {
    run_id: "run-unavailable-1",
    created_at: new Date().toISOString(),
    input: { text: "Short text" },
    final_score: "Unavailable",
    score_unavailable_reason: "Insufficient data to score",
    verdict: "cannot_verify",
    final_summary: "Cannot verify offer legitimacy.",
    agents: [],
  };
  const parsed = RunRecordSchema.parse(record);
  assert.equal(parsed.final_score, "Unavailable");
  assert.equal(parsed.score_unavailable_reason, "Insufficient data to score");
});

test("AgentEntrySchema validates failed agent with error", () => {
  const entry = {
    agent_name: "website_forensics",
    purpose: "Analyzes domain registration and SSL certificates",
    status: "failed",
    started_at: "2026-11-02T04:00:00.000Z",
    ended_at: "2026-11-02T04:00:02.000Z",
    steps: [
      {
        timestamp: "2026-11-02T04:00:01.000Z",
        action: "Tool call: rdapLookup",
        result: { error: "ETIMEDOUT" },
      },
    ],
    summary: "Agent failed due to timeout.",
    error: "Network timeout querying RDAP registry",
  };
  const parsed = AgentEntrySchema.parse(entry);
  assert.equal(parsed.status, "failed");
  assert.equal(parsed.error, "Network timeout querying RDAP registry");
  assert.equal(typeof parsed.steps[0].result, "string");
});

test("RunListItemSchema validates list format", () => {
  const item = {
    id: "run-123",
    date: "2026-11-02T04:00:00.000Z",
    input: "Internship text preview",
    score: "Unavailable",
    verdict: "cannot_verify",
  };
  const parsed = RunListItemSchema.parse(item);
  assert.equal(parsed.id, "run-123");
  assert.equal(parsed.score, "Unavailable");
});
