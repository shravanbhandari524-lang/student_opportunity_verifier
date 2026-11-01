import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  getDb,
  createCheck,
  getCheck,
  updateStatus,
  updateCheckResult,
  saveInputs,
  getInputs,
  replaceEntities,
  getEntities,
  saveAgentResult,
  DuplicateAgentResultError,
  getAgentResults,
  appendEvent,
  getEvents,
  saveReport,
  getReport,
  saveFeedback,
  upsertGraphNode,
  addGraphEdge,
  deleteExpired,
  purgeCache,
} from "../lib/db/index.js";
import { cacheSet } from "../lib/cache.js";
import { getCaseFile, renderMarkdown } from "../lib/caseFile.js";

const TEST_DB = "./data/test_db_repositories.db";
const TEST_UPLOADS = "./test_uploads";

function resetDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_UPLOADS)) {
    fs.rmSync(TEST_UPLOADS, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_UPLOADS, { recursive: true });
  return getDb(TEST_DB);
}

test("Repositories: Check lifecycle, updates, and state transitions", () => {
  const db = resetDb();

  // Create check
  const check = createCheck({ language: "en" }, db);
  assert.ok(check.id);
  assert.equal(check.status, "created");
  assert.equal(check.currentRound, 0);
  assert.equal(check.language, "en");
  assert.equal(check.riskLevel, null);
  assert.equal(check.score, null);
  assert.equal(check.confidence, null);

  // Update status
  const extracting = updateStatus(check.id, "extracting", db);
  assert.equal(extracting.status, "extracting");

  // Invalid transition throws
  assert.throws(() => updateStatus(check.id, "scoring", db), /Invalid state transition/);

  // Update check results
  const updated = updateCheckResult(
    check.id,
    {
      currentRound: 1,
      status: "awaiting_confirmation",
    },
    db
  );
  assert.equal(updated.currentRound, 1);
  assert.equal(updated.status, "awaiting_confirmation");

  // Bad score constraint (score must be 0..100)
  assert.throws(
    () => updateCheckResult(check.id, { score: 150 }, db),
    /Number must be less than or equal to 100/
  );
});

test("Repositories: saveInputs and getInputs round-trip with transaction", () => {
  const db = resetDb();
  const check = createCheck({}, db);

  const inputs = [
    {
      type: "text",
      value: "Suspicious scholarship offer",
    },
    {
      type: "image",
      filePath: "uploads/screenshot1.png",
      mimeType: "image/png",
      sizeBytes: 1024,
    },
    {
      type: "upi",
      value: "scam@upi",
    },
  ];

  const saved = saveInputs(check.id, inputs, db);
  assert.equal(saved.length, 3);
  assert.equal(saved[0].type, "text");
  assert.equal(saved[0].value, "Suspicious scholarship offer");
  assert.equal(saved[1].type, "image");
  assert.equal(saved[1].sizeBytes, 1024);

  // Query back
  const queried = getInputs(check.id, db);
  assert.equal(queried.length, 3);
  assert.equal(queried[2].value, "scam@upi");

  // Transaction rollback on bad input row
  assert.throws(() => {
    saveInputs(
      check.id,
      [
        { type: "text", value: "ok" },
        { type: "invalid_type", value: "fail" },
      ],
      db
    );
  });
  // Verify previous inputs were not disturbed
  assert.equal(getInputs(check.id, db).length, 3);
});

