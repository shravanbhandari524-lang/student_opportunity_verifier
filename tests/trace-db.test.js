import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";
import { up as migration001 } from "../lib/db/migrations/001_initial_l0_schema.js";
import { up as migration002 } from "../lib/db/migrations/002_target_l1_schema.js";
import { up as migration003 } from "../lib/db/migrations/003_add_classifier_result_to_agent_results.js";
import { up as migration004 } from "../lib/db/migrations/004_check_events_trace_payload.js";
import {
  createCheck,
  appendEvent,
  listEventsAfter,
  getEvents,
  getDb,
} from "../lib/db/index.js";
import { getCaseFile } from "../lib/caseFile.js";
import { TraceEventSchema } from "../lib/contracts/trace.js";
import { traceEventFixtures } from "../lib/contracts/fixtures/trace/individual-events.js";

test("Trace DB: migration 004 cleanly backfills existing check_events rows", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Run migrations 1 through 3
  migration001(db);
  migration002(db);
  migration003(db);

  // Insert a check and old check_events rows without seq or payload_json
  const checkId = "c0a80101-0000-4000-8000-000000000001";
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO checks (id, status, current_round, language, created_at, updated_at, expires_at)
    VALUES (?, 'created', 0, 'en', ?, ?, ?)
  `).run(checkId, now, now, now);

  db.prepare(`
    INSERT INTO check_events (check_id, round, type, agent, status, summary, created_at)
    VALUES (?, 1, 'stage', NULL, NULL, 'Extraction started', '2026-10-27T10:00:01Z')
  `).run(checkId);

  db.prepare(`
    INSERT INTO check_events (check_id, round, type, agent, status, summary, created_at)
    VALUES (?, 1, 'agent', 'message_analyst', 'done', 'Analysis complete', '2026-10-27T10:00:02Z')
  `).run(checkId);

  // Now run migration 004
  migration004(db);

  // Verify rows were backfilled
  const rows = db.prepare(`SELECT * FROM check_events WHERE check_id = ? ORDER BY seq ASC`).all(checkId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].seq, 1);
  assert.equal(rows[1].seq, 2);
  assert.ok(rows[0].payload_json, "Expected payload_json to be non-empty");
  assert.ok(rows[1].payload_json, "Expected payload_json to be non-empty");

  const parsed0 = JSON.parse(rows[0].payload_json);
  assert.equal(parsed0.seq, 1);
  assert.equal(parsed0.checkId, checkId);

  db.close();
});

test("Trace DB: appendEvent assigns monotonic seq and listEventsAfter filters correctly", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);
  assert.ok(check?.id);

  // Append 3 events without explicit seq
  const ev1 = appendEvent(
    check.id,
    {
      type: "stage",
      stage: "investigating",
      round: 1,
      agent: null,
    },
    db
  );
  assert.equal(ev1.seq, 1);

  const ev2 = appendEvent(
    check.id,
    {
      type: "note",
      text: "Checking domain records",
      round: 1,
      agent: "website_forensics",
    },
    db
  );
  assert.equal(ev2.seq, 2);

  const ev3 = appendEvent(
    check.id,
    {
      ...traceEventFixtures.toolEndRdapLookup,
      seq: undefined, // allow appendEvent to compute next seq
      checkId: check.id,
    },
    db
  );
  assert.equal(ev3.seq, 3);

  // listEventsAfter(check.id, 0) returns all 3
  const allEvents = listEventsAfter(check.id, 0, db);
  assert.equal(allEvents.length, 3);
  assert.equal(allEvents[0].seq, 1);
  assert.equal(allEvents[1].seq, 2);
  assert.equal(allEvents[2].seq, 3);

  // listEventsAfter(check.id, 1) returns 2 and 3
  const after1 = listEventsAfter(check.id, 1, db);
  assert.equal(after1.length, 2);
  assert.equal(after1[0].seq, 2);
  assert.equal(after1[1].seq, 3);

  // listEventsAfter(check.id, 3) returns empty array
  const after3 = listEventsAfter(check.id, 3, db);
  assert.equal(after3.length, 0);

  db.close();
});

test("Trace DB: UNIQUE(check_id, seq) constraint rejects duplicate sequence numbers", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);

  // First append with seq 1
  appendEvent(
    check.id,
    {
      seq: 1,
      type: "stage",
      stage: "extraction",
      round: 0,
      agent: null,
    },
    db
  );

  // Attempt second append with the same seq 1 -> must throw SQLITE_CONSTRAINT
  assert.throws(() => {
    appendEvent(
      check.id,
      {
        seq: 1,
        type: "stage",
        stage: "investigating",
        round: 1,
        agent: null,
      },
      db
    );
  }, /UNIQUE constraint failed/);

  db.close();
});

test("Trace DB: appendEvent returns stored event and throws on invalid input", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);

  // Valid append returns stored event with final seq and truncated payload
  const longText = "x".repeat(200);
  const stored = appendEvent(
    check.id,
    {
      type: "note",
      text: longText,
      round: 1,
      agent: "message_analyst",
    },
    db
  );

  assert.equal(typeof stored.id, "number");
  assert.equal(stored.seq, 1);
  assert.equal(stored.type, "note");
  assert.ok(stored.text.length <= 80, "Text must be truncated to max 80 chars");

  // Invalid event throws on invalid input
  assert.throws(() => {
    appendEvent(
      check.id,
      {
        type: "invalid_type_unknown",
        round: 1,
      },
      db
    );
  });

  db.close();
});

test("Trace DB: atomic seq assignment under tight loop and interleaved async calls has no gaps or duplicates", async () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);
  const TOTAL_EVENTS = 50;

  // Interleave async executions that each call appendEvent
  const promises = Array.from({ length: TOTAL_EVENTS }, (_, idx) => {
    return (async () => {
      // Small randomized delay before calling appendEvent to simulate concurrent async work
      await new Promise((resolve) => setTimeout(resolve, (idx % 5) * 2));
      return appendEvent(
        check.id,
        {
          type: "note",
          text: `Event #${idx}`,
          round: 1,
          agent: "website_forensics",
        },
        db
      );
    })();
  });

  const results = await Promise.all(promises);
  assert.equal(results.length, TOTAL_EVENTS);

  // Retrieve all events via listEventsAfter
  const stored = listEventsAfter(check.id, 0, db);
  assert.equal(stored.length, TOTAL_EVENTS);

  // Assert seq is strictly increasing from 1 to TOTAL_EVENTS with no gaps or duplicates
  const seqs = stored.map((e) => e.seq);
  const expectedSeqs = Array.from({ length: TOTAL_EVENTS }, (_, i) => i + 1);
  assert.deepEqual(seqs, expectedSeqs);

  db.close();
});

