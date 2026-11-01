/**
 * scripts/eval/report.js
 *
 * Markdown and JSON report generator for evaluation runs.
 *
 * Guarantees:
 * - Claim Guard:
 *   "CLAIM GUARD: No accuracy statement may be asserted unless evaluation dataset contains
 *   at least 50 non-synthetic cases with two independent labels."
 * - Provenance Breakdown:
 *   Reports exact counts of synthetic vs non-synthetic cases first.
 * - Classifier Section:
 *   Loads services/classifier/metrics.json and prints its warning without training.
 * - Failure Inspection:
 *   Displays case ID, expected, predicted, flag IDs, and reasons only.
 *   Shows raw message text ONLY when showText is explicitly true.
 */

import fs from "node:fs";
import path from "node:path";

export const CLAIM_GUARD_MESSAGE =
  "CLAIM GUARD: No public accuracy claim may be asserted unless the evaluation dataset contains at least 50 non-synthetic cases with two independent labels.";

/**
 * Loads classifier metrics if available.
 *
 * @returns {object | null}
 */
export function loadClassifierMetrics() {
  const metricsPath = path.join(process.cwd(), "services", "classifier", "metrics.json");
  if (!fs.existsSync(metricsPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metricsPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Checks if claim guard allows accuracy statements.
 * Only cases with source_type real_public or paraphrased, both labeler_1 and labeler_2
 * non-empty and equal, and expected_level agreeing with both, count toward the 50.
 *
 * @param {object} datasetSummary
 * @returns {{ allowed: boolean, qualifyingCount: number, total: number, reason: string, header: string }}
 */
export function evaluateClaimGuard(datasetSummary = {}) {
  const total = datasetSummary.total || 0;
  const qualifyingCount = datasetSummary.qualifyingCount !== undefined
    ? datasetSummary.qualifyingCount
    : (datasetSummary.byProvenance?.real_public || 0) + (datasetSummary.byProvenance?.paraphrased || 0);

  const allowed = qualifyingCount >= 50;
  const header = allowed
    ? `PRELIMINARY FIGURE ONLY (Qualifying: ${qualifyingCount} / Total: ${total}), interval shown`
    : `NO PUBLIC ACCURACY CLAIM PERMITTED (Qualifying: ${qualifyingCount} / Total: ${total})`;

  const reason = allowed
    ? `Dataset qualifies for preliminary reporting (${qualifyingCount} qualifying double-labelled non-synthetic cases; >= 50 required).`
    : `Public accuracy claim prohibited: dataset contains only ${qualifyingCount} qualifying cases (minimum 50 double-labelled non-synthetic cases with agreeing labels required).`;

  return { allowed, qualifyingCount, total, reason, header };
}

/**
 * Renders Markdown report string.
 *
 * @param {object} reportData
 * @param {object} [options]
 * @param {boolean} [options.showText=false]
 * @returns {string}
 */
export function renderMarkdownReport(reportData, options = {}) {
  const { meta, datasetSummary, metrics, failures, classifierMetrics } = reportData;
  const guard = evaluateClaimGuard(datasetSummary);
  const showText = Boolean(options.showText);

  const lines = [];

  const isPlumbingMode = meta.mode === "sample-smoke" || meta.mode === "fixtures";
  const claimHeader = isPlumbingMode
    ? "PLUMBING CHECK ON SYNTHETIC CASES; NOT A MEASUREMENT"
    : guard.header;

  lines.push("# Student Opportunity Verifier: Evaluation Report");
  lines.push("");
  lines.push(`> [!IMPORTANT]`);
  lines.push(`> **Claim Guard Header:** ${claimHeader}`);
  lines.push(`> **Notice:** ${CLAIM_GUARD_MESSAGE}`);
  lines.push(`> *Status:* **${guard.allowed ? "QUALIFIED" : "UNQUALIFIED / BENCHMARK ONLY"}** — ${guard.reason}`);
  lines.push("");

  // How to read this
  const interval = metrics.wilsonInterval || metrics.bootstrapInterval;
  const ciLow = (interval.low * 100).toFixed(1);
  const ciHigh = (interval.high * 100).toFixed(1);
  lines.push("## How to read this report");
  lines.push(`- **Sample Size (Total):** ${metrics.totalCases}`);
  lines.push(`- **Qualifying Double-Labelled Non-Synthetic Cases:** ${guard.qualifyingCount}`);
  if (isPlumbingMode) {
    lines.push(`- **Result:** plumbing check, no measurement (${metrics.correct ?? 0} of ${metrics.totalCases} matched their stubs)`);
  } else {
    lines.push(`- **95% Wilson Score Interval:** [${ciLow}%, ${ciHigh}%]`);
    lines.push(`- **Agreement:** ${(metrics.agreement * 100).toFixed(1)}% (N=${metrics.totalCases}, 95% CI: [${ciLow}%, ${ciHigh}%])`);
  }
  lines.push(`- **Claim Guard Status:** ${guard.allowed ? "QUALIFIED" : "PROHIBITED (less than 50 qualifying cases)"}`);
  lines.push("");

  // 1. Run Metadata
  lines.push("## 1. Run Metadata");
  lines.push(`- **Date:** ${meta.date}`);
  lines.push(`- **Mode:** \`${meta.mode}\``);
  lines.push(`- **Git Commit:** \`${meta.gitCommit}\``);
  lines.push(`- **Model:** \`${meta.model}\``);
  lines.push(`- **Scoring Config Hash:** \`${meta.scoringConfigHash || "n/a"}\``);
  lines.push(`- **Test Set File:** \`${meta.datasetPath}\``);
  lines.push(`- **Test Set Hash:** \`${meta.datasetHash}\``);
  if (meta.partial) {
    lines.push(`- **Warning:** Run stopped early due to budget cap. Results are **PARTIAL**.`);
  }
  lines.push("");

  // 2. Dataset Composition
  lines.push("## 2. Dataset Composition & Provenance");
  lines.push(`- **Total Cases:** ${datasetSummary.total}`);
  lines.push(`- **Synthetic Cases:** ${datasetSummary.byProvenance?.synthetic || 0}`);
  lines.push(`- **Real Public Cases:** ${datasetSummary.byProvenance?.real_public || 0}`);
  lines.push(`- **Paraphrased Cases:** ${datasetSummary.byProvenance?.paraphrased || 0}`);
  lines.push(`- **Annotator Disagreements:** ${datasetSummary.disagreementsCount || 0}`);
  lines.push("");

  // 3. Overall Performance
  lines.push("## 3. Overall Evaluation Metrics");
  if (isPlumbingMode) {
    lines.push(`- **Result:** plumbing check, no measurement (${metrics.correct ?? 0} of ${metrics.totalCases} matched their stubs)`);
  } else {
    lines.push(`- **Agreement:** ${(metrics.agreement * 100).toFixed(1)}% (N=${metrics.totalCases}, 95% CI: [${ciLow}%, ${ciHigh}%])`);
  }
  lines.push(`- **Correct Classifications:** ${metrics.correct ?? 0}`);
  lines.push(`- **Dangerous Misses (Medium/High -> Low):** ${metrics.dangerousMisses ?? metrics.dangerousMissesElevatedToLow} (High -> Low: ${metrics.dangerousMissesHighToLow})`);
  lines.push(`- **False Alarms (Low -> High):** ${metrics.falseAlarms ?? metrics.falseAlarmsLowToHigh}`);
  lines.push(`- **Over-cautious (Low -> Medium):** ${metrics.overCautious ?? 0}`);
  lines.push(`- **Unhelpful Abstention (High/Med/Low -> Cannot Verify):** ${metrics.unhelpfulAbstention ?? 0}`);
  lines.push(`- **Missed Abstention (Cannot Verify -> Low/Med/High):** ${metrics.missedAbstention ?? 0}`);
  lines.push(`- **Other Misclassifications:** ${metrics.otherMisclassifications ?? 0}`);
  lines.push(`- **Cannot Verify Rate:** ${(metrics.cannotVerifyRate * 100).toFixed(1)}%`);
  lines.push(`- **Runs with could_not_check:** ${(metrics.couldNotCheckShare * 100).toFixed(1)}%`);
  lines.push("");

  // 4. 4x4 Confusion Matrix
  lines.push("## 4. 4x4 Confusion Matrix (Expected vs Predicted)");
  lines.push("| Expected \\ Predicted | low | medium | high | cannot_verify |");
  lines.push("|---|---|---|---|---|");
  for (const exp of ["low", "medium", "high", "cannot_verify"]) {
    const row = metrics.confusionMatrix[exp] || {};
    lines.push(`| **${exp}** | ${row.low || 0} | ${row.medium || 0} | ${row.high || 0} | ${row.cannot_verify || 0} |`);
  }
  lines.push("");

  // 5. Per Scam-Type Breakdown
  lines.push("## 5. Performance by Scam Type");
  lines.push("| Scam Type | Cases | Agreement | Dangerous Misses | False Alarms |");
  lines.push("|---|---|---|---|---|");
  for (const [st, stats] of Object.entries(metrics.perScamType || {})) {
    lines.push(`| \`${st}\` | ${stats.count} | ${(stats.agreement * 100).toFixed(1)}% | ${stats.dangerousMisses} | ${stats.falseAlarms} |`);
  }
  lines.push("");

  // 6. Confidence Calibration
  lines.push("## 6. Confidence Calibration");
  lines.push("| Confidence Level | Count | Agreement |");
  lines.push("|---|---|---|");
  for (const [lvl, stats] of Object.entries(metrics.confidenceCalibration || {})) {
    lines.push(`| \`${lvl}\` | ${stats.count} | ${(stats.agreement * 100).toFixed(1)}% |`);
  }
  lines.push("");

  // 6b. Flag Agreement Rates
  lines.push("## 6b. Flag Agreement Rates");
  lines.push("> *Note:* Flag agreement rate measures how often the final level matched the label in cases where this flag fired; not the accuracy of the flag.");
  lines.push("| Flag ID | Fires Count | Agreement Rate |");
  lines.push("|---|---|---|");
  const flagRates = metrics.flagAgreementRates || metrics.perFlagPrecision || {};
  if (Object.keys(flagRates).length === 0) {
    lines.push("| *(none recorded)* | 0 | n/a |");
  } else {
    for (const [flagId, stats] of Object.entries(flagRates)) {
      const rate = stats.agreementRate ?? stats.precision;
      lines.push(`| \`${flagId}\` | ${stats.count} | ${(rate * 100).toFixed(1)}% |`);
    }
  }
  lines.push("");

  // 7. Latency and Resource Usage
  lines.push("## 7. Operational Latency & Calls");
  lines.push(`- **Latency Percentiles:** p50: ${metrics.latencies.p50}ms | p90: ${metrics.latencies.p90}ms | p95: ${metrics.latencies.p95}ms | max: ${metrics.latencies.max}ms`);
  lines.push(`- **LLM Calls per Case:** mean: ${metrics.callsPerCase.meanLlmCalls} | max: ${metrics.callsPerCase.maxLlmCalls}`);
  lines.push(`- **Search Calls per Case:** mean: ${metrics.callsPerCase.meanSearchCalls} | max: ${metrics.callsPerCase.maxSearchCalls}`);
  lines.push("");

  // 8. Classifier Baseline Section
  lines.push("## 8. Auxiliary Classifier Status");
  if (classifierMetrics) {
    lines.push(`> [!WARNING]`);
    lines.push(`> **Synthetic Classifier Warning:** ${classifierMetrics.warning}`);
    lines.push(`- **Classifier Test Accuracy:** ${classifierMetrics.classification_report?.accuracy ?? "n/a"}`);
    lines.push(`- **Weighted F1:** ${classifierMetrics.weighted_f1 ?? "n/a"}`);
    lines.push(`- **Zero Training Assertion:** No model was trained or re-fit during this evaluation.`);
  } else {
    lines.push(`*Auxiliary classifier metrics file not found.*`);
  }
  lines.push("");

  // 9. Failure Analysis
  lines.push("## 9. Failure Inspection");
  if (!failures || failures.length === 0) {
    lines.push("Zero failures recorded: all cases matched expected risk levels.");
  } else {
    lines.push(`Found ${failures.length} disagreements / failures:`);
    lines.push("");
    for (const f of failures) {
      lines.push(`### Case \`${f.id}\``);
      lines.push(`- **Expected:** \`${f.expected}\` | **Got:** \`${f.predicted}\``);
      lines.push(`- **Reason Codes:** \`${(f.reasons && f.reasons.length > 0) ? f.reasons.join(", ") : "none"}\``);
      lines.push(`- **Flag IDs:** \`${(f.flags && f.flags.length > 0) ? f.flags.join(", ") : "none"}\``);
      if (showText && f.text) {
        lines.push(`- **Message Text:**`);
        lines.push(`  \`\`\``);
        lines.push(`  ${f.text}`);
        lines.push(`  \`\`\``);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Saves evaluation report files (both .json and .md).
 *
 * @param {object} reportData
 * @param {object} [options]
 * @param {string} [options.outputDir="data/eval/reports"]
 * @param {boolean} [options.showText=false]
 * @returns {{ jsonPath: string, mdPath: string }}
 */
export function saveEvaluationReport(reportData, options = {}) {
  const outputDir = path.resolve(process.cwd(), options.outputDir || "data/eval/reports");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `eval-report-${reportData.meta.mode}-${timestamp}`;

  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const mdPath = path.join(outputDir, `${baseName}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), "utf8");
  fs.writeFileSync(mdPath, renderMarkdownReport(reportData, options), "utf8");

  return { jsonPath, mdPath };
}
