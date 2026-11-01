/**
 * scripts/eval/metrics.js
 *
 * Pure evaluation metrics functions for Opportunity Verifier evaluation harness.
 *
 * Metrics computed:
 * 1. Agreement: overall proportion where predicted riskLevel matches expectedLevel.
 * 2. 4x4 Confusion Matrix: rows = expected, columns = predicted across
 *    ['low', 'medium', 'high', 'cannot_verify'].
 * 3. Dangerous Misses:
 *    - critical: expected 'high' but predicted 'low'.
 *    - elevated: expected 'medium' or 'high' but predicted 'low'.
 * 4. False Alarms: expected 'low' but predicted 'high'.
 * 5. Cannot Verify Rate: proportion of predictions that are 'cannot_verify'.
 * 6. Could Not Check Share: proportion of runs with at least one agent returning 'could_not_check'.
 * 7. Per-Scam-Type Breakdown: agreement, count, dangerous misses, and false alarms per scamType.
 * 8. Per-Flag Precision: for each flagId, the proportion of runs containing that flag where the
 *    predicted riskLevel matches expectedLevel.
 * 9. Per-Agent Status Rates: for each agent, rate of ok, skipped, could_not_check.
 * 10. Confidence Calibration: agreement segmented by returned confidence level ('low', 'medium', 'high').
 * 11. Latency Percentiles: min, p50, p90, p95, p99, max, mean.
 * 12. Calls per Case: mean, min, max for llmCalls and searchCalls.
 * 13. Wilson Score Interval: two-sided 95% confidence interval for agreement.
 */

export const RISK_LEVEL_ORDER = ["low", "medium", "high", "cannot_verify"];

/**
 * Computes 4x4 confusion matrix.
 *
 * @param {Array<{ expected: string, predicted: string }>} pairs
 * @returns {Record<string, Record<string, number>>}
 */
export function computeConfusionMatrix(pairs) {
  const matrix = {};
  for (const exp of RISK_LEVEL_ORDER) {
    matrix[exp] = {};
    for (const pred of RISK_LEVEL_ORDER) {
      matrix[exp][pred] = 0;
    }
  }

  for (const { expected, predicted } of pairs) {
    if (matrix[expected] && matrix[expected][predicted] !== undefined) {
      matrix[expected][predicted]++;
    }
  }

  return matrix;
}

/**
 * Computes overall agreement rate (0 to 1).
 *
 * @param {Array<{ expected: string, predicted: string }>} pairs
 * @returns {number}
 */
export function computeAgreement(pairs) {
  if (!pairs || pairs.length === 0) return 0;
  let matches = 0;
  for (const { expected, predicted } of pairs) {
    if (expected === predicted) matches++;
  }
  return matches / pairs.length;
}

/**
 * Computes explicit error categories across the 4x4 matrix:
 * - correct: expected === predicted (4 diagonal cells)
 * - dangerousMiss: medium | high -> low (2 cells)
 * - falseAlarm: low -> high (1 cell)
 * - overCautious: low -> medium (1 cell)
 * - unhelpfulAbstention: high | medium | low -> cannot_verify (3 cells)
 * - missedAbstention: cannot_verify -> low | medium | high (3 cells)
 * - otherMisclassifications: medium -> high, high -> medium (2 cells)
 * Total cells = 4 + 2 + 1 + 1 + 3 + 3 + 2 = 16 cells (exhaustive partition).
 *
 * @param {Array<{ expected: string, predicted: string }>} pairs
 * @returns {{
 *   correct: number,
 *   dangerousMisses: number,
 *   dangerousMissesHighToLow: number,
 *   dangerousMissesElevatedToLow: number,
 *   falseAlarms: number,
 *   falseAlarmsLowToHigh: number,
 *   overCautious: number,
 *   unhelpfulAbstention: number,
 *   missedAbstention: number,
 *   otherMisclassifications: number,
 *   total: number
 * }}
 */