test("Trace DB: listEventsAfter tolerates backfilled legacy rows without throwing", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);

  // Insert a backfilled row with empty payload_json and another with corrupt JSON
  db.prepare(`
    INSERT INTO check_events (check_id, seq, round, type, agent, status, summary, payload_json, created_at)
    VALUES (?, 1, 0, 'stage', NULL, NULL, 'Legacy stage', '{}', datetime('now'))
  `).run(check.id);

  db.prepare(`
    INSERT INTO check_events (check_id, seq, round, type, agent, status, summary, payload_json, created_at)
    VALUES (?, 2, 1, 'agent', 'official_verifier', 'ok', 'Legacy agent', 'corrupt-json', datetime('now'))
  `).run(check.id);

  // Insert modern TraceEvent row
  appendEvent(
    check.id,
    {
      seq: 3,
      type: "note",
      text: "Modern note",
      round: 1,
      agent: "official_verifier",
    },
    db
  );

  // listEventsAfter should safely return all 3 rows without throwing
  const events = listEventsAfter(check.id, 0, db);
  assert.equal(events.length, 3);
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].summary, "Legacy stage");
  assert.equal(events[1].seq, 2);
  assert.equal(events[1].type, "agent");
  assert.equal(events[2].seq, 3);
  assert.equal(events[2].text, "Modern note");

  db.close();
});

