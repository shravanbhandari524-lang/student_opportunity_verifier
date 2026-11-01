#!/usr/bin/env node
/**
 * scripts/evaluate.js
 *
 * Evaluation harness CLI entrypoint.
 *
 * Supported flags:
 *   --validate-only    Validates dataset file and prints summary table (no execution)
 *   --dataset <path>   Path to dataset (.json or .csv). Defaults to data/eval/sample-cases.json
 *   --fixtures         Runs in fixtures mode using deterministic scenario stubs
 *   --replay           Runs in offline replay mode using recorded LLM and search calls
 *   --live             Runs in live mode (requires real keys and safety flags)
 *   --yes-use-fake-or-public-data  Mandatory confirmation flag for live mode
 *   --max-llm-calls N  Maximum LLM calls budget for live mode
 *   --max-searches N   Maximum searches budget for live mode
 *   --show-text        Displays message text in failure inspection
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadEvaluationDataset } from "./eval/loader.js";
import { computeEvaluationMetrics } from "./eval/metrics.js";
import {
  CLAIM_GUARD_MESSAGE,
  loadClassifierMetrics,
  renderMarkdownReport,
  saveEvaluationReport,
} from "./eval/report.js";
import { runEvalCase } from "./eval/runner.js";
import { clearScamScenario } from "../lib/contracts/fixtures/scenarios/scenario-a.js";
import { genuineNoticeScenario } from "../lib/contracts/fixtures/scenarios/scenario-b.js";
import { ambiguousThinEvidenceScenario } from "../lib/contracts/fixtures/scenarios/scenario-c.js";

function getGitCommit() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function parseArgs(args) {
  const flags = {
    validateOnly: false,
    dataset: "data/eval/sample-cases.json",
    casesDir: null,
    fixtures: false,
    sampleSmoke: false,
    replay: false,
    live: false,
    yesUseFakeOrPublicData: false,
    maxLlmCalls: 20,
    maxSearches: 10,
    showText: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--validate-only") flags.validateOnly = true;
    else if (a === "--fixtures") flags.fixtures = true;
    else if (a === "--sample-smoke") flags.sampleSmoke = true;
    else if (a === "--replay") flags.replay = true;
    else if (a === "--live") flags.live = true;
    else if (a === "--yes-use-fake-or-public-data") flags.yesUseFakeOrPublicData = true;
    else if (a === "--show-text") flags.showText = true;
    else if (a === "--cases") {
      flags.casesDir = (i + 1 < args.length && !args[i + 1].startsWith("--")) ? args[++i] : "tests/eval/cases";
    } else if (a === "--dataset" && i + 1 < args.length) {
      flags.dataset = args[++i];
    } else if (a === "--max-llm-calls" && i + 1 < args.length) {
      flags.maxLlmCalls = parseInt(args[++i], 10);
    } else if (a === "--max-searches" && i + 1 < args.length) {
      flags.maxSearches = parseInt(args[++i], 10);
    }
  }

  return flags;
}

export function printSummaryTable(result) {
  const { summary, duplicates, groupViolations, classifierOverlaps } = result;

  console.log("\n=======================================================");
  console.log("             EVALUATION DATASET SUMMARY                ");
  console.log("=======================================================");
  console.log(`Total Cases:              ${summary.total}`);
  console.log(`Label Disagreements:      ${summary.disagreementsCount}`);
  console.log(`Duplicate Text Rows:      ${duplicates.length}`);
  console.log(`Group ID Violations:      ${groupViolations.length}`);
  console.log(`Classifier Overlaps:      ${classifierOverlaps.length}`);
  console.log("\n--- Risk Levels ---");
  for (const [k, v] of Object.entries(summary.byLevel)) {
    console.log(`  ${k.padEnd(16)}: ${v}`);
  }
  console.log("\n--- Scam Types ---");
  for (const [k, v] of Object.entries(summary.byScamType)) {
    console.log(`  ${k.padEnd(16)}: ${v}`);
  }
  console.log("\n--- Languages ---");
  for (const [k, v] of Object.entries(summary.byLanguage)) {
    console.log(`  ${k.padEnd(16)}: ${v}`);
  }
  console.log("\n--- Provenance ---");
  for (const [k, v] of Object.entries(summary.byProvenance)) {
    console.log(`  ${k.padEnd(16)}: ${v}`);
  }
  console.log("=======================================================\n");

  if (duplicates.length > 0) {
    console.warn("WARNING: Duplicate text entries detected:");
    for (const d of duplicates) {
      console.warn(`  - Case ${d.id1} and Case ${d.id2} share identical normalized text`);
    }
  }

  if (groupViolations.length > 0) {
    console.error("ERROR: Group ID consistency violations:");
    for (const v of groupViolations) {
      console.error(`  - ${v.issue}`);
    }
  }

  if (classifierOverlaps.length > 0) {
    console.warn("WARNING: Evaluated cases overlap with classifier training set:");
    for (const o of classifierOverlaps) {
      console.warn(`  - Case ${o.id} matches text hash ${o.textHash.slice(0, 16)}...`);
    }
  }
}

/**
 * Runs 3 standard scenarios in fixtures mode.
 */
