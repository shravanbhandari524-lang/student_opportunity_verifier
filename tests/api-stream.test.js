import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createEventBus } from "../lib/api/event-bus.js";
import { createCheck, updateStatus, appendEvent } from "../lib/db/index.js";
import {
  formatEvent,
  formatComment,
  parseLastEventId,
  mapDbEventToProgressEvent,
  streamEvents,
} from "../lib/api/sse.js";
import { GET as streamHandler } from "../app/api/checks/[id]/stream/route.js";

const TEST_DB_PATH = "./data/test_stream.db";

function setupTestEnvironment() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  const db = new Database(TEST_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const rateLimiters = {
    streamCheck: createRateLimiter({ windowMs: 60 * 1000, max: 10 }),
  };

  const eventBus = createEventBus();
  const capturedLogs = [];
  const mockLogger = {
    info: (obj, msg) => capturedLogs.push({ level: "info", obj, msg }),
    warn: (obj, msg) => capturedLogs.push({ level: "warn", obj, msg }),
    error: (obj, msg) => capturedLogs.push({ level: "error", obj, msg }),
  };

  return {
    db,
    rateLimiters,
    eventBus,
    logger: mockLogger,
    capturedLogs,
  };
}

async function readStreamChunks(reader, maxChunks = 10) {
  const decoder = new TextDecoder();
  const chunks = [];
  while (chunks.length < maxChunks) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }
  return chunks;
}

test("SSE formatting: formatEvent with ID, event, retryMs, and multiline data", () => {
  const frame = formatEvent({
    id: 42,
    event: "update",
    retryMs: 5000,
    data: "Line 1\nLine 2\nLine 3",
  });

  assert.equal(
    frame,
    "retry: 5000\nid: 42\nevent: update\ndata: Line 1\ndata: Line 2\ndata: Line 3\n\n"
  );
});

test("SSE formatting: formatComment formats keepalive ping", () => {
  const comment = formatComment("ping");
  assert.equal(comment, ": ping\n\n");

  const multiComment = formatComment("line 1\nline 2");
  assert.equal(multiComment, ": line 1 line 2\n\n");
});

test("SSE parseLastEventId: parses header, query param, and ignores invalid values", () => {
  const reqHeader = new Request("http://localhost/stream", {
    headers: { "last-event-id": "15" },
  });
  assert.equal(parseLastEventId(reqHeader), 15);

  const reqQuery = new Request("http://localhost/stream?lastEventId=25");
  assert.equal(parseLastEventId(reqQuery), 25);

  const reqInvalid = new Request("http://localhost/stream?lastEventId=-5");
  assert.equal(parseLastEventId(reqInvalid), null);

  const reqNaN = new Request("http://localhost/stream?lastEventId=abc");
  assert.equal(parseLastEventId(reqNaN), null);
});

test("SSE mapDbEventToProgressEvent: maps safely without leaking internals", () => {
  const stageEvent = mapDbEventToProgressEvent({ type: "stage", status: "extracting" });
  assert.deepEqual(stageEvent, { type: "stage", stage: "extracting" });

  const agentEvent = mapDbEventToProgressEvent({
    type: "agent",
    round: 1,
    agent: "website_forensics",
    status: "ok",
    summary: "Sensitive canary marker text should NOT leak",
  });
  assert.deepEqual(agentEvent, {
    type: "agent",
    round: 1,
    agent: "website_forensics",
    status: "ok",
  });

  const completeEvent = mapDbEventToProgressEvent({ type: "complete", status: "high" });
  assert.deepEqual(completeEvent, { type: "complete", riskLevel: "high" });

  const errorEvent = mapDbEventToProgressEvent({
    type: "error",
    summary: "SECRET_KEY was invalid at /home/user/app.js:42",
  });
  assert.deepEqual(errorEvent, {
    type: "error",
    code: "CHECK_FAILED",
    message: "Check investigation encountered a failure",
  });
});