test("Repositories: replaceEntities and getEntities round-trip", () => {
  const db = resetDb();
  const check = createCheck({}, db);

  const entities = [
    {
      kind: "domain",
      value: "scholarship-fake.org",
      source: "extracted",
      round: 0,
      confirmed: true,
    },
    {
      kind: "upi",
      value: "payfee@okaxis",
      source: "user",
      round: 0,
      confirmed: true,
    },
    {
      kind: "company",
      value: "Target Corp",
      source: "discovered",
      discoveredBy: "website_forensics",
      round: 1,
      confirmed: false,
      evidence: {
        type: "url",
        value: "https://scholarship-fake.org/about",
      },
    },
  ];

  const saved = replaceEntities(check.id, entities, db);
  assert.equal(saved.length, 3);
  assert.equal(saved[2].kind, "company");
  assert.equal(saved[2].evidence.value, "https://scholarship-fake.org/about");

  // Query back
  const queried = getEntities(check.id, db);
  assert.equal(queried.length, 3);
  assert.equal(queried[0].value, "scholarship-fake.org");
  assert.equal(queried[1].value, "payfee@okaxis");
  assert.equal(queried[2].discoveredBy, "website_forensics");

  // Test atomic replacement: replace with 1 entity
  replaceEntities(
    check.id,
    [
      {
        kind: "phone",
        value: "+919876543210",
        source: "user",
        round: 0,
        confirmed: true,
      },
    ],
    db
  );
  const replaced = getEntities(check.id, db);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].kind, "phone");
  assert.equal(replaced[0].value, "+919876543210");
});

test("Repositories: saveAgentResult and getAgentResults with JSON parsing and constraint checks", () => {
  const db = resetDb();
  const check = createCheck({}, db);

  const agentResult = {
    agent: "website_forensics",
    round: 1,
    kind: "agent",
    status: "ok",
    flags: [
      {
        id: "lookalike_domain",
        title: "Domain resembles well-known brand",
        severity: "high",
        explanation: "Domain spoofing attempt detected",
        evidence: [{ type: "quote", value: "Lookalike domain: brand-fake.com" }],
      },
    ],
    verified: ["Domain registered yesterday"],
    newEntities: [
      {
        kind: "domain",
        value: "linked-partner.com",
        evidence: { type: "url", value: "https://brand-fake.com/partner" },
      },
    ],
    processedEntities: ["domain:brand-fake.com"],
    unchecked: [],
    manualChecks: [
      {
        label: "Check registrar",
        url: "https://whois.icann.org",
      },
    ],
    notes: "Analysis complete",
    durationMs: 450,
  };

  const saved = saveAgentResult(check.id, agentResult, db);
  assert.equal(saved.agent, "website_forensics");
  assert.equal(saved.flags.length, 1);
  assert.equal(saved.flags[0].id, "lookalike_domain");
  assert.equal(saved.newEntities.length, 1);
  assert.equal(saved.manualChecks.length, 1);

  // Query back
  // Duplicate result for same (checkId, agent, round) must throw DuplicateAgentResultError
  const duplicateAttempt = {
    ...agentResult,
    durationMs: 999,
    notes: "Attempted overwrite should fail",
  };

  assert.throws(
    () => saveAgentResult(check.id, duplicateAttempt, db),
    DuplicateAgentResultError
  );

  // Verify the first result remains unchanged
  const unchangedResults = getAgentResults(check.id, db);
  assert.equal(unchangedResults.length, 1);
  assert.equal(unchangedResults[0].durationMs, 450);
  assert.equal(unchangedResults[0].notes, "Analysis complete");
});

test("Repositories: appendEvent and getEvents ordering", () => {
  const db = resetDb();
  const check = createCheck({}, db);

  appendEvent(
    check.id,
    {
      round: 1,
      type: "round",
      status: "started",
      summary: "Round 1 started",
    },
    db
  );

  appendEvent(
    check.id,
    {
      round: 1,
      type: "agent",
      agent: "message_analyst",
      status: "completed",
      summary: "Message analysis completed",
    },
    db
  );

  const events = getEvents(check.id, db);
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "round");
  assert.equal(events[1].agent, "message_analyst");
});

