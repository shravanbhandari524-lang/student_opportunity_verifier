/**
 * lib/scoring/score.js
 *
 * Deterministic scoring engine for an opportunity verification case.
 * Pure code: no file reads, no network, no DB, no LLM, no randomness, no mutation of input.
 */

import {
  ScoreResultSchema,
  FLAG_GROUPS,
  FLAG_GROUP_CAPS,
  SOFT_FLAG_CAP,
  NO_HIGH_EVIDENCE_CAP,
  defaultSeverity,
} from "../contracts/index.js";
import { defaultConfig } from "./config.js";

/**
 * Deterministic scoring engine for an opportunity verification case.
 * Pure code: no I/O, no DB, no LLM, no randomness, no mutation of input.
 *
 * @param {object} snapshot - Case file snapshot containing findings
 * @param {object} [config=defaultConfig] - Frozen scoring configuration or options
 * @param {object} [options={}] - Options (e.g. { classifierMaxPoints })
 * @returns {import("../contracts/score-result.js").ScoreResult} Validated ScoreResult
 */
export function scoreCase(snapshot, config = defaultConfig, options = {}) {
  let effectiveConfig = config;
  let effectiveOptions = options;

  if (config && typeof config === "object" && !config.thresholds) {
    // Caller passed options as second argument: scoreCase(snapshot, { classifierMaxPoints: 10 })
    effectiveOptions = config;
    effectiveConfig = defaultConfig;
  }

  const findings = Array.isArray(snapshot?.findings) ? snapshot.findings : [];

  // Eligibility
  let completedCount = 0;
  let eligibleCount = 0;

  for (const finding of findings) {
    if (!finding || typeof finding.status !== "string") {
      continue;
    }
    if (finding.status === "ok") {
      completedCount++;
      eligibleCount++;
    } else if (finding.status === "could_not_check") {
      eligibleCount++;
    }
  }

  // Zero eligible
  if (eligibleCount === 0) {
    return ScoreResultSchema.parse({
      level: "cannot_verify",
      score: 0,
      confidence: "low",
      completedCount: 0,
      eligibleCount: 0,
      completionRatio: 0,
      rulesFired: [],
      flagPoints: [],
      classifierPoints: 0,
      confidenceCapped: false,
      reasonCodes: ["no_eligible_agents"],
      fallbackWeightFlags: [],
    });
  }

  const completionRatio = completedCount / eligibleCount;

  // Step 1: Collect flags from agents with status ok. Deduplicate by flag id across agents and rounds.
  // Weight = config weight by flag id, else severity fallback.
  /** @type {Map<string, { id: string, severity: string, weight: number, points: number, status: "counted" | "group_suppressed" | "duplicate_ignored", agents: Set<string> }>} */
  const flagMap = new Map();
  const fallbackWeightFlagsSet = new Set();

  for (const finding of findings) {
    if (finding.status !== "ok" || !Array.isArray(finding.flags)) {
      continue;
    }
    for (const flag of finding.flags) {
      if (!flag || !flag.id) {
        continue;
      }
      if (!flagMap.has(flag.id)) {
        let weight;
        if (effectiveConfig.flagWeights && Object.prototype.hasOwnProperty.call(effectiveConfig.flagWeights, flag.id)) {
          weight = effectiveConfig.flagWeights[flag.id];
        } else {
          weight = (effectiveConfig.severityWeights && effectiveConfig.severityWeights[flag.severity]) ?? 0;
          fallbackWeightFlagsSet.add(flag.id);
        }
        flagMap.set(flag.id, {
          id: flag.id,
          severity: flag.severity || defaultSeverity(flag.id) || "medium",
          weight,
          points: weight,
          status: "counted",
          agents: new Set(finding.agent ? [finding.agent] : []),
        });
      } else {
        const item = flagMap.get(flag.id);
        if (finding.agent) {
          item.agents.add(finding.agent);
        }
      }
    }
  }

  const rulesFired = [];

  // Step 2: Mutual exclusion & group suppression:
  // Fee group: within fee group keep only highest-weight flag
  const feeMembers = effectiveConfig.flagGroups?.fee ?? FLAG_GROUPS.fee;
  if (Array.isArray(feeMembers)) {
    const present = feeMembers.filter((id) => flagMap.has(id));
    if (present.length > 1) {
      let winnerId = present[0];
      let maxWeight = flagMap.get(winnerId).weight;
      for (let i = 1; i < present.length; i++) {
        const mid = present[i];
        const mw = flagMap.get(mid).weight;
        if (mw > maxWeight) {
          maxWeight = mw;
          winnerId = mid;
        }
      }
      for (const mid of present) {
        const item = flagMap.get(mid);
        if (mid === winnerId) {
          item.status = "counted";
          item.points = item.weight;
        } else {
          item.status = "group_suppressed";
          item.points = 0;
        }
      }
    }
  }

  // Mutual exclusion: within fee_equipment group keep only highest-weight flag; record "exclusion:fee_equipment"
  const feeEquipmentMembers = effectiveConfig.flagGroups?.fee_equipment ?? FLAG_GROUPS.fee_equipment;
  if (Array.isArray(feeEquipmentMembers)) {
    const present = feeEquipmentMembers.filter((id) => flagMap.has(id));
    if (present.length > 1) {
      let winnerId = present[0];
      let maxWeight = flagMap.get(winnerId).weight;
      for (let i = 1; i < present.length; i++) {
        const mid = present[i];
        const mw = flagMap.get(mid).weight;
        if (mw > maxWeight) {
          maxWeight = mw;
          winnerId = mid;
        }
      }
      for (const mid of present) {
        const item = flagMap.get(mid);
        if (mid === winnerId) {
          item.status = "counted";
          item.points = item.weight;
        } else {
          item.status = "group_suppressed";
          item.points = 0;
        }
      }
      rulesFired.push("exclusion:fee_equipment");
    }
  }

  // Step 3: Correlation caps: hiring_process and pay each capped at 20; record "correlation_cap:<group>" when a cap reduces points.
  const hiringMembers = effectiveConfig.flagGroups?.hiring_process ?? FLAG_GROUPS.hiring_process;
  const hiringCap = effectiveConfig.groupCaps?.hiring_process ?? FLAG_GROUP_CAPS.hiring_process;
  let hiringSum = 0;
  if (Array.isArray(hiringMembers)) {
    for (const id of hiringMembers) {
      const item = flagMap.get(id);
      if (item && item.status === "counted") {
        hiringSum += item.points;
      }
    }
  }
  let hiringEffective = hiringSum;
  if (hiringSum > hiringCap) {
    hiringEffective = hiringCap;
    rulesFired.push("correlation_cap:hiring_process");
  }

  const payMembers = effectiveConfig.flagGroups?.pay ?? FLAG_GROUPS.pay;
  const payCap = effectiveConfig.groupCaps?.pay ?? FLAG_GROUP_CAPS.pay;
  let paySum = 0;
  if (Array.isArray(payMembers)) {
    for (const id of payMembers) {
      const item = flagMap.get(id);
      if (item && item.status === "counted") {
        paySum += item.points;
      }
    }
  }
  let payEffective = paySum;
  if (paySum > payCap) {
    payEffective = payCap;
    rulesFired.push("correlation_cap:pay");
  }

  // Other soft flags (low and medium flags NOT in hiring_process and NOT in pay)
  let otherSoftSum = 0;
  for (const item of flagMap.values()) {
    if (item.status === "counted") {
      const isHiring = Array.isArray(hiringMembers) && hiringMembers.includes(item.id);
      const isPay = Array.isArray(payMembers) && payMembers.includes(item.id);
      const sev = defaultSeverity(item.id) || item.severity;
      if (!isHiring && !isPay && (sev === "low" || sev === "medium")) {
        otherSoftSum += item.points;
      }
    }
  }

  // Step 4: Soft cap: total points from low and medium flags capped at 45; record "soft_flag_cap_applied" when it reduces points.
  // High-severity flags are not part of this cap.
  const uncappedSoftTotal = hiringEffective + payEffective + otherSoftSum;
  const softCap = effectiveConfig.softFlagCap ?? SOFT_FLAG_CAP;
  let effectiveSoftTotal = uncappedSoftTotal;
  if (uncappedSoftTotal > softCap) {
    effectiveSoftTotal = softCap;
    rulesFired.push("soft_flag_cap_applied");
  }

  // Step 5: Add high-severity flag points.
  let highFlagPoints = 0;
  for (const item of flagMap.values()) {
    if (item.status === "counted") {
      const sev = defaultSeverity(item.id) || item.severity;
      if (sev === "high") {
        highFlagPoints += item.points;
      }
    }
  }

  const totalFlagPoints = effectiveSoftTotal + highFlagPoints;

  // Step 6: Classifier points = round(classifierMaxPoints * max(0, (p - 0.5) / 0.5)), classifierMaxPoints is an input (default 25), added after the soft cap.
  const classifierMaxPoints =
    typeof effectiveOptions?.classifierMaxPoints === "number"
      ? effectiveOptions.classifierMaxPoints
      : effectiveConfig.classifier?.maxPoints ?? 25;

  let classifierPoints = 0;
  for (const finding of findings) {
    if (finding && finding.agent === "classifier_client" && finding.status === "ok") {
      if (finding.classifierResult && typeof finding.classifierResult.probability === "number") {
        const p = finding.classifierResult.probability;
        const zeroAt = effectiveConfig.classifier?.zeroAt ?? 0.5;
        const fullAt = effectiveConfig.classifier?.fullAt ?? 1.0;
        const ratio = Math.max(0, (p - zeroAt) / (fullAt - zeroAt));
        classifierPoints = Math.round(classifierMaxPoints * ratio);
      }
      break;
    }
  }

  let score = Math.round(totalFlagPoints + classifierPoints);

  // Step 7: Hard rules force High (scholarship fee demand, account/SIM/ATM rental, graph match).
  // Note: scholarship_fee_demand triggers the hard rule; a non-scholarship fee_demand does not by itself.
  if (Array.isArray(effectiveConfig.hardRules)) {
    for (const ruleId of effectiveConfig.hardRules) {
      if (flagMap.has(ruleId)) {
        if (!rulesFired.includes(ruleId)) {
          rulesFired.push(ruleId);
        }
      }
    }
  }

  const hardRulesSet = new Set(effectiveConfig.hardRules || []);
  const hardRuleFired = rulesFired.some((r) => hardRulesSet.has(r));
  if (hardRuleFired) {
    score = Math.max(score, effectiveConfig.thresholds.high);
  }

  // Step 8: If there is no high-severity flag, no hard rule and no graph match, cap the final score at 59; record "no_high_evidence_cap".
  const hasHighFlag = Array.from(flagMap.values()).some((item) => {
    const sev = defaultSeverity(item.id) || item.severity;
    return item.status === "counted" && sev === "high";
  });
  const hasGraphMatch = flagMap.has("graph_match");

  const noHighEvidenceCapLimit = effectiveConfig.noHighEvidenceCap ?? NO_HIGH_EVIDENCE_CAP;
  if (!hasHighFlag && !hardRuleFired && !hasGraphMatch) {
    if (score > noHighEvidenceCapLimit) {
      score = noHighEvidenceCapLimit;
      rulesFired.push("no_high_evidence_cap");
    }
  }

  // Step 9: Clamp to 0-100, map thresholds (below 25 Low, 25-59 Medium, 60+ High), apply cannot_verify and confidence rules unchanged.
  score = Math.min(100, Math.max(0, score));

  let level;
  if (hardRuleFired) {
    level = "high";
  } else if (score < effectiveConfig.thresholds.medium) {
    level = "low";
  } else if (score < effectiveConfig.thresholds.high) {
    level = "medium";
  } else {
    level = "high";
  }

  // Cannot verify rule
  if (!hardRuleFired && completionRatio < effectiveConfig.cannotVerifyRatio && score < effectiveConfig.thresholds.high) {
    level = "cannot_verify";
  }

  // Critical agents rule (default: message_analyst)
  const reasonCodes = [];
  const criticalAgents = Array.isArray(effectiveConfig.criticalAgents) ? effectiveConfig.criticalAgents : [];

  for (const agentName of criticalAgents) {
    const agentFindings = findings.filter((f) => f && f.agent === agentName);
    const hasCouldNotCheck = agentFindings.some((f) => f.status === "could_not_check");
    const hasOk = agentFindings.some((f) => f.status === "ok");

    if (hasCouldNotCheck && !hasOk) {
      if (level === "low") {
        level = "cannot_verify";
        if (!reasonCodes.includes("critical_agent_failed")) {
          reasonCodes.push("critical_agent_failed");
        }
        const perAgentCode = `critical_agent_failed:${agentName}`;
        if (!reasonCodes.includes(perAgentCode)) {
          reasonCodes.push(perAgentCode);
        }
      }
    }
  }

  // Confidence & D2 cap
  let confidence;
  if (completionRatio >= effectiveConfig.confidence.high) {
    confidence = "high";
  } else if (completionRatio >= effectiveConfig.confidence.medium) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  let confidenceCapped = false;
  if (confidence === "high") {
    const hasOkExternalAgent = findings.some(
      (f) =>
        f &&
        f.status === "ok" &&
        Array.isArray(effectiveConfig.externalEvidenceAgents) &&
        effectiveConfig.externalEvidenceAgents.includes(f.agent)
    );
    if (!hasOkExternalAgent) {
      confidence = "medium";
      confidenceCapped = true;
    }
  }

  if (level === "cannot_verify") {
    confidence = "low";
  }

  // FlagPoints list sorted by points desc, then id asc
  const flagPoints = Array.from(flagMap.values()).map((item) => ({
    id: item.id,
    weight: item.weight,
    points: item.points,
    status: item.status,
    agents: Array.from(item.agents).sort(),
  }));

  flagPoints.sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    return a.id.localeCompare(b.id);
  });

  const fallbackWeightFlags = Array.from(fallbackWeightFlagsSet).sort();
  rulesFired.sort();

  const result = {
    level,
    score,
    confidence,
    completedCount,
    eligibleCount,
    completionRatio,
    rulesFired,
    flagPoints,
    classifierPoints,
    confidenceCapped,
    reasonCodes,
    fallbackWeightFlags,
  };

  return ScoreResultSchema.parse(result);
}

export { scoreCase as score };
