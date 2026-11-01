import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NAME,
  KIND,
  canRun,
  skippedReason,
  run,
  classifierClient,
} from "../lib/agents/classifier-client.js";
import { runAgent } from "../lib/agents/base.js";
import { AgentResultSchema } from "../lib/contracts/agent-result.js";
import { FLAG_REGISTRY } from "../lib/contracts/flags.js";
import { clearScamScenario } from "../lib/contracts/fixtures/scenarios/scenario-a.js";
import { genuineNoticeScenario } from "../lib/contracts/fixtures/scenarios/scenario-b.js";
import { scoreCase } from "../lib/scoring/score.js";

function makeSnapshot({
  id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  round = 1,
  text = "Default message text for student opportunity verification.",
  findings = [],
  inputs,
  submission,
} = {}) {
  const finalInputs =
    inputs !== undefined
      ? inputs
      : text !== undefined
      ? [{ id: 1, checkId: id, type: "text", value: text }]
      : [];

  return {
    check: {
      id,
      status: "investigating",
      currentRound: round,
      language: "en",
      createdAt: "2026-10-21T00:00:00.000Z",
      expiresAt: "2026-10-22T00:00:00.000Z",
    },
    inputs: finalInputs,
    submission: submission ?? (text ? { text } : undefined),
    entities: [],
    findings,
    events: [],
    control: {
      processedEntitiesByAgent: {},
      pendingEntities: [],
    },
  };
}

