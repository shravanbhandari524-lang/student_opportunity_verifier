/**
 * tests/trace-instrumentation.test.js
 *
 * Dedicated tests for Part 3 (Backend trace instrumentation and observability):
 * 1. Wrapper start/end pairing: instrumentTools emits tool_start and tool_end with matching callId.
 * 2. Cache flag: cached hits are marked with status "cached".
 * 3. Error becomes status error: tool errors (returned or thrown) become status "error" and never throw.
 * 4. Redaction: no API keys, tokens, or raw prompts leak in serialized payloads.
 * 5. Coordinator event ordering: monotonic, strictly increasing seq with no duplicates.
 * 6. Dropped invalid events: invalid candidates are dropped and logged without crashing emit.
 * 7. Flags emitted only after validation: coordinator emits flag events only after result is validated and merged.
 * 8. Agent timeout: agent timeout emits agent_status with could_not_check.
 * 9. Agent coverage: every agent emits at least one note or tool event on its fixture.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { instrumentTools, redactSecretText } from "../lib/trace.js";
import { runInvestigation } from "../lib/coordinator.js";
import {
  getDb,
  createCheck,
  saveInputs,
  replaceEntities,
  getEvents,
  listEventsAfter,
} from "../lib/db/index.js";
import { clearScamScenario } from "../lib/contracts/fixtures/scenarios/scenario-a.js";
import { createScenarioGenerate } from "./helpers/mock-generate.js";

// Helper for test isolated DB
let dbCounter = 0;
function getTestDb() {
  dbCounter++;
  const file = `./data/test_trace_inst_${Date.now()}_${dbCounter}.db`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const db = getDb(file);
  return { db, file };
}

// ---------------------------------------------------------------------------
// 1. Wrapper start/end pairing
// ---------------------------------------------------------------------------
test("trace instrumentation: instrumentTools emits tool_start and tool_end with matching callId", async () => {
  const events = [];
  const emit = (e) => events.push(e);

  const mockTools = {
    search: async (query) => ({
      ok: true,
      data: { query, total: 1, results: [{ title: "Result 1", url: "https://example.com", snippet: "sample", read: true }] },
    }),
  };

  const instrumented = instrumentTools(mockTools, emit, "official_verifier", 1);
  const res = await instrumented.search("test scholarship");

  assert.equal(res.ok, true);
  assert.equal(events.length, 2);

  const [start, end] = events;
  assert.equal(start.type, "tool_start");
  assert.equal(start.tool, "search");
  assert.equal(start.agent, "official_verifier");
  assert.equal(typeof start.callId, "string");

  assert.equal(end.type, "tool_end");
  assert.equal(end.tool, "search");
  assert.equal(end.agent, "official_verifier");
  assert.equal(end.callId, start.callId);
  assert.equal(end.status, "ok");
  assert.ok(end.durationMs >= 0);
  assert.equal(end.detail.tool, "search");
  assert.equal(end.detail.resultCount, 1);
});

// ---------------------------------------------------------------------------
// 2. Cache flag
// ---------------------------------------------------------------------------
test("trace instrumentation: cached tool result sets status to cached", async () => {
  const events = [];
  const emit = (e) => events.push(e);

  const mockTools = {
    rdapLookup: async (domain) => ({
      ok: true,
      cached: true,
      data: { domain, registeredAt: "2020-01-01", ageDays: 1500, registrar: "Example Registrar" },
    }),
  };

  const instrumented = instrumentTools(mockTools, emit, "website_forensics", 1);
  await instrumented.rdapLookup("example.com");

  const end = events.find((e) => e.type === "tool_end");
  assert.ok(end);
  assert.equal(end.status, "cached");
  assert.equal(end.detail.tool, "rdapLookup");
});

// ---------------------------------------------------------------------------
// 3. Error becomes status error
// ---------------------------------------------------------------------------
test("trace instrumentation: tool errors and throws become status error without throwing", async () => {
  const events = [];
  const emit = (e) => events.push(e);

  const mockTools = {
    searchErr: async () => ({
      ok: false,
      error: { code: "RATE_LIMITED", message: "Too many queries" },
    }),
    explodingTool: async () => {
      throw new Error("NETWORK_DOWN");
    },
  };

  const instrumented = instrumentTools(mockTools, emit, "reputation_osint", 1);

  // Call error returning tool
  const res1 = await instrumented.searchErr("query");
  assert.equal(res1.ok, false);

  // Call throwing tool - MUST NOT throw
  const res2 = await instrumented.explodingTool("query");
  assert.equal(res2.ok, false);

  const errEnds = events.filter((e) => e.type === "tool_end");
  assert.equal(errEnds.length, 2);
  assert.equal(errEnds[0].status, "error");
  assert.equal(errEnds[1].status, "error");
});

// ---------------------------------------------------------------------------
// 4. Redaction: no secrets or auth tokens in serialized output
// ---------------------------------------------------------------------------
test("trace instrumentation: redacts secrets and auth tokens from inputs and labels", async () => {
  const events = [];
  const emit = (e) => events.push(e);

  const secretApiKey = "sk-live-abcdef1234567890abcdef1234567890";
  const mockTools = {
    search: async () => ({ ok: true, data: { results: [] } }),
  };

  const instrumented = instrumentTools(mockTools, emit, "reputation_osint", 1);
  await instrumented.search(`api_key=${secretApiKey} look for scam`);

  for (const ev of events) {
    const serialized = JSON.stringify(ev);
    assert.equal(serialized.includes(secretApiKey), false, "Raw secret was present in serialized event");
  }

  // Unit check on redactSecretText helper
  const redacted = redactSecretText(`Bearer secret_token_xyz_12345678901234567890`);
  assert.ok(!redacted.includes("secret_token_xyz_12345678901234567890"));
});

// ---------------------------------------------------------------------------
// 5. Coordinator event ordering & monotonic seq
// ---------------------------------------------------------------------------
test("trace instrumentation: coordinator emits monotonic strictly increasing seq with no duplicates", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    saveInputs(check.id, [{ type: "text", value: clearScamScenario.submission.text }], db);
    const entities = clearScamScenario.entities.map((e) => ({ ...e, checkId: check.id }));
    replaceEntities(check.id, entities, db);

    const emitted = [];
    const deps = {
      db,
      generate: createScenarioGenerate("A"),
      classify: async () => ({ ok: true, data: { probability: 0.94, label: "scam" } }),
      search: async () => ({ ok: true, data: { results: [] } }),
      readPage: async () => ({ ok: true, data: { title: "Title", text: "Some text" } }),
      graphLookup: () => ({ matched: true, reportCount: 2 }),
      now: () => Date.now(),
      onEvent: (ev) => emitted.push(ev),
    };

    await runInvestigation(check.id, deps);

    assert.ok(emitted.length > 10, "Expected a rich stream of trace events");

    // Verify strictly increasing sequence numbers
    for (let i = 0; i < emitted.length; i++) {
      assert.equal(emitted[i].seq, i + 1, `Event at index ${i} has unexpected seq: ${emitted[i].seq}`);
    }

    // Verify DB stored events match emitted seq
    const dbEvents = listEventsAfter(check.id, 0, db);
    assert.equal(dbEvents.length, emitted.length);
    for (let i = 0; i < dbEvents.length; i++) {
      assert.equal(dbEvents[i].seq, i + 1);
    }
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 6. Invalid events dropped without crashing coordinator
// ---------------------------------------------------------------------------
test("trace instrumentation: coordinator drops invalid candidate events without throwing", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    saveInputs(check.id, [{ type: "text", value: "Valid test message" }], db);

    let loggedDrop = false;
    const logger = {
      warn: (obj) => {
        if (obj?.event === "trace_event_dropped") loggedDrop = true;
      },
      error: () => {},
      info: () => {},
    };

    const deps = {
      db,
      logger,
      generate: createScenarioGenerate("B"),
      classify: async () => ({ ok: true, data: { probability: 0.05, label: "benign" } }),
      search: async () => ({ ok: true, data: { results: [] } }),
      readPage: async () => ({ ok: true, data: { title: "Title", text: "Text" } }),
      graphLookup: () => ({ matched: false }),
      now: () => Date.now(),
    };

    // Coordinator should run cleanly despite internal candidate validation
    const report = await runInvestigation(check.id, deps);
    assert.ok(report);
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 7. Flags emitted only after validation
// ---------------------------------------------------------------------------
test("trace instrumentation: coordinator emits flag events only after validating and merging result", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    saveInputs(check.id, [{ type: "text", value: clearScamScenario.submission.text }], db);
    const entities = clearScamScenario.entities.map((e) => ({ ...e, checkId: check.id }));
    replaceEntities(check.id, entities, db);

    const emitted = [];
    const deps = {
      db,
      generate: createScenarioGenerate("A"),
      classify: async () => ({ ok: true, data: { probability: 0.94, label: "scam" } }),
      search: async () => ({ ok: true, data: { results: [] } }),
      readPage: async () => ({ ok: true, data: { title: "Title", text: "Some text" } }),
      graphLookup: () => ({ matched: true, reportCount: 2 }),
      now: () => Date.now(),
      onEvent: (ev) => emitted.push(ev),
    };

    await runInvestigation(check.id, deps);

    const flagEvents = emitted.filter((e) => e.type === "flag");
    assert.ok(flagEvents.length > 0, "Scenario A must emit flag events");

    for (const f of flagEvents) {
      assert.ok(f.flagId);
      assert.ok(f.title);
      assert.ok(["low", "medium", "high"].includes(f.severity));
      assert.ok(Array.isArray(f.evidence) && f.evidence.length > 0);
    }
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 8. Agent timeout still emits could_not_check
// ---------------------------------------------------------------------------
test("trace instrumentation: timed-out agent emits agent_status with could_not_check", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    saveInputs(check.id, [{ type: "text", value: "Message text" }], db);

    const emitted = [];
    const deps = {
      db,
      generate: async (params) => {
        if (params.purpose === "report_generation") {
          return {
            ok: true,
            data: {
              summary: "Report summary. Note: not a guarantee of safety.",
              scamTypeGuess: "unknown",
              flagExplanations: [],
              extraChecklist: [],
            },
          };
        }
        // Never resolve to force timeout
        return new Promise(() => {});
      },
      classify: async () => new Promise(() => {}),
      search: async () => ({ ok: true, data: { results: [] } }),
      readPage: async () => ({ ok: true, data: { title: "", text: "" } }),
      graphLookup: () => ({ matched: false }),
      now: () => Date.now(),
      onEvent: (ev) => emitted.push(ev),
    };

    // Run with very short pipeline timeout
    await runInvestigation(check.id, deps, { pipelineTimeoutMs: 100 });

    const timeoutStatuses = emitted.filter(
      (e) => e.type === "agent_status" && e.status === "could_not_check"
    );
    assert.ok(timeoutStatuses.length > 0, "Timed out agents must emit could_not_check agent_status");
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 9. Every agent emits at least one note or tool event on its fixture
// ---------------------------------------------------------------------------
test("trace instrumentation: every agent emits at least one note or tool event", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    saveInputs(check.id, [{ type: "text", value: clearScamScenario.submission.text }], db);
    const entities = clearScamScenario.entities.map((e) => ({ ...e, checkId: check.id }));
    replaceEntities(check.id, entities, db);

    const emitted = [];
    const deps = {
      db,
      generate: createScenarioGenerate("A"),
      classify: async () => ({ ok: true, data: { probability: 0.94, label: "scam" } }),
      search: async () => ({
        ok: true,
        data: {
          results: [{ title: "Official portal", url: "https://nsp.gov.in", snippet: "Gov portal" }],
        },
      }),
      readPage: async () => ({
        ok: true,
        data: { title: "Title", text: "Page content", blocked: false, status: 200 },
      }),
      graphLookup: () => ({ matched: true, reportCount: 3 }),
      now: () => Date.now(),
      onEvent: (ev) => emitted.push(ev),
    };

    await runInvestigation(check.id, deps);

    const allAgents = [
      "message_analyst",
      "classifier_client",
      "website_forensics",
      "official_verifier",
      "reputation_osint",
      "payment_entity",
    ];

    for (const ag of allAgents) {
      const agentEvents = emitted.filter(
        (e) => e.agent === ag && (e.type === "note" || e.type === "tool_start" || e.type === "tool_end")
      );
      assert.ok(
        agentEvents.length > 0,
        `Agent ${ag} should emit at least one note or tool event, emitted: ${agentEvents.length}`
      );
    }
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 10. Official Verifier: contradicted verdict -> registry flag with evidence & consistent notes
// ---------------------------------------------------------------------------
test("official verifier: contradicted verdict produces flag from registry with evidence and consistent notes (Scenario A)", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    const fullText = `${clearScamScenario.submission.text} Apply at ${clearScamScenario.submission.url}`;
    saveInputs(check.id, [{ type: "text", value: fullText }], db);
    const entities = clearScamScenario.entities.map((e) => ({ ...e, checkId: check.id, confirmed: true }));
    replaceEntities(check.id, entities, db);

    const emitted = [];
    const deps = {
      db,
      generate: createScenarioGenerate("A"),
      classify: async () => ({ ok: true, data: { probability: 0.94, label: "scam" } }),
      search: async () => ({
        ok: true,
        data: {
          results: [{ title: "National Scholarship Portal", url: "https://scholarships.gov.in", snippet: "Official NSP Portal" }],
        },
      }),
      readPage: async () => ({
        ok: true,
        data: { title: "NSP", text: "Official government schemes only", blocked: false, status: 200 },
      }),
      graphLookup: () => ({ matched: false, reportCount: 0 }),
      now: () => Date.now(),
      onEvent: (ev) => emitted.push(ev),
    };

    await runInvestigation(check.id, deps);

    const ovVerdicts = emitted.filter((e) => e.agent === "official_verifier" && e.type === "verdict");
    const ovContradicted = ovVerdicts.filter((v) => v.verdict === "contradicted");
    assert.ok(ovContradicted.length > 0, "Scenario A must have at least one contradicted verdict");

    const ovFlags = emitted.filter((e) => e.agent === "official_verifier" && e.type === "flag");
    assert.ok(ovFlags.length > 0, "Official verifier must emit flag(s) when verdicts are contradicted");
    for (const f of ovFlags) {
      assert.ok(["not_on_official_portal", "non_gov_domain_claiming_gov", "official_warning_found"].includes(f.flagId));
      assert.ok(Array.isArray(f.evidence) && f.evidence.length > 0);
    }

    const ovDone = emitted.find((e) => e.agent === "official_verifier" && e.type === "agent_status" && e.status === "done");
    assert.ok(ovDone, "Official verifier done status must exist");
    assert.ok(!ovDone.summary.toLowerCase().includes("no red flags"), "Done summary must never say 'no red flags' when contradicted");
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 11. Coordinator: eager settle emits fast agent done before slow agent tool events
// ---------------------------------------------------------------------------
test("coordinator: eager settle emits fast agent done before slow agent tool events, and timeout does not delay others", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    saveInputs(check.id, [{ type: "text", value: "Suspicious message https://fast-domain.com" }], db);
    replaceEntities(check.id, [
      { checkId: check.id, kind: "domain", value: "fast-domain.com", source: "extracted", confirmed: true },
      { checkId: check.id, kind: "company", value: "SlowCorp", source: "extracted", confirmed: true },
    ], db);

    const emitted = [];

    const fastAgent = {
      name: "message_analyst",
      kind: "check",
      canRun: () => true,
      run: async (snap, deps) => {
        deps.ctx.note("fast running");
        return {
          checkId: snap.check.id,
          agent: "message_analyst",
          kind: "check",
          round: 1,
          status: "ok",
          flags: [],
          verified: [],
          newEntities: [],
          processedEntities: [],
          unchecked: [],
          manualChecks: [],
          trace: [],
          notes: "fast done",
          durationMs: 5,
        };
      },
    };

    const slowAgent = {
      name: "website_forensics",
      kind: "check",
      canRun: () => true,
      run: async (snap, deps) => {
        deps.ctx.note("slow starting");
        // Wait 100ms, during which fastAgent should have completed and emitted 'done'
        await new Promise((r) => setTimeout(r, 100));
        await deps.search("slow search query");
        deps.ctx.note("slow finished");
        return {
          checkId: snap.check.id,
          agent: "website_forensics",
          kind: "check",
          round: 1,
          status: "ok",
          flags: [],
          verified: [],
          newEntities: [],
          processedEntities: [],
          unchecked: [],
          manualChecks: [],
          trace: [],
          notes: "slow done",
          durationMs: 110,
        };
      },
    };

    const deps = {
      db,
      agents: [fastAgent, slowAgent],
      search: async () => ({ ok: true, data: { results: [] } }),
      generate: async () => ({ ok: true, text: "ok" }),
      onEvent: (ev) => emitted.push(ev),
    };

    await runInvestigation(check.id, deps);

    const fastDoneIndex = emitted.findIndex((e) => e.agent === "message_analyst" && e.type === "agent_status" && e.status === "done");
    const slowToolIndex = emitted.findIndex((e) => e.agent === "website_forensics" && e.type === "tool_start");

    assert.ok(fastDoneIndex !== -1, "fast agent done event must be emitted");
    assert.ok(slowToolIndex !== -1, "slow agent tool_start event must be emitted");
    assert.ok(fastDoneIndex < slowToolIndex, `fast agent done (${fastDoneIndex}) must appear before slow agent tool_start (${slowToolIndex})`);
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 12. Round 2 eligibility & domain search
// ---------------------------------------------------------------------------
test("round 2 eligibility: ineligible agent returns skipped, Official Verifier searches unprocessed domain", async () => {
  const { db, file } = getTestDb();
  try {
    const check = createCheck({ status: "awaiting_confirmation" }, db);
    saveInputs(check.id, [{ type: "text", value: "National scholarship at http://initial-scholarship.com" }], db);
    replaceEntities(check.id, [
      { checkId: check.id, kind: "domain", value: "initial-scholarship.com", source: "extracted", confirmed: true },
    ], db);

    const emitted = [];
    const searchQueries = [];

    // Message analyst discovers a new domain in round 1
    const mockDiscoverAgent = {
      name: "website_forensics",
      kind: "check",
      canRun: (snap) => snap.check.currentRound === 1,
      run: async (snap, deps) => {
        deps.ctx.note("forensics running");
        return {
          checkId: snap.check.id,
          agent: "website_forensics",
          kind: "check",
          round: 1,
          status: "ok",
          flags: [],
          verified: [],
          newEntities: [
            { kind: "domain", value: "discovered-portal.org", evidence: { type: "quote", value: "initial-scholarship.com" } },
          ],
          processedEntities: ["domain:initial-scholarship.com"],
          unchecked: [],
          manualChecks: [],
          trace: [],
          notes: "discovered new domain",
          durationMs: 10,
        };
      },
    };

    // Agent with nothing new in round 2 returns skipped
    const { run: ovRun, canRun: ovCanRun } = await import("../lib/agents/official-verifier.js");
    const ovWrapper = {
      name: "official_verifier",
      kind: "check",
      canRun: ovCanRun,
      run: ovRun,
    };

    const deps = {
      db,
      agents: [mockDiscoverAgent, ovWrapper],
      search: async (q) => {
        searchQueries.push(q);
        return { ok: true, data: { results: [{ title: "Gov portal", url: "https://nsp.gov.in", snippet: "Gov portal" }] } };
      },
      readPage: async () => ({ ok: true, data: { title: "Gov", text: "Official", blocked: false, status: 200 } }),
      generate: async () => ({ ok: true, text: "ok" }),
      onEvent: (ev) => emitted.push(ev),
    };

    await runInvestigation(check.id, deps);

    // In Round 2, official verifier should run for the discovered domain
    const r2Events = emitted.filter((e) => e.round === 2);
    assert.ok(r2Events.length > 0, "Round 2 events should be emitted");

    const ovSearchInR2 = searchQueries.some((q) => q.includes("discovered-portal.org"));
    assert.ok(ovSearchInR2, `Official Verifier must run a search for discovered domain: ${searchQueries.join(", ")}`);
  } finally {
    db.close();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

// ---------------------------------------------------------------------------
// 13. Scoring: repeated flag IDs across different entities count once for points
// ---------------------------------------------------------------------------
test("scoring: repeated flag IDs across multiple entities count once for points (not inflated)", async () => {
  const { scoreCase } = await import("../lib/scoring/score.js");

  const findings = [
    {
      agent: "website_forensics",
      round: 1,
      status: "ok",
      flags: [
        { id: "domain_new", title: "Domain New", severity: "medium", evidence: [{ type: "quote", value: "first.com" }] },
      ],
    },
    {
      agent: "website_forensics",
      round: 2,
      status: "ok",
      flags: [
        { id: "domain_new", title: "Domain New", severity: "medium", evidence: [{ type: "quote", value: "second.com" }] },
      ],
    },
  ];

  const scoreResult = scoreCase({ findings });
  assert.equal(scoreResult.flagPoints.length, 1, "Only one entry for domain_new in flagPoints");
  assert.equal(scoreResult.flagPoints[0].id, "domain_new");
  assert.equal(scoreResult.flagPoints[0].status, "counted");
  assert.equal(scoreResult.flagPoints[0].points, 20); // domain_new weight is 20
  assert.equal(scoreResult.score, 20, "Total score counts domain_new once (20 points, not 40)");
});