export async function runScenariosSmoke(tempDir) {
  const scenarioCases = [
    {
      id: "SCENARIO-A",
      text: clearScamScenario.submission.text,
      link: clearScamScenario.submission.url,
      upiId: clearScamScenario.submission.upiId,
      company: "",
      handle: "",
      phone: "",
      language: clearScamScenario.submission.language,
      expectedLevel: "high",
      scamType: "scholarship",
    },
    {
      id: "SCENARIO-B",
      text: genuineNoticeScenario.submission.text,
      link: genuineNoticeScenario.submission.url,
      upiId: "",
      company: genuineNoticeScenario.submission.company,
      handle: "",
      phone: "",
      language: genuineNoticeScenario.submission.language,
      expectedLevel: "low",
      scamType: "unknown",
    },
    {
      id: "SCENARIO-C",
      text: ambiguousThinEvidenceScenario.submission.text,
      link: "",
      upiId: "",
      company: "",
      handle: ambiguousThinEvidenceScenario.submission.handle,
      phone: "",
      language: ambiguousThinEvidenceScenario.submission.language,
      expectedLevel: "cannot_verify",
      scamType: "task_job",
    },
  ];

  const results = [];
  for (const sc of scenarioCases) {
    const res = await runEvalCase(sc, { mode: "fixtures", tempDir });
    results.push(res);
  }
  return results;
}

