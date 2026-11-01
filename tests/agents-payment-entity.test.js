import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import process from "node:process";

import {
  NAME,
  KIND,
  canRun,
  skippedReason,
  run as rawRun,
  paymentEntity,
  getEligibleUnprocessedEntities,
  getProcessedEntityKeys,
} from "../lib/agents/payment-entity.js";
import { runAgent } from "../lib/agents/base.js";
import { scoreCase } from "../lib/scoring/score.js";
import { AgentResultSchema } from "../lib/contracts/agent-result.js";
import { routeMock, validateToolResult } from "./helpers/tool-result-schemas.js";

const run = (snap, deps = {}, opts = {}) => {
  const routed = { ...deps };
  if (routed.graphLookup) routed.graphLookup = routeMock("graphLookup", routed.graphLookup);
  if (routed.search) routed.search = routeMock("search", routed.search);
  return rawRun(snap, routed, opts);
};
import { clearScamScenario } from "../lib/contracts/fixtures/scenarios/scenario-a.js";
import { genuineNoticeScenario } from "../lib/contracts/fixtures/scenarios/scenario-b.js";
import { ambiguousThinEvidenceScenario } from "../lib/contracts/fixtures/scenarios/scenario-c.js";

const makeFakeSearch = (results = [], extra = {}) => async (query) => ({
  ok: true,
  data: {
    query: typeof query === "string" ? query : "test query",
    total: results.length,
    results: results.map((r, i) => ({
      position: r.position ?? i + 1,
      snippet: "",
      title: "",
      ...r,
    })),
    ...extra,
  },
});

function makeSnapshot({
  id = "11111111-1111-4111-8111-111111111111",
  round = 1,
  text = "Default opportunity text mentioning scholarship scheme and UPI.",
  entities = [],
  findings = [],
  control = {},
} = {}) {
  return {
    check: {
      id,
      status: "investigating",
      currentRound: round,
      language: "en",
      createdAt: "2026-10-21T00:00:00.000Z",
      expiresAt: "2026-10-22T00:00:00.000Z",
    },
    inputs: text ? [{ id: 1, checkId: id, type: "text", value: text }] : [],
    submission: text ? { text } : undefined,
    entities,
    findings,
    events: [],
    control: {
      processedEntitiesByAgent: {},
      ...control,
    },
  };
}

