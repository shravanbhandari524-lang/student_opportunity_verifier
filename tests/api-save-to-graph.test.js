import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../lib/db/migrations/index.js";
import { POST as saveToGraphPost } from "../app/api/checks/[id]/save-to-graph/route.js";
import { setRuntimeForTests, resetRuntime, getRuntime } from "../lib/api/runtime.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { saveCheckIdentifiers, lookup, computeCheckRef, filterQualifyingGraphIdentifier } from "../lib/graph.js";
import { replaceEntities, deleteExpired } from "../lib/db/index.js";
import { run as runPaymentEntity } from "../lib/agents/payment-entity.js";

// Ensure mock env vars for testing
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "test-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "test-model";

const TEST_DIR = path.resolve("./.test-save-to-graph-data");

describe("POST /api/checks/:id/save-to-graph and lib/graph.js", () => {
  let db;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    const dbPath = path.join(TEST_DIR, "test-graph.db");
    db = new Database(dbPath);
    runMigrations(db);

    const baseRuntime = getRuntime({ db });
    setRuntimeForTests({
      ...baseRuntime,
      db,
      rateLimiters: {
        ...baseRuntime.rateLimiters,
        actionCheck: createRateLimiter({ windowMs: 60000, max: 100 }),
      },
    });
  });

  afterEach(() => {
    resetRuntime();
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function seedCheck({
    id = "11111111-1111-4111-8111-111111111111",
    status = "report_ready",
    riskLevel = "high",
    score = 85,
    expiresAt = new Date(Date.now() + 86400000).toISOString(),
  } = {}) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO checks (id, status, current_round, language, risk_level, score, confidence, created_at, updated_at, expires_at)
      VALUES (?, ?, 1, 'en', ?, ?, 'high', ?, ?, ?)
    `).run(id, status, riskLevel, score, now, now, expiresAt);
    return id;
  }

  it("rejects missing or false consent with 400 BAD_REQUEST", async () => {
    const checkId = seedCheck();

    // 1. Missing consent
    const req1 = new Request(`http://localhost/api/checks/${checkId}/save-to-graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res1 = await saveToGraphPost(req1, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res1.status, 400);

    // 2. False consent
    const req2 = new Request(`http://localhost/api/checks/${checkId}/save-to-graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: false }),
    });
    const res2 = await saveToGraphPost(req2, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res2.status, 400);
  });

  it("returns 409 STATE_CONFLICT when risk level is not high", async () => {
    const checkIdMedium = seedCheck({
      id: "22222222-2222-4222-8222-222222222222",
      riskLevel: "medium",
    });
    const req = new Request(`http://localhost/api/checks/${checkIdMedium}/save-to-graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true }),
    });
    const res = await saveToGraphPost(req, { params: Promise.resolve({ id: checkIdMedium }) });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "STATE_CONFLICT");
  });

  it("returns 409 STATE_CONFLICT when check status is not report_ready", async () => {
    const statuses = ["created", "extracting", "awaiting_confirmation", "investigating", "scoring", "failed"];
    for (let i = 0; i < statuses.length; i++) {
      const st = statuses[i];
      const checkId = seedCheck({
        id: `33333333-3333-4333-8333-00000000000${i}`,
        status: st,
        riskLevel: "high",
      });
      const req = new Request(`http://localhost/api/checks/${checkId}/save-to-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const res = await saveToGraphPost(req, { params: Promise.resolve({ id: checkId }) });
      assert.equal(res.status, 409, `Expected 409 for status '${st}', got ${res.status}`);
    }
  });

  it("saves qualifying confirmed identifiers and applies exclusion rules", async () => {
    const checkId = seedCheck();

    // Seed entities testing each exclusion rule:
    replaceEntities(
      checkId,
      [
        // 1. Qualifying UPI
        { kind: "upi", value: "scammer@okaxis", source: "user", round: 0, confirmed: true },
        // 2. Qualifying handle
        { kind: "handle", value: "scam_recruiter", source: "user", round: 0, confirmed: true },
        // 3. Qualifying phone
        { kind: "phone", value: "+919876543210", source: "user", round: 0, confirmed: true },
        // 4. Qualifying private scam domain
        { kind: "domain", value: "scam-jobs-portal.xyz", source: "user", round: 0, confirmed: true },
        // Exclusion rule A: Unconfirmed entity
        { kind: "upi", value: "unconfirmed@okhdfc", source: "user", round: 0, confirmed: false },
        // Exclusion rule B: Discovered entity (source === "discovered")
        {
          kind: "domain",
          value: "discovered-host.org",
          source: "discovered",
          round: 1,
          discoveredBy: "website_forensics",
          evidence: { type: "url", value: "https://discovered-host.org" },
          confirmed: true,
        },
        // Exclusion rule C: User company name
        { kind: "company", value: "Acme Corporation", source: "user", round: 0, confirmed: true },
        // Exclusion rule D: Known legitimate domain (ugc.ac.in)
        { kind: "domain", value: "ugc.ac.in", source: "user", round: 0, confirmed: true },
        // Exclusion rule E: Official government suffix (.gov.in)
        { kind: "domain", value: "portal.gov.in", source: "user", round: 0, confirmed: true },
        // Exclusion rule F: Free-email domain (gmail.com)
        { kind: "domain", value: "gmail.com", source: "user", round: 0, confirmed: true },
      ],
      db
    );

    const req = new Request(`http://localhost/api/checks/${checkId}/save-to-graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true }),
    });

    const res = await saveToGraphPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.saved, 4); // Only upi, handle, phone, scam domain
    assert.ok(body.checkRef);
    assert.equal(body.checkRef, computeCheckRef(checkId));

    // Verify graph_nodes in SQLite
    const nodes = db.prepare(`SELECT kind, value, report_count FROM graph_nodes ORDER BY kind`).all();
    const nodeKinds = nodes.map((n) => n.kind);
    assert.ok(nodeKinds.includes("upi"));
    assert.ok(nodeKinds.includes("handle"));
    assert.ok(nodeKinds.includes("phone"));
    assert.ok(nodeKinds.includes("domain"));
    assert.ok(!nodeKinds.includes("company"), "company should never be saved in graph");

    // Verify known domain never saved
    const ugcNode = db.prepare(`SELECT * FROM graph_nodes WHERE value = 'ugc.ac.in'`).get();
    assert.equal(ugcNode, undefined);

    // Verify pairwise edges exist
    const edges = db.prepare(`SELECT * FROM graph_edges WHERE check_ref = ?`).all(body.checkRef);
    // 4 nodes pairwise = 4 * 3 / 2 = 6 edges
    assert.equal(edges.length, 6);
  });

  it("enforces cap of 5 identifiers per check", async () => {
    const checkId = seedCheck();

    const entities = [
      { kind: "upi", value: "scam1@okaxis", source: "user", round: 0, confirmed: true },
      { kind: "upi", value: "scam2@okaxis", source: "user", round: 0, confirmed: true },
      { kind: "upi", value: "scam3@okaxis", source: "user", round: 0, confirmed: true },
      { kind: "upi", value: "scam4@okaxis", source: "user", round: 0, confirmed: true },
      { kind: "upi", value: "scam5@okaxis", source: "user", round: 0, confirmed: true },
      { kind: "upi", value: "scam6@okaxis", source: "user", round: 0, confirmed: true },
      { kind: "upi", value: "scam7@okaxis", source: "user", round: 0, confirmed: true },
    ];
    replaceEntities(checkId, entities, db);

    const result = saveCheckIdentifiers(checkId, { consent: true, db });
    assert.equal(result.saved, 5);
  });

  it("is idempotent: second call returns saved 0 and reason already_saved without re-incrementing report_count", async () => {
    const checkId = seedCheck();
    replaceEntities(
      checkId,
      [
        { kind: "upi", value: "fraudster@okhdfc", source: "user", round: 0, confirmed: true },
        { kind: "handle", value: "fraudster_hr", source: "user", round: 0, confirmed: true },
      ],
      db
    );

    // First call
    const res1 = saveCheckIdentifiers(checkId, { consent: true, db });
    assert.equal(res1.saved, 2);

    const nodeBefore = db.prepare(`SELECT report_count FROM graph_nodes WHERE value = 'fraudster@okhdfc'`).get();
    assert.equal(nodeBefore.report_count, 1);

    // Second call
    const res2 = saveCheckIdentifiers(checkId, { consent: true, db });
    assert.equal(res2.saved, 0);
    assert.equal(res2.reason, "already_saved");

    const nodeAfter = db.prepare(`SELECT report_count FROM graph_nodes WHERE value = 'fraudster@okhdfc'`).get();
    assert.equal(nodeAfter.report_count, 1, "report_count must not be incremented on duplicate call");
  });

  it("checkRef is a stable SHA-256 hash slice", () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const ref1 = computeCheckRef(checkId);
    const ref2 = computeCheckRef(checkId);
    assert.equal(ref1, ref2);
    assert.equal(ref1.length, 32);
    assert.match(ref1, /^[0-9a-f]{32}$/);
    assert.notEqual(ref1, checkId);
  });

  it("deleteExpired preserves graph rows after check is purged", async () => {
    const checkId = seedCheck({
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
    });
    replaceEntities(
      checkId,
      [
        { kind: "upi", value: "persisted@okaxis", source: "user", round: 0, confirmed: true },
        { kind: "handle", value: "persisted_agent", source: "user", round: 0, confirmed: true },
      ],
      db
    );

    // Record to graph
    saveCheckIdentifiers(checkId, { consent: true, db });

    // Verify nodes and edges exist
    const nodeCountBefore = db.prepare(`SELECT count(*) as c FROM graph_nodes`).get().c;
    const edgeCountBefore = db.prepare(`SELECT count(*) as c FROM graph_edges`).get().c;
    assert.equal(nodeCountBefore, 2);
    assert.equal(edgeCountBefore, 1);

    // Run deleteExpired
    deleteExpired(TEST_DIR, db);

    // Check table should now have 0 checks
    const check = db.prepare(`SELECT * FROM checks WHERE id = ?`).get(checkId);
    assert.equal(check, undefined);

    // Graph tables must be completely intact
    const nodeCountAfter = db.prepare(`SELECT count(*) as c FROM graph_nodes`).get().c;
    const edgeCountAfter = db.prepare(`SELECT count(*) as c FROM graph_edges`).get().c;
    assert.equal(nodeCountAfter, 2, "graph_nodes must be preserved");
    assert.equal(edgeCountAfter, 1, "graph_edges must be preserved");
  });

  it("payment_entity lookup emits graph_match for saved UPI ID", async () => {
    const checkId = seedCheck();
    replaceEntities(
      checkId,
      [
        { kind: "upi", value: "graphscam@okhdfc", source: "user", round: 0, confirmed: true },
        { kind: "handle", value: "graphscam_bot", source: "user", round: 0, confirmed: true },
      ],
      db
    );
    saveCheckIdentifiers(checkId, { consent: true, db });

    // In a new check investigation, payment_entity checks the same UPI ID
    const snapshot = {
      checkId: "44444444-4444-4444-8444-444444444444",
      round: 1,
      entities: [
        { kind: "upi", value: "graphscam@okhdfc" },
      ],
      agentResults: [],
    };

    const graphLookupFn = (kind, value) => lookup(kind, value, { db });
    const result = await runPaymentEntity(snapshot, {
      graphLookup: graphLookupFn,
      search: async () => ({ results: [] }),
    });

    assert.equal(result.status, "ok");
    const flagIds = result.flags.map((f) => f.id);
    assert.ok(flagIds.includes("graph_match"), "Expected graph_match flag to be emitted");
  });

  it("save-to-graph for a check with high risk but zero eligible identifiers returns spec'd response and writes nothing", async () => {
    const checkId = seedCheck({
      id: "66666666-6666-4666-8666-666666666666",
      riskLevel: "high",
    });

    // Seed only non-qualifying entities:
    // - Unconfirmed entity
    // - Discovered entity
    // - Company entity
    // - Excluded domain entity (ugc.ac.in)
    replaceEntities(
      checkId,
      [
        { kind: "company", value: "Legitimate Company", source: "user", round: 0, confirmed: true },
        { kind: "domain", value: "ugc.ac.in", source: "user", round: 0, confirmed: true },
        { kind: "upi", value: "unconfirmed@okaxis", source: "user", round: 0, confirmed: false },
        {
          kind: "domain",
          value: "discovered.example",
          source: "discovered",
          round: 1,
          discoveredBy: "website_forensics",
          evidence: { type: "url", value: "https://discovered.example" },
          confirmed: true,
        },
      ],
      db
    );

    const nodesCountBefore = db.prepare(`SELECT count(*) as c FROM graph_nodes`).get().c;
    const edgesCountBefore = db.prepare(`SELECT count(*) as c FROM graph_edges`).get().c;

    const req = new Request(`http://localhost/api/checks/${checkId}/save-to-graph`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true }),
    });

    const res = await saveToGraphPost(req, { params: Promise.resolve({ id: checkId }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.saved, 0);
    assert.equal(body.reason, "no_qualifying_identifiers");
    assert.equal(body.checkRef, computeCheckRef(checkId));

    // Verify nothing written to graph tables
    const nodesCountAfter = db.prepare(`SELECT count(*) as c FROM graph_nodes`).get().c;
    const edgesCountAfter = db.prepare(`SELECT count(*) as c FROM graph_edges`).get().c;
    assert.equal(nodesCountAfter, nodesCountBefore, "Zero nodes should be written when no qualifying identifiers");
    assert.equal(edgesCountAfter, edgesCountBefore, "Zero edges should be written when no qualifying identifiers");
  });

  it("never saves a handle whose value or domain part is in known-domains, official suffixes, or free-mail domains", async () => {
    const checkId = seedCheck({
      id: "77777777-7777-4777-8777-777777777777",
      riskLevel: "high",
    });

    replaceEntities(
      checkId,
      [
        // Excluded handles
        { kind: "handle", value: "gmail.com", source: "user", round: 0, confirmed: true },
        { kind: "handle", value: "scholarships.gov.in", source: "user", round: 0, confirmed: true },
        { kind: "handle", value: "sub.ugc.ac.in", source: "user", round: 0, confirmed: true },
        // Valid bank PSP UPI handle (confirmed user entity)
        { kind: "upi", value: "scholarship.dept@okaxis", source: "user", round: 0, confirmed: true },
        // Valid handles
        { kind: "handle", value: "pm-scholarship.example", source: "user", round: 0, confirmed: true },
        { kind: "handle", value: "notgmail.com", source: "user", round: 0, confirmed: true }, // evilgmail.com / notgmail.com dot boundary
      ],
      db
    );

    const res = saveCheckIdentifiers(checkId, { consent: true, db });

    // Excluded handles must not be saved
    const gmailNode = db.prepare(`SELECT * FROM graph_nodes WHERE value = 'gmail.com'`).get();
    const govNode = db.prepare(`SELECT * FROM graph_nodes WHERE value = 'scholarships.gov.in'`).get();
    const subUgcNode = db.prepare(`SELECT * FROM graph_nodes WHERE value = 'sub.ugc.ac.in'`).get();

    assert.equal(gmailNode, undefined, "gmail.com handle should not be saved");
    assert.equal(govNode, undefined, "scholarships.gov.in handle should not be saved");
    assert.equal(subUgcNode, undefined, "sub.ugc.ac.in handle should not be saved");

    // Qualifying entries must be saved
    const okaxisNode = db.prepare(`SELECT * FROM graph_nodes WHERE value = 'scholarship.dept@okaxis'`).get();
    const pmScholNode = db.prepare(`SELECT * FROM graph_nodes WHERE value = 'pm-scholarship.example'`).get();
    const notGmailNode = db.prepare(`SELECT * FROM graph_nodes WHERE value = 'notgmail.com'`).get();

    assert.ok(okaxisNode, "scholarship.dept@okaxis must be saved");
    assert.ok(pmScholNode, "pm-scholarship.example must be saved");
    assert.ok(notGmailNode, "notgmail.com must be saved (dot boundary respected)");
    assert.equal(res.saved, 3, "Only the 3 qualifying identifiers should be saved");
  });

  it("filterQualifyingGraphIdentifier helper rejects invalid upi, handles with schemes, ports, and excluded domains", () => {
    // 1. UPI checks
    assert.equal(filterQualifyingGraphIdentifier("upi", "scholarship.dept@okaxis"), "scholarship.dept@okaxis");
    assert.equal(filterQualifyingGraphIdentifier("upi", "someone@gmail.com"), null, "UPI with gmail.com domain must be excluded");
    assert.equal(filterQualifyingGraphIdentifier("upi", "name@ugc.ac.in"), null, "UPI with ugc.ac.in domain must be excluded");
    assert.equal(filterQualifyingGraphIdentifier("upi", "@okaxis"), null, "Empty local part must be excluded");
    assert.equal(filterQualifyingGraphIdentifier("upi", "scam@"), null, "Empty handle part must be excluded");
    assert.equal(filterQualifyingGraphIdentifier("upi", "no-at-sign"), null, "Missing @ must be excluded");
    assert.equal(filterQualifyingGraphIdentifier("upi", "SCAMMER.PAY@OKAXIS"), "scammer.pay@okaxis", "Uppercase UPI must be normalized");

    // 2. Handle checks
    assert.equal(filterQualifyingGraphIdentifier("handle", "gmail.com"), null);
    assert.equal(filterQualifyingGraphIdentifier("handle", "@gmail.com"), null);
    assert.equal(filterQualifyingGraphIdentifier("handle", "https://www.gmail.com/foo"), null);
    assert.equal(filterQualifyingGraphIdentifier("handle", "scholarships.gov.in"), null);
    assert.equal(filterQualifyingGraphIdentifier("handle", "sub.ugc.ac.in"), null);
    assert.equal(filterQualifyingGraphIdentifier("handle", "pm-scholarship.example"), "pm-scholarship.example");
    assert.equal(filterQualifyingGraphIdentifier("handle", "notgmail.com"), "notgmail.com", "evilgmail.com/notgmail.com dot boundary respected");
    assert.equal(filterQualifyingGraphIdentifier("handle", "@EVIL_HANDLE"), "evil_handle");

    // 3. Other disallowed kinds
    assert.equal(filterQualifyingGraphIdentifier("company", "Acme Inc"), null);
    assert.equal(filterQualifyingGraphIdentifier("email", "victim@gmail.com"), null);
    assert.equal(filterQualifyingGraphIdentifier("amount", "5000"), null);
  });
});