test("Trace DB: activity event with a non-empty entry round-trips through appendEvent and getCaseFile", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);

  const activityCandidate = {
    type: "activity",
    agent: "website_forensics",
    round: 1,
    entry: {
      seq: 0,
      atMs: 50,
      type: "step",
      status: "ok",
      title: "Looked up domain registration in RDAP",
      detail: "Registered 4 days ago with Namecheap",
      tool: "rdap",
      sources: [{ label: "RDAP", url: "https://rdap.org/domain/example.com" }],
    },
  };

  const stored = appendEvent(check.id, activityCandidate, db);
  assert.equal(stored.type, "activity");
  assert.equal(stored.seq, 1);
  assert.equal(stored.agent, "website_forensics");
  assert.equal(stored.entry.title, "Looked up domain registration in RDAP");

  // Verify getCaseFile round-trip
  const caseFile = getCaseFile(check.id, db);
  assert.equal(caseFile.events.length, 1);
  assert.equal(caseFile.events[0].type, "activity");
  assert.equal(caseFile.events[0].agent, "website_forensics");

  // Verify listEventsAfter returns the full ActivityTraceEvent
  const retrieved = listEventsAfter(check.id, 0, db);
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].type, "activity");
  assert.equal(retrieved[0].entry.tool, "rdap");
  assert.equal(retrieved[0].entry.sources[0].url, "https://rdap.org/domain/example.com");

  db.close();
});

test("Trace DB: oversized activity entry is truncated to <= 4 KB and still persisted", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);

  const oversizedActivity = {
    type: "activity",
    agent: "message_analyst",
    round: 1,
    entry: {
      seq: 0,
      atMs: 120,
      type: "step",
      status: "warn",
      title: "Extensive pattern analysis",
      detail: "Extremely long diagnostic detail string ".repeat(200),
      sources: [
        { label: "Advisory link", url: "https://cybercrime.example.gov.in/advisory/1" },
      ],
      flagId: "fee_demand",
    },
  };

  const initialBytes = Buffer.byteLength(JSON.stringify(oversizedActivity), "utf8");
  assert.ok(initialBytes > 4096, `Expected > 4096 bytes, got ${initialBytes}`);

  const stored = appendEvent(check.id, oversizedActivity, db);
  assert.equal(stored.type, "activity");
  assert.equal(stored.seq, 1);

  const storedBytes = Buffer.byteLength(JSON.stringify(stored), "utf8");
  assert.ok(storedBytes <= 4096, `Expected <= 4096 bytes, got ${storedBytes}`);

  // Verify stored in DB and round-trips through getCaseFile and listEventsAfter
  const caseFile = getCaseFile(check.id, db);
  assert.equal(caseFile.events.length, 1);
  assert.equal(caseFile.events[0].type, "activity");

  const retrieved = listEventsAfter(check.id, 0, db);
  assert.equal(retrieved.length, 1);
  assert.equal(retrieved[0].type, "activity");
  assert.ok(retrieved[0].entry.detail.length <= 200);

  db.close();
});

test("Trace DB: old rows survive, activity accepted, and unknown type rejected", () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const check = createCheck({ language: "en" }, db);

  // 1. Existing older event types
  appendEvent(check.id, { type: "stage", stage: "investigating", round: 1 }, db);
  appendEvent(check.id, { type: "agent_status", status: "started", agent: "official_verifier", round: 1 }, db);

  // 2. Activity event is accepted alongside existing rows
  appendEvent(check.id, {
    type: "activity",
    agent: "official_verifier",
    round: 1,
    entry: {
      seq: 0,
      atMs: 25,
      type: "verified",
      status: "ok",
      title: "Verified institution registry",
      sources: [],
    },
  }, db);

  // 3. Unknown type is rejected by validation
  assert.throws(() => {
    appendEvent(check.id, {
      type: "unregistered_event_type",
      agent: "official_verifier",
      round: 1,
    }, db);
  });

  // Verify all 3 valid rows survive in monotonic sequence
  const events = listEventsAfter(check.id, 0, db);
  assert.equal(events.length, 3);
  assert.equal(events[0].seq, 1);
  assert.equal(events[0].type, "stage");
  assert.equal(events[1].seq, 2);
  assert.equal(events[1].type, "agent_status");
  assert.equal(events[2].seq, 3);
  assert.equal(events[2].type, "activity");

  const caseFile = getCaseFile(check.id, db);
  assert.equal(caseFile.events.length, 3);

  db.close();
});
