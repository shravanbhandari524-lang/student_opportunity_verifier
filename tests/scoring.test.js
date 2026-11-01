import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoreCase, score } from "../lib/scoring/score.js";
import { defaultConfig, ScoringConfigSchema } from "../lib/scoring/config.js";
import { ScoreResultSchema } from "../lib/contracts/score-result.js";
import { FLAG_REGISTRY } from "../lib/contracts/flags.js";
import { scoringInputFixtures } from "../lib/contracts/fixtures/scoring-inputs.js";
import {
  buildClearScamCaseFile,
  buildGenuineNoticeCaseFile,
  buildAmbiguousThinEvidenceCaseFile,
} from "../lib/contracts/fixtures/scenarios/index.js";
import { validFixtures } from "../lib/contracts/fixtures/valid/valid-fixtures.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeFinding({
  agent = "message_analyst",
  round = 1,
  status = "ok",
  flags = [],
  verified = [],
  classifierResult = null,
  ...rest
} = {}) {
  const finding = { agent, round, status, flags, verified, ...rest };
  if (classifierResult !== null) {
    finding.classifierResult = classifierResult;
  }
  return finding;
}

function makeSnapshot(findings = []) {
  return { findings };
}

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

describe("L3 Decision: scoreCase engine", () => {
  // Test 1
  test("scenario A gives high; B gives low; C gives cannot_verify", () => {
    const resA = scoreCase(buildClearScamCaseFile());
    assert.equal(resA.level, "high");
    assert.equal(resA.score, 100);
    assert.equal(resA.confidence, "high");
    assert.equal(resA.confidenceCapped, false);
    assert.deepEqual(resA.rulesFired, ["scholarship_fee_demand", "soft_flag_cap_applied"]);

    const resB = scoreCase(buildGenuineNoticeCaseFile());
    assert.equal(resB.level, "low");
    assert.equal(resB.score, 0);
    assert.equal(resB.confidence, "high");
    assert.equal(resB.confidenceCapped, false);
    assert.deepEqual(resB.rulesFired, []);

    const resC = scoreCase(buildAmbiguousThinEvidenceCaseFile());
    assert.equal(resC.level, "cannot_verify");
    assert.equal(resC.score, 10);
    assert.equal(resC.confidence, "low");
    assert.equal(resC.confidenceCapped, false);
    assert.deepEqual(resC.rulesFired, []);
  });

  // Test 2
  test("skipped results do not change completionRatio or confidence", () => {
    const baseFindings = [
      makeFinding({ agent: "message_analyst", status: "ok" }),
      makeFinding({ agent: "website_forensics", status: "ok", verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }] }),
      makeFinding({ agent: "official_verifier", status: "ok" }),
      makeFinding({ agent: "payment_entity", status: "ok" }),
    ];
    const withSkippedFindings = [
      ...baseFindings,
      makeFinding({ agent: "reputation_osint", status: "skipped" }),
      makeFinding({ agent: "classifier_client", status: "skipped" }),
    ];

    const baseRes = scoreCase(makeSnapshot(baseFindings));
    const withSkippedRes = scoreCase(makeSnapshot(withSkippedFindings));

    assert.equal(baseRes.completedCount, 4);
    assert.equal(baseRes.eligibleCount, 4);
    assert.equal(baseRes.completionRatio, 1.0);
    assert.equal(baseRes.confidence, "high");

    assert.equal(withSkippedRes.completedCount, 4);
    assert.equal(withSkippedRes.eligibleCount, 4);
    assert.equal(withSkippedRes.completionRatio, 1.0);
    assert.equal(withSkippedRes.confidence, "high");
  });

  // Test 3
  test("could_not_check lowers the ratio and confidence", () => {
    const allOk = [
      makeFinding({ agent: "message_analyst", status: "ok" }),
      makeFinding({ agent: "website_forensics", status: "ok", verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }] }),
      makeFinding({ agent: "official_verifier", status: "ok" }),
      makeFinding({ agent: "payment_entity", status: "ok" }),
    ];
    const resAllOk = scoreCase(makeSnapshot(allOk));
    assert.equal(resAllOk.completionRatio, 1.0);
    assert.equal(resAllOk.confidence, "high");

    // 2 ok, 2 could_not_check -> ratio 0.50 -> medium
    const halfFailed = [
      makeFinding({ agent: "message_analyst", status: "ok" }),
      makeFinding({ agent: "website_forensics", status: "ok", verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }] }),
      makeFinding({ agent: "official_verifier", status: "could_not_check" }),
      makeFinding({ agent: "payment_entity", status: "could_not_check" }),
    ];
    const resHalf = scoreCase(makeSnapshot(halfFailed));
    assert.equal(resHalf.completionRatio, 0.50);
    assert.equal(resHalf.confidence, "medium");

    // 1 ok, 3 could_not_check -> ratio 0.25 -> low
    const mostlyFailed = [
      makeFinding({ agent: "message_analyst", status: "ok" }),
      makeFinding({ agent: "website_forensics", status: "could_not_check" }),
      makeFinding({ agent: "official_verifier", status: "could_not_check" }),
      makeFinding({ agent: "payment_entity", status: "could_not_check" }),
    ];
    const resMostly = scoreCase(makeSnapshot(mostlyFailed));
    assert.equal(resMostly.completionRatio, 0.25);
    assert.equal(resMostly.confidence, "low");
  });

  // Test 4
  test("zero eligible results gives cannot_verify, low, reasonCodes contains no_eligible_agents", () => {
    const skippedOnly = makeSnapshot([
      makeFinding({ agent: "website_forensics", status: "skipped" }),
      makeFinding({ agent: "payment_entity", status: "skipped" }),
    ]);
    const res = scoreCase(skippedOnly);
    assert.equal(res.level, "cannot_verify");
    assert.equal(res.score, 0);
    assert.equal(res.confidence, "low");
    assert.equal(res.completedCount, 0);
    assert.equal(res.eligibleCount, 0);
    assert.equal(res.completionRatio, 0);
    assert.ok(res.reasonCodes.includes("no_eligible_agents"));

    const empty = scoreCase(makeSnapshot([]));
    assert.equal(empty.level, "cannot_verify");
    assert.ok(empty.reasonCodes.includes("no_eligible_agents"));
  });

  // Test 5
  test("ratio 0.39 with score 59 gives cannot_verify; ratio 0.40 with the same score does not", () => {
    // 59 points: otp_or_id_request (30) + bank_details_request (25) + classifier 4 (at p=0.58) = 59
    const scoringFindings = [
      makeFinding({
        agent: "message_analyst",
        status: "ok",
        flags: [
          { id: "otp_or_id_request", severity: "high" },
          { id: "bank_details_request", severity: "high" },
        ],
      }),
      makeFinding({
        agent: "classifier_client",
        status: "ok",
        classifierResult: {
          probability: 0.58, // round(25 * (0.08 / 0.5)) = round(4) = 4
          label: "suspicious",
          topTerms: ["otp", "bank"],
        },
      }),
    ];

    // Ratio 0.39: 39 ok, 61 could_not_check (total 100 eligible)
    const findings39 = [...scoringFindings];
    while (findings39.length < 39) {
      findings39.push(makeFinding({ agent: `agent_ok_${findings39.length}`, status: "ok" }));
    }
    while (findings39.length < 100) {
      findings39.push(makeFinding({ agent: `agent_fail_${findings39.length}`, status: "could_not_check" }));
    }

    const res39 = scoreCase(makeSnapshot(findings39));
    assert.equal(res39.score, 59);
    assert.equal(res39.completionRatio, 0.39);
    assert.equal(res39.level, "cannot_verify");

    // Ratio 0.40: 40 ok, 60 could_not_check (total 100 eligible)
    const findings40 = [...scoringFindings];
    while (findings40.length < 40) {
      findings40.push(makeFinding({ agent: `agent_ok_${findings40.length}`, status: "ok" }));
    }
    while (findings40.length < 100) {
      findings40.push(makeFinding({ agent: `agent_fail_${findings40.length}`, status: "could_not_check" }));
    }

    const res40 = scoreCase(makeSnapshot(findings40));
    assert.equal(res40.score, 59);
    assert.equal(res40.completionRatio, 0.40);
    assert.equal(res40.level, "medium");
  });

  // Test 6
  test("ratio below 0.40 with score 60 or more stays high; ratio below 0.40 with a hard rule never gives cannot_verify", () => {
    // 1 ok, 3 could_not_check -> ratio 0.25 (< 0.40)
    // Non-hard-rule flags totaling 60: task_deposit_script (30) + apk_download_prompt (30)
    const snapshotHigh = makeSnapshot([
      makeFinding({
        agent: "website_forensics",
        status: "ok",
        flags: [
          { id: "task_deposit_script", severity: "high" },
          { id: "apk_download_prompt", severity: "high" },
        ],
      }),
      makeFinding({ agent: "official_verifier", status: "could_not_check" }),
      makeFinding({ agent: "payment_entity", status: "could_not_check" }),
      makeFinding({ agent: "reputation_osint", status: "could_not_check" }),
    ]);
    const resHigh = scoreCase(snapshotHigh);
    assert.equal(resHigh.completionRatio, 0.25);
    assert.equal(resHigh.score, 60);
    assert.equal(resHigh.level, "high");

    // Hard rule flag with score < 60 originally: mule_account_request (40)
    const snapshotHardRule = makeSnapshot([
      makeFinding({
        agent: "message_analyst",
        status: "ok",
        flags: [{ id: "mule_account_request", severity: "high" }],
      }),
      makeFinding({ agent: "official_verifier", status: "could_not_check" }),
      makeFinding({ agent: "payment_entity", status: "could_not_check" }),
      makeFinding({ agent: "reputation_osint", status: "could_not_check" }),
    ]);
    const resHardRule = scoreCase(snapshotHardRule);
    assert.equal(resHardRule.completionRatio, 0.25);
    assert.equal(resHardRule.score, 60); // raised to floor 60
    assert.equal(resHardRule.level, "high");
    assert.deepEqual(resHardRule.rulesFired, ["mule_account_request"]);
  });

  // Test 7
  test("thresholds at 24/25 and 59/60 give low/medium and medium/high", () => {
    // Score 24: urgency_pressure (10, low) + candidate_picks_hours (10, low) + classifier 4 (p=0.58) = 24
    // With 2 signal types and a positive verified signal, low is allowed
    const res24 = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [
            { id: "urgency_pressure", severity: "low" },
            { id: "candidate_picks_hours", severity: "low" },
          ],
        }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }],
        }),
        makeFinding({
          agent: "classifier_client",
          status: "ok",
          classifierResult: { probability: 0.58, label: "suspicious", topTerms: [] },
        }),
      ])
    );
    assert.equal(res24.score, 24);
    assert.equal(res24.level, "low");

    // Score 25: bank_details_request (25, high) -> score 25 -> medium
    const res25 = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [{ id: "bank_details_request", severity: "high" }],
        }),
      ])
    );
    assert.equal(res25.score, 25);
    assert.equal(res25.level, "medium");

    // Score 59: otp_or_id_request (30) + bank_details_request (25) + classifier 4 = 59
    const res59 = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [
            { id: "otp_or_id_request", severity: "high" },
            { id: "bank_details_request", severity: "high" },
          ],
        }),
        makeFinding({
          agent: "classifier_client",
          status: "ok",
          classifierResult: { probability: 0.58, label: "suspicious", topTerms: [] },
        }),
      ])
    );
    assert.equal(res59.score, 59);
    assert.equal(res59.level, "medium");

    // Score 60: task_deposit_script (30) + apk_download_prompt (30) = 60
    const res60 = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [
            { id: "task_deposit_script", severity: "high" },
            { id: "apk_download_prompt", severity: "high" },
          ],
        }),
      ])
    );
    assert.equal(res60.score, 60);
    assert.equal(res60.level, "high");
  });

  // Test 8
  test("the same flag id from two agents counts once and agents lists both", () => {
    const snapshot = makeSnapshot([
      makeFinding({
        agent: "message_analyst",
        status: "ok",
        flags: [{ id: "urgency_pressure", severity: "low" }],
      }),
      makeFinding({
        agent: "official_verifier",
        status: "ok",
        flags: [{ id: "urgency_pressure", severity: "low" }],
      }),
    ]);
    const res = scoreCase(snapshot);
    assert.equal(res.score, 10);
    assert.equal(res.flagPoints.length, 1);
    const fp = res.flagPoints[0];
    assert.equal(fp.id, "urgency_pressure");
    assert.equal(fp.weight, 10);
    assert.equal(fp.points, 10);
    assert.equal(fp.status, "counted");
    assert.deepEqual(fp.agents, ["message_analyst", "official_verifier"]);
  });

  // Test 9
  test("fee group: both fee flags count only 30, one is group_suppressed; scholarship_fee_demand alone fires the hard rule; fee_demand alone fires no hard rule", () => {
    // Both present: total fee points 30, one suppressed
    const bothSnapshot = makeSnapshot([
      makeFinding({
        agent: "message_analyst",
        status: "ok",
        flags: [
          { id: "scholarship_fee_demand", severity: "high" },
          { id: "fee_demand", severity: "high" },
        ],
      }),
    ]);
    const resBoth = scoreCase(bothSnapshot);
    const feeFPs = resBoth.flagPoints.filter(
      (fp) => fp.id === "scholarship_fee_demand" || fp.id === "fee_demand"
    );
    assert.equal(feeFPs.length, 2);
    const counted = feeFPs.find((fp) => fp.status === "counted");
    const suppressed = feeFPs.find((fp) => fp.status === "group_suppressed");
    assert.ok(counted, "expected one counted fee flag");
    assert.ok(suppressed, "expected one suppressed fee flag");
    assert.equal(counted.points, 30);
    assert.equal(suppressed.points, 0);
    assert.ok(resBoth.rulesFired.includes("scholarship_fee_demand"));

    // scholarship_fee_demand alone fires hard rule
    const scholarRes = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "scholarship_fee_demand", severity: "high" }],
        }),
      ])
    );
    assert.equal(scholarRes.level, "high");
    assert.equal(scholarRes.score, 60);
    assert.deepEqual(scholarRes.rulesFired, ["scholarship_fee_demand"]);

    // fee_demand alone fires NO hard rule
    const feeDemandRes = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "fee_demand", severity: "high" }],
        }),
      ])
    );
    assert.equal(feeDemandRes.level, "medium");
    assert.equal(feeDemandRes.score, 30);
    assert.deepEqual(feeDemandRes.rulesFired, []);
  });

  // Test 10
  test("each hard rule alone forces high with score at least 60 and appears in rulesFired; the hard rule is ignored when its flag appears only in a could_not_check result (validation bypassed)", () => {
    const hardRuleIds = ["scholarship_fee_demand", "mule_account_request", "graph_match"];
    for (const ruleId of hardRuleIds) {
      const res = scoreCase(
        makeSnapshot([
          makeFinding({
            agent: "payment_entity",
            status: "ok",
            flags: [{ id: ruleId, severity: "high" }],
          }),
        ])
      );
      assert.equal(res.level, "high");
      assert.ok(res.score >= 60);
      assert.deepEqual(res.rulesFired, [ruleId]);
    }

    // Flag appears only in a could_not_check result (bypassing normal contract validation)
    const unverifiedHardRule = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "payment_entity",
          status: "could_not_check",
          flags: [{ id: "mule_account_request", severity: "high" }],
        }),
      ])
    );
    assert.equal(unverifiedHardRule.score, 0);
    assert.equal(unverifiedHardRule.rulesFired.includes("mule_account_request"), false);
    assert.equal(unverifiedHardRule.level, "cannot_verify");
  });

  // Test 11
  test("classifier points at p = 0.5, 0.75, 1.0, 0.3 give 0, 13 (round of 12.5, state the rounding), 25, 0; classifier could_not_check gives 0; classifier_high flag adds 0 flag points", () => {
    const testP = (probability) => {
      return scoreCase(
        makeSnapshot([
          makeFinding({
            agent: "classifier_client",
            status: "ok",
            classifierResult: { probability, label: "suspicious", topTerms: [] },
          }),
        ])
      );
    };

    assert.equal(testP(0.5).classifierPoints, 0);
    // At p = 0.75: 25 * (0.25 / 0.5) = 12.5; Math.round(12.5) === 13
    assert.equal(testP(0.75).classifierPoints, 13);
    assert.equal(testP(1.0).classifierPoints, 25);
    assert.equal(testP(0.3).classifierPoints, 0);

    // classifier could_not_check gives 0
    const failRes = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "classifier_client",
          status: "could_not_check",
        }),
      ])
    );
    assert.equal(failRes.classifierPoints, 0);

    // classifier_high flag adds 0 flag points
    const flagRes = scoreCase(
      makeSnapshot([
        makeFinding({
          agent: "classifier_client",
          status: "ok",
          flags: [{ id: "classifier_high", severity: "medium" }],
        }),
      ])
    );
    assert.equal(flagRes.score, 0);
    const ch = flagRes.flagPoints.find((fp) => fp.id === "classifier_high");
    assert.ok(ch);
    assert.equal(ch.weight, 0);
    assert.equal(ch.points, 0);
  });

  // Test 12
  test("confidence cap: 4 signal types without required external agent caps confidence at medium; adding ok external agent gives high; cannot_verify never reports above low", () => {
    // 4 signal types completed, but config requires reputation_osint as externalEvidenceAgents
    const customConfig = {
      ...defaultConfig,
      externalEvidenceAgents: ["reputation_osint"],
    };
    const resNoRequiredExternal = scoreCase(
      makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "ok" }),
        makeFinding({ agent: "website_forensics", status: "ok", verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }] }),
        makeFinding({ agent: "official_verifier", status: "ok" }),
        makeFinding({ agent: "payment_entity", status: "ok" }),
      ]),
      customConfig
    );
    assert.equal(resNoRequiredExternal.completionRatio, 1.0);
    assert.equal(resNoRequiredExternal.confidence, "medium");
    assert.equal(resNoRequiredExternal.confidenceCapped, true);

    // With default config (where website_forensics, official_verifier, etc. are external): uncapped high
    const resWithExternal = scoreCase(
      makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "ok" }),
        makeFinding({ agent: "website_forensics", status: "ok", verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }] }),
        makeFinding({ agent: "official_verifier", status: "ok" }),
        makeFinding({ agent: "payment_entity", status: "ok" }),
      ])
    );
    assert.equal(resWithExternal.completionRatio, 1.0);
    assert.equal(resWithExternal.confidence, "high");
    assert.equal(resWithExternal.confidenceCapped, false);

    // cannot_verify never reports above low
    const resCannotVerify = scoreCase(buildAmbiguousThinEvidenceCaseFile());
    assert.equal(resCannotVerify.level, "cannot_verify");
    assert.equal(resCannotVerify.confidence, "low");
  });

  // Test 13
  test("a flag id missing from config falls back to severity weight and is listed in fallbackWeightFlags; with the default config it is empty over every fixture", () => {
    // Missing flag id falls back to severity weight (high: 25)
    const customSnapshot = makeSnapshot([
      makeFinding({
        agent: "website_forensics",
        status: "ok",
        flags: [{ id: "unregistered_custom_flag", severity: "high" }],
      }),
    ]);
    const resCustom = scoreCase(customSnapshot);
    assert.equal(resCustom.score, 25);
    assert.deepEqual(resCustom.fallbackWeightFlags, ["unregistered_custom_flag"]);
    assert.equal(resCustom.flagPoints[0].weight, 25);
    assert.equal(resCustom.flagPoints[0].points, 25);

    // Default config over every scenario and valid fixture has empty fallbackWeightFlags
    const scenarios = [
      buildClearScamCaseFile(),
      buildGenuineNoticeCaseFile(),
      buildAmbiguousThinEvidenceCaseFile(),
    ];
    for (const sc of scenarios) {
      const res = scoreCase(sc);
      assert.deepEqual(res.fallbackWeightFlags, []);
    }
  });

  // Test 14
  test("score is clamped to 100 when the sum exceeds it", () => {
    const resA = scoreCase(buildClearScamCaseFile());
    // Scenario A has sum of flag points = 175
    assert.equal(resA.score, 100);

    const snapshotManyFlags = makeSnapshot([
      makeFinding({
        agent: "website_forensics",
        status: "ok",
        flags: [
          { id: "official_warning_found", severity: "high" }, // 40
          { id: "url_in_threat_feed", severity: "high" }, // 40
          { id: "lookalike_domain", severity: "high" }, // 20
          { id: "task_deposit_script", severity: "high" }, // 30
        ],
      }),
    ]);
    const resOver = scoreCase(snapshotManyFlags);
    assert.equal(resOver.score, 100);
  });

  // Test 15
  test("determinism and purity: same input twice gives deep-equal output; a deep-frozen snapshot is accepted; the source text of lib/scoring/*.js contains no fs, node:fs, fetch, process.env, Date, Math.random or lib/db", () => {
    const snapshot = deepFreeze(buildClearScamCaseFile());
    const res1 = scoreCase(snapshot);
    const res2 = scoreCase(snapshot);
    assert.deepEqual(res1, res2);

    const scoringDir = path.resolve(__dirname, "../lib/scoring");
    const files = fs.readdirSync(scoringDir).filter((f) => f.endsWith(".js"));
    const forbiddenPattern = /(fs|node:fs|fetch|process\.env|Date|Math\.random|lib\/db)/;

    for (const file of files) {
      const content = fs.readFileSync(path.join(scoringDir, file), "utf8");
      assert.equal(
        forbiddenPattern.test(content),
        false,
        `File ${file} contains forbidden impure token`
      );
    }
  });

  // Test 16
  test("ScoreResult validates against its schema over every fixture and every test snapshot", () => {
    const snapshots = [
      buildClearScamCaseFile(),
      buildGenuineNoticeCaseFile(),
      buildAmbiguousThinEvidenceCaseFile(),
      makeSnapshot([]),
      makeSnapshot([makeFinding({ agent: "message_analyst", status: "ok" })]),
      makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "urgency_pressure", severity: "low" }],
        }),
      ]),
    ];

    for (const snap of snapshots) {
      const res = scoreCase(snap);
      assert.doesNotThrow(() => ScoreResultSchema.parse(res));
    }

    // Also verify valid fixtures
    const validScores = validFixtures.filter((f) => f.contract === "ScoreResult");
    assert.ok(validScores.length > 0);
    for (const fixture of validScores) {
      assert.doesNotThrow(() => ScoreResultSchema.parse(fixture.data));
    }
  });

  // Test 17
  test("hard-rule floor follows config: with a custom config where thresholds.high is 70, a snapshot with only mule_account_request gives high and score exactly 70; with the default config the same snapshot gives max(rawScore, 60). With thresholds.high 70, ratio below 0.40 and score 65 gives cannot_verify", () => {
    const customConfig = {
      ...defaultConfig,
      thresholds: {
        medium: 25,
        high: 70,
      },
    };

    // Snapshot with only mule_account_request (weight 40)
    const muleSnapshot = makeSnapshot([
      makeFinding({
        agent: "payment_entity",
        status: "ok",
        flags: [{ id: "mule_account_request", severity: "high" }],
      }),
    ]);

    // Custom config: high is 70 -> score is 70
    const resCustom = scoreCase(muleSnapshot, customConfig);
    assert.equal(resCustom.level, "high");
    assert.equal(resCustom.score, 70);

    // Default config: high is 60 -> score is max(40, 60) = 60
    const resDefault = scoreCase(muleSnapshot, defaultConfig);
    assert.equal(resDefault.level, "high");
    assert.equal(resDefault.score, 60);

    // With thresholds.high 70, ratio below 0.40 and score 65 gives cannot_verify
    // 1 ok, 3 could_not_check -> ratio 0.25 (< 0.40). Flags non-hard-rule summing to 65:
    // official_warning_found (40) + bank_details_request (25) = 65
    const snapshot65 = makeSnapshot([
      makeFinding({
        agent: "website_forensics",
        status: "ok",
        flags: [
          { id: "official_warning_found", severity: "high" },
          { id: "bank_details_request", severity: "high" },
        ],
      }),
      makeFinding({ agent: "official_verifier", status: "could_not_check" }),
      makeFinding({ agent: "payment_entity", status: "could_not_check" }),
      makeFinding({ agent: "reputation_osint", status: "could_not_check" }),
    ]);

    const res65 = scoreCase(snapshot65, customConfig);
    assert.equal(res65.score, 65);
    assert.equal(res65.completionRatio, 0.25);
    assert.equal(res65.level, "cannot_verify");
  });

  describe("S2: Critical Agents Rule", () => {
    test("rejects unknown agent names in ScoringConfigSchema criticalAgents", () => {
      const invalidConfig = {
        ...defaultConfig,
        criticalAgents: ["unknown_agent_name"],
      };
      assert.throws(
        () => ScoringConfigSchema.parse(invalidConfig),
        /criticalAgents\[0\] contains unknown agent name: unknown_agent_name/
      );
    });

    test("scenario A data with message_analyst replaced by could_not_check and its flags removed gives cannot_verify with low confidence", () => {
      const baseCase = buildClearScamCaseFile();
      // Replace message_analyst finding with could_not_check and no flags
      const modifiedFindings = baseCase.findings.map((f) => {
        if (f.agent === "message_analyst") {
          return {
            ...f,
            status: "could_not_check",
            flags: [],
            reason: "LLM service timeout",
          };
        }
        return f;
      });

      // Also ensure no other agent has scholarship_fee_demand or hard rule to isolate critical agent behavior if testing would-be low,
      // but let's test when remaining flags don't fire hard rules and give a low score
      // Here, let's create a snapshot where other agents completed but only domain_no_history (5 pts) exists
      const liveScamSnapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "could_not_check" }),
        makeFinding({ agent: "website_forensics", status: "ok", flags: [{ id: "domain_no_history", severity: "low" }] }),
        makeFinding({ agent: "payment_entity", status: "ok", flags: [] }),
        makeFinding({ agent: "reputation_osint", status: "ok", flags: [] }),
        makeFinding({ agent: "official_verifier", status: "ok", flags: [] }),
        makeFinding({ agent: "classifier_client", status: "could_not_check" }),
      ]);
      const resLive = scoreCase(liveScamSnapshot);
      assert.equal(resLive.level, "cannot_verify");
      assert.equal(resLive.confidence, "low");
      assert.equal(resLive.score, 5);
      assert.ok(resLive.reasonCodes.includes("critical_agent_failed"));
      assert.ok(resLive.reasonCodes.includes("critical_agent_failed:message_analyst"));
    });

    test("scenario A data with message_analyst replaced by could_not_check but a fee flag from another agent still gives high", () => {
      const snapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "could_not_check" }),
        makeFinding({
          agent: "payment_entity",
          status: "ok",
          flags: [{ id: "scholarship_fee_demand", severity: "high" }],
        }),
        makeFinding({ agent: "website_forensics", status: "ok" }),
      ]);
      const res = scoreCase(snapshot);
      assert.equal(res.level, "high");
      assert.ok(res.rulesFired.includes("scholarship_fee_demand"));
      // Level is high, so critical agent rule does not downgrade it to cannot_verify
      assert.equal(res.reasonCodes.includes("critical_agent_failed"), false);
    });

    test("a medium score with failed message_analyst stays medium", () => {
      // 30 points (fee_demand: 30) -> score 30, which is medium
      const snapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "could_not_check" }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [{ id: "fee_demand", severity: "high" }],
        }),
        makeFinding({ agent: "payment_entity", status: "ok" }),
        makeFinding({ agent: "reputation_osint", status: "ok" }),
      ]);
      const res = scoreCase(snapshot);
      assert.equal(res.score, 30);
      assert.equal(res.level, "medium");
      // Medium is kept (more suspicious evidence is never downgraded)
      assert.equal(res.reasonCodes.includes("critical_agent_failed"), false);
    });

    test("scenario B (message_analyst ok, low) stays low", () => {
      const resB = scoreCase(buildGenuineNoticeCaseFile());
      assert.equal(resB.level, "low");
      assert.equal(resB.score, 0);
      assert.equal(resB.reasonCodes.includes("critical_agent_failed"), false);
    });

    test("message_analyst skipped (no text) with a low score stays low", () => {
      const snapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "skipped", reason: "no text" }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [],
          verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }],
        }),
        makeFinding({ agent: "official_verifier", status: "ok", flags: [] }),
      ]);
      const res = scoreCase(snapshot);
      assert.equal(res.level, "low");
      assert.equal(res.score, 0);
      assert.equal(res.reasonCodes.includes("critical_agent_failed"), false);
    });

    test("message_analyst could_not_check in round 1 but ok in round 2 is not a failure", () => {
      const snapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", round: 1, status: "could_not_check" }),
        makeFinding({ agent: "message_analyst", round: 2, status: "ok", flags: [] }),
        makeFinding({
          agent: "website_forensics",
          round: 1,
          status: "ok",
          flags: [],
          verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }],
        }),
      ]);
      const res = scoreCase(snapshot);
      assert.equal(res.level, "low");
      assert.equal(res.reasonCodes.includes("critical_agent_failed"), false);
    });

    test("classifier_client failing is not critical", () => {
      const snapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "ok", flags: [] }),
        makeFinding({ agent: "classifier_client", status: "could_not_check", reason: "service down" }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [],
          verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }],
        }),
      ]);
      const res = scoreCase(snapshot);
      assert.equal(res.level, "low");
      assert.equal(res.reasonCodes.includes("critical_agent_failed"), false);
    });

    test("config with an empty criticalAgents list restores old behavior (low stays low)", () => {
      const customConfig = {
        ...defaultConfig,
        criticalAgents: [],
      };
      const snapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "could_not_check" }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [],
          verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }],
        }),
        makeFinding({ agent: "official_verifier", status: "ok", flags: [] }),
      ]);
      const res = scoreCase(snapshot, customConfig);
      assert.equal(res.level, "low");
      assert.equal(res.reasonCodes.includes("critical_agent_failed"), false);
    });

    test("live scam shape (message_analyst could_not_check, only domain_no_history 5 points, 4 of 6 completed) gives cannot_verify", () => {
      const snapshot = makeSnapshot([
        makeFinding({ agent: "message_analyst", status: "could_not_check" }),
        makeFinding({ agent: "classifier_client", status: "could_not_check" }),
        makeFinding({ agent: "website_forensics", status: "ok", flags: [{ id: "domain_no_history", severity: "low" }] }),
        makeFinding({ agent: "payment_entity", status: "ok", flags: [] }),
        makeFinding({ agent: "reputation_osint", status: "ok", flags: [] }),
        makeFinding({ agent: "official_verifier", status: "ok", flags: [] }),
      ]);
      const res = scoreCase(snapshot);
      assert.equal(res.completedCount, 4);
      assert.equal(res.eligibleCount, 6);
      assert.equal(res.score, 5);
      assert.equal(res.level, "cannot_verify");
      assert.equal(res.confidence, "low");
      assert.ok(res.reasonCodes.includes("critical_agent_failed"));
      assert.ok(res.reasonCodes.includes("critical_agent_failed:message_analyst"));
    });
  });

  describe("Phase 4 Scoring Safeguards and Regimes", () => {
    test("runs every fixture in lib/contracts/fixtures/scoring-inputs.js through score() and asserts expected score, level, and rules", () => {
      // Case A: Genuine offer with five soft flags across hiring_process and pay
      const snapA = { findings: scoringInputFixtures.caseA_genuineWithFiveSoftFlags.findings };
      const resA = score(snapA, scoringInputFixtures.caseA_genuineWithFiveSoftFlags.options);
      assert.equal(resA.score, 47);
      assert.equal(resA.level, "medium");
      assert.deepEqual(resA.rulesFired, ["correlation_cap:hiring_process", "correlation_cap:pay"]);

      // Case B: Scam with fee_demand plus five soft flags
      const snapB = { findings: scoringInputFixtures.caseB_scamWithFeeDemandAndSoftFlags.findings };
      const resB = score(snapB, scoringInputFixtures.caseB_scamWithFeeDemandAndSoftFlags.options);
      assert.equal(resB.score, 77);
      assert.equal(resB.level, "high");
      assert.deepEqual(resB.rulesFired, ["correlation_cap:hiring_process", "correlation_cap:pay"]);

      // Case C: Maximum soft flags plus maximum classifier points (25) capped at 59 Medium without high evidence
      const snapC = { findings: scoringInputFixtures.caseC_maxSoftFlagsWithMaxClassifier.findings };
      const resC = score(snapC, scoringInputFixtures.caseC_maxSoftFlagsWithMaxClassifier.options);
      assert.equal(resC.score, 59);
      assert.equal(resC.level, "medium");
      assert.ok(resC.rulesFired.includes("no_high_evidence_cap"));
      assert.ok(resC.rulesFired.includes("soft_flag_cap_applied"));

      // Case D: fee_demand plus equipment_advance mutual exclusion keeps fee_demand only
      const snapD = { findings: scoringInputFixtures.caseD_feeDemandPlusEquipmentAdvance.findings };
      const resD = score(snapD, scoringInputFixtures.caseD_feeDemandPlusEquipmentAdvance.options);
      assert.equal(resD.score, 30);
      assert.equal(resD.level, "medium");
      assert.deepEqual(resD.rulesFired, ["exclusion:fee_equipment"]);
      const feeDemandFp = resD.flagPoints.find((fp) => fp.id === "fee_demand");
      const equipAdvanceFp = resD.flagPoints.find((fp) => fp.id === "equipment_advance");
      assert.ok(feeDemandFp);
      assert.ok(equipAdvanceFp);
      assert.equal(feeDemandFp.points, 30);
      assert.equal(feeDemandFp.status, "counted");
      assert.equal(equipAdvanceFp.points, 0);
      assert.equal(equipAdvanceFp.status, "group_suppressed");
    });

    test("soft flags alone never reach 60 for classifierMaxPoints 10 or 25", () => {
      // Collect every low and medium flag in the registry
      const softFlags = Object.entries(FLAG_REGISTRY)
        .filter(([, def]) => def.severity === "low" || def.severity === "medium")
        .map(([id, def]) => ({ id, severity: def.severity }));

      // Snapshot with all soft flags and message_analyst + website_forensics ok
      const allSoftFindings = [
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: softFlags,
        }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          flags: [],
        }),
      ];

      // 1. With classifierMaxPoints = 10, probability 1.0 (max classifier)
      const findingsWithClf10 = [
        ...allSoftFindings,
        makeFinding({
          agent: "classifier_client",
          status: "ok",
          classifierResult: { probability: 1.0, label: "suspicious", topTerms: [] },
        }),
      ];
      const res10 = score(makeSnapshot(findingsWithClf10), { classifierMaxPoints: 10 });
      assert.ok(res10.score <= 59, `Score ${res10.score} must be <= 59`);
      assert.equal(res10.level, "medium");
      assert.notEqual(res10.level, "high");
      assert.ok(res10.rulesFired.includes("soft_flag_cap_applied"));

      // 2. With classifierMaxPoints = 25, probability 1.0 (max classifier)
      const findingsWithClf25 = [
        ...allSoftFindings,
        makeFinding({
          agent: "classifier_client",
          status: "ok",
          classifierResult: { probability: 1.0, label: "suspicious", topTerms: [] },
        }),
      ];
      const res25 = score(makeSnapshot(findingsWithClf25), { classifierMaxPoints: 25 });
      assert.equal(res25.score, 59, "Score must be exactly capped at 59");
      assert.equal(res25.level, "medium");
      assert.notEqual(res25.level, "high");
      assert.ok(res25.rulesFired.includes("no_high_evidence_cap"));
      assert.ok(res25.rulesFired.includes("soft_flag_cap_applied"));

      // 3. Without classifier, soft flags alone are capped at 45
      const resNoClf = score(makeSnapshot(allSoftFindings));
      assert.ok(resNoClf.score <= 45);
      assert.equal(resNoClf.level, "medium");
      assert.notEqual(resNoClf.level, "high");
      assert.ok(resNoClf.rulesFired.includes("soft_flag_cap_applied"));
    });

    test("classifier p < 0.5 contributes 0; p = 1.0 contributes classifierMaxPoints", () => {
      const getClfPoints = (probability, classifierMaxPoints) => {
        const snap = makeSnapshot([
          makeFinding({ agent: "message_analyst", status: "ok" }),
          makeFinding({
            agent: "classifier_client",
            status: "ok",
            classifierResult: { probability, label: "suspicious", topTerms: [] },
          }),
        ]);
        const options = classifierMaxPoints !== undefined ? { classifierMaxPoints } : {};
        return score(snap, options).classifierPoints;
      };

      // Default (25 max points)
      assert.equal(getClfPoints(0.0), 0);
      assert.equal(getClfPoints(0.2), 0);
      assert.equal(getClfPoints(0.499), 0);
      assert.equal(getClfPoints(0.5), 0);
      assert.equal(getClfPoints(0.75), 13); // round(25 * 0.5) = round(12.5) = 13
      assert.equal(getClfPoints(1.0), 25);

      // classifierMaxPoints = 10
      assert.equal(getClfPoints(0.0, 10), 0);
      assert.equal(getClfPoints(0.499, 10), 0);
      assert.equal(getClfPoints(0.5, 10), 0);
      assert.equal(getClfPoints(0.75, 10), 5); // round(10 * 0.5) = 5
      assert.equal(getClfPoints(1.0, 10), 10);

      // classifierMaxPoints = 0
      assert.equal(getClfPoints(1.0, 0), 0);
    });

    test("scholarship_fee_demand triggers the hard rule; non-scholarship fee_demand does not by itself", () => {
      // scholarship_fee_demand alone: triggers hard rule, forces High (score floor 60), rulesFired has scholarship_fee_demand
      const scholarSnap = makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "scholarship_fee_demand", severity: "high" }],
        }),
      ]);
      const resScholar = score(scholarSnap);
      assert.equal(resScholar.score, 60);
      assert.equal(resScholar.level, "high");
      assert.deepEqual(resScholar.rulesFired, ["scholarship_fee_demand"]);

      // Even with low completion ratio (1 ok, 3 could_not_check -> 0.25 < 0.40), hard rule prevents cannot_verify
      const scholarLowRatioSnap = makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "scholarship_fee_demand", severity: "high" }],
        }),
        makeFinding({ agent: "website_forensics", status: "could_not_check" }),
        makeFinding({ agent: "payment_entity", status: "could_not_check" }),
        makeFinding({ agent: "official_verifier", status: "could_not_check" }),
      ]);
      const resScholarLowRatio = score(scholarLowRatioSnap);
      assert.equal(resScholarLowRatio.completionRatio, 0.25);
      assert.equal(resScholarLowRatio.level, "high");
      assert.equal(resScholarLowRatio.score, 60);
      assert.deepEqual(resScholarLowRatio.rulesFired, ["scholarship_fee_demand"]);

      // fee_demand alone: weight 30, level medium, NO hard rule fired
      const feeDemandSnap = makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "fee_demand", severity: "high" }],
        }),
      ]);
      const resFeeDemand = score(feeDemandSnap);
      assert.equal(resFeeDemand.score, 30);
      assert.equal(resFeeDemand.level, "medium");
      assert.deepEqual(resFeeDemand.rulesFired, []);

      // fee_demand with low completion ratio (1 ok, 3 could_not_check -> 0.25 < 0.40):
      // because score 30 < 60 and no hard rule, cannot_verify rule triggers
      const feeDemandLowRatioSnap = makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "fee_demand", severity: "high" }],
        }),
        makeFinding({ agent: "website_forensics", status: "could_not_check" }),
        makeFinding({ agent: "payment_entity", status: "could_not_check" }),
        makeFinding({ agent: "official_verifier", status: "could_not_check" }),
      ]);
      const resFeeDemandLowRatio = score(feeDemandLowRatioSnap);
      assert.equal(resFeeDemandLowRatio.completionRatio, 0.25);
      assert.equal(resFeeDemandLowRatio.score, 30);
      assert.equal(resFeeDemandLowRatio.level, "cannot_verify");
      assert.deepEqual(resFeeDemandLowRatio.rulesFired, []);
    });

    test("skipped agents do not lower confidence; could_not_check does", () => {
      const baseOkFindings = [
        makeFinding({ agent: "message_analyst", status: "ok" }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          verified: [{ id: "domain_registration", claim: "domain_registration", status: "verified" }],
        }),
        makeFinding({ agent: "payment_entity", status: "ok" }),
        makeFinding({ agent: "official_verifier", status: "ok" }),
      ];

      // Base: 4 ok agents -> ratio 1.0, confidence high
      const resBase = score(makeSnapshot(baseOkFindings));
      assert.equal(resBase.completedCount, 4);
      assert.equal(resBase.eligibleCount, 4);
      assert.equal(resBase.completionRatio, 1.0);
      assert.equal(resBase.confidence, "high");

      // Adding 2 skipped agents does NOT increment eligibleCount and does NOT lower ratio or confidence
      const findingsWithSkipped = [
        ...baseOkFindings,
        makeFinding({ agent: "reputation_osint", status: "skipped", reason: "no handle" }),
        makeFinding({ agent: "classifier_client", status: "skipped", reason: "no text" }),
      ];
      const resSkipped = score(makeSnapshot(findingsWithSkipped));
      assert.equal(resSkipped.completedCount, 4);
      assert.equal(resSkipped.eligibleCount, 4);
      assert.equal(resSkipped.completionRatio, 1.0);
      assert.equal(resSkipped.confidence, "high");

      // Adding 4 could_not_check agents increments eligibleCount to 8 -> ratio 0.50 -> medium confidence
      const findingsWithHalfFailed = [
        ...baseOkFindings,
        makeFinding({ agent: "reputation_osint", round: 1, status: "could_not_check", reason: "timeout" }),
        makeFinding({ agent: "classifier_client", round: 1, status: "could_not_check", reason: "error" }),
        makeFinding({ agent: "reputation_osint", round: 2, status: "could_not_check", reason: "timeout" }),
        makeFinding({ agent: "classifier_client", round: 2, status: "could_not_check", reason: "error" }),
      ];
      const resHalfFailed = score(makeSnapshot(findingsWithHalfFailed));
      assert.equal(resHalfFailed.completedCount, 4);
      assert.equal(resHalfFailed.eligibleCount, 8);
      assert.equal(resHalfFailed.completionRatio, 0.50);
      assert.equal(resHalfFailed.confidence, "medium");

      // Adding 12 could_not_check agents increments eligibleCount to 16 -> ratio 0.25 -> low confidence
      const findingsWithMostlyFailed = [
        ...baseOkFindings,
        ...Array.from({ length: 12 }, (_, i) =>
          makeFinding({ agent: `agent_fail_${i}`, status: "could_not_check" })
        ),
      ];
      const resMostlyFailed = score(makeSnapshot(findingsWithMostlyFailed));
      assert.equal(resMostlyFailed.completedCount, 4);
      assert.equal(resMostlyFailed.eligibleCount, 16);
      assert.equal(resMostlyFailed.completionRatio, 0.25);
      assert.equal(resMostlyFailed.confidence, "low");
    });

    test("config test: every flag ID used as a key in lib/scoring/config.js exists in the contract registry and no key is fee_before_selection", () => {
      const configFlagIds = Object.keys(defaultConfig.flagWeights);
      const registryIds = Object.keys(FLAG_REGISTRY);

      assert.ok(registryIds.length > 0, "FLAG_REGISTRY must not be empty");
      assert.equal(configFlagIds.length, registryIds.length, "Config flagWeights must match FLAG_REGISTRY count exactly");

      assert.equal(
        Object.prototype.hasOwnProperty.call(defaultConfig.flagWeights, "fee_before_selection"),
        false,
        "fee_before_selection must NOT exist in defaultConfig.flagWeights"
      );

      for (const id of configFlagIds) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, id),
          `Config key '${id}' does not exist in FLAG_REGISTRY`
        );
      }

      for (const id of registryIds) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(defaultConfig.flagWeights, id),
          `FLAG_REGISTRY key '${id}' missing from defaultConfig.flagWeights`
        );
      }
    });

    test("purity test: score() makes zero I/O (no fs, node:fs, fetch, or network imports in lib/scoring/)", () => {
      const scoringDir = path.resolve(__dirname, "../lib/scoring");
      const files = fs.readdirSync(scoringDir).filter((f) => f.endsWith(".js"));
      const forbiddenTokens = [
        "fs",
        "node:fs",
        "fetch",
        "http",
        "https",
        "node:http",
        "node:https",
        "net",
        "node:net",
        "child_process",
        "process.env",
        "Date",
        "Math.random",
        "lib/db",
      ];
      const forbiddenPattern = new RegExp(`\\b(${forbiddenTokens.join("|")})\\b`);

      for (const file of files) {
        const content = fs.readFileSync(path.join(scoringDir, file), "utf8");
        assert.equal(
          forbiddenPattern.test(content),
          false,
          `File ${file} contains forbidden impure token`
        );
      }

      // Assert score() runs synchronously on frozen inputs with zero asynchronous side-effects
      const frozenInput = Object.freeze({
        findings: Object.freeze([
          Object.freeze({
            agent: "message_analyst",
            status: "ok",
            flags: Object.freeze([]),
          }),
        ]),
      });
      const res = score(frozenInput);
      assert.equal(typeof res.score, "number");
      assert.equal(typeof res.level, "string");
    });

    test("Ledger integration: claimKey deduplication counts highest weight and ignores duplicates", () => {
      const snap = {
        findings: [
          {
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "refundable_fee_offer", severity: "high", title: "Refundable fee", explanation: "Deposit requested", evidence: [{ type: "quote", value: "deposit 799" }] },
            ],
          },
          {
            agent: "payment_analyst",
            status: "ok",
            flags: [
              { id: "upfront_payment_demand", severity: "high", title: "Upfront fee", explanation: "Fee requested", evidence: [{ type: "quote", value: "deposit 799" }] },
            ],
          },
        ],
      };

      const res = score(snap);
      assert.equal(res.score, 25); // Highest weight of fee_demand (25), not duplicated
      assert.equal(res.flagPoints.filter((f) => f.status === "counted").length, 1);
      assert.equal(res.flagPoints.filter((f) => f.status === "group_suppressed").length, 1);
    });

    test("Ledger integration: corroboration bonus adds points and appears in rulesFired", () => {
      const snap = {
        findings: [
          {
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "chat_only_interview", severity: "medium", title: "Chat interview", explanation: "Telegram", evidence: [{ type: "quote", value: "telegram" }] },
            ],
          },
        ],
      };

      const baseRes = score(snap);
      assert.equal(baseRes.score, 15); // chat_only_interview weight is 15
      assert.equal(baseRes.corroborationBonus, 0);

      // With corroboration (+5 bonus)
      const corroboratedRes = score(snap, {
        corroborations: ["Message analysis corroborated by OSINT"],
      });
      assert.equal(corroboratedRes.score, 20); // 15 + 5
      assert.equal(corroboratedRes.corroborationBonus, 5);
      assert.ok(corroboratedRes.rulesFired.includes("corroboration_bonus"));
      assert.deepEqual(corroboratedRes.corroborations, ["Message analysis corroborated by OSINT"]);
    });

    test("Ledger integration: low classifier probability never lowers score and reports contradiction", () => {
      const snap = {
        findings: [
          {
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "scholarship_fee_demand", severity: "high", title: "Fee demand", explanation: "Fee demanded", evidence: [{ type: "quote", value: "799 deposit" }] },
            ],
          },
          {
            agent: "classifier_client",
            status: "ok",
            classifierResult: {
              probability: 0.02,
              label: "benign",
            },
          },
        ],
      };

      const contradictionMsg = "The ML model rated this message 2% scam-like, but message analysis found a deposit demand. Evidence from the message text outweighs the model.";
      const res = score(snap, {
        contradictions: [contradictionMsg],
      });

      assert.equal(res.level, "high");
      assert.ok(res.score >= 60);
      assert.equal(res.classifierPoints, 0);
      assert.ok(res.contradictions.includes(contradictionMsg));
    });
  });

  describe("Evidence Coverage & Strict Risk Gate Scenarios", () => {
    test("Scenario a: google-only sentence -> Medium, big brand without official channel, message-only coverage, confidence low", () => {
      const snap = {
        entities: [
          { kind: "company", value: "Google" },
        ],
        findings: [
          makeFinding({
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "no_interview_selection", severity: "medium" },
            ],
          }),
        ],
      };

      const res = score(snap);
      assert.equal(res.level, "medium");
      assert.ok(res.rulesFired.includes("big_brand_no_official_channel"));
      assert.deepEqual(res.coverage.checked, ["message"]);
      assert.equal(res.confidence, "low");
    });

    test("Scenario b: genuine-looking offer letter text only, no flags -> cannot_verify with thin_coverage", () => {
      const snap = {
        findings: [
          makeFinding({
            agent: "message_analyst",
            status: "ok",
            flags: [],
          }),
        ],
      };

      const res = score(snap);
      assert.equal(res.level, "cannot_verify");
      assert.ok(res.reasonCodes.includes("thin_coverage"));
      assert.ok(res.rulesFired.includes("thin_coverage"));
      assert.deepEqual(res.coverage.checked, ["message"]);
      assert.equal(res.confidence, "low");
    });

    test("Scenario c: genuine offer with official domain matched, valid certificate, old domain, no flags -> low", () => {
      const snap = {
        entities: [
          { kind: "company", value: "Google" },
          { kind: "domain", value: "careers.google.com" },
        ],
        findings: [
          makeFinding({
            agent: "message_analyst",
            status: "ok",
            flags: [],
          }),
          makeFinding({
            agent: "website_forensics",
            status: "ok",
            flags: [],
            verified: [
              { id: "ssl_certificate", claim: "ssl_certificate", status: "verified" },
              { id: "domain_age", claim: "domain_age", status: "verified" },
            ],
          }),
          makeFinding({
            agent: "official_verifier",
            status: "ok",
            flags: [],
            verified: [
              { id: "official_domain_match", claim: "domain_authenticity", status: "verified" },
            ],
          }),
        ],
      };

      const res = score(snap);
      assert.equal(res.level, "low");
      assert.equal(res.score, 0);
      assert.ok(res.coverage.checked.includes("message"));
      assert.ok(res.coverage.checked.includes("website"));
      assert.ok(res.coverage.checked.includes("official sources"));
      assert.ok(res.confidence === "medium" || res.confidence === "high");
    });

    test("Scenario d: clear scam (fee, personal UPI, Telegram) -> high", () => {
      const snap = {
        findings: [
          makeFinding({
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "fee_demand", severity: "high" },
              { id: "chat_only_interview", severity: "medium" },
            ],
          }),
          makeFinding({
            agent: "payment_entity",
            status: "ok",
            flags: [
              { id: "personal_payment_id", severity: "high" },
            ],
          }),
        ],
      };

      const res = score(snap);
      assert.equal(res.level, "high");
      assert.ok(res.score >= 60);
      assert.ok(res.coverage.checked.includes("message"));
      assert.ok(res.coverage.checked.includes("payee"));
    });

    test("Scenario e: skipped agents never reduce confidence; failed agents reduce it; thin evidence with a hard rule still yields High", () => {
      const fourOkFindings = [
        makeFinding({ agent: "message_analyst", status: "ok" }),
        makeFinding({
          agent: "website_forensics",
          status: "ok",
          verified: [{ id: "ssl_cert", claim: "ssl_certificate", status: "verified" }],
        }),
        makeFinding({ agent: "official_verifier", status: "ok" }),
        makeFinding({ agent: "payment_entity", status: "ok" }),
      ];

      const baseRes = score(makeSnapshot(fourOkFindings));
      assert.equal(baseRes.confidence, "high");

      // Skipped agents do not reduce confidence
      const withSkipped = score(makeSnapshot([
        ...fourOkFindings,
        makeFinding({ agent: "reputation_osint", status: "skipped", reason: "no handle" }),
      ]));
      assert.equal(withSkipped.confidence, "high");

      // Failed agents reduce confidence
      const withFailed = score(makeSnapshot([
        ...fourOkFindings,
        makeFinding({ agent: "reputation_osint", status: "could_not_check", reason: "timeout" }),
        makeFinding({ agent: "classifier_client", status: "could_not_check", reason: "error" }),
      ]));
      assert.equal(withFailed.confidence, "medium");

      // Thin evidence with a hard rule still yields High
      const thinHardRule = score(makeSnapshot([
        makeFinding({
          agent: "message_analyst",
          status: "ok",
          flags: [{ id: "scholarship_fee_demand", severity: "high" }],
        }),
      ]));
      assert.equal(thinHardRule.level, "high");
      assert.ok(thinHardRule.score >= 60);
      assert.ok(thinHardRule.rulesFired.includes("scholarship_fee_demand"));
    });

    test("Scenario f: full Google case with notes -> High", () => {
      const snap = {
        entities: [
          { kind: "company", value: "Google" },
          { kind: "upi", value: "rahul.hr@oksbi" },
          { kind: "handle", value: "@google_hr_careers" },
        ],
        findings: [
          makeFinding({
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "fee_demand", severity: "high" },
              { id: "no_interview_selection", severity: "medium" },
            ],
          }),
          makeFinding({
            agent: "payment_entity",
            status: "ok",
            flags: [
              { id: "personal_payment_id", severity: "high" },
            ],
          }),
          makeFinding({
            agent: "reputation_osint",
            status: "ok",
            flags: [
              { id: "brand_handle_lookalike", severity: "medium" },
              { id: "scam_reports_found", severity: "high" },
            ],
          }),
        ],
      };

      const res = score(snap);
      assert.equal(res.level, "high");
      assert.ok(res.score >= 60);
      assert.ok(res.coverage.checked.includes("message"));
      assert.ok(res.coverage.checked.includes("payee"));
      assert.ok(res.coverage.checked.includes("reputation"));
    });
  });

  describe("Claim Groups & Correlated Scoring", () => {
    test("domain_brand_impersonation: lookalike_domain and domain_company_mismatch count once at highest weight + corroboration bonus", () => {
      const snap = {
        entities: [
          { kind: "domain", value: "careers-microsoft-internships.example" },
          { kind: "company", value: "Microsoft India" },
        ],
        findings: [
          makeFinding({
            agent: "website_forensics",
            status: "ok",
            flags: [
              { id: "lookalike_domain", severity: "high", evidence: [{ type: "quote", value: "careers-microsoft-internships.example" }] },
            ],
          }),
          makeFinding({
            agent: "official_verifier",
            status: "ok",
            flags: [
              { id: "domain_company_mismatch", severity: "high", evidence: [{ type: "quote", value: "careers-microsoft-internships.example" }] },
            ],
          }),
        ],
      };

      const res = score(snap);
      assert.ok(res.rulesFired.includes("claim_group:domain_brand_impersonation"), "Must record claim group rule");

      const mismatchFlag = res.flagPoints.find((f) => f.id === "domain_company_mismatch");
      const lookalikeFlag = res.flagPoints.find((f) => f.id === "lookalike_domain");

      assert.ok(mismatchFlag);
      assert.ok(lookalikeFlag);

      // Highest weight is 25 (mismatch) + 5 (corroboration bonus) = 30 points
      assert.equal(mismatchFlag.status, "counted");
      assert.equal(mismatchFlag.points, 30);

      // Other flag in group is suppressed to 0 points
      assert.equal(lookalikeFlag.status, "group_suppressed");
      assert.equal(lookalikeFlag.points, 0);

      // Total score from the group is 30, not 45
      assert.equal(res.score, 30);
    });

    test("brand_handle_impersonation: authority_impersonation and brand_handle_lookalike group only when sharing evidence", () => {
      // 1. Sharing evidence: both reference @google_hr_careers
      const snapSharing = {
        entities: [{ kind: "handle", value: "@google_hr_careers" }],
        findings: [
          makeFinding({
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "authority_impersonation", severity: "high", evidence: [{ type: "quote", value: "@google_hr_careers" }] },
            ],
          }),
          makeFinding({
            agent: "reputation_osint",
            status: "ok",
            flags: [
              { id: "brand_handle_lookalike", severity: "medium", evidence: [{ type: "quote", value: "@google_hr_careers" }] },
            ],
          }),
        ],
      };

      const resSharing = score(snapSharing);
      assert.ok(resSharing.rulesFired.includes("claim_group:brand_handle_impersonation"));
      const authFlag = resSharing.flagPoints.find((f) => f.id === "authority_impersonation");
      const handleFlag = resSharing.flagPoints.find((f) => f.id === "brand_handle_lookalike");

      // 25 (authority) + 5 (bonus) = 30
      assert.equal(authFlag.status, "counted");
      assert.equal(authFlag.points, 30);
      assert.equal(handleFlag.status, "group_suppressed");
      assert.equal(handleFlag.points, 0);
      assert.equal(resSharing.score, 30);

      // 2. Not sharing evidence: separate claims
      const snapSeparate = {
        entities: [
          { kind: "handle", value: "@tcs_support_desk" },
          { kind: "company", value: "Google" },
        ],
        findings: [
          makeFinding({
            agent: "message_analyst",
            status: "ok",
            flags: [
              { id: "authority_impersonation", severity: "high", evidence: [{ type: "quote", value: "Official Google Letterhead" }] },
            ],
          }),
          makeFinding({
            agent: "reputation_osint",
            status: "ok",
            flags: [
              { id: "brand_handle_lookalike", severity: "medium", evidence: [{ type: "quote", value: "@tcs_support_desk" }] },
            ],
          }),
        ],
      };

      const resSeparate = score(snapSeparate);
      assert.equal(resSeparate.rulesFired.includes("claim_group:brand_handle_impersonation"), false);
      const authSep = resSeparate.flagPoints.find((f) => f.id === "authority_impersonation");
      const handleSep = resSeparate.flagPoints.find((f) => f.id === "brand_handle_lookalike");
      assert.equal(authSep.status, "counted");
      assert.equal(authSep.points, 25);
      assert.equal(handleSep.status, "counted");
      assert.equal(handleSep.points, 15);
      assert.equal(resSeparate.score, 40);
    });

    test("independent evidence (domain_new, personal_payment_id, free_email_recruiter) stays separate", () => {
      const snap = {
        entities: [
          { kind: "domain", value: "careers-portal.in" },
          { kind: "upi", value: "recruiter@oksbi" },
          { kind: "email", value: "recruiter@gmail.com" },
        ],
        findings: [
          makeFinding({
            agent: "website_forensics",
            status: "ok",
            flags: [
              { id: "domain_new", severity: "medium", evidence: [{ type: "url", value: "https://rdap.org/domain/careers-portal.in" }] },
            ],
          }),
          makeFinding({
            agent: "payment_entity",
            status: "ok",
            flags: [
              { id: "personal_payment_id", severity: "high", evidence: [{ type: "quote", value: "recruiter@oksbi" }] },
            ],
          }),
          makeFinding({
            agent: "payment_entity",
            status: "ok",
            flags: [
              { id: "free_email_recruiter", severity: "medium", evidence: [{ type: "quote", value: "recruiter@gmail.com" }] },
            ],
          }),
        ],
      };

      const res = score(snap);
      const domNew = res.flagPoints.find((f) => f.id === "domain_new");
      const payId = res.flagPoints.find((f) => f.id === "personal_payment_id");
      const freeMail = res.flagPoints.find((f) => f.id === "free_email_recruiter");

      assert.equal(domNew.status, "counted");
      assert.equal(domNew.points, 20);
      assert.equal(payId.status, "counted");
      assert.equal(payId.points, 25);
      assert.equal(freeMail.status, "counted");
      assert.equal(freeMail.points, 15);

      // None of them are grouped or suppressed
      assert.equal(res.rulesFired.some((r) => r.startsWith("claim_group:")), false);
    });
  });
});