test("Repositories: saveReport and getReport validation", () => {
  const db = resetDb();
  const check = createCheck({}, db);

  const report = {
    checkId: check.id,
    riskLevel: "high",
    score: 85,
    confidence: "high",
    scamTypeGuess: "scholarship",
    language: "en",
    summary: "Clear scholarship scam with upfront fee request",
    flags: [
      {
        id: "scholarship_fee_demand",
        title: "Upfront registration fee requested",
        severity: "high",
        explanation: "Candidate asked to pay 500 INR processing fee",
        evidence: [{ type: "quote", value: "Pay 500 INR registration fee" }],
      },
    ],
    verified: ["UPI ID linked to multiple fraud complaints"],
    couldNotCheck: [],
    notApplicable: [],
    checklist: [
      {
        text: "Official portal does not charge applicants",
        url: "https://scholarships.gov.in",
      },
    ],
    actions: [
      { id: "college_email", label: "Email authority" },
    ],
    disclaimer: "This report is an automated risk assessment based on public facts and does not constitute a legal verdict.",
    generatedAt: new Date().toISOString(),
  };

  const saved = saveReport(check.id, report, db);
  assert.equal(saved.riskLevel, "high");
  assert.equal(saved.flags.length, 1);
  assert.equal(saved.score, 85);

  const retrieved = getReport(check.id, db);
  assert.equal(retrieved.checkId, check.id);
  assert.equal(retrieved.checklist[0].text, "Official portal does not charge applicants");
});

test("Repositories: upsertGraphNode enforces uniqueness on (kind, value) and increments report_count", () => {
  const db = resetDb();

  const node1 = upsertGraphNode({ kind: "upi", value: "scam@okhdfc" }, db);
  assert.ok(node1.id);
  assert.equal(node1.kind, "upi");
  assert.equal(node1.value, "scam@okhdfc");
  assert.equal(node1.reportCount, 1);
  const firstSeen = node1.firstSeen;

  // Insert again with identical (kind, value)
  const node1Updated = upsertGraphNode({ kind: "upi", value: "scam@okhdfc" }, db);
  assert.equal(node1Updated.id, node1.id);
  assert.equal(node1Updated.reportCount, 2);
  assert.equal(node1Updated.firstSeen, firstSeen);

  // Third time increment
  const node1Third = upsertGraphNode({ kind: "upi", value: "scam@okhdfc" }, db);
  assert.equal(node1Third.id, node1.id);
  assert.equal(node1Third.reportCount, 3);

  // Different kind with same value is separate node
  const domainNode = upsertGraphNode({ kind: "domain", value: "scam@okhdfc" }, db);
  assert.notEqual(domainNode.id, node1.id);
  assert.equal(domainNode.reportCount, 1);

  // Verify total rows in table
  const count = db.prepare(`SELECT count(*) as count FROM graph_nodes`).get().count;
  assert.equal(count, 2);
});

test("Repositories: addGraphEdge enforces node_a < node_b ordering and edge survives check deletion", () => {
  const db = resetDb();
  const check = createCheck({}, db);

  const nodeA = upsertGraphNode({ kind: "upi", value: "fraud@okaxis" }, db);
  const nodeB = upsertGraphNode({ kind: "domain", value: "fraud-portal.com" }, db);

  // Ensure nodeA and nodeB have distinct integer IDs
  const lowerId = Math.min(nodeA.id, nodeB.id);
  const higherId = Math.max(nodeA.id, nodeB.id);

  // Pass inverted order (nodeA = higherId, nodeB = lowerId)
  const edge = addGraphEdge(
    {
      nodeA: higherId,
      nodeB: lowerId,
      checkRef: check.id,
    },
    db
  );

  assert.ok(edge.id);
  assert.equal(edge.nodeA, lowerId);
  assert.equal(edge.nodeB, higherId);
  assert.equal(edge.checkRef, check.id);
  assert.ok(edge.nodeA < edge.nodeB, "Edge invariant node_a < node_b must hold");

  // Verify stored in DB with node_a < node_b
  const dbRow = db.prepare(`SELECT * FROM graph_edges WHERE id = ?`).get(edge.id);
  assert.equal(dbRow.node_a, lowerId);
  assert.equal(dbRow.node_b, higherId);
  assert.ok(dbRow.node_a < dbRow.node_b);

  // Self-loop is rejected
  assert.throws(
    () => addGraphEdge({ nodeA: lowerId, nodeB: lowerId, checkRef: check.id }, db),
    /Self-loop edges are not allowed/
  );

  // Delete the check
  db.prepare(`DELETE FROM checks WHERE id = ?`).run(check.id);

  // Verify edge survives check deletion (checkRef is opaque string reference)
  const edgeAfterCheckDeletion = db.prepare(`SELECT * FROM graph_edges WHERE id = ?`).get(edge.id);
  assert.ok(edgeAfterCheckDeletion);
  assert.equal(edgeAfterCheckDeletion.check_ref, check.id);
  assert.equal(edgeAfterCheckDeletion.node_a, lowerId);
  assert.equal(edgeAfterCheckDeletion.node_b, higherId);
});

