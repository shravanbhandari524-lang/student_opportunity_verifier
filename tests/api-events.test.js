import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createCheck, appendEvent } from "../lib/db/index.js";
import { GET as eventsHandler } from "../app/api/checks/[id]/events/route.js";

const TEST_DB_PATH = "./data/test_events_endpoint.db";

function setupTestEnvironment() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  const db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const rateLimiters = {
    streamCheck: createRateLimiter({ windowMs: 60 * 1000, max: 20 }),
  };

  return { db, rateLimiters };
}

test("GET /api/checks/:id/events: returns 404 for unknown check id", async () => {
  const env = setupTestEnvironment();
  const unknownId = "99999999-9999-4999-8999-999999999999";

  const req = new Request(`http://localhost/api/checks/${unknownId}/events?after=0`);
  const res = await eventsHandler(req, {
    params: Promise.resolve({ id: unknownId }),
    runtime: env,
  });

  assert.equal(res.status, 404);
  const json = await res.json();
  assert.equal(json.code, "NOT_FOUND");
});

test("GET /api/checks/:id/events: after=0 returns all events strictly ordered by seq ASC", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);

  // Append 3 trace events
  appendEvent(check.id, {
    seq: 1,
    type: "stage",
    stage: "investigating",
  }, env.db);

  appendEvent(check.id, {
    seq: 2,
    type: "note",
    agent: "message_analyst",
    note: "Checking predatory urgency words",
  }, env.db);

  appendEvent(check.id, {
    seq: 3,
    type: "complete",
  }, env.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/events?after=0`);
  const res = await eventsHandler(req, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.events));
  assert.equal(json.events.length, 3);
  assert.equal(json.events[0].seq, 1);
  assert.equal(json.events[0].type, "stage");
  assert.equal(json.events[1].seq, 2);
  assert.equal(json.events[1].type, "note");
  assert.equal(json.events[2].seq, 3);
  assert.equal(json.events[2].type, "complete");
});

test("GET /api/checks/:id/events: after=<last> returns empty array with no duplicates", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);

  appendEvent(check.id, {
    seq: 1,
    type: "stage",
    stage: "investigating",
  }, env.db);

  appendEvent(check.id, {
    seq: 2,
    type: "complete",
  }, env.db);

  // Query after=<last> where last seq is 2
  const req = new Request(`http://localhost/api/checks/${check.id}/events?after=2`);
  const res = await eventsHandler(req, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.events));
  assert.equal(json.events.length, 0);
});

test("GET /api/checks/:id/events: query validation rejects negative after parameter with 400", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/events?after=-5`);
  const res = await eventsHandler(req, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });

  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.code, "BAD_REQUEST");
});
