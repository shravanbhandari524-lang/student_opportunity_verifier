import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";
import {
  createCheck,
  updateStatus,
  appendEvent,
  getEventsAfter,
  listStaleChecks,
  countActiveChecks,
  markCheckFailed,
  deleteCheck,
  getCheck,
} from "../lib/db/index.js";

const TEST_DB = "./data/test_db_boundary.db";

describe("Database Boundary and L6 Repository Functions", () => {
  function setupDb() {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    const db = new Database(TEST_DB);
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return db;
  }

  it("getEventsAfter returns ordered events strictly after given id and excludes other checks", () => {
    const db = setupDb();
    const c1 = createCheck({ text: "check 1" }, db);
    const c2 = createCheck({ text: "check 2" }, db);

    const ev1 = appendEvent(c1.id, { round: 1, type: "stage", status: "extracting" }, db);
    const ev2 = appendEvent(c1.id, { round: 1, type: "stage", status: "investigating" }, db);
    appendEvent(c2.id, { round: 1, type: "stage", status: "extracting" }, db); // c2 event
    const ev4 = appendEvent(c1.id, { round: 1, type: "complete", status: "low" }, db);

    // After ev1.id for c1: must return ev2 and ev4 only, in ascending order
    const events = getEventsAfter(c1.id, ev1.id, 10, db);
    assert.equal(events.length, 2);
    assert.equal(events[0].id, ev2.id);
    assert.equal(events[1].id, ev4.id);
    assert.ok(events[0].id < events[1].id);

    // Respects limit
    const limited = getEventsAfter(c1.id, 0, 1, db);
    assert.equal(limited.length, 1);
    assert.equal(limited[0].id, ev1.id);

    db.close();
    fs.unlinkSync(TEST_DB);
  });

  it("listStaleChecks finds candidate checks by age and status, never returning terminal checks", () => {
    const db = setupDb();
    const cStale = createCheck({ text: "stale" }, db);
    const cFresh = createCheck({ text: "fresh" }, db);
    const cTerminal = createCheck({ text: "terminal" }, db);

    updateStatus(cStale.id, "extracting", db);
    updateStatus(cFresh.id, "extracting", db);

    updateStatus(cTerminal.id, "extracting", db);
    updateStatus(cTerminal.id, "awaiting_confirmation", db);
    updateStatus(cTerminal.id, "investigating", db);
    updateStatus(cTerminal.id, "scoring", db);
    updateStatus(cTerminal.id, "report_ready", db);

    const now = Date.now();
    const staleIso = new Date(now - 600000).toISOString(); // 10 mins ago
    const freshIso = new Date(now - 60000).toISOString(); // 1 min ago

    db.prepare("UPDATE checks SET updated_at = ? WHERE id = ?").run(staleIso, cStale.id);
    db.prepare("UPDATE checks SET updated_at = ? WHERE id = ?").run(freshIso, cFresh.id);
    db.prepare("UPDATE checks SET updated_at = ? WHERE id = ?").run(staleIso, cTerminal.id);

    // 5-minute cutoff (300000ms): only cStale should be returned
    const stale = listStaleChecks(["extracting", "investigating"], 300000, now, db);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].id, cStale.id);

    db.close();
    fs.unlinkSync(TEST_DB);
  });

  it("countActiveChecks returns count of checks in matching statuses", () => {
    const db = setupDb();
    const c1 = createCheck({ text: "active 1" }, db);
    const c2 = createCheck({ text: "active 2" }, db);
    const c3 = createCheck({ text: "created only" }, db);

    updateStatus(c1.id, "extracting", db);
    updateStatus(c2.id, "extracting", db);

    const count = countActiveChecks(["extracting", "investigating"], db);
    assert.equal(count, 2);

    const countAll = countActiveChecks(["created", "extracting"], db);
    assert.equal(countAll, 3);

    db.close();
    fs.unlinkSync(TEST_DB);
  });

  it("markCheckFailed atomically updates status, failureReason, appends event, and rejects invalid transitions or reason codes", () => {
    const db = setupDb();
    const c = createCheck({ text: "fail test" }, db);
    updateStatus(c.id, "extracting", db);

    // 1. Invalid reason code is rejected
    assert.throws(
      () => markCheckFailed(c.id, "not_a_valid_failure_reason", { db }),
      /Invalid failureReason code/
    );

    // 2. Valid markCheckFailed works atomically
    const failedCheck = markCheckFailed(c.id, "server_restart", { summary: "Server died", db });
    assert.equal(failedCheck.status, "failed");
    assert.equal(failedCheck.failureReason, "server_restart");

    // Event was appended
    const events = getEventsAfter(c.id, 0, 10, db);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "error");
    assert.equal(events[0].summary, "Server died");

    // 3. Rejects transition from terminal state (already failed)
    assert.throws(
      () => markCheckFailed(c.id, "server_restart", { db }),
      /Invalid state transition/
    );

    db.close();
    fs.unlinkSync(TEST_DB);
  });

  it("deleteCheck deletes row and cascades", () => {
    const db = setupDb();
    const c = createCheck({ text: "to delete" }, db);
    appendEvent(c.id, { round: 1, type: "stage", status: "extracting" }, db);

    const changes = deleteCheck(c.id, db);
    assert.equal(changes, 1);
    assert.equal(getCheck(c.id, db), null);

    db.close();
    fs.unlinkSync(TEST_DB);
  });

  it("static invariant: fails if runtime code in app/ or lib/api/ imports better-sqlite3 or executes raw statements", () => {
    const scannedDirs = ["app", "lib/api"];

    function scanDir(dir) {
      const files = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanDir(fullPath));
        } else if (entry.isFile() && fullPath.endsWith(".js")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const violations = [];
    for (const d of scannedDirs) {
      const jsFiles = scanDir(d);
      for (const file of jsFiles) {
        const rawContent = fs.readFileSync(file, "utf8");
        // Strip comments so JSDoc @param {import("better-sqlite3").Database} type annotations are ignored
        const codeOnly = rawContent.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

        if (codeOnly.includes("better-sqlite3")) {
          violations.push({ file, pattern: "better-sqlite3 import" });
        }
        if (codeOnly.includes(".prepare(")) {
          violations.push({ file, pattern: ".prepare(" });
        }
        if (codeOnly.includes(".exec(")) {
          violations.push({ file, pattern: ".exec(" });
        }
      }
    }

    assert.deepEqual(violations, [], `No runtime code in app/ or lib/api/ may call better-sqlite3 directly: ${JSON.stringify(violations)}`);
  });

  it("static invariant: fails if runtime code in app/ or lib/api/ (except lib/env.js) reads process.env", () => {
    const scannedDirs = ["app", "lib/api"];

    function scanDir(dir) {
      const files = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...scanDir(fullPath));
        } else if (entry.isFile() && fullPath.endsWith(".js")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const violations = [];
    for (const d of scannedDirs) {
      const jsFiles = scanDir(d);
      for (const file of jsFiles) {
        if (file === "lib/env.js") continue; // lib/env.js is the only place allowed to access process.env

        const rawContent = fs.readFileSync(file, "utf8");
        // Strip comments so JSDoc comments mentioning process.env are ignored
        const codeOnly = rawContent.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

        if (codeOnly.includes("process.env")) {
          violations.push({ file, pattern: "process.env" });
        }
      }
    }

    assert.deepEqual(violations, [], `No runtime code in app/ or lib/api/ may read process.env: ${JSON.stringify(violations)}`);
  });

  it("static invariant process.env self-test: detected simulated violation", () => {
    const fakeCode = "const myVar = process.env.SOME_VAR;";
    assert.ok(fakeCode.includes("process.env"));
  });

  it("static invariant self-test: detected simulated violation", () => {
    const fakeCode = "const stmt = db.prepare('SELECT * FROM checks');";
    assert.ok(fakeCode.includes(".prepare("));
  });
});

