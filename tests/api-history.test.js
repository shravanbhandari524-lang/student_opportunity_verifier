import test from "node:test";
import assert from "node:assert/strict";
import { GET as listHistoryHandler } from "../app/api/history/route.js";
import { GET as getHistoryDetailHandler } from "../app/api/history/[id]/route.js";
import { getDb, saveRunRecord } from "../lib/db/index.js";

test("API: GET /api/history and GET /api/history/[id]", async () => {
  const db = getDb(":memory:");
  const runtimeContext = { runtime: { db } };

  const testRunId = "run-api-test-123";
  saveRunRecord({
    run_id: testRunId,
    created_at: new Date().toISOString(),
    input: { text: "Software Engineering Intern offer letter" },
    final_score: 90,
    score_unavailable_reason: null,
    verdict: "high",
    final_summary: "High risk recruitment scam detected.",
    agents: [
      {
        agent_name: "message_analyst",
        purpose: "Analyzes message text",
        status: "completed",
        started_at: "2026-11-02T04:00:00.000Z",
        ended_at: "2026-11-02T04:00:01.000Z",
        steps: [
          {
            timestamp: "2026-11-02T04:00:00.500Z",
            action: "Scanned salary terms",
            result: "Unrealistic stipend detected",
          },
        ],
        summary: "Flagged unrealistic stipend.",
        score_contribution: 30,
        raw_output: {},
        error: null,
      },
    ],
  }, db);

  // 1. Test List
  const listReq = new Request("http://localhost:3000/api/history");
  const listRes = await listHistoryHandler(listReq, runtimeContext);
  assert.equal(listRes.status, 200);

  const listData = await listRes.json();
  assert.ok(Array.isArray(listData));
  const found = listData.find((r) => r.id === testRunId);
  assert.ok(found);
  assert.equal(found.id, testRunId);
  assert.equal(found.score, 90);
  assert.equal(found.verdict, "high");

  // 2. Test Detail
  const detailReq = new Request(`http://localhost:3000/api/history/${testRunId}`);
  const detailRes = await getHistoryDetailHandler(detailReq, {
    ...runtimeContext,
    params: { id: testRunId },
  });
  assert.equal(detailRes.status, 200);

  const detailData = await detailRes.json();
  assert.equal(detailData.run_id, testRunId);
  assert.equal(detailData.final_score, 90);
  assert.equal(detailData.verdict, "high");
  assert.equal(detailData.final_summary, "High risk recruitment scam detected.");
  assert.equal(detailData.agents.length, 1);
  assert.equal(detailData.agents[0].agent_name, "message_analyst");
  assert.equal(detailData.agents[0].steps.length, 1);

  // 3. Test 404
  const notFoundReq = new Request("http://localhost:3000/api/history/non-existent-id");
  const notFoundRes = await getHistoryDetailHandler(notFoundReq, {
    ...runtimeContext,
    params: { id: "non-existent-id" },
  });
  assert.equal(notFoundRes.status, 404);
});