export function computeErrorExtremes(pairs) {
  let correct = 0;
  let dangerousMisses = 0;
  let highToLow = 0;
  let mediumToLow = 0;
  let falseAlarms = 0;
  let overCautious = 0;
  let unhelpfulAbstention = 0;
  let missedAbstention = 0;
  let otherMisclassifications = 0;

  for (const { expected, predicted } of pairs) {
    if (expected === predicted) {
      correct++;
    } else if ((expected === "high" || expected === "medium") && predicted === "low") {
      dangerousMisses++;
      if (expected === "high") highToLow++;
      if (expected === "medium") mediumToLow++;
    } else if (expected === "low" && predicted === "high") {
      falseAlarms++;
    } else if (expected === "low" && predicted === "medium") {
      overCautious++;
    } else if (
      (expected === "high" || expected === "medium" || expected === "low") &&
      predicted === "cannot_verify"
    ) {
      unhelpfulAbstention++;
    } else if (
      expected === "cannot_verify" &&
      (predicted === "low" || predicted === "medium" || predicted === "high")
    ) {
      missedAbstention++;
    } else {
      otherMisclassifications++;
    }
  }

  return {
    correct,
    dangerousMisses,
    dangerousMissesHighToLow: highToLow,
    dangerousMissesElevatedToLow: highToLow + mediumToLow,
    falseAlarms,
    falseAlarmsLowToHigh: falseAlarms,
    overCautious,
    unhelpfulAbstention,
    missedAbstention,
    otherMisclassifications,
    total: pairs.length,
  };
}

/**
 * Computes latency percentiles.
 *
 * @param {number[]} latenciesMs
 * @returns {{ min: number, p50: number, p90: number, p95: number, p99: number, max: number, mean: number }}
 */
