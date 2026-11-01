import test from "node:test";
import assert from "node:assert/strict";
import { runInvestigation } from "../lib/coordinator.js";
import { getDb, createCheck, saveInputs, getRunRecord, listRunRecords } from "../lib/db/index.js";

test("Coordinator: persists full run record with incremental agent logs and summary", async () => {
  const db = getDb(":memory:");

  const check = createCheck({ language: "en", status: "awaiting_confirmation" }, db);
  saveInputs(check.id, [{ type: "text", value: "Offer letter for software intern at Microsoft with 60000 INR stipend" }], db);

  const mockDeps = {
    db,
    search: async () => ({ ok: true, results: [] }),
    readPage: async () => ({ ok: true, text: "Page content" }),
    classify: async () => ({ ok: true, probability: 0.1, isSpam: false, topTerms: [] }),
    generate: async () => ({ text: "Summary text" }),
    graphLookup: async () => ({ exists: false }),
  };

  const report = await runInvestigation(check.id, mockDeps);
  assert.ok(report);

  const record = getRunRecord(check.id, db);
  assert.ok(record);
  assert.equal(record.run_id, check.id);
  assert.ok(record.created_at);
  assert.ok(record.input.text.includes("Microsoft"));
  assert.ok(record.final_summary.length > 0);
  assert.equal(typeof record.verdict, "string");

  // Verify agents array
  assert.ok(Array.isArray(record.agents));
  assert.ok(record.agents.length >= 6);

  // Verify each agent entry
  for (const ag of record.agents) {
    assert.ok(ag.agent_name);
    assert.ok(ag.purpose);
    assert.ok(["queued", "running", "completed", "failed"].includes(ag.status));
    if (ag.status === "completed") {
      assert.ok(ag.started_at);
      assert.ok(ag.ended_at);
      assert.ok(ag.summary.length > 0);
      assert.ok(Array.isArray(ag.steps));
      assert.ok(ag.steps.length > 0);
      // Verify step format
      for (const step of ag.steps) {
        assert.ok(step.timestamp);
        assert.ok(step.action);
        assert.ok(step.result !== undefined);
      }
    }
  }

  // Verify listRunRecords includes this run
  const list = listRunRecords(10, db);
  const found = list.find((item) => item.id === check.id);
  assert.ok(found);
  assert.equal(found.id, check.id);
  assert.equal(found.verdict, record.verdict);
  assert.equal(found.score, record.final_score);
});
