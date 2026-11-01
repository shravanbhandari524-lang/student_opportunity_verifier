import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";
import { createCheck, updateStatus, getCheck } from "../lib/db/index.js";
import { createJobRunner, recoverStaleChecks } from "../lib/api/jobs.js";

const TEST_DIR = path.resolve("./data/test_jobs");

function setupTestDb() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
  const db = new Database(path.join(TEST_DIR, "test.db"));
  runMigrations(db);
  return db;
}

describe("lib/api/jobs.js", () => {
  let db;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("createJobRunner tracks concurrent jobs and enforces maxConcurrent with 503", async () => {
    const runner = createJobRunner({ maxConcurrent: 2 });
    let release1, release2;
    const task1 = new Promise((resolve) => { release1 = resolve; });
    const task2 = new Promise((resolve) => { release2 = resolve; });

    const p1 = runner.run("check-1", () => task1);
    const p2 = runner.run("check-2", () => task2);

    assert.equal(runner.activeCount(), 2);
    assert.equal(runner.isActive("check-1"), true);
    assert.equal(runner.isActive("check-2"), true);

    // 3rd concurrent task is rejected with 503 SERVICE_UNAVAILABLE
    await assert.rejects(
      () => runner.run("check-3", async () => {}),
      (err) => err.code === "SERVICE_UNAVAILABLE" && err.status === 503
    );

    // Release task1
    release1();
    await p1;
    assert.equal(runner.activeCount(), 1);

    // Release task2
    release2();
    await p2;
    assert.equal(runner.activeCount(), 0);
  });

  it("recoverStaleChecks marks stalled intermediate checks as failed", () => {
    const check1 = createCheck({}, db);
    const check2 = createCheck({}, db);
    const check3 = createCheck({}, db);

    // Transition checks
    updateStatus(check1.id, "extracting", db);
    updateStatus(check2.id, "extracting", db);
    updateStatus(check2.id, "awaiting_confirmation", db);
    updateStatus(check2.id, "investigating", db);
    // check3 stays created

    // Set updated_at back in time to simulate crash
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare(`UPDATE checks SET updated_at = ? WHERE id IN (?, ?)`).run(tenMinutesAgo, check1.id, check2.id);

    const result = recoverStaleChecks({
      db,
      maxAgeMs: 5 * 60 * 1000,
      logger: { warn: () => {}, error: () => {} },
    });

    assert.equal(result.recoveredCount, 2);
    assert.ok(result.checkIds.includes(check1.id));
    assert.ok(result.checkIds.includes(check2.id));

    // Verify DB status is now failed
    assert.equal(getCheck(check1.id, db).status, "failed");
    assert.equal(getCheck(check2.id, db).status, "failed");
    assert.equal(getCheck(check3.id, db).status, "created");
  });
});
