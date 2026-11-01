import test from "node:test";
import assert from "node:assert/strict";
import {
  getDb,
  saveRunRecord,
  updateRunRecordAgent,
  getRunRecord,
  listRunRecords,
} from "../lib/db/index.js";

test("Database: run_records repository operations", () => {
  const db = getDb(":memory:");

  const runId = "test-db-run-001";
  const initialRecord = {
    run_id: runId,
    created_at: new Date().toISOString(),
    input: { text: "Sample offer letter for testing" },
    final_score: null,
    score_unavailable_reason: "Investigation in progress",
    verdict: "investigating",
    final_summary: "",
    agents: [
      {
        agent_name: "message_analyst",
        purpose: "Analyzes message text",
        status: "queued",
        steps: [],
      },
    ],
  };

  const saved = saveRunRecord(initialRecord, db);
  assert.equal(saved.run_id, runId);
  assert.equal(saved.final_score, "Unavailable");
  assert.equal(saved.score_unavailable_reason, "Investigation in progress");
  assert.equal(saved.agents.length, 1);
  assert.equal(saved.agents[0].status, "queued");

  // Incrementally update agent when it starts
  const startedUpdate = {
    status: "running",
    started_at: new Date().toISOString(),
    input_received: { text: "Sample offer letter" },
    steps: [
      {
        timestamp: new Date().toISOString(),
        action: "Analysis: Began reading submission",
        result: "Loaded 32 characters",
      },
    ],
  };
  const afterStart = updateRunRecordAgent(runId, "message_analyst", startedUpdate, db);
  assert.equal(afterStart.agents[0].status, "running");
  assert.equal(afterStart.agents[0].steps.length, 1);

  // Incrementally update agent when it finishes
  const finishedUpdate = {
    status: "completed",
    ended_at: new Date().toISOString(),
    steps: [
      {
        timestamp: new Date().toISOString(),
        action: "Analysis: Began reading submission",
        result: "Loaded 32 characters",
      },
      {
        timestamp: new Date().toISOString(),
        action: "Decision: Checked salary promises",
        result: "No issues found",
      },
    ],
    summary: "Completed text analysis without red flags.",
    score_contribution: 0,
    raw_output: { flags: [] },
  };
  const afterFinish = updateRunRecordAgent(runId, "message_analyst", finishedUpdate, db);
  assert.equal(afterFinish.agents[0].status, "completed");
  assert.equal(afterFinish.agents[0].steps.length, 2);
  assert.equal(afterFinish.agents[0].summary, "Completed text analysis without red flags.");

  // Finalize run
  const finalized = saveRunRecord({
    ...afterFinish,
    final_score: 85,
    verdict: "low",
    final_summary: "Verification completed with LOW risk. All checks passed.",
  }, db);
  assert.equal(finalized.final_score, 85);
  assert.equal(finalized.verdict, "low");

  // Test list
  const list = listRunRecords(10, db);
  assert(list.length >= 1);
  const item = list.find((r) => r.id === runId);
  assert.ok(item);
  assert.equal(item.score, 85);
  assert.equal(item.verdict, "low");

  // Test get
  const fetched = getRunRecord(runId, db);
  assert.equal(fetched.run_id, runId);
  assert.equal(fetched.final_score, 85);
  assert.equal(fetched.agents[0].status, "completed");
});