describe("L4 Classifier Client Agent", () => {
  test("canRun false on empty text", () => {
    const snap1 = makeSnapshot({ text: "" });
    assert.equal(canRun(snap1), false);
    assert.equal(skippedReason(snap1), "no_message_text");

    const snap2 = makeSnapshot({ inputs: [] });
    delete snap2.submission;
    assert.equal(canRun(snap2), false);
    assert.equal(skippedReason(snap2), "no_message_text");

    const snap3 = makeSnapshot({ text: "   \t\n  " });
    assert.equal(canRun(snap3), false);
    assert.equal(skippedReason(snap3), "no_message_text");
  });

  test("canRun false in round 2", () => {
    const snap = makeSnapshot({ round: 2, text: "Suspicious scholarship message." });
    assert.equal(canRun(snap), false);
    assert.equal(skippedReason(snap), "round_not_supported");
  });

  test("canRun false when a result already exists", () => {
    const snap = makeSnapshot({
      round: 1,
      text: "Suspicious scholarship message.",
      findings: [
        {
          id: 1,
          checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          agent: NAME,
          kind: KIND,
          round: 1,
          status: "ok",
          reason: null,
          flags: [],
          verified: [],
          newEntities: [],
          processedEntities: [],
          unchecked: [],
          manualChecks: [],
          durationMs: 5,
          trace: [],
          notes: "",
        },
      ],
    });
    assert.equal(canRun(snap), false);
    assert.equal(skippedReason(snap), "already_ran");
  });

  test("canRun true on scenario A", () => {
    const snap = makeSnapshot({
      id: clearScamScenario.entities[0].checkId,
      round: 1,
      text: clearScamScenario.submission.text,
      submission: clearScamScenario.submission,
      entities: clearScamScenario.entities,
    });
    assert.equal(canRun(snap), true);
  });

  test("probability 0.95 with a topTerm present in the text gives ok, classifierResult attached, classifier_high with quote evidence", async () => {
    const sampleText = "Please pay registration fee immediately to secure your award.";
    const snap = makeSnapshot({ text: sampleText });

    const fakeClassify = async () => ({
      ok: true,
      data: {
        probability: 0.95,
        label: "suspicious",
        topTerms: ["registration fee", "nonexistent_term"],
        scamType: "fee_demand",
      },
    });

    const res = await run(snap, { classify: fakeClassify });

    assert.equal(res.status, "ok");
    assert.equal(res.agent, NAME);
    assert.ok(res.classifierResult);
    assert.equal(res.classifierResult.probability, 0.95);
    assert.equal(res.classifierResult.label, "suspicious");

    assert.equal(res.flags.length, 1);
    const flag = res.flags[0];
    assert.equal(flag.id, "classifier_high");
    assert.equal(flag.severity, FLAG_REGISTRY.classifier_high.severity);
    assert.equal(flag.evidence.length, 1);
    assert.equal(flag.evidence[0].type, "quote");
    assert.equal(flag.evidence[0].value, "registration fee");
  });

  test("probability 0.95 with no topTerm in the text gives ok, classifierResult attached, no flag", async () => {
    const sampleText = "Earn money from home by reviewing movies.";
    const snap = makeSnapshot({ text: sampleText });

    const fakeClassify = async () => ({
      ok: true,
      data: {
        probability: 0.95,
        label: "suspicious",
        topTerms: ["upfront fee", "crypto deposit"],
      },
    });

    const res = await run(snap, { classify: fakeClassify });

    assert.equal(res.status, "ok");
    assert.ok(res.classifierResult);
    assert.equal(res.classifierResult.probability, 0.95);
    assert.equal(res.flags.length, 0);
  });

  test("probability 0.79 gives no flag and 0.80 gives the flag (with a matching term)", async () => {
    const sampleText = "Pay upfront fee for scholarship.";
    const snap = makeSnapshot({ text: sampleText });

    // Case 1: probability 0.79 -> below threshold
    const fake79 = async () => ({
      ok: true,
      data: {
        probability: 0.79,
        label: "suspicious",
        topTerms: ["upfront fee"],
      },
    });
    const res79 = await run(snap, { classify: fake79 });
    assert.equal(res79.status, "ok");
    assert.ok(res79.classifierResult);
    assert.equal(res79.flags.length, 0);

    // Case 2: probability 0.80 -> reaches threshold
    const fake80 = async () => ({
      ok: true,
      data: {
        probability: 0.80,
        label: "suspicious",
        topTerms: ["upfront fee"],
      },
    });
    const res80 = await run(snap, { classify: fake80 });
    assert.equal(res80.status, "ok");
    assert.ok(res80.classifierResult);
    assert.equal(res80.flags.length, 1);
    assert.equal(res80.flags[0].id, "classifier_high");
    assert.equal(res80.flags[0].evidence[0].value, "upfront fee");
  });

  test("probability 0.30 gives ok, classifierResult attached, no flag", async () => {
    const sampleText = "Official campus research fellowship announcement.";
    const snap = makeSnapshot({ text: sampleText });

    const fakeClassify = async () => ({
      ok: true,
      data: {
        probability: 0.30,
        label: "benign",
        topTerms: ["fellowship"],
      },
    });

    const res = await run(snap, { classify: fakeClassify });
    assert.equal(res.status, "ok");
    assert.ok(res.classifierResult);
    assert.equal(res.classifierResult.probability, 0.30);
    assert.equal(res.classifierResult.label, "benign");
    assert.equal(res.flags.length, 0);
  });

  test("service failure gives could_not_check and no classifierResult", async () => {
    const snap = makeSnapshot({ text: "Opportunity message text." });

    // Simulated network/service error
    const failingClassify = async () => ({
      ok: false,
      error: { code: "UPSTREAM_ERROR", message: "Classifier service unavailable" },
    });

    const res = await run(snap, { classify: failingClassify });
    assert.equal(res.status, "could_not_check");
    assert.equal(res.reason, "classifier_unavailable");
    assert.equal(res.classifierResult, undefined);
    assert.deepEqual(res.flags, []);
  });

  test("probability 1.2 and NaN give could_not_check invalid_result", async () => {
    const snap = makeSnapshot({ text: "Opportunity message text." });

    // 1. probability 1.2 (> 1.0)
    const invalid1 = async () => ({
      ok: true,
      data: {
        probability: 1.2,
        label: "suspicious",
        topTerms: [],
      },
    });
    const res1 = await run(snap, { classify: invalid1 });
    assert.equal(res1.status, "could_not_check");
    assert.equal(res1.reason, "invalid_result");
    assert.equal(res1.classifierResult, undefined);

    // 2. probability NaN
    const invalid2 = async () => ({
      ok: true,
      data: {
        probability: NaN,
        label: "suspicious",
        topTerms: [],
      },
    });
    const res2 = await run(snap, { classify: invalid2 });
    assert.equal(res2.status, "could_not_check");
    assert.equal(res2.reason, "invalid_result");
    assert.equal(res2.classifierResult, undefined);
  });

  test("a could_not_check result built with a classifierResult is rejected by the AgentResult schema", () => {
    const invalidCandidate = {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: NAME,
      kind: KIND,
      round: 1,
      status: "could_not_check",
      reason: "error",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      durationMs: 10,
      classifierResult: {
        probability: 0.85,
        label: "suspicious",
        topTerms: ["fee"],
      },
    };

    const parseResult = AgentResultSchema.safeParse(invalidCandidate);
    assert.equal(parseResult.success, false);
    assert.match(
      parseResult.error.message,
      /classifierResult is allowed ONLY when status is 'ok'/
    );
  });

  test("at most 3 quote items on the flag when 5 terms match", async () => {
    const sampleText = "one two three four five six seven";
    const snap = makeSnapshot({ text: sampleText });

    const fakeClassify = async () => ({
      ok: true,
      data: {
        probability: 0.90,
        label: "suspicious",
        topTerms: ["one", "two", "three", "four", "five"],
      },
    });

    const res = await run(snap, { classify: fakeClassify });
    assert.equal(res.status, "ok");
    assert.equal(res.flags.length, 1);
    assert.equal(res.flags[0].evidence.length, 3);
    assert.deepEqual(
      res.flags[0].evidence.map((e) => e.value),
      ["one", "two", "three"]
    );
  });

  test("the ok result fed into scoreCase (import lib/scoring in the test only) gives classifierPoints 13 at p=0.75 and 25 at p=1.0 (proves agent output and scoring input line up)", async () => {
    const sampleText = "Opportunity message text.";
    const snap = makeSnapshot({ text: sampleText });

    // p = 0.75 -> classifierPoints 13
    const fake75 = async () => ({
      ok: true,
      data: {
        probability: 0.75,
        label: "suspicious",
        topTerms: [],
      },
    });
    const res75 = await run(snap, { classify: fake75 });
    const score75 = scoreCase({ findings: [res75] });
    assert.equal(score75.classifierPoints, 13);

    // p = 1.0 -> classifierPoints 25
    const fake100 = async () => ({
      ok: true,
      data: {
        probability: 1.0,
        label: "suspicious",
        topTerms: [],
      },
    });
    const res100 = await run(snap, { classify: fake100 });
    const score100 = scoreCase({ findings: [res100] });
    assert.equal(score100.classifierPoints, 25);
  });

  test("the result validates against the AgentResult schema on scenarios A and B texts", async () => {
    // Scenario A
    const snapA = makeSnapshot({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      text: clearScamScenario.submission.text,
      submission: clearScamScenario.submission,
    });
    const fakeClassifyA = async () => ({
      ok: true,
      data: {
        probability: 0.92,
        label: "suspicious",
        topTerms: ["verification fee", "funds"],
      },
    });
    const resA = await run(snapA, { classify: fakeClassifyA });
    const validatedA = AgentResultSchema.parse(resA);
    assert.equal(validatedA.status, "ok");
    assert.equal(validatedA.flags.length, 1);
    assert.ok(validatedA.classifierResult);

    // Scenario B
    const snapB = makeSnapshot({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      text: genuineNoticeScenario.submission.text,
      submission: genuineNoticeScenario.submission,
    });
    const fakeClassifyB = async () => ({
      ok: true,
      data: {
        probability: 0.05,
        label: "benign",
        topTerms: ["fellowship"],
      },
    });
    const resB = await run(snapB, { classify: fakeClassifyB });
    const validatedB = AgentResultSchema.parse(resB);
    assert.equal(validatedB.status, "ok");
    assert.equal(validatedB.flags.length, 0);
    assert.ok(validatedB.classifierResult);
  });

  test("runAgent on a skipped case does not call the fake classify (count 0)", async () => {
    const snap = makeSnapshot({ text: "" }); // Empty text -> skipped
    let callCount = 0;
    const fakeClassify = async () => {
      callCount++;
      return { ok: true, data: { probability: 0.9, label: "suspicious", topTerms: [] } };
    };

    const res = await runAgent(classifierClient, snap, { classify: fakeClassify });
    assert.equal(callCount, 0);
    assert.equal(res.status, "skipped");
    assert.equal(res.reason, "no_message_text");
  });

  test("no network call occurs", async () => {
    const snap = makeSnapshot({ text: "Completely offline message text." });
    let callCount = 0;
    const fakeClassify = async () => {
      callCount++;
      return {
        ok: true,
        data: {
          probability: 0.4,
          label: "benign",
          topTerms: [],
        },
      };
    };

    const res = await run(snap, { classify: fakeClassify });
    assert.equal(callCount, 1);
    assert.equal(res.status, "ok");
  });

  describe("Classifier Cap Wiring and Health Integration", () => {
    test("/health with synthetic provenance gives classifierMaxPoints 10", async () => {
      const snap = makeSnapshot({ text: "Opportunity text with scholarships and grants" });
      const fakeHealth = async () => ({
        ok: true,
        data: {
          status: "ok",
          data_provenance: "synthetic",
          real_row_count: 25,
        },
      });
      const fakeClassify = async () => ({
        ok: true,
        data: {
          probability: 0.9,
          label: "suspicious",
          topTerms: ["scholarships"],
        },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "ok");
      const healthTrace = res.trace.find((t) => t.check === "health");
      assert.ok(healthTrace, "Must include health check in trace");
      assert.equal(healthTrace.classifierMaxPoints, 10);
      assert.ok(res.notes.includes("classifierMaxPoints=10"));
    });

    test("/health with mixed_synthetic_and_public provenance and real_row_count 100 gives 10", async () => {
      const snap = makeSnapshot({ text: "Opportunity text with scholarships and grants" });
      const fakeHealth = async () => ({
        ok: true,
        data: {
          status: "ok",
          data_provenance: "mixed_synthetic_and_public",
          real_row_count: 100,
        },
      });
      const fakeClassify = async () => ({
        ok: true,
        data: {
          probability: 0.9,
          label: "suspicious",
          topTerms: ["scholarships"],
        },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "ok");
      const healthTrace = res.trace.find((t) => t.check === "health");
      assert.ok(healthTrace);
      assert.equal(healthTrace.classifierMaxPoints, 10);
      assert.ok(res.notes.includes("classifierMaxPoints=10"));
    });

    test("/health with real provenance and 60 or more rows gives 25", async () => {
      const snap = makeSnapshot({ text: "Opportunity text with scholarships and grants" });
      const fakeHealth = async () => ({
        ok: true,
        data: {
          status: "ok",
          data_provenance: "real",
          real_row_count: 60,
        },
      });
      const fakeClassify = async () => ({
        ok: true,
        data: {
          probability: 0.9,
          label: "suspicious",
          topTerms: ["scholarships"],
        },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "ok");
      const healthTrace = res.trace.find((t) => t.check === "health");
      assert.ok(healthTrace);
      assert.equal(healthTrace.classifierMaxPoints, 25);
      assert.ok(res.notes.includes("classifierMaxPoints=25"));
    });

    test("/health with real provenance and below 60 rows gives 10", async () => {
      const snap = makeSnapshot({ text: "Opportunity text with scholarships and grants" });
      const fakeHealth = async () => ({
        ok: true,
        data: {
          status: "ok",
          data_provenance: "real",
          real_row_count: 59,
        },
      });
      const fakeClassify = async () => ({
        ok: true,
        data: {
          probability: 0.9,
          label: "suspicious",
          topTerms: ["scholarships"],
        },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "ok");
      const healthTrace = res.trace.find((t) => t.check === "health");
      assert.ok(healthTrace);
      assert.equal(healthTrace.classifierMaxPoints, 10);
      assert.ok(res.notes.includes("classifierMaxPoints=10"));
    });

    test("/health with real rows of 60 or more and non-synthetic provenance gives 25", async () => {
      const snap = makeSnapshot({ text: "Opportunity text with scholarships and grants" });
      const fakeHealth = async () => ({
        ok: true,
        data: {
          status: "ok",
          data_provenance: "real_public_reports",
          real_row_count: 120,
        },
      });
      const fakeClassify = async () => ({
        ok: true,
        data: {
          probability: 0.9,
          label: "suspicious",
          topTerms: ["scholarships"],
        },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "ok");
      const healthTrace = res.trace.find((t) => t.check === "health");
      assert.ok(healthTrace);
      assert.equal(healthTrace.classifierMaxPoints, 25);
      assert.ok(res.notes.includes("classifierMaxPoints=25"));
    });

    test("service down on health gives could_not_check with no points", async () => {
      const snap = makeSnapshot({ text: "Opportunity text" });
      const fakeHealth = async () => ({
        ok: false,
        error: { code: "NETWORK", message: "Failed to connect to classifier" },
      });
      const fakeClassify = async () => {
        throw new Error("Should not be called if health check fails");
      };

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "could_not_check");
      assert.equal(res.classifierResult, undefined);

      // Verify that scoring with this finding adds 0 points
      const scoreResult = scoreCase(makeSnapshot({ findings: [res] }));
      assert.equal(scoreResult.score, 0);
    });
  });

  describe("Activity Log & Instrumentation", () => {
    test("input records text length of main message only (userNotes ignored)", async () => {
      const mainText = "Pay 1000 deposit to secure student internship";
      const snap = makeSnapshot({ text: mainText });
      snap.userNotes = "User was approached via Instagram DM offering 50k per month";

      let capturedText = null;
      const fakeClassify = async (txt) => {
        capturedText = txt;
        return {
          ok: true,
          data: {
            probability: 0.88,
            label: "suspicious",
            topTerms: ["deposit", "internship"],
          },
        };
      };
      const fakeHealth = async () => ({
        ok: true,
        data: { data_provenance: "synthetic", real_row_count: 0 },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "ok");
      assert.equal(capturedText, mainText, "Classifier must receive main message text only, never userNotes");

      assert.ok(Array.isArray(res.activity));
      const inputEntry = res.activity.find((a) => a.type === "input");
      assert.ok(inputEntry, "Activity must contain an input entry");
      assert.equal(inputEntry.tool, "classifier");
      assert.ok(inputEntry.detail.includes(`${mainText.length} characters`));
      assert.ok(inputEntry.detail.includes("Main message text only"));
    });

    test("down: reports plain reason plus dev start command in dev and production message in prod", async () => {
      const snap = makeSnapshot({ text: "Offer letter requiring registration fee" });
      const fakeHealth = async () => ({
        ok: false,
        error: { code: "NETWORK", message: "ECONNREFUSED" },
      });

      // 1. Development mode
      const oldEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "development";
        const resDev = await run(snap, { classifierHealth: fakeHealth });
        assert.equal(resDev.status, "could_not_check");
        assert.equal(resDev.reason, "classifier_service_unavailable");
        assert.ok(Array.isArray(resDev.activity));

        const limitDev = resDev.activity.find((a) => a.type === "limit");
        assert.ok(limitDev);
        assert.equal(limitDev.status, "failed");
        assert.ok(limitDev.detail.includes("npm run dev:all"));
        assert.ok(resDev.summary.includes("npm run dev:all"));

        // 2. Production mode
        process.env.NODE_ENV = "production";
        const resProd = await run(snap, { classifierHealth: fakeHealth });
        assert.equal(resProd.status, "could_not_check");
        assert.equal(resProd.reason, "classifier_service_unavailable");

        const limitProd = resProd.activity.find((a) => a.type === "limit");
        assert.ok(limitProd);
        assert.equal(limitProd.status, "failed");
        assert.ok(limitProd.detail.toLowerCase().includes("the classifier was unavailable"));
        assert.ok(resProd.summary.toLowerCase().includes("the classifier was unavailable"));
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
    });

    test("slow: handles timeout with failed step, limit and clear summary", async () => {
      const snap = makeSnapshot({ text: "Suspicious task offer" });
      const fakeHealth = async () => ({
        ok: true,
        data: { data_provenance: "synthetic", real_row_count: 0 },
      });
      const fakeClassify = async () => ({
        ok: false,
        error: { code: "TIMEOUT", message: "Classifier request timed out" },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "could_not_check");
      assert.equal(res.reason, "timeout");

      const limitEntry = res.activity.find((a) => a.type === "limit");
      assert.ok(limitEntry);
      assert.equal(limitEntry.status, "failed");
      assert.ok(limitEntry.title.includes("timed out") || limitEntry.detail.includes("timed out"));
      assert.ok(res.summary.includes("timed out"));
    });

    test("bad payload: handles schema validation error gracefully with failed step and limit", async () => {
      const snap = makeSnapshot({ text: "Suspicious offer with deposit" });
      const fakeHealth = async () => ({
        ok: true,
        data: { data_provenance: "synthetic", real_row_count: 0 },
      });
      const fakeClassify = async () => ({
        ok: true,
        data: {
          probability: 9.99, // Invalid probability
          label: "not_a_valid_label",
        },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "could_not_check");
      assert.equal(res.reason, "invalid_result");

      const limitEntry = res.activity.find((a) => a.type === "limit");
      assert.ok(limitEntry);
      assert.equal(limitEntry.status, "failed");
      assert.ok(limitEntry.detail.includes("schema validation"));
      assert.ok(res.summary.includes("invalid"));
    });

    test("success: records step with probability %, label, clean top terms (no <AMT>), info with points and synthetic cap, and standard summary", async () => {
      const snap = makeSnapshot({ text: "Urgent scholarship registration: pay deposit on telegram now" });
      const fakeHealth = async () => ({
        ok: true,
        data: { data_provenance: "synthetic", real_row_count: 10 },
      });
      const fakeClassify = async () => ({
        ok: true,
        data: {
          probability: 0.88,
          label: "suspicious",
          topTerms: ["<AMT>", "deposit", "<URL>", "telegram", "amt"],
        },
      });

      const res = await run(snap, { classify: fakeClassify, classifierHealth: fakeHealth });
      assert.equal(res.status, "ok");

      // Verify activity entries
      const entries = res.activity;
      assert.ok(entries.length >= 3);

      // 1. Input entry
      const inputEntry = entries.find((e) => e.type === "input");
      assert.ok(inputEntry);
      assert.equal(inputEntry.tool, "classifier");
      assert.ok(inputEntry.detail.includes("Main message text only"));

      // 2. Classifier evaluation step
      const stepEntry = entries.find((e) => e.type === "step" && e.title.includes("Classifier evaluation"));
      assert.ok(stepEntry);
      assert.equal(stepEntry.status, "ok");
      assert.equal(stepEntry.tool, "classifier");
      assert.ok(stepEntry.detail.includes("Service reachable"));
      assert.ok(stepEntry.detail.includes("88% scam probability"));
      assert.ok(stepEntry.detail.includes("suspicious"));
      assert.ok(stepEntry.detail.includes("deposit, telegram"));
      assert.ok(!stepEntry.detail.includes("<AMT>"), "Placeholder tokens like <AMT> must be filtered out");
      assert.ok(!stepEntry.detail.includes("amt"), "Placeholder word 'amt' must be filtered out");

      // 3. Info entry for scoring points contribution & synthetic cap rationale
      const infoEntry = entries.find((e) => e.type === "step" && e.status === "info");
      assert.ok(infoEntry);
      assert.equal(infoEntry.tool, "classifier");
      assert.ok(infoEntry.detail.includes("Adds 8 points to risk score"));
      assert.ok(infoEntry.detail.includes("capped at 10 points"));
      assert.ok(infoEntry.detail.includes("trained mostly on synthetic examples; treat as a weak signal, not proof"));

      // 4. Summary format: "Language model says 88% scam-like (weak signal; adds 8 points)."
      assert.equal(res.summary, "Language model says 88% scam-like (weak signal; adds 8 points).");

      // 5. Check classifierResult attached has clean topTerms
      assert.deepEqual(res.classifierResult.topTerms, ["deposit", "telegram"]);
    });
  });
});
