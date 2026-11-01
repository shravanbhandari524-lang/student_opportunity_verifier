import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { getDb, createCheck, saveInputs, getInputs, getEntities, getAgentResults } from "../lib/db/index.js";
import { runExtraction } from "../lib/extract.js";
import { runInvestigation } from "../lib/coordinator.js";
import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { POST as confirmCheckHandler } from "../app/api/checks/[id]/confirm/route.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";
import { getRuntime } from "../lib/api/runtime.js";

const TEST_DB_PATH = "./data/test_discrepancy_unit.db";

test("API vs CLI Discrepancy Fix: Confirming entities preserves message text and produces identical findings", async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = getDb(TEST_DB_PATH);
  const runtime = getRuntime({ db });

  const testText = "Congratulations, you are selected for an internship at Google. Pay Rs 500 to rahul.hr@oksbi, call 9876543210";
  const testHandle = "@google_hr_careers";
  const testUserNotes = "Recruiter contacted me via Telegram channel offering fast track onboarding";

  // Mock LLM generation for deterministic test
  const mockGenerate = async (params) => {
    if (params.purpose === "entity_sweep") {
      return {
        ok: true,
        data: {
          companies: [{ name: "Google", orgType: "company", quote: "Google" }],
          schemes: [],
          handles: [{ handle: "@google_hr_careers", platform: "telegram", quote: "@google_hr_careers" }],
          paymentIds: [{ id: "rahul.hr@oksbi", quote: "rahul.hr@oksbi" }],
          amounts: [{ amount: "500", quote: "Pay Rs 500", purpose: "advance payment" }],
        },
      };
    }
    if (params.purpose === "message_analyst_evaluation") {
      return {
        ok: true,
        data: {
          findings: [
            {
              flagId: "fee_demand",
              explanation: "The opportunity requires an upfront payment.",
              quote: "Pay Rs 500 to rahul.hr@oksbi",
            },
            {
              flagId: "no_interview_selection",
              explanation: "Claimed selection without any interview process.",
              quote: "Congratulations, you are selected for an internship at Google",
            },
          ],
        },
      };
    }
    if (params.purpose === "report_generation") {
      return {
        ok: true,
        data: {
          summary: "This opportunity is high risk due to upfront fee demands and impersonation.",
          scamTypeGuess: "internship_scam",
          flagExplanations: [
            { flagId: "fee_demand", text: "Demand for payment" },
            { flagId: "personal_payment_id", text: "Personal UPI ID used" },
            { flagId: "no_interview_selection", text: "Immediate selection claimed" },
          ],
          extraChecklist: ["Do not pay any money."],
        },
      };
    }
    return { ok: true, data: {} };
  };

  const mockSearch = async () => ({
    ok: true,
    data: { results: [] },
  });

  const pipelineDeps = {
    generate: mockGenerate,
    search: mockSearch,
    classify: async () => ({ ok: true, data: { probability: 0.85, label: "suspicious", topTerms: ["selected", "internship"] } }),
    classifierHealth: async () => ({ ok: true, data: { status: "healthy", data_provenance: "synthetic" } }),
  };

  // 1. Create check through API
  const formData = new FormData();
  formData.append("text", testText);
  formData.append("handle", testHandle);
  formData.append("userNotes", testUserNotes);
  formData.append("consent", "true");

  const createReq = new Request("http://localhost:3000/api/checks", {
    method: "POST",
    body: formData,
  });

  const createRes = await createCheckHandler(createReq, {
    runtime: { ...runtime, pipelineDeps },
    extractDeps: {
      db,
      generate: mockGenerate,
      uploadDir: "./temp_test_uploads",
      handlePlatform: "telegram",
    },
  });

  assert.equal(createRes.status, 201);
  const { checkId } = await createRes.json();
  assert.ok(checkId);

  // Poll GET /api/checks/:id until awaiting_confirmation
  let checkData = null;
  for (let i = 0; i < 20; i++) {
    const getReq = new Request(`http://localhost:3000/api/checks/${checkId}`);
    const getRes = await getCheckHandler(getReq, { runtime, params: { id: checkId } });
    checkData = await getRes.json();
    if (checkData.check?.status === "awaiting_confirmation") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(checkData.check?.status, "awaiting_confirmation");
  assert.ok(checkData.entities.length >= 4);

  // 2. Confirm entities via API WITHOUT passing texts (or texts: [])
  // This simulates the client sending only confirmed entities
  const confirmPayload = {
    entities: checkData.entities.map((e) => ({
      kind: e.kind,
      value: e.value,
      source: "user",
    })),
  };

  const confirmReq = new Request(`http://localhost:3000/api/checks/${checkId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirmPayload),
  });

  const confirmRes = await confirmCheckHandler(confirmReq, {
    runtime: { ...runtime, pipelineDeps },
    coordinatorDeps: {
      db,
      ...pipelineDeps,
      onEvent: () => {},
    },
    params: { id: checkId },
  });

  assert.equal(confirmRes.status, 200);

  // Verify text was NOT wiped out in database
  const inputsAfterConfirm = getInputs(checkId, db);
  const textInput = inputsAfterConfirm.find((i) => i.type === "text");
  assert.ok(textInput, "Text input must be preserved in database after entity confirmation");
  assert.equal(textInput.value, testText);

  // Wait for investigation to finish
  let pollData = null;
  for (let i = 0; i < 40; i++) {
    const getReq = new Request(`http://localhost:3000/api/checks/${checkId}`);
    const getRes = await getCheckHandler(getReq, { runtime, params: { id: checkId } });
    pollData = await getRes.json();
    if (pollData.check?.status === "report_ready") break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // Check agent results
  const agentResults = getAgentResults(checkId, db);
  const messageAnalyst = agentResults.find((r) => r.agent === "message_analyst");
  assert.ok(messageAnalyst);
  assert.equal(messageAnalyst.status, "ok");
  const maFlags = (messageAnalyst.flags || []).map((f) => f.id);
  assert.ok(maFlags.includes("fee_demand"), "Must include fee_demand");
  assert.ok(maFlags.includes("no_interview_selection"), "Must include no_interview_selection");

  const paymentAgent = agentResults.find((r) => r.agent === "payment_entity");
  assert.ok(paymentAgent);
  assert.equal(paymentAgent.status, "ok");
  const payFlags = (paymentAgent.flags || []).map((f) => f.id);
  assert.ok(payFlags.includes("personal_payment_id"), "Must include personal_payment_id");

  // Clean up
  try { fs.unlinkSync(TEST_DB_PATH); } catch {}
});
