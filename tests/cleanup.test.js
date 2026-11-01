import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runCleanup, MAX_IMAGE_AGE_MS } from "../lib/cleanup.js";
import {
  getDb,
  createCheck,
  updateStatus,
  saveInputs,
  saveFeedback,
  upsertGraphNode,
  addGraphEdge,
} from "../lib/db/index.js";
import { cacheSet } from "../lib/cache.js";

const TEST_DB = "./data/test_cleanup_service.db";
const TEST_UPLOADS = "./test_cleanup_uploads";

function resetTestEnv() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_UPLOADS)) {
    fs.rmSync(TEST_UPLOADS, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_UPLOADS, { recursive: true });
  return getDb(TEST_DB);
}

test("cleanup: expired check removed with children; unexpired check kept", async () => {
  const db = resetTestEnv();
  const now = Date.now();

  // Create an expired check (25 hours ago)
  const expiredCheck = createCheck({}, db);
  const yesterdayIso = new Date(now - 25 * 3600 * 1000).toISOString();
  db.prepare(`UPDATE checks SET expires_at = ? WHERE id = ?`).run(yesterdayIso, expiredCheck.id);

  // Create an unexpired check (expires in 23 hours)
  const validCheck = createCheck({}, db);

  const res = await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    now: () => now,
  });

  assert.equal(res.checksDeleted, 1);
  assert.equal(res.errors.length, 0);

  const check1 = db.prepare(`SELECT * FROM checks WHERE id = ?`).get(expiredCheck.id);
  const check2 = db.prepare(`SELECT * FROM checks WHERE id = ?`).get(validCheck.id);

  assert.equal(check1, undefined);
  assert.ok(check2);
});

test("cleanup: graph nodes, edges and feedback survive, feedback.check_id becomes NULL", async () => {
  const db = resetTestEnv();
  const now = Date.now();

  const expiredCheck = createCheck({}, db);
  const yesterdayIso = new Date(now - 25 * 3600 * 1000).toISOString();
  db.prepare(`UPDATE checks SET expires_at = ? WHERE id = ?`).run(yesterdayIso, expiredCheck.id);

  // Save feedback referencing expired check
  saveFeedback(
    {
      checkId: expiredCheck.id,
      verdict: "right",
      riskLevelShown: "high",
      comment: "Accurate assessment",
    },
    db
  );

  // Add graph node and edge
  const nodeA = upsertGraphNode({ kind: "domain", value: "scam-portal.com" }, db);
  const nodeB = upsertGraphNode({ kind: "upi", value: "scam@upi" }, db);
  addGraphEdge({ nodeA: nodeA.id, nodeB: nodeB.id, checkRef: expiredCheck.id }, db);

  const res = await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    now: () => now,
  });

  assert.equal(res.checksDeleted, 1);

  // Feedback row survives, check_id set to null via foreign key ON DELETE SET NULL
  const fbRow = db.prepare(`SELECT * FROM feedback`).get();
  assert.ok(fbRow);
  assert.equal(fbRow.check_id, null);
  assert.equal(fbRow.verdict, "right");

  // Graph nodes and edges survive
  const nodes = db.prepare(`SELECT * FROM graph_nodes`).all();
  const edges = db.prepare(`SELECT * FROM graph_edges`).all();
  assert.equal(nodes.length, 2);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].check_ref, expiredCheck.id);
});

test("cleanup: cache purge respects TTL", async () => {
  const db = resetTestEnv();
  const now = Date.now();

  // Expired cache entry (1 second TTL, fetched in past)
  cacheSet("expired_entry", { val: 1 }, 1, db);
  db.prepare(`UPDATE lookup_cache SET fetched_at = fetched_at - 100 WHERE key = 'expired_entry'`).run();

  // Fresh cache entry (1000 seconds TTL)
  cacheSet("fresh_entry", { val: 2 }, 1000, db);

  const res = await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    now: () => now,
  });

  assert.equal(res.cacheRowsPurged, 1);
  const expired = db.prepare(`SELECT * FROM lookup_cache WHERE key = 'expired_entry'`).get();
  const fresh = db.prepare(`SELECT * FROM lookup_cache WHERE key = 'fresh_entry'`).get();

  assert.equal(expired, undefined);
  assert.ok(fresh);
});