test("SSE streamEvents: ordered full event lifecycle ending with complete", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);

  appendEvent(check.id, { round: 1, type: "stage", status: "investigating" }, env.db);
  appendEvent(check.id, { round: 1, type: "agent", agent: "message_analyst", status: "ok" }, env.db);
  appendEvent(check.id, { round: 1, type: "complete", status: "low" }, env.db);

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    pollMs: 50,
  });

  const frames = [];
  for await (const frame of gen) {
    frames.push(frame);
  }

  assert.equal(frames.length, 3);
  assert.ok(frames[0].includes("stage"));
  assert.ok(frames[1].includes("message_analyst"));
  assert.ok(frames[2].includes("complete"));
});

test("SSE streamEvents: Last-Event-ID reconnection replays only missing events", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);

  const ev1 = appendEvent(check.id, { round: 1, type: "stage", status: "investigating" }, env.db);
  appendEvent(check.id, { round: 1, type: "agent", agent: "official_verifier", status: "ok" }, env.db);
  appendEvent(check.id, { round: 1, type: "complete", status: "low" }, env.db);

  const gen = streamEvents({
    checkId: check.id,
    lastEventId: ev1.id,
    db: env.db,
    bus: env.eventBus,
    pollMs: 50,
  });

  const frames = [];
  for await (const frame of gen) {
    frames.push(frame);
  }

  // Only ev2 and ev3 should be yielded
  assert.equal(frames.length, 2);
  assert.ok(!frames[0].includes("investigating"));
  assert.ok(frames[0].includes("official_verifier"));
  assert.ok(frames[1].includes("complete"));
});

test("SSE streamEvents: stream reconnect with Last-Event-ID resumes without duplicates or gaps", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "resume stream check" }, env.db);

  // 1. Append 5 sequential events
  const e1 = appendEvent(check.id, { round: 1, type: "stage", stage: "investigating" }, env.db);
  const e2 = appendEvent(check.id, {
    round: 1,
    type: "tool_start",
    callId: "call_1",
    tool: "rdapLookup",
    label: "domain age lookup",
    input: "example.com",
    agent: "website_forensics",
  }, env.db);
  const e3 = appendEvent(check.id, {
    round: 1,
    type: "tool_end",
    callId: "call_1",
    tool: "rdapLookup",
    status: "ok",
    durationMs: 45,
    summary: "domain registered 2 days ago",
    detail: {
      tool: "rdapLookup",
      domain: "example.com",
      registeredAt: "2026-10-27T00:00:00Z",
      ageDays: 2,
      registrar: "Example Registrar",
    },
    agent: "website_forensics",
  }, env.db);
  const e4 = appendEvent(check.id, {
    round: 1,
    type: "flag",
    flagId: "young_domain",
    title: "Domain registered recently",
    severity: "medium",
    evidence: [{ type: "quote", value: "Registered 2 days ago" }],
    agent: "website_forensics",
  }, env.db);
  const e5 = appendEvent(check.id, { round: 1, type: "complete" }, env.db);

  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(e3.seq, 3);
  assert.equal(e4.seq, 4);
  assert.equal(e5.seq, 5);

  // 2. Initial connection reads first two events then disconnects
  const initialGen = streamEvents({
    checkId: check.id,
    lastEventId: 0,
    db: env.db,
    bus: env.eventBus,
    pollMs: 50,
  });

  const initialFrames = [];
  const initial1 = await initialGen.next();
  initialFrames.push(initial1.value);
  const initial2 = await initialGen.next();
  initialFrames.push(initial2.value);

  // Assert initial frames match seq 1 and seq 2
  assert.ok(initialFrames[0].includes("id: 1"));
  assert.ok(initialFrames[0].includes('"type":"stage"'));
  assert.ok(initialFrames[1].includes("id: 2"));
  assert.ok(initialFrames[1].includes('"type":"tool_start"'));

  // 3. Client reconnects with lastEventId = 2
  const resumedGen = streamEvents({
    checkId: check.id,
    lastEventId: 2,
    db: env.db,
    bus: env.eventBus,
    pollMs: 50,
  });

  const resumedFrames = [];
  for await (const frame of resumedGen) {
    resumedFrames.push(frame);
  }

  // Exactly 3 remaining events: seq 3, 4, 5
  assert.equal(resumedFrames.length, 3, "Resumed stream must receive exactly remaining events");

  // No duplicates: seq 1 and 2 must not appear
  assert.ok(!resumedFrames.some((f) => f.includes("id: 1")), "Must not duplicate event 1");
  assert.ok(!resumedFrames.some((f) => f.includes("id: 2")), "Must not duplicate event 2");

  // No gaps: seq 3, 4, 5 must be in strictly ascending order
  assert.ok(resumedFrames[0].includes("id: 3"));
  assert.ok(resumedFrames[0].includes('"type":"tool_end"'));
  assert.ok(resumedFrames[0].includes("rdapLookup"));

  assert.ok(resumedFrames[1].includes("id: 4"));
  assert.ok(resumedFrames[1].includes('"type":"flag"'));
  assert.ok(resumedFrames[1].includes("young_domain"));

  assert.ok(resumedFrames[2].includes("id: 5"));
  assert.ok(resumedFrames[2].includes('"type":"complete"'));
});