export async function runCasesEvaluation(casesDir, flags) {
  const dirPath = path.resolve(process.cwd(), casesDir);
  if (!fs.existsSync(dirPath)) {
    console.error(`ERROR: Cases directory not found: ${dirPath}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.warn(`No .json evaluation cases found in ${dirPath}`);
    return;
  }

  console.log(`\n=======================================================`);
  console.log(`        RUNNING EVALUATION CASES: ${casesDir}          `);
  console.log(`=======================================================`);
  console.log(`Found ${files.length} case file(s).\n`);

  const cases = [];
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
      cases.push({
        file,
        id: content.id || path.basename(file, ".json"),
        input: content.input || {},
        expectedLevel: content.expectedLevel,
        expectedFlagsIncluded: content.expectedFlagsIncluded || [],
        expectedOfficialVerdict: content.expectedOfficialVerdict || null,
        notes: content.notes || "",
      });
    } catch (err) {
      console.error(`Failed to parse ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  if (flags.validateOnly) {
    console.log("Validation mode only. Cases validated successfully:");
    for (const c of cases) {
      console.log(`  - [OK] ${c.id}: expected ${c.expectedLevel}, flags: [${c.expectedFlagsIncluded.join(", ")}]`);
    }
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cases-"));
  const results = [];
  let mismatches = 0;

  try {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      process.stdout.write(`[${i + 1}/${cases.length}] Evaluating ${c.id}... `);

      const evalCaseObj = {
        id: c.id,
        text: c.input?.text || "",
        link: c.input?.link || c.input?.url || "",
        upiId: c.input?.upi || c.input?.upiId || "",
        company: c.input?.company || "",
        handle: c.input?.handle || "",
        phone: c.input?.phone || "",
        language: c.input?.language || "en",
        expectedLevel: c.expectedLevel,
        scamType: "scholarship",
        why: c.notes || "Case verification",
      };

      const mode = flags.live ? "live" : (flags.replay ? "replay" : "fixtures");

      const res = await runEvalCase(evalCaseObj, {
        mode,
        tempDir,
        recordingsDir: process.env.RECORD_REPLAY_DIR || path.join(process.cwd(), ".recordings"),
        limits: {
          maxLlmCalls: flags.maxLlmCalls,
          maxSearches: flags.maxSearches,
        },
      });

      const levelMatch = res.predicted === c.expectedLevel;
      const missingFlags = c.expectedFlagsIncluded.filter((f) => !res.flags.includes(f));
      const flagsMatch = missingFlags.length === 0;

      const isPass = levelMatch && flagsMatch;
      if (!isPass) mismatches++;

      results.push({
        id: c.id,
        expectedLevel: c.expectedLevel,
        predictedLevel: res.predicted,
        levelMatch,
        expectedFlags: c.expectedFlagsIncluded,
        actualFlags: res.flags,
        missingFlags,
        flagsMatch,
        durationMs: res.durationMs,
        isPass,
      });

      const statusTag = isPass ? "PASS" : "MISMATCH";
      console.log(`${statusTag} (predicted: ${res.predicted}, expected: ${c.expectedLevel}) [${res.durationMs}ms]`);
      if (!flagsMatch) {
        console.log(`    Missing expected flags: ${missingFlags.join(", ")}`);
      }
    }

    console.log(`\n=======================================================`);
    console.log(`                 EVALUATION RESULTS                    `);
    console.log(`=======================================================`);
    console.log(`Total Cases:              ${cases.length}`);
    console.log(`Passed (Agreement):       ${cases.length - mismatches}`);
    console.log(`Mismatches:               ${mismatches}`);
    console.log(`Agreement Rate:           ${Math.round(((cases.length - mismatches) / cases.length) * 100)}%`);
    console.log(`=======================================================\n`);

    if (mismatches > 0) {
      process.exitCode = 1;
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.casesDir) {
    await runCasesEvaluation(flags.casesDir, flags);
    return;
  }
  const datasetPath = path.resolve(process.cwd(), flags.dataset);

  const datasetResult = loadEvaluationDataset(datasetPath);

  if (flags.validateOnly || (!flags.fixtures && !flags.sampleSmoke && !flags.replay && !flags.live)) {
    printSummaryTable(datasetResult);
    if (datasetResult.groupViolations.length > 0) {
      process.exit(1);
    }
    return;
  }

  // Safety assertions for live mode
  if (flags.live) {
    if (!flags.yesUseFakeOrPublicData) {
      console.error(
        "ERROR: Live mode requires explicit confirmation flag: --yes-use-fake-or-public-data"
      );
      process.exit(1);
    }
  }

  const mode = flags.sampleSmoke
    ? "sample-smoke"
    : (flags.fixtures ? "fixtures" : (flags.replay ? "replay" : "live"));
  console.log(`\nStarting evaluation harness in mode: [${mode}]`);
  if (mode === "sample-smoke") {
    console.log(`HEADER: "PLUMBING CHECK ON SYNTHETIC CASES; NOT A MEASUREMENT"`);
  }
  console.log(`Claim Guard: "${CLAIM_GUARD_MESSAGE}"\n`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-harness-"));
  const runs = [];
  let stoppedByBudget = false;

  const datasetFileBytes = fs.readFileSync(datasetPath);
  const datasetHash = crypto.createHash("sha256").update(datasetFileBytes).digest("hex");

  try {
    if (flags.fixtures && flags.dataset.includes("sample-cases")) {
      // Run the 3 official scenarios first as fixtures mode smoke
      console.log("Running 3 reference scenarios in fixtures mode...");
      const scenarioRuns = await runScenariosSmoke(tempDir);
      runs.push(...scenarioRuns);
    } else {
      console.log(`Executing ${datasetResult.cases.length} evaluation cases...`);
      for (let i = 0; i < datasetResult.cases.length; i++) {
        const c = datasetResult.cases[i];
        process.stdout.write(`  [${i + 1}/${datasetResult.cases.length}] Evaluating ${c.id}... `);

        const res = await runEvalCase(c, {
          mode,
          tempDir,
          recordingsDir: process.env.RECORD_REPLAY_DIR || path.join(process.cwd(), ".recordings"),
          limits: {
            maxLlmCalls: flags.maxLlmCalls,
            maxSearches: flags.maxSearches,
          },
        });

        runs.push(res);
        const match = res.expected === res.predicted ? "MATCH" : "DIFF";
        console.log(`expected: ${res.expected}, predicted: ${res.predicted} [${match}] (${res.durationMs}ms)`);

        if (res.stoppedByBudget) {
          console.warn("\nWARNING: Live execution budget reached. Stopping early with partial results.");
          stoppedByBudget = true;
          break;
        }
      }
    }

    const metrics = computeEvaluationMetrics(runs);
    const classifierMetrics = loadClassifierMetrics();

    const failures = runs.filter((r) => r.expected !== r.predicted);

    const reportData = {
      meta: {
        date: new Date().toISOString(),
        mode,
        gitCommit: getGitCommit(),
        model: process.env.LLM_MODEL || "mock-model",
        scoringConfigHash: "sha256:default-rules-v1",
        datasetPath: path.relative(process.cwd(), datasetPath),
        datasetHash,
        partial: stoppedByBudget,
      },
      datasetSummary: datasetResult.summary,
      metrics,
      failures,
      classifierMetrics,
    };

    const { jsonPath, mdPath } = saveEvaluationReport(reportData, { showText: flags.showText });

    console.log("\n=======================================================");
    console.log("             EVALUATION RUN COMPLETE                   ");
    console.log("=======================================================");
    console.log(`Cases Processed:          ${runs.length}`);
    if (mode === "sample-smoke" || mode === "fixtures") {
      console.log(`Result:                   plumbing check, no measurement (${metrics.correct ?? 0} of ${metrics.totalCases} matched their stubs)`);
    } else {
      const interval = metrics.wilsonInterval || metrics.bootstrapInterval;
      const ciLow = (interval.low * 100).toFixed(1);
      const ciHigh = (interval.high * 100).toFixed(1);
      console.log(`Agreement:                ${(metrics.agreement * 100).toFixed(1)}% (N=${metrics.totalCases}, 95% CI: [${ciLow}%, ${ciHigh}%])`);
    }
    console.log(`Dangerous Misses (H->L):  ${metrics.dangerousMissesHighToLow}`);
    console.log(`False Alarms (L->H):      ${metrics.falseAlarmsLowToHigh}`);
    console.log(`JSON Report Saved:        ${path.relative(process.cwd(), jsonPath)}`);
    console.log(`Markdown Report Saved:    ${path.relative(process.cwd(), mdPath)}`);
    console.log("=======================================================\n");

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

// Run if directly executed
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("Evaluation error:", err);
    process.exit(1);
  });
}
