import test from "node:test";
import assert from "node:assert/strict";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";
import { createCheck, getCheck, updateCheckResult } from "../lib/db/index.js";
import { FAILURE_REASON_CODES } from "../lib/contracts/enums.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";

function setupInMemoryDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

test("S4: getCheck normalizes legacy free-text failure_reason to 'unknown_error' without throwing", () => {
  const db = setupInMemoryDb();
  const check = createCheck({ text: "legacy test" }, db);

  // Directly insert a legacy free-text sentence into the database row
  db.prepare(`
    UPDATE checks
    SET status = 'failed', failure_reason = 'Extraction failed due to an internal system error', updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), check.id);

  // Read through getCheck (validates with CheckSchema)
  const loaded = getCheck(check.id, db);
  assert.equal(loaded.status, "failed");
  assert.equal(loaded.failureReason, "unknown_error");
});

test("S4: GET /api/checks/:id returns normalized failureReason code for legacy rows", async () => {
  const db = setupInMemoryDb();
  const check = createCheck({ text: "legacy test route" }, db);

  db.prepare(`
    UPDATE checks
    SET status = 'failed', failure_reason = 'Some free text error from old version', updated_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), check.id);

  const req = new Request(`http://localhost/api/checks/${check.id}`);
  const runtime = {
    db,
    rateLimiters: {
      getCheck: { assertAllowed: () => {} },
    },
  };
  const res = await getCheckHandler(req, { params: Promise.resolve({ id: check.id }), runtime });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.check.status, "failed");
  assert.equal(json.check.failureReason, "unknown_error");
});

test("S4: updateCheckResult strictly validates failureReason against FAILURE_REASON_CODES and rejects free text", () => {
  const db = setupInMemoryDb();
  const check = createCheck({ text: "write validation test" }, db);

  // Free text must throw a validation error (ZodError)
  assert.throws(
    () => {
      updateCheckResult(
        check.id,
        {
          status: "failed",
          failureReason: "Free text explanation that is not a code",
        },
        db
      );
    },
    /Invalid enum value/
  );

  // Valid codes from FAILURE_REASON_CODES must succeed
  for (const code of FAILURE_REASON_CODES) {
    const updated = updateCheckResult(
      check.id,
      {
        status: "failed",
        failureReason: code,
      },
      db
    );
    assert.equal(updated.status, "failed");
    assert.equal(updated.failureReason, code);
  }
});
