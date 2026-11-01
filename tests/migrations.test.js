import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

import { runMigrations, MIGRATIONS } from "../lib/db/migrations/index.js";
import { up as upL0, name as name001 } from "../lib/db/migrations/001_initial_l0_schema.js";
import { up as upL1, name as name002 } from "../lib/db/migrations/002_target_l1_schema.js";
import { up as up003, name as name003 } from "../lib/db/migrations/003_add_classifier_result_to_agent_results.js";
import { getDb } from "../lib/db/index.js";
import {
  CHECK_STATUSES,
  ENTITY_KINDS,
  ENTITY_SOURCES,
  INPUT_TYPES,
  AGENT_NAMES,
  AGENT_STATUSES,
  RISK_LEVELS,
  CONFIDENCE_LEVELS,
  LANGUAGES,
  FEEDBACK_VERDICTS,
} from "../lib/contracts/enums.js";

const TEST_MIGRATION_DB = "./data/test-migration.db";

test("Database Migrations: Pragmas, WAL, busy timeout, foreign keys, and cascade deletion", () => {
  if (fs.existsSync(TEST_MIGRATION_DB)) fs.unlinkSync(TEST_MIGRATION_DB);
  const db = getDb(TEST_MIGRATION_DB);

  // Check pragmas
  const journalMode = db.pragma("journal_mode", { simple: true });
  assert.equal(journalMode.toLowerCase(), "wal");

  const foreignKeys = db.pragma("foreign_keys", { simple: true });
  assert.equal(foreignKeys, 1);

  const busyTimeout = db.pragma("busy_timeout", { simple: true });
  assert.equal(busyTimeout, 5000);

  // Test cascade deletion: inserting check and child rows
  db.prepare(`
    INSERT INTO checks (id, status, language, created_at, updated_at, expires_at)
    VALUES ('chk-test-cascade', 'created', 'en', datetime('now'), datetime('now'), datetime('now', '+1 day'))
  `).run();

  db.prepare(`
    INSERT INTO check_inputs (check_id, type, value, created_at)
    VALUES ('chk-test-cascade', 'text', 'sample text', datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO entities (check_id, kind, value, source, confirmed)
    VALUES ('chk-test-cascade', 'domain', 'test.example', 'user', 1)
  `).run();

  db.prepare(`
    INSERT INTO agent_results (check_id, agent, round, kind, status, duration_ms)
    VALUES ('chk-test-cascade', 'message_analyst', 1, 'agent', 'ok', 100)
  `).run();

  db.prepare(`
    INSERT INTO reports (check_id, report_json, created_at)
    VALUES ('chk-test-cascade', '{"summary":"test"}', datetime('now'))
  `).run();

  db.prepare(`
    INSERT INTO check_events (check_id, seq, type, payload_json, created_at)
    VALUES ('chk-test-cascade', 1, 'stage', '{}', datetime('now'))
  `).run();

  // Verify child rows exist
  assert.equal(db.prepare(`SELECT count(*) AS c FROM check_inputs WHERE check_id = 'chk-test-cascade'`).get().c, 1);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM entities WHERE check_id = 'chk-test-cascade'`).get().c, 1);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM agent_results WHERE check_id = 'chk-test-cascade'`).get().c, 1);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM reports WHERE check_id = 'chk-test-cascade'`).get().c, 1);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM check_events WHERE check_id = 'chk-test-cascade'`).get().c, 1);

  // Delete parent check -> all child rows must cascade delete
  db.prepare(`DELETE FROM checks WHERE id = 'chk-test-cascade'`).run();

  assert.equal(db.prepare(`SELECT count(*) AS c FROM check_inputs WHERE check_id = 'chk-test-cascade'`).get().c, 0);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM entities WHERE check_id = 'chk-test-cascade'`).get().c, 0);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM agent_results WHERE check_id = 'chk-test-cascade'`).get().c, 0);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM reports WHERE check_id = 'chk-test-cascade'`).get().c, 0);
  assert.equal(db.prepare(`SELECT count(*) AS c FROM check_events WHERE check_id = 'chk-test-cascade'`).get().c, 0);

  db.close();
});

test("Database Migrations: Enum CHECK constraints match enums.js exactly", () => {
  if (fs.existsSync(TEST_MIGRATION_DB)) fs.unlinkSync(TEST_MIGRATION_DB);
  const db = getDb(TEST_MIGRATION_DB);

  const tables = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type='table'`).all();
  const sqlByTable = Object.fromEntries(tables.map((t) => [t.name, t.sql]));

  // Helper extracting enum items from CHECK (col IN (...))
  function extractCheckEnum(sql, colName) {
    const re = new RegExp(`${colName}\\s+TEXT[^,)]*CHECK\\s*\\([^)]*${colName}\\s+IN\\s*\\(([^)]+)\\)`, "i");
    const m = sql.match(re);
    if (!m) return null;
    return m[1]
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .sort();
  }

  // checks.status
  const checksStatus = extractCheckEnum(sqlByTable.checks, "status");
  assert.deepEqual(checksStatus, [...CHECK_STATUSES].sort());

  // checks.language
  const checksLang = extractCheckEnum(sqlByTable.checks, "language");
  assert.deepEqual(checksLang, [...LANGUAGES].sort());

  // check_inputs.type
  const inputTypes = extractCheckEnum(sqlByTable.check_inputs, "type");
  assert.deepEqual(inputTypes, [...INPUT_TYPES].sort());

  // entities.kind
  const entityKinds = extractCheckEnum(sqlByTable.entities, "kind");
  assert.deepEqual(entityKinds, [...ENTITY_KINDS].sort());

  // entities.source
  const entitySources = extractCheckEnum(sqlByTable.entities, "source");
  assert.deepEqual(entitySources, [...ENTITY_SOURCES].sort());

  // agent_results.agent
  const agentResultsAgent = extractCheckEnum(sqlByTable.agent_results, "agent");
  assert.deepEqual(agentResultsAgent, [...AGENT_NAMES].sort());

  // agent_results.status
  const agentResultsStatus = extractCheckEnum(sqlByTable.agent_results, "status");
  assert.deepEqual(agentResultsStatus, [...AGENT_STATUSES].sort());

  // feedback.verdict
  const feedbackVerdict = extractCheckEnum(sqlByTable.feedback, "verdict");
  assert.deepEqual(feedbackVerdict, [...FEEDBACK_VERDICTS].sort());

  db.close();
});

