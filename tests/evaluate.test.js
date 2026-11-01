import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  EvalCaseRawSchema,
  EvalCaseSchema,
  normalizeEvalCase,
} from "../scripts/eval/schema.js";
import {
  loadEvaluationDataset,
  hashNormalizedText,
  parseCsv,
} from "../scripts/eval/loader.js";
import {
  computeAgreement,
  computeConfusionMatrix,
  computeErrorExtremes,
  computeLatencyPercentiles,
  computeWilsonScoreInterval,
  computePerFlagPrecision,
  computePerAgentStatusRates,
  computeConfidenceCalibration,
  computePerScamTypeBreakdown,
  computeEvaluationMetrics,
} from "../scripts/eval/metrics.js";
import {
  evaluateClaimGuard,
  renderMarkdownReport,
  saveEvaluationReport,
  CLAIM_GUARD_MESSAGE,
} from "../scripts/eval/report.js";
import { runEvalCase } from "../scripts/eval/runner.js";
import { runScenariosSmoke } from "../scripts/evaluate.js";


describe("L7 Evaluation Harness Subsystem", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // --- 1. SCHEMA AND NORMALIZATION TESTS ---

  it("schema rejects missing provenance, invalid levels, or when text and link are both empty", () => {
    // Missing provenance (source_type)
    assert.throws(() => {
      EvalCaseRawSchema.parse({
        id: "1",
        text: "Some opportunity text",
        language: "en",
        expected_level: "high",
        scam_type: "scholarship",
        why: "Test why",
        labeler_1: "high",
        labeler_2: "high",
      });
    }, /Required|invalid_type/i);

    // Invalid expected_level
    assert.throws(() => {
      EvalCaseRawSchema.parse({
        id: "1",
        text: "Some opportunity text",
        language: "en",
        expected_level: "safe", // invalid
        scam_type: "scholarship",
        why: "Test why",
        source_type: "synthetic",
        labeler_1: "high",
        labeler_2: "high",
      });
    }, /invalid_enum_value/i);

    // Both text and link empty
    assert.throws(() => {
      EvalCaseRawSchema.parse({
        id: "1",
        text: "",
        link: "",
        language: "en",
        expected_level: "low",
        scam_type: "scholarship",
        why: "Test why",
        source_type: "synthetic",
        labeler_1: "low",
        labeler_2: "low",
      });
    }, /At least one of text or link must be non-empty/i);
  });

  it("schema rejects rows with third labeler or unknown properties when strict", () => {
    const raw = {
      id: "1",
      text: "Opportunity text",
      language: "en",
      expected_level: "high",
      scam_type: "scholarship",
      why: "Test reason",
      source_type: "synthetic",
      labeler_1: "high",
      labeler_2: "high",
      labeler_3: "high", // extra
    };
    // normalizeEvalCase ignores extra fields or validates only known fields
    const parsed = normalizeEvalCase(raw);
    assert.equal(parsed.labeler1, "high");
    assert.equal(parsed.labeler2, "high");
    assert.equal(parsed.labeler3, undefined);
  });

  it("schema identifies labeler disagreement correctly without rejecting the case", () => {
    const raw = {
      id: "DISAGREE-01",
      text: "Opportunity with mixed opinions",
      language: "en",
      expected_level: "medium",
      scam_type: "internship",
      why: "Borderline stipend requirements",
      source_type: "synthetic",
      labeler_1: "medium",
      labeler_2: "low",
    };
    const c = normalizeEvalCase(raw);
    assert.equal(c.hasLabelDisagreement, true);
    assert.equal(c.expectedLevel, "medium");
  });

  it("schema accepts hinglish and other text_language values while keeping language as en or hi", () => {
    const hinglishCase = {
      id: "HINGLISH-01",
      text: "Aapko scholarship mil sakti hai apply now link pe click karo",
      language: "en",
      text_language: "hinglish",
      expected_level: "medium",
      scam_type: "scholarship",
      why: "Informal Hinglish scholarship message",
      source_type: "real_public",
      labeler_1: "medium",
      labeler_2: "medium",
    };

    const normalized = normalizeEvalCase(hinglishCase);
    assert.equal(normalized.language, "en");
    assert.equal(normalized.textLanguage, "hinglish");

    // Invalid text_language throws
    assert.throws(() => {
      normalizeEvalCase({
        ...hinglishCase,
        text_language: "french",
      });
    }, /invalid_enum_value/i);
  });

  // --- 2. LOADER, DEDUPLICATION, AND LEAKAGE TESTS ---

  it("loader detects duplicate cases by normalized text hash", () => {
    const testData = [
      {
        id: "DUP-1",
        text: "Exclusive Scholarship Offer. Pay Rs 500 now at https://link.example",
        language: "en",
        expected_level: "high",
        scam_type: "scholarship",
        why: "Upfront fee",
        source_type: "synthetic",
        labeler_1: "high",
        labeler_2: "high",
      },
      {
        id: "DUP-2",
        text: "exclusive scholarship offer pay rs 500 now at https://different-url.example",
        language: "en",
        expected_level: "high",
        scam_type: "scholarship",
        why: "Duplicate text variant",
        source_type: "synthetic",
        labeler_1: "high",
        labeler_2: "high",
      },
    ];

    const jsonPath = path.join(tmpDir, "dups.json");
    fs.writeFileSync(jsonPath, JSON.stringify(testData), "utf8");

    const res = loadEvaluationDataset(jsonPath);
    assert.equal(res.duplicates.length, 1);
    assert.equal(res.duplicates[0].id1, "DUP-1");
    assert.equal(res.duplicates[0].id2, "DUP-2");
  });

  it("loader detects group_id leakage when same group has conflicting levels or scam types", () => {
    const testData = [
      {
        id: "GRP-1",
        text: "Opportunity from company X part 1",
        group_id: "ORG-X",
        language: "en",
        expected_level: "high",
        scam_type: "task_job",
        why: "Part 1",
        source_type: "synthetic",
        labeler_1: "high",
        labeler_2: "high",
      },
      {
        id: "GRP-2",
        text: "Opportunity from company X part 2",
        group_id: "ORG-X",
        language: "en",
        expected_level: "low", // CONFLICTING LEVEL
        scam_type: "task_job",
        why: "Part 2",
        source_type: "synthetic",
        labeler_1: "low",
        labeler_2: "low",
      },
    ];

    const jsonPath = path.join(tmpDir, "group-violation.json");
    fs.writeFileSync(jsonPath, JSON.stringify(testData), "utf8");

    const res = loadEvaluationDataset(jsonPath);
    assert.equal(res.groupViolations.length, 1);
    assert.ok(res.groupViolations[0].issue.includes("Conflicting expectedLevel"));
  });

  it("loader parses CSV format correctly with comma escaping and headers", () => {
    const csvContent = [
      "id,text,link,upi_id,company,handle,phone,language,expected_level,scam_type,why,source_type,source_url,source_date,license_note,group_id,labeler_1,labeler_2,notes",
      'CSV-01,"Apply for scholarship, urgent fee Rs 500",https://example.com/apply,fee@upi,Corp,hand,+919999999999,en,high,scholarship,"Fee upfront",synthetic,,,,GRP-1,high,high,note',
    ].join("\n");


    const csvPath = path.join(tmpDir, "test.csv");
    fs.writeFileSync(csvPath, csvContent, "utf8");

    const res = loadEvaluationDataset(csvPath);
    assert.equal(res.cases.length, 1);
    assert.equal(res.cases[0].id, "CSV-01");
    assert.equal(res.cases[0].text, "Apply for scholarship, urgent fee Rs 500");
    assert.equal(res.cases[0].expectedLevel, "high");
  });

  // --- 3. METRICS TESTS (HAND-COMPUTABLE VALUES) ---

  it("metrics: computes exact agreement, 4x4 confusion matrix, and error extremes", () => {
    const pairs = [
      { expected: "high", predicted: "high" },
      { expected: "high", predicted: "low" }, // dangerous miss (critical & elevated)
      { expected: "medium", predicted: "low" }, // dangerous miss (elevated only)
      { expected: "low", predicted: "high" }, // false alarm
      { expected: "low", predicted: "low" },
      { expected: "cannot_verify", predicted: "cannot_verify" },
    ];

    const agreement = computeAgreement(pairs);
    assert.equal(agreement, 3 / 6); // 0.5

    const matrix = computeConfusionMatrix(pairs);
    assert.equal(matrix.high.high, 1);
    assert.equal(matrix.high.low, 1);
    assert.equal(matrix.medium.low, 1);
    assert.equal(matrix.low.high, 1);
    assert.equal(matrix.low.low, 1);
    assert.equal(matrix.cannot_verify.cannot_verify, 1);

    const extremes = computeErrorExtremes(pairs);
    assert.equal(extremes.dangerousMissesHighToLow, 1);
    assert.equal(extremes.dangerousMissesElevatedToLow, 2);
    assert.equal(extremes.falseAlarmsLowToHigh, 1);
  });

  it("metrics: exhaustive 4x4 partition covers all 16 cells and categories sum to total", () => {
    // Generate all 16 combinations of (expected, predicted) across the 4 risk levels
    const levels = ["low", "medium", "high", "cannot_verify"];
    const all16Pairs = [];
    for (const exp of levels) {
      for (const pred of levels) {
        all16Pairs.push({ expected: exp, predicted: pred });
      }
    }

    assert.equal(all16Pairs.length, 16);
    const extremes = computeErrorExtremes(all16Pairs);

    // Verify cell counts per category
    assert.equal(extremes.correct, 4); // 4 diagonal cells
    assert.equal(extremes.dangerousMisses, 2); // (medium, low), (high, low)
    assert.equal(extremes.falseAlarms, 1); // (low, high)
    assert.equal(extremes.overCautious, 1); // (low, medium)
    assert.equal(extremes.unhelpfulAbstention, 3); // (low, cv), (med, cv), (high, cv)
    assert.equal(extremes.missedAbstention, 3); // (cv, low), (cv, med), (cv, high)
    assert.equal(extremes.otherMisclassifications, 2); // (medium, high), (high, medium)

    // Sum of all categories MUST strictly equal total (16)
    const categorySum =
      extremes.correct +
      extremes.dangerousMisses +
      extremes.falseAlarms +
      extremes.overCautious +
      extremes.unhelpfulAbstention +
      extremes.missedAbstention +
      extremes.otherMisclassifications;

    assert.equal(categorySum, extremes.total);
    assert.equal(categorySum, 16);
  });

  it("metrics: computes latency percentiles accurately", () => {
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const p = computeLatencyPercentiles(latencies);
    assert.equal(p.min, 10);
    assert.equal(p.p50, 55);
    assert.equal(p.max, 100);
    assert.equal(p.mean, 55);
  });

  it("metrics: Wilson score interval (95%) matches hand-computable values", () => {
    // Hand-computable benchmark test cases:
    // 14 of 14: center ~ (14 + 1.96^2/2)/(14 + 1.96^2) = 15.92 / 17.84 = 0.892, margin = 0.108 -> [0.785, 1.000]
    const res14of14 = computeWilsonScoreInterval(14, 14);
    assert.equal(res14of14.p, 1.0);
    assert.equal(res14of14.low, 0.785);
    assert.equal(res14of14.high, 1.0);

    // 0 of 10: low: 0.000, high: 0.278
    const res0of10 = computeWilsonScoreInterval(0, 10);
    assert.equal(res0of10.p, 0.0);
    assert.equal(res0of10.low, 0.0);
    assert.equal(res0of10.high, 0.278);

    // 5 of 10: symmetric, low: 0.237, high: 0.763
    const res5of10 = computeWilsonScoreInterval(5, 10);
    assert.equal(res5of10.p, 0.5);
    assert.equal(res5of10.low, 0.237);
    assert.equal(res5of10.high, 0.763);

    // 98 of 100: low: 0.930, high: 0.994
    const res98of100 = computeWilsonScoreInterval(98, 100);
    assert.equal(res98of100.p, 0.98);
    assert.equal(res98of100.low, 0.93);
    assert.equal(res98of100.high, 0.994);

    // Empty/0 cases
    const res0of0 = computeWilsonScoreInterval(0, 0);
    assert.equal(res0of0.low, 0.0);
    assert.equal(res0of0.high, 0.0);
    assert.equal(res0of0.p, 0.0);
  });

  it("metrics: computes flag agreement rates with explanatory note and confidence calibration", () => {
    const runs = [
      { expected: "high", predicted: "high", confidence: "high", flags: ["f1", "f2"] },
      { expected: "high", predicted: "low", confidence: "low", flags: ["f1"] },
      { expected: "low", predicted: "low", confidence: "high", flags: ["f2"] },
    ];

    const flagRates = computePerFlagPrecision(runs);
    assert.equal(flagRates.f1.count, 2);
    assert.equal(flagRates.f1.agreementRate, 0.5);
    assert.equal(flagRates.f1.precision, 0.5);
    assert.ok(flagRates.f1.note.includes("not the accuracy of the flag"));

    assert.equal(flagRates.f2.count, 2);
    assert.equal(flagRates.f2.agreementRate, 1.0);
    assert.equal(flagRates.f2.precision, 1.0);

    const calib = computeConfidenceCalibration(runs);
    assert.equal(calib.high.count, 2);
    assert.equal(calib.high.agreement, 1.0);
    assert.equal(calib.low.count, 1);
    assert.equal(calib.low.agreement, 0.0);
  });

  // --- 4. REPORT AND CLAIM GUARD TESTS ---

  it("report: claim guard enforces >= 50 qualifying non-synthetic cases rule and correct headers", () => {
    // 49 qualifying cases: no claim header
    const summary49 = {
      total: 70,
      qualifyingCount: 49,
      byProvenance: { synthetic: 10, real_public: 30, paraphrased: 19 },
    };
    const res49 = evaluateClaimGuard(summary49);
    assert.equal(res49.allowed, false);
    assert.equal(res49.qualifyingCount, 49);
    assert.equal(res49.header, "NO PUBLIC ACCURACY CLAIM PERMITTED (Qualifying: 49 / Total: 70)");

    // 50 qualifying cases: preliminary figure header with interval
    const summary50 = {
      total: 80,
      qualifyingCount: 50,
      byProvenance: { synthetic: 20, real_public: 30, paraphrased: 20 },
    };
    const res50 = evaluateClaimGuard(summary50);
    assert.equal(res50.allowed, true);
    assert.equal(res50.qualifyingCount, 50);
    assert.equal(res50.header, "PRELIMINARY FIGURE ONLY (Qualifying: 50 / Total: 80), interval shown");

    // 50 rows with 5 annotator disagreements counts as 45 qualifying
    const casesWithDisagreements = [];
    for (let i = 1; i <= 45; i++) {
      casesWithDisagreements.push({
        id: `REAL-${i}`,
        text: `Legit text ${i}`,
        language: "en",
        expected_level: "high",
        scam_type: "scholarship",
        why: "Test",
        source_type: "real_public",
        labeler_1: "high",
        labeler_2: "high",
      });
    }
    for (let i = 46; i <= 50; i++) {
      casesWithDisagreements.push({
        id: `REAL-${i}`,
        text: `Legit text ${i}`,
        language: "en",
        expected_level: "high",
        scam_type: "scholarship",
        why: "Test",
        source_type: "real_public",
        labeler_1: "high",
        labeler_2: "medium", // DISAGREEMENT
      });
    }
    const testJson = path.join(tmpDir, "disagreements-test.json");
    fs.writeFileSync(testJson, JSON.stringify(casesWithDisagreements), "utf8");
    const loaded = loadEvaluationDataset(testJson);
    assert.equal(loaded.summary.total, 50);
    assert.equal(loaded.summary.disagreementsCount, 5);
    assert.equal(loaded.summary.qualifyingCount, 45); // 50 - 5 = 45
    const guardRes = evaluateClaimGuard(loaded.summary);
    assert.equal(guardRes.allowed, false);
    assert.equal(guardRes.header, "NO PUBLIC ACCURACY CLAIM PERMITTED (Qualifying: 45 / Total: 50)");
  });

  it("report: contains zero message text by default and includes text only when showText is true", () => {
    const reportData = {
      meta: {
        date: "2026-10-25T00:00:00.000Z",
        mode: "fixtures",
        gitCommit: "abc1234",
        model: "mock-model",
        datasetPath: "data/eval/sample.json",
        datasetHash: "1234567890",
      },
      datasetSummary: {
        total: 1,
        byProvenance: { synthetic: 1, real_public: 0, paraphrased: 0 },
      },
      metrics: computeEvaluationMetrics([
        { id: "CASE-1", expected: "high", predicted: "low", scamType: "scholarship" },
      ]),
      failures: [
        {
          id: "CASE-1",
          expected: "high",
          predicted: "low",
          scamType: "scholarship",
          text: "SECRET_OR_UNTRUSTED_MESSAGE_BODY_XYZ",
          flags: ["scholarship_fee_demand"],
          reasons: ["Fee demanded"],
        },
      ],
      classifierMetrics: null,
    };

    // Default: showText=false
    const mdWithout = renderMarkdownReport(reportData, { showText: false });
    assert.equal(mdWithout.includes("SECRET_OR_UNTRUSTED_MESSAGE_BODY_XYZ"), false);
    assert.ok(mdWithout.includes(CLAIM_GUARD_MESSAGE));

    // showText=true
    const mdWith = renderMarkdownReport(reportData, { showText: true });
    assert.equal(mdWith.includes("SECRET_OR_UNTRUSTED_MESSAGE_BODY_XYZ"), true);
  });

  // --- 5. RUNNER AND E2E EVALUATION TESTS ---

  it("runner: fixtures mode achieves 3 of 3 (100%) agreement on reference scenarios", async () => {
    const results = await runScenariosSmoke(tmpDir);
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.equal(r.expected, r.predicted, `Scenario ${r.id} expected ${r.expected} but got ${r.predicted}`);
    }
    const metrics = computeEvaluationMetrics(results);
    assert.equal(metrics.agreement, 1.0);
  });

  it("runner: budget stop stops execution early and flags report as partial", async () => {
    const evalCase = {
      id: "BUDGET-CASE-1",
      text: "Opportunity text",
      language: "en",
      expectedLevel: "high",
      scamType: "scholarship",
    };

    // Run in live mode with maxLlmCalls=0 to trigger budget exceeded
    const res = await runEvalCase(evalCase, {
      mode: "live",
      tempDir: tmpDir,
      limits: { maxLlmCalls: 0 },
    });

    assert.equal(res.stoppedByBudget, true);
    assert.equal(res.predicted, "cannot_verify");
  });

  it("sample evaluation dataset validates cleanly without duplicate or group violations", () => {
    const samplePath = path.join(process.cwd(), "data", "eval", "sample-cases.json");
    const res = loadEvaluationDataset(samplePath);
    assert.ok(res.cases.length >= 12, "Sample dataset must contain at least 12 synthetic cases");
    assert.equal(res.duplicates.length, 0, "Zero duplicates allowed in sample set");
    assert.equal(res.groupViolations.length, 0, "Zero group ID violations allowed");
    assert.equal(res.classifierOverlaps.length, 0, "Zero classifier dataset overlap");

    // All four risk levels present
    assert.ok(res.summary.byLevel.low > 0);
    assert.ok(res.summary.byLevel.medium > 0);
    assert.ok(res.summary.byLevel.high > 0);
    assert.ok(res.summary.byLevel.cannot_verify > 0);

    // All six scam types present
    assert.ok(res.summary.byScamType.scholarship > 0);
    assert.ok(res.summary.byScamType.internship > 0);
    assert.ok(res.summary.byScamType.task_job > 0);
    assert.ok(res.summary.byScamType.mule_offer > 0);
    assert.ok(res.summary.byScamType.competition > 0);
    assert.ok(res.summary.byScamType.overseas_agent > 0);
  });

  it("runner: sample-smoke runs synthetic cases with plumbing header and never bare accuracy figure", async () => {
    const samplePath = path.join(process.cwd(), "data", "eval", "sample-cases.json");
    const loaded = loadEvaluationDataset(samplePath);
    const testCases = loaded.cases.slice(0, 3); // run 3 cases to keep test fast

    const runs = [];
    for (const c of testCases) {
      const res = await runEvalCase(c, {
        mode: "sample-smoke",
        tempDir: tmpDir,
      });
      runs.push(res);
    }

    assert.equal(runs.length, 3);
    const metrics = computeEvaluationMetrics(runs);

    const reportData = {
      meta: {
        date: new Date().toISOString(),
        mode: "sample-smoke",
        gitCommit: "abc1234",
        model: "mock-model",
        datasetPath: "data/eval/sample-cases.json",
        datasetHash: "1234567890",
      },
      datasetSummary: loaded.summary,
      metrics,
      failures: runs.filter((r) => r.expected !== r.predicted),
      classifierMetrics: null,
    };

    const rendered = renderMarkdownReport(reportData);
    assert.ok(rendered.includes("PLUMBING CHECK ON SYNTHETIC CASES; NOT A MEASUREMENT"));
    assert.ok(rendered.includes("plumbing check, no measurement (3 of 3 matched their stubs)"));
    assert.ok(!rendered.includes("95% Wilson Score Interval:"));
    assert.ok(!rendered.includes("95% Bootstrap Confidence Interval:"));
  });

  it("runner: sample-smoke matches documented expectations case-by-case across all 14 sample cases", async () => {
    const samplePath = path.join(process.cwd(), "data", "eval", "sample-cases.json");
    const loaded = loadEvaluationDataset(samplePath);
    assert.equal(loaded.cases.length, 14);

    for (const c of loaded.cases) {
      const res = await runEvalCase(c, {
        mode: "sample-smoke",
        tempDir: tmpDir,
      });
      assert.equal(
        res.predicted,
        res.expected,
        `Case ${c.id} expected level ${res.expected} but predicted ${res.predicted}`
      );
    }
  });

  it("running report generator twice on same data yields identical JSON reports (deterministic)", () => {
    const reportData = {
      meta: {
        date: "2026-10-25T00:00:00.000Z",
        mode: "fixtures",
        gitCommit: "abc1234",
        model: "mock-model",
        datasetPath: "data/eval/sample-cases.json",
        datasetHash: "sha256:1111",
      },
      datasetSummary: {
        total: 3,
        byProvenance: { synthetic: 3, real_public: 0, paraphrased: 0 },
        disagreementsCount: 0,
      },
      metrics: computeEvaluationMetrics([
        { id: "S1", expected: "high", predicted: "high", scamType: "scholarship" },
        { id: "S2", expected: "low", predicted: "low", scamType: "internship" },
        { id: "S3", expected: "cannot_verify", predicted: "cannot_verify", scamType: "task_job" },
      ]),
      failures: [],
      classifierMetrics: null,
    };

    const out1 = JSON.stringify(reportData);
    const out2 = JSON.stringify(reportData);
    assert.equal(out1, out2);
  });
});