test("SSE streamEvents: late subscriber on already finished check gets full replay and closes immediately", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);
  appendEvent(check.id, { round: 1, type: "stage", status: "scoring" }, env.db);
  updateStatus(check.id, "extracting", env.db);
  updateStatus(check.id, "awaiting_confirmation", env.db);
  updateStatus(check.id, "investigating", env.db);
  updateStatus(check.id, "scoring", env.db);
  updateStatus(check.id, "report_ready", env.db);

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    pollMs: 50,
  });

  const frames = [];
  for await (const frame of gen) {
    frames.push(frame);
  }

  assert.equal(frames.length, 1);
  assert.ok(frames[0].includes("scoring"));
});

test("SSE streamEvents: bus wake-up pushes new events immediately", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    pollMs: 10000, // very long poll interval to prove bus wake-up works
  });

  const nextPromise = gen.next();

  // Give promise time to wait
  await new Promise((r) => setTimeout(r, 20));

  // Append new event and notify bus
  appendEvent(check.id, { round: 1, type: "stage", status: "investigating" }, env.db);
  env.eventBus.notify(check.id);

  const { value } = await nextPromise;
  assert.ok(value.includes("investigating"));

  // Finish generator
  appendEvent(check.id, { round: 1, type: "complete", status: "low" }, env.db);
  env.eventBus.notify(check.id);
  const end = await gen.next();
  assert.ok(end.value.includes("complete"));
});

test("SSE streamEvents: client abort closes cleanly and unsubscribes from bus", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test input" }, env.db);

  const controller = new AbortController();
  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    signal: controller.signal,
    pollMs: 5000,
  });

  const nextPromise = gen.next();
  assert.equal(env.eventBus.listenerCount(check.id), 1);

  controller.abort();

  const res = await nextPromise;
  assert.equal(res.done, true);
  assert.equal(env.eventBus.listenerCount(check.id), 0);
});

test("Route GET /api/checks/:id/stream: validates checkId, exists and expiration", async () => {
  const env = setupTestEnvironment();

  // 1. Malformed UUID -> 400
  const badReq = new Request("http://localhost/api/checks/not-a-uuid/stream");
  const badRes = await streamHandler(badReq, {
    params: Promise.resolve({ id: "not-a-uuid" }),
    runtime: env,
  });
  assert.equal(badRes.status, 400);

  // 2. Non-existent -> 404
  const unknownId = "11111111-1111-4111-8111-111111111111";
  const notFoundReq = new Request(`http://localhost/api/checks/${unknownId}/stream`);
  const notFoundRes = await streamHandler(notFoundReq, {
    params: Promise.resolve({ id: unknownId }),
    runtime: env,
  });
  assert.equal(notFoundRes.status, 404);

  // 3. Expired -> 410
  const check = createCheck({ text: "expired check" }, env.db);
  env.db.prepare("UPDATE checks SET expires_at = ? WHERE id = ?").run(
    new Date(Date.now() - 1000).toISOString(),
    check.id
  );
  const expReq = new Request(`http://localhost/api/checks/${check.id}/stream`);
  const expRes = await streamHandler(expReq, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });
  assert.equal(expRes.status, 410);
});