test("Database Migrations: L0 seed data preserves graph, feedback, and cache across migration 2, and migrations are idempotent", () => {
  const SEED_DB = "./data/test-seed.db";
  if (fs.existsSync(SEED_DB)) fs.unlinkSync(SEED_DB);

  // 1. Manually build L0 schema and seed rows
  const rawDb = new Database(SEED_DB);
  rawDb.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  upL0(rawDb);
  rawDb.prepare(`INSERT INTO schema_migrations VALUES (1, '001_initial_l0_schema', datetime('now'))`).run();

  // Seed L0 rows
  rawDb.prepare(`
    INSERT INTO graph_nodes (id, kind, value, first_seen, report_count)
    VALUES ('node-1', 'domain', 'scammer.example', '2026-09-01T00:00:00.000Z', 5)
  `).run();

  rawDb.prepare(`
    INSERT INTO graph_nodes (id, kind, value, first_seen, report_count)
    VALUES ('node-2', 'upi', 'scammer@okaxis', '2026-09-01T00:00:00.000Z', 5)
  `).run();

  rawDb.prepare(`
    INSERT INTO graph_nodes (id, kind, value, first_seen, report_count)
    VALUES ('node-3', 'phone', '+919876543210', '2026-09-01T00:00:00.000Z', 1)
  `).run();

  // Edge whose old node order is reversed relative to the new integer ids (node-2 to node-1)
  rawDb.prepare(`
    INSERT INTO graph_edges (id, node_a, node_b, check_ref, created_at)
    VALUES ('edge-rev', 'node-2', 'node-1', 'chk-seed-1', '2026-09-01T00:00:00.000Z')
  `).run();

  // Self-loop edge (node-1 to node-1)
  rawDb.prepare(`
    INSERT INTO graph_edges (id, node_a, node_b, check_ref, created_at)
    VALUES ('edge-loop', 'node-1', 'node-1', 'chk-seed-1', '2026-09-01T00:00:00.000Z')
  `).run();

  // Duplicate edges (same nodes and check_ref)
  rawDb.prepare(`
    INSERT INTO graph_edges (id, node_a, node_b, check_ref, created_at)
    VALUES ('edge-dup-1', 'node-1', 'node-3', 'chk-seed-2', '2026-09-01T01:00:00.000Z')
  `).run();
  rawDb.prepare(`
    INSERT INTO graph_edges (id, node_a, node_b, check_ref, created_at)
    VALUES ('edge-dup-2', 'node-3', 'node-1', 'chk-seed-2', '2026-09-01T02:00:00.000Z')
  `).run();

  // NULL check_ref edge
  rawDb.prepare(`
    INSERT INTO graph_edges (id, node_a, node_b, check_ref, created_at)
    VALUES ('edge-null-ref', 'node-2', 'node-3', NULL, '2026-09-01T03:00:00.000Z')
  `).run();

  // Seed feedback rows with each of the 6 valid verdict values plus one unknown value
  const feedbackRows = [
    { id: 'fb-wrong', verdict: 'wrong', comment: 'Marked wrong' },
    { id: 'fb-unhelpful', verdict: 'unhelpful', comment: 'Marked unhelpful' },
    { id: 'fb-inaccurate', verdict: 'inaccurate', comment: 'Marked inaccurate' },
    { id: 'fb-right', verdict: 'right', comment: 'Marked right' },
    { id: 'fb-helpful', verdict: 'helpful', comment: 'Marked helpful' },
    { id: 'fb-accurate', verdict: 'accurate', comment: 'Marked accurate' },
    { id: 'fb-unknown', verdict: 'spam_verdict', comment: 'Should be excluded' },
  ];
  for (const r of feedbackRows) {
    rawDb.prepare(`
      INSERT INTO feedback (id, check_id, verdict, comment, created_at)
      VALUES (?, 'chk-seed-1', ?, ?, '2026-09-02T00:00:00.000Z')
    `).run(r.id, r.verdict, r.comment);
  }

  // Seed check with non-UUID id that has child rows and feedback
  rawDb.prepare(`
    INSERT INTO checks (id, status, language, risk_level, score, confidence, created_at, expires_at)
    VALUES ('non-uuid-check-123', 'completed', 'en', 'high', 85, 'high', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z')
  `).run();
  rawDb.prepare(`
    INSERT INTO check_inputs (id, check_id, type, value, file_path)
    VALUES ('inp-non-uuid', 'non-uuid-check-123', 'text', 'bad offer', NULL)
  `).run();
  rawDb.prepare(`
    INSERT INTO entities (id, check_id, kind, value, source, confirmed)
    VALUES ('ent-non-uuid', 'non-uuid-check-123', 'domain', 'scammer.example', 'user', 1)
  `).run();
  rawDb.prepare(`
    INSERT INTO agent_results (id, check_id, agent, status, flags_json, verified_json, notes, duration_ms)
    VALUES ('res-non-uuid', 'non-uuid-check-123', 'message_analyst', 'ok', '[]', '[]', 'test', 50)
  `).run();
  rawDb.prepare(`
    INSERT INTO reports (check_id, report_json, created_at)
    VALUES ('non-uuid-check-123', '{"summary":"test"}', '2026-09-01T00:00:00.000Z')
  `).run();
  rawDb.prepare(`
    INSERT INTO feedback (id, check_id, verdict, comment, created_at)
    VALUES ('fb-non-uuid', 'non-uuid-check-123', 'right', 'Feedback on non-uuid check', '2026-09-02T00:00:00.000Z')
  `).run();

  rawDb.prepare(`
    INSERT INTO lookup_cache (key, result_json, fetched_at, ttl_seconds)
    VALUES ('cache-1', '{"ip":"1.2.3.4"}', '2026-10-20T00:00:00.000Z', 3600)
  `).run();

  rawDb.close();

  // 2. Open via getDb, running migration 2
  const migratedDb = getDb(SEED_DB);

  // Check version
  const versions = migratedDb.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all();
  assert.deepEqual(versions.map((v) => v.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  // Check graph_nodes preserved and last_seen populated
  const node = migratedDb.prepare(`SELECT * FROM graph_nodes WHERE value = 'scammer.example'`).get();
  assert.ok(node);
  assert.equal(typeof node.id, "number", "New node id must be integer");
  assert.equal(node.report_count, 5);
  assert.equal(node.last_seen, '2026-09-01T00:00:00.000Z');

  // Verify graph_edges:
  // (a) reversed edge stored with node_a < node_b
  const revEdge = migratedDb.prepare(`
    SELECT ge.* FROM graph_edges ge
    JOIN graph_nodes n1 ON ge.node_a = n1.id
    JOIN graph_nodes n2 ON ge.node_b = n2.id
    WHERE n1.value = 'scammer.example' AND n2.value = 'scammer@okaxis'
  `).get();
  assert.ok(revEdge, "Reversed edge must be stored");
  assert.ok(revEdge.node_a < revEdge.node_b, "node_a must be strictly less than node_b");

  // (b) self-loop edge is absent
  const selfLoops = migratedDb.prepare(`SELECT * FROM graph_edges WHERE node_a = node_b`).all();
  assert.equal(selfLoops.length, 0, "Self-loop edge must be absent");

  // (c) duplicates collapsed: exactly 1 edge between node-1 and node-3 with check_ref 'chk-seed-2'
  const dupEdges = migratedDb.prepare(`
    SELECT ge.* FROM graph_edges ge
    JOIN graph_nodes n1 ON ge.node_a = n1.id
    JOIN graph_nodes n2 ON ge.node_b = n2.id
    WHERE (n1.value = 'scammer.example' AND n2.value = '+919876543210')
       OR (n1.value = '+919876543210' AND n2.value = 'scammer.example')
  `).all();
  assert.equal(dupEdges.length, 1, "Duplicate edges must be collapsed into exactly 1");

  // (d) NULL check_ref is 'legacy'
  const nullRefEdge = migratedDb.prepare(`
    SELECT ge.* FROM graph_edges ge
    JOIN graph_nodes n1 ON ge.node_a = n1.id
    JOIN graph_nodes n2 ON ge.node_b = n2.id
    WHERE (n1.value = 'scammer@okaxis' AND n2.value = '+919876543210')
       OR (n1.value = '+919876543210' AND n2.value = 'scammer@okaxis')
  `).get();
  assert.ok(nullRefEdge);
  assert.equal(nullRefEdge.check_ref, 'legacy', "NULL check_ref must become 'legacy'");

  // Verify feedback mapping:
  // - 6 valid verdicts copied: wrong, unhelpful, inaccurate -> 'wrong'; right, helpful, accurate -> 'right'
  // - 1 feedback for deleted non-uuid check survived with check_id NULL -> 'right'
  // - 1 unknown verdict excluded
  const feedbackList = migratedDb.prepare(`SELECT * FROM feedback`).all();
  const unknownFb = feedbackList.find((f) => f.comment === 'Should be excluded');
  assert.equal(unknownFb, undefined, "Unknown feedback verdict must be excluded");

  const wrongFb = feedbackList.find((f) => f.comment === 'Marked wrong');
  assert.equal(wrongFb.verdict, 'wrong');

  const unhelpfulFb = feedbackList.find((f) => f.comment === 'Marked unhelpful');
  assert.equal(unhelpfulFb.verdict, 'wrong');

  const inaccurateFb = feedbackList.find((f) => f.comment === 'Marked inaccurate');
  assert.equal(inaccurateFb.verdict, 'wrong');

  const rightFb = feedbackList.find((f) => f.comment === 'Marked right');
  assert.equal(rightFb.verdict, 'right');

  const helpfulFb = feedbackList.find((f) => f.comment === 'Marked helpful');
  assert.equal(helpfulFb.verdict, 'right');

  const accurateFb = feedbackList.find((f) => f.comment === 'Marked accurate');
  assert.equal(accurateFb.verdict, 'right');

  // Verify non-UUID check and its children are gone
  const nonUuidCheck = migratedDb.prepare(`SELECT * FROM checks WHERE id = 'non-uuid-check-123'`).get();
  assert.equal(nonUuidCheck, undefined, "Non-UUID check must be deleted");

  const nonUuidInputs = migratedDb.prepare(`SELECT * FROM check_inputs WHERE check_id = 'non-uuid-check-123'`).all();
  assert.equal(nonUuidInputs.length, 0, "Non-UUID check inputs must be cascaded");

  const nonUuidEntities = migratedDb.prepare(`SELECT * FROM entities WHERE check_id = 'non-uuid-check-123'`).all();
  assert.equal(nonUuidEntities.length, 0, "Non-UUID entities must be cascaded");

  const nonUuidResults = migratedDb.prepare(`SELECT * FROM agent_results WHERE check_id = 'non-uuid-check-123'`).all();
  assert.equal(nonUuidResults.length, 0, "Non-UUID agent_results must be cascaded");

  const nonUuidReports = migratedDb.prepare(`SELECT * FROM reports WHERE check_id = 'non-uuid-check-123'`).all();
  assert.equal(nonUuidReports.length, 0, "Non-UUID reports must be cascaded");

  // Verify feedback for non-UUID check survives with check_id NULL
  const nonUuidFb = feedbackList.find((f) => f.comment === 'Feedback on non-uuid check');
  assert.ok(nonUuidFb, "Feedback on deleted non-UUID check must survive");
  assert.equal(nonUuidFb.check_id, null, "check_id of surviving feedback must be NULL");
  assert.equal(nonUuidFb.verdict, 'right');

  // PRAGMA foreign_key_check returns nothing
  const fkCheck = migratedDb.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(fkCheck, [], "PRAGMA foreign_key_check must return empty array");

  // Check cache preserved with epoch integer fetched_at
  const cacheRow = migratedDb.prepare(`SELECT * FROM lookup_cache WHERE key = 'cache-1'`).get();
  assert.ok(cacheRow);
  assert.equal(typeof cacheRow.fetched_at, "number");

  // 3. Test idempotency: running migrations again changes nothing
  runMigrations(migratedDb);
  const versionsAgain = migratedDb.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all();
  assert.deepEqual(versionsAgain.map((v) => v.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  const fkCheckAgain = migratedDb.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(fkCheckAgain, [], "PRAGMA foreign_key_check after rerun must return empty array");

  migratedDb.close();
});

test("migration 003 applies on a DB already at migration 002 containing rows", () => {
  const TEST_003_DB = "./data/test_migration_003.db";
  if (fs.existsSync(TEST_003_DB)) fs.unlinkSync(TEST_003_DB);

  // 1. Manually setup DB with migrations 1 and 2 applied
  const db = new Database(TEST_003_DB);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  upL0(db);
  db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, datetime('now'))`).run(name001);
  upL1(db);
  db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, ?, datetime('now'))`).run(name002);

  // Verify at version 2
  const versionsAt2 = db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all();
  assert.deepEqual(versionsAt2.map((r) => r.version), [1, 2]);

  // Insert a valid check and agent result row in migration 002 schema
  db.prepare(`
    INSERT INTO checks (id, status, language, created_at, updated_at, expires_at)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'created', 'en', datetime('now'), datetime('now'), datetime('now', '+1 day'))
  `).run();

  db.prepare(`
    INSERT INTO agent_results (check_id, agent, round, kind, status, duration_ms)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'message_analyst', 1, 'agent', 'ok', 100)
  `).run();

  // Verify table does not have classifier_result_json column yet
  const colInfoBefore = db.prepare(`PRAGMA table_info(agent_results)`).all();
  assert.equal(colInfoBefore.some((c) => c.name === "classifier_result_json"), false);

  // 2. Run runMigrations (which applies 003)
  runMigrations(db);

  // 3. Verify schema_migrations now has version 14
  const versionsAt3 = db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all();
  assert.deepEqual(versionsAt3.map((r) => r.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

  // 4. Verify classifier_result_json column exists and existing row has NULL
  const colInfoAfter = db.prepare(`PRAGMA table_info(agent_results)`).all();
  assert.ok(colInfoAfter.some((c) => c.name === "classifier_result_json"));

  const existingRow = db.prepare(`SELECT * FROM agent_results WHERE check_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`).get();
  assert.equal(existingRow.classifier_result_json, null);

  // 5. Insert new row with classifier_result_json and verify
  db.prepare(`
    INSERT INTO agent_results (check_id, agent, round, kind, status, duration_ms, classifier_result_json)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'classifier_client', 1, 'check', 'ok', 50, '{"probability":0.9,"label":"suspicious","topTerms":[]}')
  `).run();

  const newRow = db.prepare(`SELECT * FROM agent_results WHERE agent = 'classifier_client'`).get();
  assert.equal(newRow.classifier_result_json, '{"probability":0.9,"label":"suspicious","topTerms":[]}');

  // Verify foreign keys and pragmas are intact
  const fkCheck = db.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(fkCheck, []);

  db.close();
});

test("migration 007 applies activity_json and summary columns to agent_results", () => {
  const TEST_007_DB = "./data/test_migration_007.db";
  if (fs.existsSync(TEST_007_DB)) fs.unlinkSync(TEST_007_DB);

  const db = new Database(TEST_007_DB);
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  const colInfo = db.prepare(`PRAGMA table_info(agent_results)`).all();
  assert.ok(colInfo.some((c) => c.name === "activity_json"));
  assert.ok(colInfo.some((c) => c.name === "summary"));

  const versions = db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all();
  assert.ok(versions.map((r) => r.version).includes(7));

  db.close();
  if (fs.existsSync(TEST_007_DB)) fs.unlinkSync(TEST_007_DB);
});

test("migration 010 creates evidence_ledger table with cascade deletion", () => {
  const TEST_010_DB = "./data/test_migration_010.db";
  if (fs.existsSync(TEST_010_DB)) fs.unlinkSync(TEST_010_DB);

  const db = new Database(TEST_010_DB);
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  const colInfo = db.prepare(`PRAGMA table_info(evidence_ledger)`).all();
  assert.ok(colInfo.some((c) => c.name === "claim_key"));
  assert.ok(colInfo.some((c) => c.name === "evidence_type"));
  assert.ok(colInfo.some((c) => c.name === "confidence"));

  const versions = db.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all();
  assert.ok(versions.map((r) => r.version).includes(10));

  // Test insert and cascade delete
  db.prepare(`
    INSERT INTO checks (id, status, language, created_at, updated_at, expires_at)
    VALUES ('chk-ledger-test', 'created', 'en', datetime('now'), datetime('now'), datetime('now', '+1 day'))
  `).run();

  db.prepare(`
    INSERT INTO evidence_ledger (
      id, check_id, agent, round, kind, flag_id, claim_key, quote_or_url, evidence_type, verification_status, confidence, timestamp
    ) VALUES (
      'ev-1', 'chk-ledger-test', 'message_analyst', 1, 'flag', 'fee_demand', 'fee_demand', '₹799', 'quote', 'flagged', 'high', datetime('now')
    )
  `).run();

  const rowBefore = db.prepare(`SELECT * FROM evidence_ledger WHERE check_id = 'chk-ledger-test'`).get();
  assert.ok(rowBefore);
  assert.equal(rowBefore.claim_key, 'fee_demand');

  db.prepare(`DELETE FROM checks WHERE id = 'chk-ledger-test'`).run();
  const rowAfter = db.prepare(`SELECT * FROM evidence_ledger WHERE check_id = 'chk-ledger-test'`).get();
  assert.equal(rowAfter, undefined, "Evidence ledger row should cascade delete when check is deleted");

  db.close();
  if (fs.existsSync(TEST_010_DB)) fs.unlinkSync(TEST_010_DB);
});

test("migration 014 creates users, sessions, and adds user_id to checks with cascade/SET NULL", () => {
  const TEST_014_DB = path.join(tmpdir(), `test-014-${Date.now()}.db`);
  if (fs.existsSync(TEST_014_DB)) fs.unlinkSync(TEST_014_DB);

  const db = getDb(TEST_014_DB);

  // Check tables exist
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
  assert.ok(tables.includes("users"), "users table should exist");
  assert.ok(tables.includes("sessions"), "sessions table should exist");

  // Check checks table has user_id
  const checkCols = db.prepare(`PRAGMA table_info(checks)`).all().map(c => c.name);
  assert.ok(checkCols.includes("user_id"), "checks table must have user_id column");

  // Insert user
  const userId = "11111111-2222-4333-8444-555555555555";
  db.prepare(`
    INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(userId, "google-sub-123", "test@example.com", "Test User", "https://example.com/avatar.png");

  // Insert session
  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, created_at)
    VALUES (?, ?, datetime('now', '+7 days'), datetime('now'))
  `).run("sess-1", userId);

  // Insert check with user_id
  db.prepare(`
    INSERT INTO checks (id, user_id, status, language, created_at, updated_at, expires_at)
    VALUES ('chk-user-1', ?, 'created', 'en', datetime('now'), datetime('now'), datetime('now', '+1 day'))
  `).run(userId);

  const checkRow = db.prepare(`SELECT * FROM checks WHERE id = 'chk-user-1'`).get();
  assert.equal(checkRow.user_id, userId);

  // When user is deleted, sessions cascade and checks.user_id is set to null
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);

  const sessAfter = db.prepare(`SELECT * FROM sessions WHERE id = 'sess-1'`).get();
  assert.equal(sessAfter, undefined, "Session should cascade delete");

  const checkAfter = db.prepare(`SELECT * FROM checks WHERE id = 'chk-user-1'`).get();
  assert.ok(checkAfter, "Check should still exist");
  assert.equal(checkAfter.user_id, null, "user_id on check should be SET NULL");

  db.close();
  if (fs.existsSync(TEST_014_DB)) fs.unlinkSync(TEST_014_DB);
});
