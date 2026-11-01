/**
 * tests/graph.test.js
 *
 * Offline unit tests for lib/graph.js and scripts/seedGraph.js:
 * - Upsert node with normalization
 * - Pairwise linking with canonical ordering and self-loop rejection
 * - Lookup returning GraphMatch contract
 * - Write policy refusals (consent === false, riskLevel !== "high")
 * - Disallowed kinds rejection
 * - Idempotent seeding from seed-graph.json without double-incrementing report_count
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";
import {
  upsertNode,
  link,
  lookup,
  recordReport,
  normalizeGraphValue,
  computeCheckRef,
} from "../lib/graph.js";
import { seedGraph } from "../scripts/seedGraph.js";
import { GraphMatchSchema } from "../lib/contracts/graph.js";

describe("lib/graph.js", () => {
  let db;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  test("normalizeGraphValue normalizes domains, upi, handles, and phones", () => {
    assert.equal(normalizeGraphValue("domain", "HTTP://WWW.SCAM-PORTAL.COM/path"), "scam-portal.com");
    assert.equal(normalizeGraphValue("upi", "  User@OkHdfcBank  "), "user@okhdfcbank");
    assert.equal(normalizeGraphValue("handle", "  @TelegramScammer  "), "telegramscammer");
    assert.equal(normalizeGraphValue("company", "  Fake   Company   Pvt  Ltd  "), "Fake Company Pvt Ltd");
    assert.equal(normalizeGraphValue("phone", "+91 98765 43210"), "+919876543210");
    assert.equal(normalizeGraphValue("amount", "5000"), null); // Disallowed kind
  });

  test("upsertNode inserts node and increments reportCount on conflict", () => {
    const node1 = upsertNode("upi", "scam@okaxis", { db });
    assert.equal(node1.id, 1);
    assert.equal(node1.value, "scam@okaxis");
    assert.equal(node1.reportCount, 1);

    const node2 = upsertNode("upi", "SCAM@OKAXIS", { db });
    assert.equal(node2.id, 1);
    assert.equal(node2.reportCount, 2);
  });

  test("link creates pairwise edges with canonical ordering nodeA < nodeB", () => {
    const n1 = upsertNode("upi", "u1@bank", { db });
    const n2 = upsertNode("domain", "d1.com", { db });
    const n3 = upsertNode("phone", "+919999988888", { db });

    const edges = link([n3.id, n1.id, n2.id], "check-ref-123", { db });
    assert.equal(edges.length, 3);

    for (const edge of edges) {
      assert.ok(edge.nodeA < edge.nodeB, `Canonical ordering violated: ${edge.nodeA} >= ${edge.nodeB}`);
      assert.equal(edge.checkRef, "check-ref-123");
    }

    // Linking single or duplicate node returns empty array
    assert.deepEqual(link([n1.id], "ref", { db }), []);
    assert.deepEqual(link([n1.id, n1.id], "ref", { db }), []);
  });

  test("lookup returns valid GraphMatch shape with matched: true and connected count", () => {
    const n1 = upsertNode("upi", "scam@paytm", { db });
    const n2 = upsertNode("domain", "scam-jobs.com", { db });
    link([n1.id, n2.id], "ref-abc", { db });

    const match = lookup("upi", "SCAM@PAYTM", { db });
    assert.equal(match.matched, true);
    assert.equal(match.nodeId, n1.id);
    assert.equal(match.value, "scam@paytm");
    assert.equal(match.connectedNodesCount, 1);

    // Validate with zod schema
    assert.doesNotThrow(() => GraphMatchSchema.parse(match));

    // Lookup non-existent
    const noMatch = lookup("upi", "clean@bank", { db });
    assert.equal(noMatch.matched, false);
    assert.doesNotThrow(() => GraphMatchSchema.parse(noMatch));
  });

  test("write policy: recordReport refuses non-high risk or missing consent", () => {
    const validIdentifiers = [
      { kind: "upi", value: "scam@okaxis" },
      { kind: "domain", value: "scam.com" },
    ];

    // Missing consent
    const resNoConsent = recordReport({
      checkId: "check-1",
      riskLevel: "high",
      consent: false,
      identifiers: validIdentifiers,
    }, { db });
    assert.equal(resNoConsent.recorded, false);
    assert.ok(resNoConsent.reason.includes("consent is required"));

    // Risk level is medium
    const resMedium = recordReport({
      checkId: "check-2",
      riskLevel: "medium",
      consent: true,
      identifiers: validIdentifiers,
    }, { db });
    assert.equal(resMedium.recorded, false);
    assert.ok(resMedium.reason.includes("Only 'high' risk"));

    // Valid report succeeds atomically
    const resOk = recordReport({
      checkId: "check-3",
      riskLevel: "high",
      consent: true,
      identifiers: validIdentifiers,
    }, { db });
    assert.equal(resOk.recorded, true);
    assert.equal(resOk.nodeIds.length, 2);
    assert.equal(resOk.edgeCount, 1);
  });

  test("seedGraph is idempotent and does not double-increment reportCount on second run", () => {
    const firstRun = seedGraph(db);
    assert.ok(firstRun.seededCount > 0);

    const matchBefore = lookup("domain", "fake-scholarship-portal.com", { db });
    assert.equal(matchBefore.matched, true);
    const countBefore = matchBefore.reportCount;

    // Second run must skip
    const secondRun = seedGraph(db);
    assert.equal(secondRun.seededCount, 0);
    assert.equal(secondRun.skippedCount, firstRun.seededCount);

    const matchAfter = lookup("domain", "fake-scholarship-portal.com", { db });
    assert.equal(matchAfter.reportCount, countBefore);
  });
});