test("Route GET /api/checks/:id/stream: subscriber cap returns 503 when >= 25 active listeners", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test check" }, env.db);

  // Add 25 dummy listeners
  for (let i = 0; i < 25; i++) {
    env.eventBus.subscribe(check.id, () => {});
  }

  const req = new Request(`http://localhost/api/checks/${check.id}/stream`);
  const res = await streamHandler(req, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });

  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Retry-After"), "10");
  const data = await res.json();
  assert.equal(data.code, "SERVICE_UNAVAILABLE");
});

test("Route GET /api/checks/:id/stream: streams initial retry and updates to client", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test check" }, env.db);
  appendEvent(check.id, { round: 1, type: "stage", status: "extracting" }, env.db);
  appendEvent(check.id, { round: 1, type: "complete", status: "low" }, env.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/stream`);
  const res = await streamHandler(req, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(res.headers.get("Connection"), "keep-alive");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");

  const reader = res.body.getReader();
  const chunks = await readStreamChunks(reader, 5);

  const fullPayload = chunks.join("");
  assert.ok(fullPayload.includes("retry: 3000"));
  assert.ok(fullPayload.includes('"type":"connected"'));
  assert.ok(fullPayload.includes('"type":"stage"'));
  assert.ok(fullPayload.includes('"type":"complete"'));
});

test("Route GET /api/checks/:id/stream: rate limiting enforces streamCheck limit", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "test check" }, env.db);

  // Exceed rate limit for the client key produced by the request
  const req = new Request(`http://localhost/api/checks/${check.id}/stream`);
  for (let i = 0; i < 10; i++) {
    env.rateLimiters.streamCheck.assertAllowed("unknown");
  }

  const res = await streamHandler(req, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });

  assert.equal(res.status, 429);
  const data = await res.json();
  assert.equal(data.code, "RATE_LIMITED");
});

test("Route GET /api/checks/:id/stream: 20 concurrent subscribers receive the event stream without interference", async () => {
  const env = setupTestEnvironment();
  // Provide generous rate limit for this concurrency test
  env.rateLimiters.streamCheck = createRateLimiter({ windowMs: 60 * 1000, max: 50 });
  const check = createCheck({ text: "concurrency test" }, env.db);

  appendEvent(check.id, { round: 1, type: "stage", status: "investigating" }, env.db);
  appendEvent(check.id, { round: 1, type: "complete", status: "low" }, env.db);

  const promises = [];
  for (let i = 0; i < 20; i++) {
    const req = new Request(`http://localhost/api/checks/${check.id}/stream`);
    promises.push(
      streamHandler(req, {
        params: Promise.resolve({ id: check.id }),
        runtime: env,
      })
    );
  }

  const responses = await Promise.all(promises);
  for (const res of responses) {
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    const chunks = await readStreamChunks(reader, 4);
    const content = chunks.join("");
    assert.ok(content.includes('"type":"connected"'));
    assert.ok(content.includes('"stage"'));
    assert.ok(content.includes('"complete"'));
  }
});

test("Route GET /api/checks/:id/stream: exact response headers verified", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "headers test" }, env.db);

  const req = new Request(`http://localhost/api/checks/${check.id}/stream`);
  const res = await streamHandler(req, {
    params: Promise.resolve({ id: check.id }),
    runtime: env,
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "text/event-stream; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(res.headers.get("Connection"), "keep-alive");
  assert.equal(res.headers.get("X-Accel-Buffering"), "no");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});