test("Repositories: Feedback and Graph nodes survive check deletion", () => {
  const db = resetDb();
  const check = createCheck({}, db);

  // Save feedback referencing check
  const feedback = saveFeedback(
    {
      checkId: check.id,
      verdict: "right",
      riskLevelShown: "high",
      comment: "Very accurate analysis",
    },
    db
  );
  assert.ok(feedback.id);
  assert.equal(feedback.verdict, "right");

  // Upsert graph node and edge
  const node1 = upsertGraphNode({ kind: "upi", value: "scam@okhdfc" }, db);
  const node2 = upsertGraphNode({ kind: "domain", value: "scamportal.com" }, db);
  const edge = addGraphEdge(
    {
      nodeA: node1.id,
      nodeB: node2.id,
      checkRef: check.id,
    },
    db
  );
  assert.ok(edge.id);

  // Now delete the check directly
  db.prepare(`DELETE FROM checks WHERE id = ?`).run(check.id);

  // Feedback survived with check_id SET NULL
  const fbRow = db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(feedback.id);
  assert.ok(fbRow);
  assert.equal(fbRow.check_id, null);
  assert.equal(fbRow.verdict, "right");

  // Graph nodes survived
  const n1 = db.prepare(`SELECT * FROM graph_nodes WHERE id = ?`).get(node1.id);
  const n2 = db.prepare(`SELECT * FROM graph_nodes WHERE id = ?`).get(node2.id);
  assert.ok(n1);
  assert.ok(n2);

  // Graph edge survived (checkRef is opaque string reference)
  const edgeRow = db.prepare(`SELECT * FROM graph_edges WHERE id = ?`).get(edge.id);
  assert.ok(edgeRow);
  assert.equal(edgeRow.check_ref, check.id);
});