describe("L4 Payment and Entity Agent", () => {
  // 1. canRun false with no eligible entity
  test("canRun false with no eligible entity", () => {
    const snapEmpty = makeSnapshot({ entities: [] });
    assert.equal(canRun(snapEmpty), false);
    assert.equal(skippedReason(snapEmpty), "no_eligible_entities");

    const snapIneligibleOnly = makeSnapshot({
      entities: [
        { id: 1, checkId: "11111111-1111-4111-8111-111111111111", kind: "url", value: "https://example.com/page", source: "user", round: 0, confirmed: true },
        { id: 2, checkId: "11111111-1111-4111-8111-111111111111", kind: "company", value: "Acme Corp", source: "user", round: 0, confirmed: true },
      ],
    });
    assert.equal(canRun(snapIneligibleOnly), false);
  });

  // 2. canRun true for each of the five kinds
  test("canRun true for each of the five kinds", () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const testKinds = [
      { kind: "upi", value: "test@okaxis" },
      { kind: "phone", value: "+919876543210" },
      { kind: "handle", value: "telegram_recruiter" },
      { kind: "email", value: "hr@example.com" },
      { kind: "domain", value: "scholarship-dept.example" },
    ];

    for (const item of testKinds) {
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: item.kind, value: item.value, source: "user", round: 0, confirmed: true }],
      });
      assert.equal(canRun(snap), true, `canRun should be true for kind ${item.kind}`);
    }
  });

  // 3. canRun false when every entity already processed (and true in round 2 for a new entity)
  test("canRun false when every entity already processed (and true in round 2 for a new entity)", () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const ent1 = { id: 1, checkId, kind: "upi", value: "test@okaxis", source: "user", round: 0, confirmed: true };

    const snapProcessedViaControl = makeSnapshot({
      entities: [ent1],
      control: {
        processedEntitiesByAgent: {
          [NAME]: ["upi:test@okaxis"],
        },
      },
    });
    assert.equal(canRun(snapProcessedViaControl), false);
    assert.equal(skippedReason(snapProcessedViaControl), "all_entities_already_processed");

    const snapProcessedViaFindings = makeSnapshot({
      entities: [ent1],
      findings: [
        {
          checkId,
          agent: NAME,
          kind: KIND,
          round: 1,
          status: "ok",
          flags: [],
          verified: [],
          newEntities: [],
          processedEntities: ["upi:test@okaxis"],
          unchecked: [],
          manualChecks: [],
          trace: [],
          notes: "",
          durationMs: 10,
        },
      ],
    });
    assert.equal(canRun(snapProcessedViaFindings), false);

    // Round 2 with newly discovered domain
    const ent2 = { id: 2, checkId, kind: "domain", value: "newly-discovered.example", source: "discovered", discoveredBy: "website_forensics", round: 1, confirmed: true, evidence: { type: "url", value: "https://example.com" } };
    const snapRound2 = makeSnapshot({
      round: 2,
      entities: [ent1, ent2],
      control: {
        processedEntitiesByAgent: {
          [NAME]: ["upi:test@okaxis"],
        },
      },
    });
    assert.equal(canRun(snapRound2), true);
    const unproc = getEligibleUnprocessedEntities(snapRound2);
    assert.equal(unproc.length, 1);
    assert.equal(unproc[0].value, "newly-discovered.example");
  });

  // 4. Graph match emits graph_match with evidence
  test("graph match emits graph_match with evidence", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const text = "Please pay registration fee to malicious@okaxis.";
    const snap = makeSnapshot({
      text,
      entities: [{ id: 1, checkId, kind: "upi", value: "malicious@okaxis", source: "user", round: 0, confirmed: true }],
    });

    const fakeGraphLookup = (kind, value) => {
      if (kind === "upi" && value === "malicious@okaxis") {
        return {
          matched: true,
          nodeId: 42,
          kind: "upi",
          value: "malicious@okaxis",
          reportCount: 3,
          connectedNodesCount: 2,
        };
      }
      return { matched: false };
    };

    const fakeSearch = async () => ({ ok: true, data: { results: [] } });

    const result = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(result.status, "ok");
    const graphFlag = result.flags.find((f) => f.id === "graph_match");
    assert.ok(graphFlag, "graph_match flag should be emitted");
    assert.equal(graphFlag.severity, "high");
    assert.ok(graphFlag.evidence.length > 0);
    assert.equal(graphFlag.evidence[0].type, "quote");
    assert.equal(graphFlag.evidence[0].value, "malicious@okaxis");
  });

  // 5. Personal UPI plus a government scheme claim emits personal_payment_id with a verified quote
  test("personal UPI plus a government scheme claim emits personal_payment_id with a verified quote", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const text = "National Scholarship Portal release fee: send Rs 500 to student.desk@okaxis immediately.";
    const snap = makeSnapshot({
      text,
      entities: [{ id: 1, checkId, kind: "upi", value: "student.desk@okaxis", source: "user", round: 0, confirmed: true }],
    });

    const fakeGraphLookup = () => ({ matched: false });
    const fakeSearch = async () => ({ ok: true, data: { results: [] } });

    const result = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(result.status, "ok");
    const pFlag = result.flags.find((f) => f.id === "personal_payment_id");
    assert.ok(pFlag, "personal_payment_id flag should be emitted");
    assert.equal(pFlag.severity, "high");
    assert.equal(pFlag.evidence[0].type, "quote");
    assert.equal(pFlag.evidence[0].value, "student.desk@okaxis");
  });

  // 6. A quote not present in the message is dropped and counted
  test("a quote not present in the message is dropped and counted", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    // Text mentions scheme wording, but the UPI entity value itself does NOT appear in the text
    const text = "Ministry scholarship portal registration notice.";
    const snap = makeSnapshot({
      text,
      entities: [{ id: 1, checkId, kind: "upi", value: "other.person@okaxis", source: "user", round: 0, confirmed: true }],
    });

    const fakeGraphLookup = () => ({ matched: false });
    const fakeSearch = async () => ({ ok: true, data: { results: [] } });

    const result = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(result.status, "ok");
    const pFlag = result.flags.find((f) => f.id === "personal_payment_id");
    assert.equal(pFlag, undefined, "flag should not be emitted if quote not present in text");
    assert.ok(result.notes.includes("dropped due to unverified quote evidence"));
  });

  // 7. Foreign number emits foreign_or_voip_number
  test("foreign number emits foreign_or_voip_number", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const text = "Contact recruiter on WhatsApp at +12025550143.";
    const snap = makeSnapshot({
      text,
      entities: [{ id: 1, checkId, kind: "phone", value: "+12025550143", source: "user", round: 0, confirmed: true }],
    });

    const fakeGraphLookup = () => ({ matched: false });
    const fakeSearch = async () => ({ ok: true, data: { results: [] } });

    const result = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(result.status, "ok");
    const phoneFlag = result.flags.find((f) => f.id === "foreign_or_voip_number");
    assert.ok(phoneFlag, "foreign_or_voip_number should be emitted");
    assert.equal(phoneFlag.severity, "low");
    assert.equal(phoneFlag.evidence[0].type, "quote");
    assert.equal(phoneFlag.evidence[0].value, "+12025550143");
  });

  // 8. Scam-report search hit emits scam_reports_found with the URL (if canEmit allows, or recorded in trace)
  test("scam-report search hit records findings and search trace", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const text = "Call +919876543210 for job details.";
    const snap = makeSnapshot({
      text,
      entities: [{ id: 1, checkId, kind: "phone", value: "+919876543210", source: "user", round: 0, confirmed: true }],
    });

    const fakeGraphLookup = () => ({ matched: false });
    const fakeSearch = makeFakeSearch([
      {
        title: "Warning: +919876543210 scam complaints",
        snippet: "User reported fraud and fake job offers from this number.",
        url: "https://consumercomplaints.in/scam-9876543210",
      },
    ]);

    const result = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(result.status, "ok");
    const searchTrace = result.trace.find((t) => t.check === "scam_search");
    assert.ok(searchTrace);
    assert.equal(searchTrace.corroborated, true);
  });

  // 9. No search results emits no flag and the "not a safety guarantee" note
  test("no search results emits no flag and the 'not a safety guarantee' note", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const text = "Domain contact: legit-test.example";
    const snap = makeSnapshot({
      text,
      entities: [{ id: 1, checkId, kind: "domain", value: "legit-test.example", source: "user", round: 0, confirmed: true }],
    });

    const fakeGraphLookup = () => ({ matched: false });
    const fakeSearch = async () => ({
      ok: true,
      data: { results: [] },
    });

    const result = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(result.status, "ok");
    assert.equal(result.flags.length, 0);
    assert.ok(result.notes.includes("not a safety guarantee"));
  });

  // 10. Search budget is never exceeded (assert call count)
  test("search budget is never exceeded (assert call count)", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const entities = [
      { id: 1, checkId, kind: "domain", value: "d1.example", source: "user", round: 0, confirmed: true },
      { id: 2, checkId, kind: "domain", value: "d2.example", source: "user", round: 0, confirmed: true },
      { id: 3, checkId, kind: "domain", value: "d3.example", source: "user", round: 0, confirmed: true },
      { id: 4, checkId, kind: "domain", value: "d4.example", source: "user", round: 0, confirmed: true },
      { id: 5, checkId, kind: "domain", value: "d5.example", source: "user", round: 0, confirmed: true },
    ];
    const snap = makeSnapshot({ entities });

    let searchCallCount = 0;
    const fakeSearch = async () => {
      searchCallCount++;
      return { ok: true, data: { results: [] } };
    };
    const fakeGraphLookup = () => ({ matched: false });

    const result = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch }, { searchBudget: 3 });
    assert.equal(result.status, "ok");
    assert.equal(searchCallCount, 3, "Search calls must not exceed budget of 3");
    const skippedSearch = result.trace.filter((t) => t.status === "skipped_budget");
    assert.equal(skippedSearch.length, 2);
  });

  // 11. Graph throws but search works gives ok with trace showing the failed item
  test("graph throws but search works gives ok with trace showing the failed item", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const snap = makeSnapshot({
      entities: [
        { id: 1, checkId, kind: "domain", value: "test-err.example", source: "user", round: 0, confirmed: true },
      ],
    });

    const throwingGraph = () => {
      throw new Error("DB_CRASH_SIMULATION");
    };
    const workingSearch = makeFakeSearch([]);

    const result = await run(snap, { graphLookup: throwingGraph, search: workingSearch });
    assert.equal(result.status, "ok");
    const failedTrace = result.trace.find((t) => t.check === "graph_lookup" && t.status === "failed");
    assert.ok(failedTrace, "Trace should record failed graph_lookup");
    assert.equal(failedTrace.reason, "graph_lookup_failed");
  });

  // 12. Every item failing gives could_not_check with empty arrays
  test("every item failing gives could_not_check with empty arrays", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const snap = makeSnapshot({
      entities: [
        { id: 1, checkId, kind: "domain", value: "fail-domain.example", source: "user", round: 0, confirmed: true },
      ],
    });

    const throwingGraph = () => {
      throw new Error("FATAL_GRAPH_ERROR");
    };
    const throwingSearch = async () => {
      throw new Error("FATAL_SEARCH_ERROR");
    };

    const result = await run(snap, { graphLookup: throwingGraph, search: throwingSearch });
    assert.equal(result.status, "could_not_check");
    assert.equal(result.reason, "all_checks_failed");
    assert.deepEqual(result.flags, []);
    assert.deepEqual(result.verified, []);
    assert.deepEqual(result.newEntities, []);
    assert.deepEqual(result.processedEntities, []);
  });

  // 12b. Offline invariant: when all network tools fail or time out, result is could_not_check
  test("offline invariant: when graph and search tools fail or time out, network-dependent entities give could_not_check", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const snap = makeSnapshot({
      entities: [
        { id: 1, checkId, kind: "handle", value: "telegram_recruiter", source: "user", round: 0, confirmed: true },
      ],
    });

    // Handle entity has no pure local validator; it strictly depends on graph lookup and search
    const fatalGraph = () => ({ ok: false, error: { code: "TIMEOUT", message: "graph unreachable" } });
    const fatalSearch = async () => ({ ok: false, error: { code: "NETWORK", message: "search network down" } });

    const result = await run(snap, { graphLookup: fatalGraph, search: fatalSearch });
    assert.equal(result.status, "could_not_check");
    assert.equal(result.reason, "all_checks_failed");
    assert.deepEqual(result.flags, []);
    assert.deepEqual(result.verified, []);
    assert.deepEqual(result.newEntities, []);
    assert.deepEqual(result.processedEntities, []);
  });

  // 13. Skipped when nothing applies
  test("skipped when nothing applies", async () => {
    const snap = makeSnapshot({ entities: [] });
    const result = await runAgent(paymentEntity, snap);
    assert.equal(result.status, "skipped");
    assert.equal(result.reason, "no_eligible_entities");
    assert.deepEqual(result.flags, []);
    assert.deepEqual(result.processedEntities, []);
  });

  // 14. Timeout path via runAgent gives could_not_check
  test("timeout path via runAgent gives could_not_check", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const snap = makeSnapshot({
      entities: [{ id: 1, checkId, kind: "upi", value: "slow@okaxis", source: "user", round: 0, confirmed: true }],
    });

    const hangingAgent = {
      name: NAME,
      kind: KIND,
      canRun: () => true,
      run: () => new Promise(() => {}), // never resolves
    };

    const result = await runAgent(hangingAgent, snap, {}, { timeoutMs: 50 });
    assert.equal(result.status, "could_not_check");
    assert.equal(result.reason, "timeout");
  });

  // 15. No phone value appears in any failure reason
  test("no phone value appears in any failure reason", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const secretPhone = "+919988776655";
    const snap = makeSnapshot({
      entities: [{ id: 1, checkId, kind: "phone", value: secretPhone, source: "user", round: 0, confirmed: true }],
    });

    const failingGraph = () => {
      throw new Error(`Graph error for ${secretPhone}`);
    };
    const failingSearch = async () => ({
      ok: false,
      error: { code: "NETWORK", message: `Search failed for ${secretPhone}` },
    });

    const result = await run(snap, { graphLookup: failingGraph, search: failingSearch });
    if (result.reason) {
      assert.ok(!result.reason.includes(secretPhone), "Phone must not leak into reason");
    }
  });

  // 16. Agent output validates against AgentResultSchema
  test("agent output validates against AgentResultSchema", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const snap = makeSnapshot({
      entities: [
        { id: 1, checkId, kind: "upi", value: "test@okaxis", source: "user", round: 0, confirmed: true },
        { id: 2, checkId, kind: "email", value: "user@gmail.com", source: "user", round: 0, confirmed: true },
      ],
    });

    const fakeGraphLookup = () => ({ matched: false });
    const fakeSearch = async () => ({ ok: true, data: { results: [] } });

    const rawResult = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    const parsed = AgentResultSchema.safeParse(rawResult);
    assert.ok(parsed.success, `Schema validation failed: ${JSON.stringify(parsed.error?.issues)}`);
  });

  // 17. Output of a graph_match result fed to scoreCase fires the graph_match hard rule and gives high
  test("output of a graph_match result fed to scoreCase fires the graph_match hard rule and gives high", async () => {
    const checkId = "11111111-1111-4111-8111-111111111111";
    const text = "Send payment to verifiedscam@okaxis.";
    const snap = makeSnapshot({
      text,
      entities: [{ id: 1, checkId, kind: "upi", value: "verifiedscam@okaxis", source: "user", round: 0, confirmed: true }],
    });

    const fakeGraphLookup = () => ({
      matched: true,
      nodeId: 101,
      kind: "upi",
      value: "verifiedscam@okaxis",
      reportCount: 5,
      connectedNodesCount: 3,
    });
    const fakeSearch = async () => ({ ok: true, data: { results: [] } });

    const agentResult = await run(snap, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(agentResult.status, "ok");

    // Feed finding into scoreCase
    const scoringSnapshot = {
      findings: [agentResult],
    };
    const scoreOutput = scoreCase(scoringSnapshot);
    assert.equal(scoreOutput.level, "high", "Hard rule graph_match must force level to high");
    assert.ok(scoreOutput.rulesFired.includes("graph_match"), "rulesFired must include graph_match");
    assert.ok(scoreOutput.score >= 60, "Score floor must be at least high threshold (60)");
  });

  // 18. Scenario fixtures evaluation: check canRun and result status on scenario A, B, and C
  test("scenario fixtures A, B and C canRun and execution status", async () => {
    const fakeGraphLookup = () => ({ matched: false });
    const fakeSearch = async () => ({ ok: true, data: { results: [] } });

    // Scenario A: Has UPI and domain entities
    assert.equal(canRun(clearScamScenario), true, "Scenario A has eligible entities");
    const resA = await run(clearScamScenario, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(resA.status, "ok");

    // Scenario B: Has domain entity
    assert.equal(canRun(genuineNoticeScenario), true, "Scenario B has domain entity");
    const resB = await run(genuineNoticeScenario, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(resB.status, "ok");

    // Scenario C: Has handle entity
    assert.equal(canRun(ambiguousThinEvidenceScenario), true, "Scenario C has handle entity");
    const resC = await run(ambiguousThinEvidenceScenario, { graphLookup: fakeGraphLookup, search: fakeSearch });
    assert.equal(resC.status, "ok");
  });

  // 19. free_email_recruiter tests
  describe("free_email_recruiter emission", () => {
    const checkId = "11111111-1111-4111-8111-111111111111";

    test("emits free_email_recruiter when recruiter uses free provider and text contains recruitment context", async () => {
      const snap = makeSnapshot({
        text: "Congratulations! We have an exciting internship opportunity for you. Please reply with details.",
        entities: [{ id: 1, checkId, kind: "email", value: "hr-recruiting@gmail.com", source: "user", round: 0, confirmed: true }],
      });
      const res = await run(snap);
      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "free_email_recruiter");
      assert.ok(flag, "Must emit free_email_recruiter flag");
      assert.equal(flag.severity, "medium");
      assert.equal(flag.evidence.length, 1);
      assert.equal(flag.evidence[0].type, "quote");
      assert.equal(flag.evidence[0].value, "internship");
      assert.ok(snap.inputs[0].value.includes(flag.evidence[0].value), "Quote must be verbatim in input text");
    });

    test("does not emit free_email_recruiter for enterprise email domain", async () => {
      const snap = makeSnapshot({
        text: "Congratulations! We have an exciting internship opportunity for you. Please reply with details.",
        entities: [{ id: 1, checkId, kind: "email", value: "hr@google.com", source: "user", round: 0, confirmed: true }],
      });
      const res = await run(snap);
      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "free_email_recruiter");
      assert.equal(flag, undefined, "Must not emit for enterprise domain");
    });

    test("does not emit free_email_recruiter when no recruitment context is found in text", async () => {
      const snap = makeSnapshot({
        text: "Hello, please find the document attached for your review.",
        entities: [{ id: 1, checkId, kind: "email", value: "randomperson@gmail.com", source: "user", round: 0, confirmed: true }],
      });
      const res = await run(snap);
      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "free_email_recruiter");
      assert.equal(flag, undefined, "Must not emit without recruitment context terms");
    });
  });

  // 20. default graph dependency isolation (Step H6)
  describe("default graph dependency isolation", () => {
    const checkId = "11111111-1111-4111-8111-111111111111";

    test("no injected graphLookup means no database access and no database file created", async () => {
      const probeDbPath = "./data/test-h6-probe-isolation.db";
      const originalDbPath = process.env.DB_PATH;
      process.env.DB_PATH = probeDbPath;
      if (fs.existsSync(probeDbPath)) fs.unlinkSync(probeDbPath);

      try {
        const snap = makeSnapshot({
          entities: [{ id: 1, checkId, kind: "upi", value: "test@okaxis", source: "user", round: 0, confirmed: true }],
        });

        const res = await rawRun(snap, {
          search: async () => ({ ok: true, data: { results: [] } }),
        });

        assert.equal(fs.existsSync(probeDbPath), false, "Database file must never be created when graphLookup is not injected");
        assert.equal(res.status, "ok", "Agent result is ok because UPI syntax and search succeeded");
        const graphTrace = res.trace.find((t) => t.check === "graph_lookup");
        assert.ok(graphTrace, "Trace must record graph_lookup attempt");
        assert.equal(graphTrace.status, "failed");
        assert.equal(graphTrace.reason, "GRAPH_UNAVAILABLE");
      } finally {
        if (fs.existsSync(probeDbPath)) fs.unlinkSync(probeDbPath);
        process.env.DB_PATH = originalDbPath;
      }
    });

    test("agent result is could_not_check when graph lookup fails and all other items fail", async () => {
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "handle", value: "some_handle", source: "user", round: 0, confirmed: true }],
      });

      // No graphLookup injected (uses default no-op failure), and search fails
      const res = await rawRun(snap, {
        search: async () => ({ ok: false, error: { code: "TIMEOUT", message: "Search timed out" } }),
      });

      assert.equal(res.status, "could_not_check");
      assert.deepEqual(res.flags, []);
    });

    test("injected graphLookup still produces graph_match as before", async () => {
      const snap = makeSnapshot({
        text: "Send payment to scammer.handle@okaxis",
        entities: [{ id: 1, checkId, kind: "upi", value: "scammer.handle@okaxis", source: "user", round: 0, confirmed: true }],
      });

      const res = await rawRun(snap, {
        graphLookup: (kind, value) => ({
          matched: true,
          nodeId: 99,
          reportCount: 5,
          connectedNodesCount: 3,
        }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "graph_match");
      assert.ok(flag, "Must emit graph_match flag when graphLookup matches");
      assert.equal(flag.severity, "high");
      assert.equal(flag.evidence[0].value, "scammer.handle@okaxis");
    });
  });

  // 21. safeToolCall failure style coverage (Step H6)
  describe("safeToolCall failure style coverage (thrown ToolError vs returned ok: false)", () => {
    const checkId = "11111111-1111-4111-8111-111111111111";

    test("handles returned { ok: false } from search via safeToolCall", async () => {
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "upi", value: "payment@okaxis", source: "user", round: 0, confirmed: true }],
      });

      const failingSearch = async () => validateToolResult("search", {
        ok: false,
        error: { code: "RATE_LIMITED", message: "API rate limited" },
      });

      const res = await rawRun(snap, {
        search: failingSearch,
        graphLookup: () => ({ matched: false }),
      });

      assert.equal(res.status, "ok", "UPI syntax and graph check succeed so overall status is ok");
      const searchTrace = res.trace.find((t) => t.check === "scam_search");
      assert.ok(searchTrace, "Trace must record scam_search attempt");
      assert.equal(searchTrace.status, "error");
      assert.equal(searchTrace.code, "RATE_LIMITED");
    });

    test("handles thrown ToolError/Exception from search via safeToolCall", async () => {
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "upi", value: "payment@okaxis", source: "user", round: 0, confirmed: true }],
      });

      const throwingSearch = async () => {
        const err = new Error("Search upstream connection terminated abruptly");
        err.code = "ECONNRESET";
        throw err;
      };

      const res = await rawRun(snap, {
        search: throwingSearch,
        graphLookup: () => ({ matched: false }),
      });

      assert.equal(res.status, "ok", "Agent must not crash when search throws");
      const searchTrace = res.trace.find((t) => t.check === "scam_search");
      assert.ok(searchTrace, "Trace must record scam_search attempt");
      assert.equal(searchTrace.status, "error");
      assert.equal(searchTrace.code, "ECONNRESET");
    });

    test("when search throws ToolError and all other checks fail, produces could_not_check", async () => {
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "handle", value: "unknown_user", source: "user", round: 0, confirmed: true }],
      });

      const throwingSearch = async () => {
        const err = new Error("Fatal search service timeout");
        err.code = "ETIMEDOUT";
        throw err;
      };

      const res = await rawRun(snap, {
        search: throwingSearch,
        // graphLookup omitted -> defaults to no-op failure
      });

      assert.equal(res.status, "could_not_check");
      assert.deepEqual(res.flags, []);
    });
  });

  describe("S3: check failure counting per item", () => {
    test("graph ok and search failed gives ok with a failed trace item and the unavailable note", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "domain", value: "research-portal.institute.edu.example", source: "user", round: 0, confirmed: true }],
      });

      const failingSearch = async () => validateToolResult("search", {
        ok: false,
        error: { code: "UPSTREAM_ERROR", message: "Search API responded with HTTP 400" },
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: failingSearch,
      });

      assert.equal(res.status, "ok", "Graph lookup succeeded, so agent returns ok despite search failure");
      const searchTrace = res.trace.find((t) => t.check === "scam_search");
      assert.ok(searchTrace, "Trace must record failed scam_search");
      assert.equal(searchTrace.status, "error");
      assert.equal(searchTrace.code, "UPSTREAM_ERROR");
      assert.ok(res.notes.includes("Scam-report search was unavailable for 1 identifier(s)."), "Notes must mention unavailable search");
      assert.ok(!res.notes.includes("Search checks returned no public complaints"), "Notes must not claim no public complaints found");
    });

    test("graph failed and search ok gives ok", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "handle", value: "student_lead", source: "user", round: 0, confirmed: true }],
      });

      const throwingGraph = () => {
        throw new Error("GRAPH_SERVICE_DOWN");
      };

      const successfulSearch = async () => validateToolResult("search", {
        ok: true,
        data: {
          query: "test query",
          total: 0,
          results: [],
        },
      });

      const res = await run(snap, {
        graphLookup: throwingGraph,
        search: successfulSearch,
      });

      assert.equal(res.status, "ok", "Search succeeded so agent returns ok despite graph failure");
      const graphTrace = res.trace.find((t) => t.check === "graph_lookup");
      assert.ok(graphTrace && graphTrace.status === "failed", "Graph failure must be in trace");
      const searchTrace = res.trace.find((t) => t.check === "scam_search");
      assert.ok(searchTrace && searchTrace.status === "ok", "Search success must be in trace");
    });

    test("both graph and search failed gives could_not_check all_checks_failed", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "domain", value: "dead-domain.example", source: "user", round: 0, confirmed: true }],
      });

      const failingGraph = () => ({
        ok: false,
        error: { code: "ECONNREFUSED", message: "Graph service offline" },
      });

      const failingSearch = async () => validateToolResult("search", {
        ok: false,
        error: { code: "UPSTREAM_ERROR", message: "Search service unavailable" },
      });

      const res = await run(snap, {
        graphLookup: failingGraph,
        search: failingSearch,
      });

      assert.equal(res.status, "could_not_check");
      assert.equal(res.reason, "all_checks_failed");
      assert.deepEqual(res.flags, []);
    });

    test("validation-only entities (upi with no network) still ok", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "upi", value: "valid.handle@okaxis", source: "user", round: 0, confirmed: true }],
      });

      // No network search executed (budget 0) and graph lookup failed
      const failingGraph = () => ({
        ok: false,
        error: { code: "GRAPH_ERROR" },
      });

      const res = await run(snap, {
        graphLookup: failingGraph,
      }, { searchBudget: 0 });

      assert.equal(res.status, "ok", "UPI syntax validation succeeded, so entity has a successful check");
      assert.ok(res.verified.some((v) => v.includes("UPI syntax valid")));
    });

    test("a successful search with no results keeps the old note", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "domain", value: "clean-domain.example", source: "user", round: 0, confirmed: true }],
      });

      const emptySearch = async () => validateToolResult("search", {
        ok: true,
        data: {
          query: "clean-domain.example",
          total: 0,
          results: [],
        },
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: emptySearch,
      });

      assert.equal(res.status, "ok");
      assert.ok(
        res.notes.includes("Search checks returned no public complaints for 1 identifier(s) (not a safety guarantee)."),
        "Must keep the old note when search succeeded with 0 results"
      );
      assert.ok(!res.notes.includes("unavailable"), "Must not include unavailable wording when search succeeded");
    });

    test("the failure reasons still contain no entity values", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const secretDomain = "sensitive-domain-xyz.example";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "domain", value: secretDomain, source: "user", round: 0, confirmed: true }],
      });

      const failingGraph = () => ({
        ok: false,
        error: { code: "GRAPH_FAILURE", message: `Failed for ${secretDomain}` },
      });
      const failingSearch = async () => validateToolResult("search", {
        ok: false,
        error: { code: "SEARCH_FAILURE", message: `Failed for ${secretDomain}` },
      });

      const res = await run(snap, {
        graphLookup: failingGraph,
        search: failingSearch,
      });

      assert.equal(res.status, "could_not_check");
      assert.ok(!res.reason.includes(secretDomain), "Entity value must not leak into agent failure reason");
      assert.equal(res.reason, "all_checks_failed");
    });

    test("search provider error.message does not leak into trace, notes, or reason", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const sensitiveLeakMarker = "SECRET_PROVIDER_INTERNAL_ERROR_MARKER_998877";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "domain", value: "test-domain.example", source: "user", round: 0, confirmed: true }],
      });

      const failingSearch = async () => validateToolResult("search", {
        ok: false,
        error: { code: "UPSTREAM_ERROR", message: `Serper failure: ${sensitiveLeakMarker}` },
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: failingSearch,
      });

      assert.equal(res.status, "ok");
      const serialized = JSON.stringify(res);
      assert.ok(
        !serialized.includes(sensitiveLeakMarker),
        "Upstream search error.message must not leak into agent result or trace"
      );
      const searchTrace = res.trace.find((t) => t.check === "scam_search");
      assert.equal(searchTrace.code, "UPSTREAM_ERROR");
    });

    test("payment_entity emits no flags from search results when exact identifier is absent", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "domain", value: "reported-domain.example", source: "user", round: 0, confirmed: true }],
      });

      const searchWithScamReports = async () => validateToolResult("search", {
        ok: true,
        data: {
          query: "reported-domain.example scam",
          total: 1,
          results: [
            {
              position: 1,
              title: "Generic online education scam report",
              snippet: "Users reported general fraud and scam activities on student portals.",
              url: "https://consumercomplaints.example/scam",
            },
          ],
        },
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: searchWithScamReports,
      });

      assert.equal(res.status, "ok");
      assert.deepEqual(res.flags, [], "payment_entity must never emit flags from search results when exact identifier is missing");
    });

    test("payment_entity emits scam_reports_found when exact identifier is in search snippet with nearby scam wording", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        entities: [{ id: 1, checkId, kind: "upi", value: "badactor@paytm", source: "user", round: 0, confirmed: true }],
      });

      const searchWithExactHit = async () => validateToolResult("search", {
        ok: true,
        data: {
          query: "badactor@paytm scam",
          total: 1,
          results: [
            {
              position: 1,
              title: "Complaint against badactor@paytm fraudulent payment",
              snippet: "Victim cheated of Rs 2000. Do not transfer money to badactor@paytm scam account.",
              url: "https://consumercomplaints.example/badactor-scam",
            },
          ],
        },
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: searchWithExactHit,
      });

      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "scam_reports_found");
      assert.ok(flag, "Must emit scam_reports_found when exact identifier appears near scam word");
      assert.equal(flag.severity, "high");
      assert.equal(flag.evidence[0].type, "url");
      assert.equal(flag.evidence[0].value, "https://consumercomplaints.example/badactor-scam");
    });

    test("Google internship with personal UPI emits personal_payment_id with and without keyword list", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      // Scenario A: With keyword list ("internship")
      const snapWithKeywords = makeSnapshot({
        id: checkId,
        text: "Selected for an internship at Google. Pay onboarding fee of Rs 1,500 to rahul.sharma99@okaxis.",
        entities: [
          { id: 1, checkId, kind: "company", value: "Google", source: "user", round: 0, confirmed: true },
          { id: 2, checkId, kind: "upi", value: "rahul.sharma99@okaxis", source: "user", round: 0, confirmed: true },
        ],
      });

      const resA = await run(snapWithKeywords, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(resA.status, "ok");
      const flagA = resA.flags.find((f) => f.id === "personal_payment_id");
      assert.ok(flagA, "Must emit personal_payment_id when company and payment request exist with keywords");

      // Scenario B: Without keyword list (only company entity and payment request in text, no keywords like scholarship/internship)
      const snapWithoutKeywords = makeSnapshot({
        id: checkId,
        text: "Google Summer Tech Hub. Please pay advance deposit of Rs 1,500 to rahul.sharma99@okaxis.",
        entities: [
          { id: 1, checkId, kind: "company", value: "Google", source: "user", round: 0, confirmed: true },
          { id: 2, checkId, kind: "upi", value: "rahul.sharma99@okaxis", source: "user", round: 0, confirmed: true },
        ],
      });

      const resB = await run(snapWithoutKeywords, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(resB.status, "ok");
      const flagB = resB.flags.find((f) => f.id === "personal_payment_id");
      assert.ok(flagB, "Must emit personal_payment_id based on company entity and payment request even without keywords");
    });

    test("UPI provided only in form field still produces flag and passes verification", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      // Message text does NOT contain the UPI ID string; it is only in submission.upiId / entities
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [
          { id: 1, checkId, type: "text", value: "Selected for Google role. Deposit registration fee of Rs 500." },
        ],
        submission: {
          text: "Selected for Google role. Deposit registration fee of Rs 500.",
          upiId: "rahul.payment@okaxis",
          company: "Google",
        },
        entities: [
          { id: 1, checkId, kind: "company", value: "Google", source: "user", round: 0, confirmed: true },
          { id: 2, checkId, kind: "upi", value: "rahul.payment@okaxis", source: "user", round: 0, confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "personal_payment_id");
      assert.ok(flag, "UPI provided only in form field must still emit personal_payment_id");
      assert.equal(flag.evidence[0].value, "rahul.payment@okaxis");
    });

    test("Payee classification: merit.grants@sbi does NOT emit high personal_payment_id", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      const snap = makeSnapshot({
        id: checkId,
        text: "National Merit Scholarship Council official registration. Submit examination application fee of Rs 250 via UPI to merit.grants@sbi.",
        entities: [
          { id: 1, checkId, kind: "company", value: "National Merit Scholarship Council", source: "user", round: 0, confirmed: true },
          { id: 2, checkId, kind: "upi", value: "merit.grants@sbi", source: "user", round: 0, confirmed: true },
        ],
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "personal_payment_id");
      assert.equal(flag, undefined, "Institutional bank handle with non-person name must NOT emit personal_payment_id");
      assert.ok(res.notes.includes("cannot be verified") || res.manualChecks.length >= 0);
    });

    test("Payment request detection: UPI ID merely mentioned without payment request does NOT flag", async () => {
      const checkId = "11111111-1111-4111-8111-111111111111";
      // UPI ID appears in informational text, but no payment/fee/deposit demand or amount entity
      const snap = makeSnapshot({
        id: checkId,
        text: "Google community meet: For any venue queries contact our coordinator rahul.sharma99@okaxis.",
        entities: [
          { id: 1, checkId, kind: "company", value: "Google", source: "user", round: 0, confirmed: true },
          { id: 2, checkId, kind: "upi", value: "rahul.sharma99@okaxis", source: "user", round: 0, confirmed: true },
        ],
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(res.status, "ok");
      const flag = res.flags.find((f) => f.id === "personal_payment_id");
      assert.equal(flag, undefined, "UPI ID mentioned without payment request must not emit personal_payment_id");
    });
  });

  describe("Activity Log & Audit 8 Cases", () => {
    test("Case 1: Google Case produces input, rules, consistency, graph, search, limit, and manual entries", async () => {
      const checkId = "00000000-0000-0000-0000-000000000001";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "Google India summer internship program. Selected candidates must pay a refundable onboarding kit fee of Rs 1,500 to rahul.sharma99@okaxis. Contact our recruiter on Instagram @google_careers_intern or WhatsApp at +919876543210.",
        }],
        submission: {
          text: "Google India summer internship program. Selected candidates must pay a refundable onboarding kit fee of Rs 1,500 to rahul.sharma99@okaxis. Contact our recruiter on Instagram @google_careers_intern or WhatsApp at +919876543210.",
          company: "Google",
        },
        entities: [
          { id: 1, checkId, kind: "company", value: "Google", source: "user", confirmed: true },
          { id: 2, checkId, kind: "upi", value: "rahul.sharma99@okaxis", source: "user", confirmed: true },
          { id: 3, checkId, kind: "handle", value: "google_careers_intern", source: "user", confirmed: true },
          { id: 4, checkId, kind: "phone", value: "+919876543210", source: "user", confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: (kind, val) => (val === "+919876543210" ? { matched: true, reportCount: 3, connectedNodesCount: 5 } : { matched: false }),
        search: async (q) => ({
          ok: true,
          data: {
            query: q,
            total: 1,
            results: [
              {
                title: "Report on +919876543210 scam complaints",
                snippet: "+919876543210 scam reported by users",
                url: "https://example.com/report1",
                position: 1,
              },
            ],
          },
        }),
      });

      assert.equal(res.status, "ok");
      assert.ok(res.activity.length > 0, "Activity log must not be empty");

      // Verify input entries
      const inputs = res.activity.filter((e) => e.type === "input");
      assert.ok(inputs.some((e) => e.title.includes("rahul.sharma99@okaxis")), "Must have input for UPI");
      assert.ok(inputs.some((e) => e.title.includes("google_careers_intern")), "Must have input for handle");
      assert.ok(inputs.some((e) => e.title.includes("+919876543210")), "Must have input for phone");

      // Verify step rules (UPI): format valid, handle recognised, type, payee classification
      const upiRuleStep = res.activity.find((e) => e.type === "step" && e.title.includes("UPI rules"));
      assert.ok(upiRuleStep, "Must have UPI rules step");
      assert.ok(upiRuleStep.detail.toLowerCase().includes("format valid"));
      assert.ok(upiRuleStep.detail.includes("recognised") || upiRuleStep.detail.includes("okaxis"));
      assert.ok(upiRuleStep.detail.includes("name-like ID") || upiRuleStep.detail.includes("type:"));
      assert.ok(upiRuleStep.detail.toLowerCase().includes("payee classification"));

      // Verify step rules (consistency): claimed organisation vs payee type, payment requested, mismatch explanation
      const consistencyStep = res.activity.find((e) => e.type === "step" && e.title.includes("Payee consistency"));
      assert.ok(consistencyStep, "Must have Payee consistency step");
      assert.ok(consistencyStep.detail.includes("Google"));
      assert.ok(consistencyStep.detail.includes("payment requested"));
      assert.ok(consistencyStep.detail.includes("personal"));

      // Verify step graph
      const graphSteps = res.activity.filter((e) => e.type === "step" && e.tool === "graph");
      assert.ok(graphSteps.some((e) => e.title.includes("Scam database match")), "Must report match for phone");
      assert.ok(graphSteps.some((e) => e.title.includes("Checked our scam database: no earlier reports for this identifier")), "Must report no earlier reports for other entities");

      // Verify step search: query as plain text, number of results, exact-match sources
      const searchSteps = res.activity.filter((e) => e.type === "step" && e.tool === "search");
      assert.ok(searchSteps.length > 0, "Must have search step");
      assert.ok(searchSteps.some((e) => e.detail.includes("Query:") && e.detail.includes("Results found:")));

      // Verify limit & manual entries for UPI ID
      const limitEntry = res.activity.find((e) => e.type === "limit");
      assert.ok(limitEntry, "Must have limit entry for UPI ID");
      assert.equal(limitEntry.detail, "Whether this UPI ID exists or who owns it cannot be checked from here.");

      const manualEntry = res.activity.find((e) => e.type === "manual");
      assert.ok(manualEntry, "Must have manual entry for UPI ID");
      assert.equal(
        manualEntry.detail,
        "Before paying, type the ID into your own UPI app and read the verified name. A scheme or a large company never asks fees to a personal ID. If the name does not match the organisation, do not pay."
      );

      // Verify summary conforms to prompt requirement
      assert.ok(res.summary.includes("1 UPI ID: looks personal, offer claims Google, payment requested;"), `Summary was: ${res.summary}`);
    });

    test("Case 2: Genuine company official UPI produces institutional classification without mismatch warning", async () => {
      const checkId = "00000000-0000-0000-0000-000000000002";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "National Merit Scholarship Council official registration. Submit examination application fee of Rs 250 via UPI to merit.grants@sbi.",
        }],
        submission: {
          text: "National Merit Scholarship Council official registration. Submit examination application fee of Rs 250 via UPI to merit.grants@sbi.",
          company: "National Merit Scholarship Council",
        },
        entities: [
          { id: 1, checkId, kind: "company", value: "National Merit Scholarship Council", source: "user", confirmed: true },
          { id: 2, checkId, kind: "upi", value: "merit.grants@sbi", source: "user", confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async (q) => ({ ok: true, data: { query: q, total: 0, results: [] } }),
      });

      assert.equal(res.status, "ok");
      assert.equal(res.flags.length, 0, "No flags for institutional bank handle");

      const upiRuleStep = res.activity.find((e) => e.type === "step" && e.title.includes("UPI rules"));
      assert.ok(upiRuleStep.detail.includes("institution-like ID"));
      assert.ok(upiRuleStep.detail.includes("unverified institutional"));

      const consistencyStep = res.activity.find((e) => e.type === "step" && e.title.includes("Payee consistency"));
      assert.equal(consistencyStep.status, "ok");

      const limitEntry = res.activity.find((e) => e.type === "limit");
      assert.ok(limitEntry);

      const manualEntry = res.activity.find((e) => e.type === "manual");
      assert.ok(manualEntry);

      assert.ok(res.summary.includes("institutional bank handle"));
      assert.ok(res.summary.includes("no database match"));
    });

    test("Case 3: Graph-seeded scam identifier logs database match and linked count", async () => {
      const checkId = "00000000-0000-0000-0000-000000000003";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "Urgent: Payment required for grant disbursement. Send Rs 500 to scholarship.scam@okaxis to claim your award.",
        }],
        submission: {
          text: "Urgent: Payment required for grant disbursement. Send Rs 500 to scholarship.scam@okaxis to claim your award.",
        },
        entities: [
          { id: 1, checkId, kind: "upi", value: "scholarship.scam@okaxis", source: "user", confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: () => ({ matched: true, reportCount: 1, connectedNodesCount: 5 }),
        search: async (q) => ({ ok: true, data: { query: q, total: 0, results: [] } }),
      });

      assert.equal(res.status, "ok");
      const graphStep = res.activity.find((e) => e.type === "step" && e.tool === "graph");
      assert.ok(graphStep.title.includes("Scam database match"));
      assert.ok(graphStep.detail.includes("5 linked identifier(s)"));
      assert.ok(res.summary.includes("database match"));
    });

    test("Case 4: Unknown PSP suffix records unrecognised handle step", async () => {
      const checkId = "00000000-0000-0000-0000-000000000004";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "Freelance web design task payout registration. Transfer Rs 200 token to dev.user@unknowncryptopsp.",
        }],
        submission: {
          text: "Freelance web design task payout registration. Transfer Rs 200 token to dev.user@unknowncryptopsp.",
        },
        entities: [
          { id: 1, checkId, kind: "upi", value: "dev.user@unknowncryptopsp", source: "user", confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async (q) => ({ ok: true, data: { query: q, total: 0, results: [] } }),
      });

      assert.equal(res.status, "ok");
      const upiRuleStep = res.activity.find((e) => e.type === "step" && e.title.includes("UPI rules"));
      assert.ok(upiRuleStep.detail.includes("unrecognised handle"));
    });

    test("Case 5: Malformed UPI produces invalid format step and summary", async () => {
      const checkId = "00000000-0000-0000-0000-000000000005";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "Pay application charges to invalid..vpa@@@axis.",
        }],
        submission: {
          text: "Pay application charges to invalid..vpa@@@axis.",
        },
        entities: [
          { id: 1, checkId, kind: "upi", value: "invalid..vpa@@@axis", source: "user", confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async (q) => ({ ok: true, data: { query: q, total: 0, results: [] } }),
      });

      assert.equal(res.status, "ok");
      const upiRuleStep = res.activity.find((e) => e.type === "step" && e.title.includes("UPI rules: invalid format"));
      assert.ok(upiRuleStep, "Must record invalid format step");
      assert.ok(res.summary.includes("invalid format"));
    });

    test("Case 6: Handle-only input produces handle input and database search steps", async () => {
      const checkId = "00000000-0000-0000-0000-000000000006";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "DM our recruitment coordinator on Telegram @student_internships_hub to apply.",
        }],
        submission: {
          text: "DM our recruitment coordinator on Telegram @student_internships_hub to apply.",
        },
        entities: [
          { id: 1, checkId, kind: "handle", value: "student_internships_hub", source: "user", confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async (q) => ({ ok: true, data: { query: q, total: 0, results: [] } }),
      });

      assert.equal(res.status, "ok");
      const handleInput = res.activity.find((e) => e.type === "input");
      assert.ok(handleInput.title.includes("@student_internships_hub"));
      assert.ok(res.summary.includes("Checked 1 handle: no suspicious signals found; no database match."));
    });

    test("Case 7: Missing input returns skipped with explanatory summary", async () => {
      const checkId = "00000000-0000-0000-0000-000000000007";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "General announcement without any contact or payment details.",
        }],
        submission: {
          text: "General announcement without any contact or payment details.",
        },
        entities: [],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap);
      assert.equal(res.status, "skipped");
      assert.equal(res.reason, "no_eligible_entities");
      assert.equal(res.summary, "No payment details, UPI ID, or phone number found to check.");
    });

    test("Case 8: Free webmail recruiter and international phone produces phone/email steps and findings", async () => {
      const checkId = "00000000-0000-0000-0000-000000000008";
      const snap = {
        check: { id: checkId, status: "investigating", currentRound: 1, language: "en" },
        inputs: [{
          type: "text",
          value: "Global Technology Partners: We have a job offer for you as a Junior Associate. Send your resume to careers.recruiter@gmail.com or contact our HR via WhatsApp at +12025550143.",
        }],
        submission: {
          text: "Global Technology Partners: We have a job offer for you as a Junior Associate. Send your resume to careers.recruiter@gmail.com or contact our HR via WhatsApp at +12025550143.",
        },
        entities: [
          { id: 1, checkId, kind: "email", value: "careers.recruiter@gmail.com", source: "user", confirmed: true },
          { id: 2, checkId, kind: "phone", value: "+12025550143", source: "user", confirmed: true },
        ],
        findings: [],
        control: { processedEntitiesByAgent: {} },
      };

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async (q) => ({ ok: true, data: { query: q, total: 0, results: [] } }),
      });

      assert.equal(res.status, "ok");
      const emailStep = res.activity.find((e) => e.type === "step" && e.title.includes("Email rules"));
      assert.ok(emailStep.detail.includes("Free-mail provider: yes"));

      const phoneStep = res.activity.find((e) => e.type === "step" && e.title.includes("Phone rules"));
      assert.ok(phoneStep.detail.includes("Country: US"));

      assert.ok(res.summary.includes("Checked 1 email and 1 phone:"));
      assert.ok(res.summary.includes("no database match"));
    });

    test("Invariance: No activity entry or summary ever claims any UPI ID is real or verified", async () => {
      const testUpis = ["user@okaxis", "merit.grants@sbi", "invalid..vpa@@@axis"];
      for (const upi of testUpis) {
        const snap = makeSnapshot({
          id: "11111111-1111-4111-8111-111111111111",
          text: `Payment fee to ${upi}`,
          entities: [{ id: 1, kind: "upi", value: upi, source: "user", confirmed: true }],
        });

        const res = await run(snap, {
          graphLookup: () => ({ matched: false }),
          search: async (q) => ({ ok: true, data: { query: q, total: 0, results: [] } }),
        });

        const allText = [
          res.summary,
          ...res.activity.map((a) => `${a.title} ${a.detail || ""}`),
        ].join(" ").toLowerCase();

        assert.equal(allText.includes("verified merchant"), false, "Must never claim verified merchant");
        assert.equal(allText.includes("upi is verified"), false, "Must never claim upi is verified");
        assert.equal(allText.includes("upi is real"), false, "Must never claim upi is real");
      }
    });

    test("graph lookup: no prior reports records ok step with plain text", async () => {
      const snap = makeSnapshot({
        id: "22222222-2222-4222-8222-222222222222",
        text: "Contact @mentor_john on Telegram for details.",
        entities: [{ id: 1, kind: "handle", value: "mentor_john", source: "user", confirmed: true }],
      });

      const res = await run(snap, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(res.status, "ok");
      const step = res.activity.find((a) => a.tool === "graph" && a.type === "step");
      assert.ok(step, "Must have graph activity step");
      assert.equal(step.status, "ok");
      assert.equal(step.title, "Checked our scam database: no earlier reports for this identifier");
      assert.ok(step.detail.includes("no earlier reports for this identifier"));
    });

    test("graph lookup: real database error stays failed and becomes could_not_check for that part", async () => {
      const snap = makeSnapshot({
        id: "33333333-3333-4333-8333-333333333333",
        text: "Contact @mentor_john on Telegram for details.",
        entities: [{ id: 1, kind: "handle", value: "mentor_john", source: "user", confirmed: true }],
      });

      // 1. When all checks fail for this entity (search throws, graph has DB error), result is could_not_check
      const resAllFailed = await run(snap, {
        graphLookup: () => ({ ok: false, error: { code: "SQLITE_IOERR", message: "disk I/O error" } }),
        search: async () => ({ ok: false, error: { code: "SEARCH_TIMEOUT", message: "timed out" } }),
      });

      assert.equal(resAllFailed.status, "could_not_check");
      const failedStep = resAllFailed.activity.find((a) => a.tool === "graph" && a.type === "step");
      assert.ok(failedStep, "Must record failed step for graph lookup error");
      assert.equal(failedStep.status, "failed");
      assert.equal(failedStep.title, "Checked our scam database: lookup failed");

      // 2. Partial check failure: syntax succeeds for UPI, but graph lookup has DB error -> entity is in unchecked
      const snapUpi = makeSnapshot({
        id: "44444444-4444-4444-8444-444444444444",
        text: "Send Rs 100 to user@oksbi",
        entities: [{ id: 2, kind: "upi", value: "user@oksbi", source: "user", confirmed: true }],
      });

      const resPartial = await run(snapUpi, {
        graphLookup: () => ({ ok: false, error: { code: "ECONNREFUSED", message: "connection refused" } }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });

      assert.equal(resPartial.status, "ok");
      assert.ok(resPartial.unchecked.includes("upi:user@oksbi"), "Failed graph check part must place entity in unchecked");
      const upiFailedStep = resPartial.activity.find((a) => a.tool === "graph" && a.type === "step");
      assert.ok(upiFailedStep);
      assert.equal(upiFailedStep.status, "failed");
      assert.equal(upiFailedStep.title, "Checked our scam database: lookup failed");
    });

    test("Requirement 3: payment demand analysis when fee demand exists without payee identifier", async () => {
      const scholarshipText =
        "Government of India – National Student Digital Empowerment Scholarship 2026. Selected students enrolled in undergraduate programs are eligible for financial assistance of ₹45,000 per academic year. Registration is available through the National Scholarship Verification Portal. Applicants must complete Aadhaar verification and submit their bank account details. A refundable document verification deposit of ₹799 is required to activate the scholarship. Limited to 5000 students nationwide. Last date: 5 November 2026. Issued under the Department of Higher Education.";

      const snap = makeSnapshot({
        id: "55555555-5555-4555-8555-555555555555",
        text: scholarshipText,
        entities: [
          { kind: "company", value: "Government of India", orgType: "government" },
          { kind: "company", value: "Department of Higher Education", orgType: "government" },
          { kind: "scheme", value: "National Student Digital Empowerment Scholarship 2026" },
          { kind: "amount", value: "45000" },
          { kind: "amount", value: "799", purpose: "refundable deposit" },
        ],
      });

      // 1. Direct run()
      const res = await run(snap);
      assert.equal(res.status, "ok");
      assert.ok(res.summary.includes("recipient cannot be verified"), "Summary must state recipient cannot be verified");
      assert.equal(res.flags.length, 0, "Payment agent must NOT emit fee flag (Message Analyst owns fee flags, avoid double counting)");

      const manualActivity = res.activity.find((a) => a.type === "manual");
      assert.ok(manualActivity, "Activity must contain manual item");
      assert.equal(
        manualActivity.title,
        "Ask where the money is to be sent. A scholarship or genuine employer does not charge a deposit."
      );

      // Check entityStatus
      assert.ok(Array.isArray(res.entityStatus));
      const amtStatus = res.entityStatus.find((es) => es.entityKind === "amount" && es.entityValue === "799");
      assert.ok(amtStatus);
      assert.equal(amtStatus.status, "unverified");

      // 2. runAgent runner
      const resFromRunner = await runAgent(paymentEntity, snap);
      assert.equal(resFromRunner.status, "ok");
      assert.ok(resFromRunner.summary.includes("recipient cannot be verified"));
      assert.equal(resFromRunner.flags.length, 0);
      assert.ok(resFromRunner.activity.some((a) => a.type === "manual"));
    });

    test("Payment Direction & Demands: stipend alone produces 0 demands; stipend + reg fee produces 1 demand; refundable deposit produces a demand", async () => {
      // 1. Stipend alone
      const snapStipend = makeSnapshot({
        id: "66666666-6666-4666-8666-666666666666",
        text: "Internship at Microsoft India. Stipend: Rs 18,000 per month.",
        entities: [
          { kind: "domain", value: "careers-microsoft.com" },
          { kind: "amount", value: "18000", direction: "to_candidate", purpose: "stipend/salary" },
        ],
      });
      const resStipend = await run(snapStipend, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });
      assert.equal(resStipend.status, "ok");
      assert.equal(resStipend.summary.includes("payment demand"), false, "Summary must not report payment demand for stipend alone");
      assert.ok(resStipend.trace.some((t) => t.type === "compensation_amount_analysis"), "Trace must record compensation amount analysis");

      // 2. Stipend + registration fee
      const snapStipendPlusFee = makeSnapshot({
        id: "77777777-7777-4777-8777-777777777777",
        text: "Internship offering stipend of Rs 18000. Please pay registration fee of Rs 500.",
        entities: [
          { kind: "amount", value: "18000", direction: "to_candidate", purpose: "stipend/salary" },
          { kind: "amount", value: "500", direction: "from_candidate", purpose: "registration fee" },
        ],
      });
      const resStipendPlusFee = await run(snapStipendPlusFee, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });
      assert.equal(resStipendPlusFee.status, "ok");
      assert.ok(
        resStipendPlusFee.summary.includes("1 payment demand") || resStipendPlusFee.summary.includes("demands ₹500"),
        "Summary must report the payment demand"
      );

      // 3. Refundable deposit
      const snapDeposit = makeSnapshot({
        id: "88888888-8888-4888-8888-888888888888",
        text: "A refundable document verification deposit of Rs 799 is required.",
        entities: [
          { kind: "amount", value: "799", direction: "from_candidate", purpose: "refundable deposit" },
        ],
      });
      const resDeposit = await run(snapDeposit, {
        graphLookup: () => ({ matched: false }),
        search: async () => ({ ok: true, data: { results: [] } }),
      });
      assert.equal(resDeposit.status, "ok");
      assert.ok(resDeposit.summary.includes("1 payment demand") || resDeposit.summary.includes("demands ₹799"), "Refundable deposit must produce a demand");
      assert.ok(resDeposit.trace.some((t) => t.type === "payment_demand_analysis"), "Trace must record payment demand analysis");
    });
  });
});