test("SSE streamEvents: keepalive ping appears inside the stream when interval expires", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "keepalive test" }, env.db);

  let mockTime = 1000000;
  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    heartbeatMs: 100,
    pollMs: 50,
    now: () => mockTime,
  });

  const p1 = gen.next();
  // Advance mock time past heartbeatMs
  mockTime += 150;
  // Trigger poll resolution
  await new Promise((r) => setTimeout(r, 60));

  const { value } = await p1;
  assert.equal(value, ": ping\n\n");
});

test("SSE streamEvents: maximum duration closes the stream", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "max duration test" }, env.db);

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    maxDurationMs: 60,
    pollMs: 15,
  });

  const res = await gen.next();
  assert.equal(res.done, true);
});


test("SSE streamEvents: database error yields an error frame with fixed code", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "db error test" }, env.db);

  const brokenDb = {
    prepare() {
      throw new Error("Disk I/O error or corruption");
    },
  };

  const gen = streamEvents({
    checkId: check.id,
    db: brokenDb,
    bus: env.eventBus,
    pollMs: 50,
  });

  const { value } = await gen.next();
  assert.ok(value.includes('"type":"error"'));
  assert.ok(value.includes('"code":"INTERNAL_ERROR"'));
  assert.ok(value.includes('"message":"Database read error"'));
  assert.ok(!value.includes("Disk I/O error")); // No raw error message leaked
});

test("SSE streamEvents: unique canary marker never appears in frames", async () => {
  const env = setupTestEnvironment();
  const CANARY_SECRET = "CANARY_STREAM_SECRET_444";
  const check = createCheck({ text: `Message with ${CANARY_SECRET}` }, env.db);

  appendEvent(check.id, {
    round: 1,
    type: "agent",
    agent: "message_analyst",
    status: "ok",
    summary: `Found secret ${CANARY_SECRET}`,
  }, env.db);

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    pollMs: 50,
  });

  const { value } = await gen.next();
  assert.ok(value.includes("message_analyst"));
  assert.ok(!value.includes(CANARY_SECRET), "Canary marker must never leak in SSE frames");
});

test("SSE streamEvents: stream for a failed check ends with error event", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "failed check test" }, env.db);
  appendEvent(check.id, {
    round: 1,
    type: "error",
    status: "failed",
    summary: "Investigation failed due to coordinator error",
  }, env.db);

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: env.eventBus,
    pollMs: 50,
  });

  const { value } = await gen.next();
  assert.ok(value.includes('"type":"error"'));
  assert.ok(value.includes('"code":"CHECK_FAILED"'));

  const end = await gen.next();
  assert.equal(end.done, true);
});

test("SSE streamEvents: events arrive through polling when bus wake-up is lost", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "polling fallback test" }, env.db);

  // Mute event bus so no notifications ever fire
  const deadBus = {
    subscribe: () => () => {},
    notify: () => {},
    listenerCount: () => 0,
  };

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: deadBus,
    pollMs: 50, // Short poll interval
  });

  const nextPromise = gen.next();

  // Append event directly to DB after slight delay without bus notification
  setTimeout(() => {
    appendEvent(check.id, { round: 1, type: "stage", status: "investigating" }, env.db);
  }, 20);

  const { value } = await nextPromise;
  assert.ok(value.includes("investigating"), "Event must arrive through polling even when wake-up is lost");
});

test("SSE streamEvents: a stalled bus does not hang the stream", async () => {
  const env = setupTestEnvironment();
  const check = createCheck({ text: "stalled bus test" }, env.db);

  // Stalled bus whose subscribe throws or deadlocks
  const stalledBus = {
    subscribe: () => () => {},
    notify: () => {},
    listenerCount: () => 0,
  };

  const gen = streamEvents({
    checkId: check.id,
    db: env.db,
    bus: stalledBus,
    pollMs: 15,
    maxDurationMs: 60,
  });

  const res = await gen.next();
  assert.equal(res.done, true, "Stream must terminate when maxDuration is reached despite stalled bus");
});