test("cleanup: orphan image removed, referenced recent image kept", async () => {
  const db = resetTestEnv();
  const now = Date.now();

  // Create an orphan file in uploadDir
  const orphanFile = path.join(TEST_UPLOADS, "orphan.png");
  fs.writeFileSync(orphanFile, "dummy-orphan-content");

  // Create a referenced recent file in uploadDir
  const check = createCheck({}, db);
  const recentFile = path.join(TEST_UPLOADS, "recent.png");
  fs.writeFileSync(recentFile, "dummy-recent-content");

  saveInputs(
    check.id,
    [
      {
        type: "image",
        filePath: recentFile,
        mimeType: "image/png",
        sizeBytes: 20,
        createdAt: new Date(now - 10 * 60 * 1000).toISOString(), // 10 minutes old (< 1 hour)
      },
    ],
    db
  );

  const res = await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    now: () => now,
  });

  assert.equal(res.filesDeleted, 1);
  assert.equal(fs.existsSync(orphanFile), false);
  assert.equal(fs.existsSync(recentFile), true);
});

test("cleanup: old referenced image removed and file_path cleared in DB", async () => {
  const db = resetTestEnv();
  const now = Date.now();

  const check = createCheck({}, db);
  const oldFile = path.join(TEST_UPLOADS, "old.png");
  fs.writeFileSync(oldFile, "dummy-old-content");

  saveInputs(
    check.id,
    [
      {
        type: "image",
        filePath: oldFile,
        mimeType: "image/png",
        sizeBytes: 20,
        createdAt: new Date(now - (MAX_IMAGE_AGE_MS + 5000)).toISOString(), // > 1 hour old
      },
    ],
    db
  );

  const res = await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    now: () => now,
  });

  assert.equal(res.filesDeleted, 1);
  assert.equal(fs.existsSync(oldFile), false);

  // Verify file_path is cleared in check_inputs
  const row = db.prepare(`SELECT file_path FROM check_inputs WHERE check_id = ?`).get(check.id);
  assert.equal(row.file_path, null);
});

test("cleanup: path traversal and absolute path outside upload directory are refused", async () => {
  const db = resetTestEnv();
  const outsideFile = "./test_outside_escape.png";
  fs.writeFileSync(outsideFile, "outside-content");

  try {
    const res = await runCleanup({
      db,
      uploadDir: TEST_UPLOADS,
      listFiles: () => ["../test_outside_escape.png"],
    });

    assert.ok(res.errors.includes("PATH_TRAVERSAL_REFUSED"));
    assert.equal(fs.existsSync(outsideFile), true);
  } finally {
    if (fs.existsSync(outsideFile)) fs.unlinkSync(outsideFile);
  }
});

test("cleanup: symlink pointing outside upload directory is refused", async () => {
  const db = resetTestEnv();
  const outsideTarget = "./test_symlink_target.png";
  fs.writeFileSync(outsideTarget, "target-content");
  const symlinkPath = path.join(TEST_UPLOADS, "symlink.png");

  try {
    fs.symlinkSync(path.resolve(outsideTarget), symlinkPath);

    const res = await runCleanup({
      db,
      uploadDir: TEST_UPLOADS,
    });

    assert.ok(res.errors.includes("SYMLINK_ESCAPE_REFUSED"));
    assert.equal(fs.existsSync(outsideTarget), true);
  } finally {
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    if (fs.existsSync(outsideTarget)) fs.unlinkSync(outsideTarget);
  }
});

test("cleanup: failing unlink does not abort other cleanup steps", async () => {
  const db = resetTestEnv();
  const orphan = path.join(TEST_UPLOADS, "failing_orphan.png");
  fs.writeFileSync(orphan, "failing");

  const res = await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    unlink: () => {
      throw new Error("EPERM: Permission denied");
    },
  });

  assert.ok(res.errors.includes("UNLINK_FAILED"));
  assert.equal(res.checksDeleted, 0);
  assert.equal(res.cacheRowsPurged, 0);
});

test("cleanup: running twice in a row is idempotent and safe", async () => {
  const db = resetTestEnv();
  const res1 = await runCleanup({ db, uploadDir: TEST_UPLOADS });
  const res2 = await runCleanup({ db, uploadDir: TEST_UPLOADS });

  assert.deepEqual(res2, {
    checksDeleted: 0,
    cacheRowsPurged: 0,
    filesDeleted: 0,
    staleChecksRecovered: 0,
    staleCrawlsRecovered: 0,
    errors: [],
  });
});

