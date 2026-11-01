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
import { defaultConfig, KNOWN_ORGANISATIONS, CLAIM_GROUPS } from "./config.js";
import { FLAG_TO_CLAIM_KEY, reconcile } from "../evidence/ledger.js";
import { classifySource } from "../evidence/source-classifier.js";

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

  // 1. Evidence coverage: compute which signal types were actually checked successfully
  // Signal types: message, payee, website, official, reputation
  const checkedSignals = new Set();
  for (const finding of findings) {
    if (!finding || finding.status !== "ok") continue;
    if (finding.agent === "message_analyst") checkedSignals.add("message");
    if (finding.agent === "payment_entity") checkedSignals.add("payee");
    if (finding.agent === "website_forensics") checkedSignals.add("website");
    if (finding.agent === "official_verifier") checkedSignals.add("official sources");
    if (finding.agent === "reputation_osint") checkedSignals.add("reputation");
  }

  const allSignalTypes = ["message", "payee", "website", "official sources", "reputation"];
  const checked = allSignalTypes.filter((s) => checkedSignals.has(s));
  const notChecked = allSignalTypes.filter((s) => !checkedSignals.has(s));
  const coverage = { checked, notChecked };

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
      corroborationBonus: 0,
      contradictions: [],
      corroborations: [],
      confidenceCapped: false,
      reasonCodes: ["no_eligible_agents"],
      fallbackWeightFlags: [],
      coverage,
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

        // Evidence quality weighting for scam_reports_found
        if (flag.id === "scam_reports_found") {
          const evidenceUrls = (flag.evidence || [])
            .map((ev) => (typeof ev === "string" ? ev : ev?.value))
            .filter((v) => typeof v === "string" && v.includes("://"));

          if (evidenceUrls.length > 0) {
            const classifications = evidenceUrls.map((u) => classifySource(u));
            const hasAuthoritative = classifications.some((c) => c.isAuthoritative);
            const hasComplaint = classifications.some((c) => c.isComplaint);
            const hasForumOrAggregator = classifications.some((c) => c.isForumOrAggregator);

            if (hasAuthoritative || hasComplaint) {
              weight = Math.min(25, weight);
            } else if (hasForumOrAggregator) {
              weight = Math.min(10, weight);
            } else {
              weight = 0;
            }
          }
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

  // Helper to check if two flags share evidence
  function checkSharedEvidence(flagIdA, flagIdB) {
    const quotesA = new Set();
    const quotesB = new Set();

    if (Array.isArray(snapshot?.findings)) {
      for (const finding of snapshot.findings) {
        if (Array.isArray(finding?.flags)) {
          for (const f of finding.flags) {
            if (f.id === flagIdA && f.evidence) {
              const evArr = Array.isArray(f.evidence) ? f.evidence : [f.evidence];
              for (const ev of evArr) if (ev?.value) quotesA.add(String(ev.value).toLowerCase().trim());
            }
            if (f.id === flagIdB && f.evidence) {
              const evArr = Array.isArray(f.evidence) ? f.evidence : [f.evidence];
              for (const ev of evArr) if (ev?.value) quotesB.add(String(ev.value).toLowerCase().trim());
            }
          }
        }
      }
    }

    for (const a of quotesA) {
      for (const b of quotesB) {
        if (a === b || a.includes(b) || b.includes(a)) {
          return true;
        }
      }
    }
    return false;
  }

  // Claim groups: Correlated flags that count once at highest weight + corroboration bonus
  const claimGroups = effectiveConfig.claimGroups || CLAIM_GROUPS;
  const claimCorroborationBonus = effectiveConfig.corroborationBonus ?? 5;

  // 1. domain_brand_impersonation: lookalike_domain + domain_company_mismatch
  const domainGroup = claimGroups.domain_brand_impersonation || ["lookalike_domain", "domain_company_mismatch"];
  const domainPresent = domainGroup.filter((id) => flagMap.has(id) && flagMap.get(id).status === "counted");
  if (domainPresent.length > 1) {
    let winnerId = domainPresent[0];
    let maxWeight = flagMap.get(winnerId).weight;
    for (let i = 1; i < domainPresent.length; i++) {
      const mid = domainPresent[i];
      const mw = flagMap.get(mid).weight;
      if (mw > maxWeight) {
        maxWeight = mw;
        winnerId = mid;
      }
    }
    for (const mid of domainPresent) {
      const item = flagMap.get(mid);
      if (mid === winnerId) {
        item.status = "counted";
        item.points = item.weight + claimCorroborationBonus;
      } else {
        item.status = "group_suppressed";
        item.points = 0;
      }
    }
    rulesFired.push("claim_group:domain_brand_impersonation");
  }

  // 2. brand_handle_impersonation: authority_impersonation + brand_handle_lookalike (when sharing evidence)
  const handleGroup = claimGroups.brand_handle_impersonation || ["authority_impersonation", "brand_handle_lookalike"];
  const handlePresent = handleGroup.filter((id) => flagMap.has(id) && flagMap.get(id).status === "counted");
  if (handlePresent.length > 1 && checkSharedEvidence("authority_impersonation", "brand_handle_lookalike")) {
    const itemAuth = flagMap.get("authority_impersonation");
    const itemHandle = flagMap.get("brand_handle_lookalike");
    const winner = itemAuth.weight >= itemHandle.weight ? itemAuth : itemHandle;
    const loser = winner === itemAuth ? itemHandle : itemAuth;
    winner.status = "counted";
    winner.points = winner.weight + claimCorroborationBonus;
    loser.status = "group_suppressed";
    loser.points = 0;
    rulesFired.push("claim_group:brand_handle_impersonation");
  }

  // Deduplicate flags sharing the same claimKey: within each claimKey keep only highest weight flag
  const claimMap = new Map();
  for (const item of flagMap.values()) {
    if (item.status !== "counted") continue;
    const cKey = FLAG_TO_CLAIM_KEY[item.id] || item.id;
    if (!claimMap.has(cKey)) {
      claimMap.set(cKey, item);
    } else {
      const existing = claimMap.get(cKey);
      if (item.weight > existing.weight) {
        existing.status = "group_suppressed";
        existing.points = 0;
        claimMap.set(cKey, item);
      } else {
        item.status = "group_suppressed";
        item.points = 0;
      }
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

  // Step 4: Corroboration bonus & Soft cap
  const reconciliation = effectiveOptions?.reconciliation || (effectiveOptions?.ledger ? reconcile(effectiveOptions.ledger) : null);
  const corroborations = Array.isArray(reconciliation?.corroborations)
    ? reconciliation.corroborations
    : (Array.isArray(effectiveOptions?.corroborations) ? effectiveOptions.corroborations : []);
  const contradictions = Array.isArray(reconciliation?.contradictions)
    ? reconciliation.contradictions
    : (Array.isArray(effectiveOptions?.contradictions) ? effectiveOptions.contradictions : []);

  let corroborationBonus = 0;
  if (corroborations.length > 0) {
    const defaultBonus = effectiveConfig.corroborationBonus ?? 5;
    const maxBonus = effectiveConfig.maxCorroborationBonus ?? 10;
    corroborationBonus = Math.min(maxBonus, defaultBonus * corroborations.length);
    rulesFired.push("corroboration_bonus");
  }

  // Soft cap: total points from low and medium flags combined (after correlation caps and corroboration bonuses) capped at 45; record "soft_flag_cap_applied" when it reduces points.
  // High-severity flags are not part of this cap.
  const uncappedSoftTotal = hiringEffective + payEffective + otherSoftSum + corroborationBonus;
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
  const hasMediumFlag = Array.from(flagMap.values()).some((item) => {
    const sev = defaultSeverity(item.id) || item.severity;
    return item.status === "counted" && sev === "medium";
  });
  const hasGraphMatch = flagMap.has("graph_match");

  const noHighEvidenceCapLimit = effectiveConfig.noHighEvidenceCap ?? NO_HIGH_EVIDENCE_CAP;
  if (!hasHighFlag && !hardRuleFired && !hasGraphMatch) {
    if (score > noHighEvidenceCapLimit) {
      score = noHighEvidenceCapLimit;
      rulesFired.push("no_high_evidence_cap");
    }
  }

  // Step 9: Clamp to 0-100, determine positive verified signals and evaluate Big Brand / Institution channels
  score = Math.min(100, Math.max(0, score));

  const hasPositiveVerifiedSignal = findings.some((f) => {
    if (!f || f.status !== "ok") return false;
    if (Array.isArray(f.verified) && f.verified.length > 0) return true;
    if (Array.isArray(f.entityStatus) && f.entityStatus.some((es) => es?.status === "verified")) return true;
    return false;
  }) || (Array.isArray(effectiveOptions?.ledger) && effectiveOptions.ledger.some((e) => e?.kind === "verified" || e?.verificationStatus === "verified"));

  const entities = Array.isArray(snapshot?.entities) ? snapshot.entities : [];
  const knownOrgs = effectiveConfig.knownOrganisations || KNOWN_ORGANISATIONS;
  const hasBigBrandOrScheme = entities.some((e) => {
    if (!e || typeof e.value !== "string") return false;
    const norm = e.value.toLowerCase().trim();
    if (e.kind === "company" && knownOrgs.has(norm)) return true;
    if (e.kind === "scheme") return true;
    return false;
  });

  const domains = entities.filter((e) => e && (e.kind === "domain" || e.kind === "url"));
  const hasMismatchOrLookalike =
    flagMap.has("domain_company_mismatch") ||
    flagMap.has("lookalike_domain") ||
    flagMap.has("non_gov_domain_claiming_gov");

  const hasOfficialDomain = domains.length > 0 && !hasMismatchOrLookalike;
  const hasSuspiciousOrPersonalContact =
    flagMap.has("personal_payment_id") ||
    flagMap.has("brand_handle_lookalike") ||
    flagMap.has("free_email_recruiter") ||
    flagMap.has("off_platform_contact") ||
    flagMap.has("chat_only_interview");

  const isBigBrandWithoutOfficialChannel =
    hasBigBrandOrScheme && (!hasOfficialDomain || hasSuspiciousOrPersonalContact);

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

  const reasonCodes = [];

  if (!hardRuleFired) {
    // Rule 5: Big brand without official channel -> at least Medium
    if (isBigBrandWithoutOfficialChannel) {
      if (!rulesFired.includes("big_brand_no_official_channel")) {
        rulesFired.push("big_brand_no_official_channel");
      }
      if (level === "low") {
        level = "medium";
      }
    }

    // Rule 3: Any high flag -> at least Medium. Any medium flag with no positive verified signal -> at least Medium, even if score < 25.
    if (level === "low") {
      if (hasHighFlag) {
        level = "medium";
        if (!rulesFired.includes("high_flag_baseline")) {
          rulesFired.push("high_flag_baseline");
        }
      } else if (hasMediumFlag && !hasPositiveVerifiedSignal) {
        level = "medium";
        if (!rulesFired.includes("medium_flag_without_verified_signal")) {
          rulesFired.push("medium_flag_without_verified_signal");
        }
      }
    }

    // Rule 2: Low is allowed ONLY when ALL hold:
    // - no flag of severity medium or high
    // - at least 2 independent signal types were checked successfully (coverage.checked.length >= 2)
    // - at least one positive verified signal exists OR at least 3 eligible checks completed with no flags
    if (level === "low") {
      const condition2a = !hasHighFlag && !hasMediumFlag;
      const condition2b = coverage.checked.length >= 2;
      const condition2c = hasPositiveVerifiedSignal || (completedCount >= 3 && flagMap.size === 0);

      if (!(condition2a && condition2b && condition2c)) {
        if (flagMap.size === 0 && coverage.checked.length < 2) {
          // Rule 4: No flags but thin coverage (< 2 signal types) -> Cannot verify
          level = "cannot_verify";
          if (!reasonCodes.includes("thin_coverage")) {
            reasonCodes.push("thin_coverage");
          }
          if (!rulesFired.includes("thin_coverage")) {
            rulesFired.push("thin_coverage");
          }
        } else if (hasMediumFlag || hasHighFlag || isBigBrandWithoutOfficialChannel) {
          level = "medium";
        } else {
          level = "cannot_verify";
          if (!reasonCodes.includes("insufficient_evidence")) {
            reasonCodes.push("insufficient_evidence");
          }
        }
      }
    } else if (flagMap.size === 0 && coverage.checked.length < 2 && level !== "high") {
      // Rule 4: No flags but thin coverage (< 2 signal types) -> Cannot verify
      level = "cannot_verify";
      if (!reasonCodes.includes("thin_coverage")) {
        reasonCodes.push("thin_coverage");
      }
      if (!rulesFired.includes("thin_coverage")) {
        rulesFired.push("thin_coverage");
      }
    }
  }

  // Cannot verify rule (completion ratio < 0.40)
  if (!hardRuleFired && completionRatio < effectiveConfig.cannotVerifyRatio && score < effectiveConfig.thresholds.high) {
    level = "cannot_verify";
  }

  // Critical agents rule (default: message_analyst)
  const criticalAgents = Array.isArray(effectiveConfig.criticalAgents) ? effectiveConfig.criticalAgents : [];

  for (const agentName of criticalAgents) {
    const agentFindings = findings.filter((f) => f && f.agent === agentName);
    const hasCouldNotCheck = agentFindings.some((f) => f.status === "could_not_check");
    const hasOk = agentFindings.some((f) => f.status === "ok");

    if (hasCouldNotCheck && !hasOk) {
      if (level === "low") {
        level = "cannot_verify";
      }
      if (level === "cannot_verify") {
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

  // Confidence & Coverage-based confidence (Rule 6)
  const coverageCount = coverage.checked.length;
  const criticalFailed = criticalAgents.some((agentName) => {
    const af = findings.filter((f) => f && f.agent === agentName);
    return af.some((f) => f.status === "could_not_check") && !af.some((f) => f.status === "ok");
  });
  const anyAgentFailed = findings.some(
    (f) =>
      f &&
      (f.status === "could_not_check" ||
        (Array.isArray(f.unchecked) && f.unchecked.length > 0))
  );

  let confidence;
  if (criticalFailed) {
    confidence = "low";
  } else if (coverageCount >= 4 && !anyAgentFailed && completionRatio >= effectiveConfig.confidence.high) {
    confidence = "high";
  } else if (coverageCount >= 2 && completionRatio >= effectiveConfig.confidence.medium) {
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
    corroborationBonus,
    contradictions,
    corroborations,
    confidenceCapped,
    reasonCodes,
    fallbackWeightFlags,
    coverage,
  };

  return ScoreResultSchema.parse(result);
}

export { scoreCase as score };