test("Repositories: deleteExpired removes expired checks, cascades children, and cleans uploads safely", () => {
  const db = resetDb();

  // Create an expired check
  const expiredCheck = createCheck({}, db);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE checks SET expires_at = ? WHERE id = ?`).run(yesterday, expiredCheck.id);

  // Create an active check
  const activeCheck = createCheck({}, db);

  // Put a file for expiredCheck inside test_uploads
  const filePath1 = path.join(TEST_UPLOADS, "expired_img.png");
  fs.writeFileSync(filePath1, "dummy-image-content");

  saveInputs(
    expiredCheck.id,
    [
      {
        type: "image",
        filePath: filePath1,
        mimeType: "image/png",
        sizeBytes: 19,
      },
    ],
    db
  );

  // Put a file for activeCheck inside test_uploads
  const filePath2 = path.join(TEST_UPLOADS, "active_img.png");
  fs.writeFileSync(filePath2, "active-image-content");

  saveInputs(
    activeCheck.id,
    [
      {
        type: "image",
        filePath: filePath2,
        mimeType: "image/png",
        sizeBytes: 20,
      },
    ],
    db
  );

  // Run deleteExpired
  const result = deleteExpired(TEST_UPLOADS, db);
  assert.equal(result.deletedCount, 1);
  assert.equal(result.deletedFiles.length, 1);
  assert.equal(fs.existsSync(filePath1), false);
  assert.equal(fs.existsSync(filePath2), true);

  // Verify expired check and cascaded rows are gone
  assert.equal(getCheck(expiredCheck.id, db), null);
  assert.equal(getInputs(expiredCheck.id, db).length, 0);

  // Active check remains
  assert.ok(getCheck(activeCheck.id, db));
  assert.equal(getInputs(activeCheck.id, db).length, 1);

  // Security test: Attempt to delete file outside upload directory throws error
  const outsidePath = path.resolve("./data/should_not_delete.txt");
  fs.writeFileSync(outsidePath, "secret");

  const maliciousCheck = createCheck({}, db);
  db.prepare(`UPDATE checks SET expires_at = ? WHERE id = ?`).run(yesterday, maliciousCheck.id);
  db.prepare(
    `INSERT INTO check_inputs (check_id, type, file_path, created_at) VALUES (?, 'image', ?, ?)`
  ).run(maliciousCheck.id, outsidePath, yesterday);

  assert.throws(
    () => deleteExpired(TEST_UPLOADS, db),
    /Security violation: Attempted to delete file outside upload directory/
  );
  assert.equal(fs.existsSync(outsidePath), true);
  fs.unlinkSync(outsidePath);
});

test("Repositories: purgeCache deletes expired entries from lookup_cache", () => {
  const db = resetDb();
  // set a key with 0 TTL (already expired when fetched_at was in past)
  cacheSet("expired_key", { data: 123 }, 1, db);
  // manually wind back fetched_at to simulate expiration
  db.prepare(`UPDATE lookup_cache SET fetched_at = fetched_at - 100 WHERE key = 'expired_key'`).run();

  // set a key with 1000 TTL
  cacheSet("valid_key", { data: 456 }, 1000, db);

  const purged = purgeCache(db);
  assert.equal(purged, 1);

  const rowExpired = db.prepare(`SELECT * FROM lookup_cache WHERE key = 'expired_key'`).get();
  const rowValid = db.prepare(`SELECT * FROM lookup_cache WHERE key = 'valid_key'`).get();
  assert.equal(rowExpired, undefined);
  assert.ok(rowValid);
});

test("round trip through the repository (save, assemble snapshot, identical classifierResult)", () => {
  const db = resetDb();
  const check = createCheck({}, db);
  db.prepare("UPDATE checks SET current_round = 1 WHERE id = ?").run(check.id);

  const classifierResultData = {
    probability: 0.94,
    label: "suspicious",
    topTerms: ["fee", "deposit"],
    scamType: "scholarship_scam",
  };

  const agentResult = {
    agent: "classifier_client",
    round: 1,
    kind: "check",
    status: "ok",
    flags: [],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    notes: "ML classification completed",
    durationMs: 85,
    classifierResult: classifierResultData,
  };

  const saved = saveAgentResult(check.id, agentResult, db);
  assert.equal(saved.agent, "classifier_client");
  assert.deepEqual(saved.classifierResult, classifierResultData);

  // Assemble snapshot via getCaseFile
  const caseFile = getCaseFile(check.id, db);
  const foundFinding = caseFile.findings.find((f) => f.agent === "classifier_client");
  assert.ok(foundFinding, "classifier_client finding must be present in snapshot");
  assert.deepEqual(foundFinding.classifierResult, classifierResultData);

  // Markdown rendering check (shows classifier probability line only)
  const md = renderMarkdown(caseFile);
  assert.ok(md.includes("- **Classifier Probability:** 0.94"), "Markdown must include classifier probability line");
  assert.equal(md.includes("scholarship_scam"), false, "Markdown must not include scamType or extra fields");
});