test("cleanup: stale-check sweep moves investigating/scoring checks older than 10m to failed and emits event", async () => {
  const db = resetTestEnv();
  const now = Date.now();

  // 1. Check stuck in investigating for 15 minutes
  const stuckInvestigating = createCheck({ language: "en" }, db);
  updateStatus(stuckInvestigating.id, "extracting", db);
  updateStatus(stuckInvestigating.id, "awaiting_confirmation", db);
  updateStatus(stuckInvestigating.id, "investigating", db);
  const fifteenMinsAgo = new Date(now - 15 * 60 * 1000).toISOString();
  db.prepare(`UPDATE checks SET updated_at = ? WHERE id = ?`).run(fifteenMinsAgo, stuckInvestigating.id);

  // 2. Check stuck in scoring for 12 minutes
  const stuckScoring = createCheck({ language: "en" }, db);
  updateStatus(stuckScoring.id, "extracting", db);
  updateStatus(stuckScoring.id, "awaiting_confirmation", db);
  updateStatus(stuckScoring.id, "investigating", db);
  updateStatus(stuckScoring.id, "scoring", db);
  const twelveMinsAgo = new Date(now - 12 * 60 * 1000).toISOString();
  db.prepare(`UPDATE checks SET updated_at = ? WHERE id = ?`).run(twelveMinsAgo, stuckScoring.id);

  // 3. Fresh check in investigating (3 minutes ago) - should NOT be failed
  const freshInvestigating = createCheck({ language: "en" }, db);
  updateStatus(freshInvestigating.id, "extracting", db);
  updateStatus(freshInvestigating.id, "awaiting_confirmation", db);
  updateStatus(freshInvestigating.id, "investigating", db);
  const threeMinsAgo = new Date(now - 3 * 60 * 1000).toISOString();
  db.prepare(`UPDATE checks SET updated_at = ? WHERE id = ?`).run(threeMinsAgo, freshInvestigating.id);

  // 4. Check in awaiting_confirmation (15 minutes ago) - should NOT be failed by stale check sweep
  const oldAwaiting = createCheck({ language: "en" }, db);
  updateStatus(oldAwaiting.id, "extracting", db);
  updateStatus(oldAwaiting.id, "awaiting_confirmation", db);
  db.prepare(`UPDATE checks SET updated_at = ? WHERE id = ?`).run(fifteenMinsAgo, oldAwaiting.id);

  // Run cleanup with now
  const res = await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    now: () => now,
  });

  assert.equal(res.staleChecksRecovered, 2, "Must recover exactly the 2 stuck checks");

  // Verify stuck investigating moved to failed with coordinator_pipeline_error
  const check1 = db.prepare(`SELECT * FROM checks WHERE id = ?`).get(stuckInvestigating.id);
  assert.equal(check1.status, "failed");
  assert.equal(check1.failure_reason, "coordinator_pipeline_error");

  // Verify check_events emitted for check1
  const events1 = db.prepare(`SELECT * FROM check_events WHERE check_id = ? ORDER BY seq ASC`).all(stuckInvestigating.id);
  assert.ok(events1.length >= 1, "Must emit at least one check_event");
  const lastEvent1 = events1[events1.length - 1];
  assert.equal(lastEvent1.status, "could_not_check");
  const payload1 = JSON.parse(lastEvent1.payload_json);
  assert.equal(payload1.checkId, stuckInvestigating.id);
  assert.ok(payload1.summary.includes("10 minutes"));

  // Verify stuck scoring moved to failed with coordinator_pipeline_error
  const check2 = db.prepare(`SELECT * FROM checks WHERE id = ?`).get(stuckScoring.id);
  assert.equal(check2.status, "failed");
  assert.equal(check2.failure_reason, "coordinator_pipeline_error");

  // Verify fresh check and awaiting check remain untouched
  const check3 = db.prepare(`SELECT * FROM checks WHERE id = ?`).get(freshInvestigating.id);
  assert.equal(check3.status, "investigating");

  const check4 = db.prepare(`SELECT * FROM checks WHERE id = ?`).get(oldAwaiting.id);
  assert.equal(check4.status, "awaiting_confirmation");
});

test("cleanup: logs and errors contain no user text or raw file contents", async () => {
  const db = resetTestEnv();
  const logged = [];
  const fakeLogger = {
    error: (entry) => logged.push(entry),
    warn: (entry) => logged.push(entry),
    info: (entry) => logged.push(entry),
  };

  await runCleanup({
    db,
    uploadDir: TEST_UPLOADS,
    logger: fakeLogger,
  });

  for (const entry of logged) {
    const serialized = JSON.stringify(entry);
    assert.equal(serialized.includes("dummy"), false);
    assert.equal(serialized.includes("secret"), false);
  }
});