export function computeLatencyPercentiles(latenciesMs) {
  if (!latenciesMs || latenciesMs.length === 0) {
    return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  const getPercentile = (p) => {
    if (n === 1) return sorted[0];
    const index = (p / 100) * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  return {
    min: sorted[0],
    p50: Math.round(getPercentile(50)),
    p90: Math.round(getPercentile(90)),
    p95: Math.round(getPercentile(95)),
    p99: Math.round(getPercentile(99)),
    max: sorted[n - 1],
    mean: Math.round((sum / n) * 10) / 10,
  };
}

/**
 * Computes the two-sided 95% Wilson score interval for a binomial proportion.
 *
 * For sample size n and k successes:
 *   p_hat = k / n
 *   center = (k + z^2 / 2) / (n + z^2)
 *   margin = (z * sqrt((k * (n - k) / n) + (z^2 / 4))) / (n + z^2)
 *   [low, high] = [max(0, center - margin), min(1, center + margin)]
 *
 * Default z = 1.95996 (two-sided 95% confidence).
 *
 * @param {number} k Number of matches/successes
 * @param {number} n Sample size
 * @param {number} [z=1.95996] Normal critical value
 * @returns {{ low: number, high: number, p: number }}
 */
export function computeWilsonScoreInterval(k, n, z = 1.95996) {
  if (n <= 0) {
    return { low: 0, high: 0, p: 0 };
  }
  const pHat = k / n;
  const z2 = z * z;
  const denominator = n + z2;
  const center = (k + z2 / 2) / denominator;
  const underRadical = (k * (n - k)) / n + z2 / 4;
  const margin = (z * Math.sqrt(Math.max(0, underRadical))) / denominator;

  const low = Math.max(0, center - margin);
  const high = Math.min(1, center + margin);

  return {
    low: Math.round(low * 1000) / 1000,
    high: Math.round(high * 1000) / 1000,
    p: Math.round(pHat * 1000) / 1000,
  };
}

/**
 * Computes flag agreement rates: for each flagId, the proportion of runs where
 * the predicted riskLevel matches expectedLevel ("how often the final level
 * matched the label in cases where this flag fired; not the accuracy of the flag").
 *
 * @param {Array<{ expected: string, predicted: string, flags: string[] }>} runs
 * @returns {Record<string, { count: number, agreementRate: number, precision: number, note: string }>}
 */
export function computeFlagAgreementRates(runs) {
  const flagMap = {};

  for (const { expected, predicted, flags } of runs) {
    if (!flags || !Array.isArray(flags)) continue;
    const isCorrect = expected === predicted;
    for (const flagId of flags) {
      if (!flagMap[flagId]) {
        flagMap[flagId] = { total: 0, correct: 0 };
      }
      flagMap[flagId].total++;
      if (isCorrect) flagMap[flagId].correct++;
    }
  }

  const result = {};
  for (const [flagId, stats] of Object.entries(flagMap)) {
    const rate = Math.round((stats.correct / stats.total) * 1000) / 1000;
    result[flagId] = {
      count: stats.total,
      agreementRate: rate,
      precision: rate, // backward compatibility
      note: "how often the final level matched the label in cases where this flag fired; not the accuracy of the flag",
    };
  }
  return result;
}

export const computePerFlagPrecision = computeFlagAgreementRates;

/**
 * Computes per-agent status rates: for each agent, rate of ok, skipped, could_not_check.
 *
 * @param {Array<{ agentResults: Array<{ agent: string, status: string }> }>} runs
 * @returns {Record<string, { ok: number, skipped: number, couldNotCheck: number, total: number }>}
 */
export function computePerAgentStatusRates(runs) {
  const agentMap = {};

  for (const run of runs) {
    if (!run.agentResults || !Array.isArray(run.agentResults)) continue;
    for (const res of run.agentResults) {
      const agent = res.agent || "unknown";
      if (!agentMap[agent]) {
        agentMap[agent] = { ok: 0, skipped: 0, couldNotCheck: 0, total: 0 };
      }
      agentMap[agent].total++;
      if (res.status === "ok") agentMap[agent].ok++;
      else if (res.status === "skipped") agentMap[agent].skipped++;
      else if (res.status === "could_not_check") agentMap[agent].couldNotCheck++;
    }
  }

  return agentMap;
}

/**
 * Computes confidence calibration: agreement rate per confidence level.
 *
 * @param {Array<{ expected: string, predicted: string, confidence?: string }>} runs
 * @returns {Record<string, { count: number, agreement: number }>}
 */
export function computeConfidenceCalibration(runs) {
  const confMap = {
    low: { count: 0, matches: 0 },
    medium: { count: 0, matches: 0 },
    high: { count: 0, matches: 0 },
  };

  for (const run of runs) {
    const conf = run.confidence || "low";
    if (!confMap[conf]) confMap[conf] = { count: 0, matches: 0 };
    confMap[conf].count++;
    if (run.expected === run.predicted) {
      confMap[conf].matches++;
    }
  }

  const result = {};
  for (const [lvl, stats] of Object.entries(confMap)) {
    result[lvl] = {
      count: stats.count,
      agreement: stats.count > 0 ? Math.round((stats.matches / stats.count) * 1000) / 1000 : 0,
    };
  }
  return result;
}

/**
 * Computes per-scam-type breakdown.
 *
 * @param {Array<{ expected: string, predicted: string, scamType: string }>} runs
 * @returns {Record<string, { count: number, agreement: number, dangerousMisses: number, falseAlarms: number }>}
 */
export function computePerScamTypeBreakdown(runs) {
  const breakdown = {};

  for (const run of runs) {
    const st = run.scamType || "unknown";
    if (!breakdown[st]) {
      breakdown[st] = { runs: [] };
    }
    breakdown[st].runs.push({ expected: run.expected, predicted: run.predicted });
  }

  const result = {};
  for (const [st, { runs: subRuns }] of Object.entries(breakdown)) {
    const agreement = computeAgreement(subRuns);
    const extremes = computeErrorExtremes(subRuns);
    result[st] = {
      count: subRuns.length,
      agreement: Math.round(agreement * 1000) / 1000,
      dangerousMisses: extremes.dangerousMissesElevatedToLow,
      falseAlarms: extremes.falseAlarmsLowToHigh,
    };
  }

  return result;
}

/**
 * Master evaluation metrics accumulator.
 *
 * @param {Array<{
 *   id: string,
 *   expected: string,
 *   predicted: string,
 *   scamType: string,
 *   confidence?: string,
 *   flags?: string[],
 *   agentResults?: Array<{ agent: string, status: string }>,
 *   durationMs?: number,
 *   llmCalls?: number,
 *   searchCalls?: number
 * }>} runs
 * @returns {object} Aggregated evaluation report metrics
 */
export function computeEvaluationMetrics(runs) {
  const n = runs.length;
  if (n === 0) {
    return {
      totalCases: 0,
      agreement: 0,
      confusionMatrix: computeConfusionMatrix([]),
      dangerousMissesHighToLow: 0,
      dangerousMissesElevatedToLow: 0,
      falseAlarmsLowToHigh: 0,
      cannotVerifyRate: 0,
      couldNotCheckShare: 0,
      perScamType: {},
      perFlagPrecision: {},
      perAgentStatusRates: {},
      confidenceCalibration: {},
      latencies: computeLatencyPercentiles([]),
      callsPerCase: { meanLlmCalls: 0, meanSearchCalls: 0, maxLlmCalls: 0, maxSearchCalls: 0 },
      wilsonInterval: { low: 0, high: 0, p: 0 },
      bootstrapInterval: { low: 0, high: 0, p: 0 },
    };
  }

  const pairs = runs.map((r) => ({ expected: r.expected, predicted: r.predicted }));
  const agreement = computeAgreement(pairs);
  const confusionMatrix = computeConfusionMatrix(pairs);
  const extremes = computeErrorExtremes(pairs);

  const cannotVerifyCount = pairs.filter((p) => p.predicted === "cannot_verify").length;
  const cannotVerifyRate = Math.round((cannotVerifyCount / n) * 1000) / 1000;

  let runsWithCouldNotCheck = 0;
  for (const r of runs) {
    if (r.agentResults && r.agentResults.some((a) => a.status === "could_not_check")) {
      runsWithCouldNotCheck++;
    }
  }
  const couldNotCheckShare = Math.round((runsWithCouldNotCheck / n) * 1000) / 1000;

  const latencies = computeLatencyPercentiles(runs.map((r) => r.durationMs || 0));

  let totalLlm = 0;
  let totalSearch = 0;
  let maxLlm = 0;
  let maxSearch = 0;
  for (const r of runs) {
    const l = r.llmCalls || 0;
    const s = r.searchCalls || 0;
    totalLlm += l;
    totalSearch += s;
    if (l > maxLlm) maxLlm = l;
    if (s > maxSearch) maxSearch = s;
  }

  const callsPerCase = {
    meanLlmCalls: Math.round((totalLlm / n) * 10) / 10,
    meanSearchCalls: Math.round((totalSearch / n) * 10) / 10,
    maxLlmCalls: maxLlm,
    maxSearchCalls: maxSearch,
  };

  const wilsonInterval = computeWilsonScoreInterval(extremes.correct, n);
  const perScamType = computePerScamTypeBreakdown(runs);
  const flagAgreementRates = computeFlagAgreementRates(runs);
  const perAgentStatusRates = computePerAgentStatusRates(runs);
  const confidenceCalibration = computeConfidenceCalibration(runs);

  return {
    totalCases: n,
    agreement: Math.round(agreement * 1000) / 1000,
    confusionMatrix,
    correct: extremes.correct,
    dangerousMisses: extremes.dangerousMisses,
    dangerousMissesHighToLow: extremes.dangerousMissesHighToLow,
    dangerousMissesElevatedToLow: extremes.dangerousMissesElevatedToLow,
    falseAlarms: extremes.falseAlarms,
    falseAlarmsLowToHigh: extremes.falseAlarmsLowToHigh,
    overCautious: extremes.overCautious,
    unhelpfulAbstention: extremes.unhelpfulAbstention,
    missedAbstention: extremes.missedAbstention,
    otherMisclassifications: extremes.otherMisclassifications,
    cannotVerifyRate,
    couldNotCheckShare,
    perScamType,
    flagAgreementRates,
    perFlagPrecision: flagAgreementRates, // alias
    perAgentStatusRates,
    confidenceCalibration,
    latencies,
    callsPerCase,
    wilsonInterval,
    bootstrapInterval: wilsonInterval, // backwards compatibility alias
  };
}
