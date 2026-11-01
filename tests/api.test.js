import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";
process.env.UPLOAD_DIR = "./data/test_uploads";

import { POST } from "../app/api/checks/route.js";
import { getCheck, getInputs, getDb } from "../lib/db/index.js";

const TEST_DB = "./data/test_api_checks.db";

function resetDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  process.env.DB_PATH = TEST_DB;
  return getDb(TEST_DB);
}

test("API: POST /api/checks creates check from valid multipart CheckSubmission", async () => {
  const db = resetDb();

  const formData = new FormData();
  formData.append("text", "Offer letter asking for payment on UPI");
  formData.append("url", "https://example.com/jobs");
  formData.append("upiId", "fee@okaxis");
  formData.append("language", "en");
  formData.append("consent", "true");

  const req = new Request("http://localhost:3000/api/checks", {
    method: "POST",
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 201);
  const data = await res.json();

  assert.ok(data.checkId);
  assert.equal(data.status, "created");

  // Verify created in db
  const check = getCheck(data.checkId, db);
  assert.ok(check);

  // Verify initial inputs were saved
  const inputs = getInputs(data.checkId, db);
  assert.equal(inputs.length, 3);
});

test("API: POST /api/checks returns ApiError with BAD_REQUEST on missing consent", async () => {
  resetDb();

  const formData = new FormData();
  formData.append("text", "Some text");
  formData.append("consent", "false");

  const req = new Request("http://localhost:3000/api/checks", {
    method: "POST",
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const data = await res.json();

  assert.equal(data.code, "BAD_REQUEST");
  assert.ok(Array.isArray(data.details?.issues));
});

test("API: POST /api/checks returns ApiError with BAD_REQUEST when no primary input is provided", async () => {
  resetDb();

  const formData = new FormData();
  formData.append("company", "Acme Corp");
  formData.append("consent", "true");

  const req = new Request("http://localhost:3000/api/checks", {
    method: "POST",
    body: formData,
  });

  const res = await POST(req);
  assert.equal(res.status, 400);
  const data = await res.json();

  assert.equal(data.code, "BAD_REQUEST");
  assert.ok(Array.isArray(data.details?.issues));
});

test("API: POST /api/checks returns ApiError with UNSUPPORTED_MEDIA_TYPE on JSON body", async () => {
  resetDb();

  const req = new Request("http://localhost:3000/api/checks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const res = await POST(req);
  assert.equal(res.status, 415);
  const data = await res.json();

  assert.equal(data.code, "UNSUPPORTED_MEDIA_TYPE");
});
