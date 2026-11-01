/**
 * lib/report.js
 *
 * Deterministic evidence assembly, LLM report generation, and safe fallbacks for Layer L5:
 * - buildEvidencePack(findings, scoreResult, options) -> pure code assembling facts, flags, and checks.
 * - generateReport({ findings, scoreResult, language, checkInputsSummary }, deps) -> orchestrates LLM report with strict schema, validation, and fallbacks.
 * - buildFallbackReport(pack, language, deps) -> pure/deterministic English/Hindi fallback report conforming to ReportSchema.
 *
 * Strict Layer Rules:
 * - Deterministic code owns and overwrites: riskLevel, score, confidence, flags, verified, couldNotCheck, notApplicable, base checklist, actions, disclaimer.
 * - LLM output only contributes: summary, scamTypeGuess, flagExplanations, extraChecklist.
 * - All user, web page, and search quotes are delimited via wrapUntrusted.
 * - Banned phrases ("is safe", "guaranteed genuine", "is a scammer", etc.) trigger post-validation rejection and fallback.
 * - Level cannot_verify requires insufficient evidence statement; level low requires not-a-guarantee notice.
 * - Never throws.
 */

import { z } from "zod";
import { ReportSchema, SCAM_TYPE_GUESSES } from "./contracts/report.js";
import { FLAG_REGISTRY, defaultSeverity } from "./contracts/flags.js";
import { generate as defaultGenerate, wrapUntrusted } from "./llm/generate.js";
import { FLAG_CHECKLIST_MAP, MANUAL_VERIFICATION_CHECKLIST } from "./report/checklist.js";
import {
  BANNED_SAFETY_PHRASES,
  BANNED_SCAMMER_PATTERNS,
  INSUFFICIENT_EVIDENCE_PHRASES_EN,
  INSUFFICIENT_EVIDENCE_PHRASES_HI,
  LOW_RISK_NOTICE_EN,
  LOW_RISK_NOTICE_HI,
  CRITICAL_AGENT_FAILED_NOTICE_EN,
  CRITICAL_AGENT_FAILED_NOTICE_HI,
  DISCLAIMER_EN,
  DISCLAIMER_HI,
  ACTIONS_MAP,
  REPORTING_CHANNELS,
} from "./report/constants.js";

// Robust LLM Output Schema: accepts aliases and normalizes fields while strictly rejecting unexpected top-level keys
const RawFlagExplanationSchema = z.preprocess((val) => {
  if (!val || typeof val !== "object") return val;
  const flagId = val.flagId || val.flag_id || val.id || "general";
  const text = val.text || val.explanation || val.detail || val.summary || "";
  return { flagId, text };
}, z.object({
  flagId: z.string().min(1),
  text: z.string().min(5).max(1000),
}));

const RawChecklistItemSchema = z.preprocess((val) => {
  if (typeof val === "string") {
    return { flagId: "general", step: val.trim() };
  }
  if (!val || typeof val !== "object") return val;
  const flagId = val.flagId || val.flag_id || val.id || "general";
  const step = val.step || val.text || val.action || val.instruction || "";
  return { flagId, step };
}, z.object({
  flagId: z.string().min(1),
  step: z.string().min(5).max(300),
}));

const normalizeScamType = (val) => {
  if (typeof val !== "string") return "unknown";
  const lower = val.toLowerCase().trim();
  if (SCAM_TYPE_GUESSES.includes(lower)) return lower;
  if (lower.includes("scholarship")) return "scholarship";
  if (lower.includes("internship")) return "internship";
  if (lower.includes("task")) return "task_job";
  if (lower.includes("mule")) return "mule_account";
  if (lower.includes("competition") || lower.includes("hackathon")) return "competition";
  if (lower.includes("job")) return "job";
  return "unknown";
};

export const LLMReportOutputSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object") return raw;
  const normalized = { ...raw };

  if ("flag_explanations" in normalized && !("flagExplanations" in normalized)) {
    normalized.flagExplanations = normalized.flag_explanations;
    delete normalized.flag_explanations;
  }
  if ("scam_type_guess" in normalized && !("scamTypeGuess" in normalized)) {
    normalized.scamTypeGuess = normalized.scam_type_guess;
    delete normalized.scam_type_guess;
  }
  if ("extra_checklist" in normalized && !("extraChecklist" in normalized)) {
    normalized.extraChecklist = normalized.extra_checklist;
    delete normalized.extra_checklist;
  }
  if ("improve_check" in normalized && !("improveCheck" in normalized)) {
    normalized.improveCheck = normalized.improve_check;
    delete normalized.improve_check;
  }
  if ("report_summary" in normalized && !("summary" in normalized)) {
    normalized.summary = normalized.report_summary;
    delete normalized.report_summary;
  }
  return normalized;
}, z.object({
  summary: z.string().min(10).max(2000),
  scamTypeGuess: z.preprocess(normalizeScamType, z.enum(SCAM_TYPE_GUESSES)).default("unknown"),
  flagExplanations: z.array(RawFlagExplanationSchema).default([]),
  extraChecklist: z.array(RawChecklistItemSchema).max(5).default([]),
  improveCheck: z.array(z.string()).max(5).default([]),
}).strict());

/**
 * Builds actionable guidance on what the user could provide to strengthen the check.
 *
 * @param {object} coverage - Evidence coverage { checked, notChecked }
 * @param {"en" | "hi"} [language="en"]
 * @returns {Array<string>}
 */
export function buildImproveCheck(coverage = { checked: [], notChecked: [] }, language = "en") {
  const isHi = language === "hi";
  const suggestions = [];
  const notChecked = Array.isArray(coverage?.notChecked) ? coverage.notChecked : [];

  for (const signal of notChecked) {
    if (signal === "payee") {
      suggestions.push(
        isHi
          ? "भुगतानकर्ता की वैधता जांचने के लिए यूपीआई आईडी, बैंक खाता या भर्तीकर्ता का फोन नंबर जोड़ें।"
          : "Add a payment request, UPI ID, recruiter phone number, or bank details to verify payee legitimacy."
      );
    } else if (signal === "website") {
      suggestions.push(
        isHi
          ? "डोमेन पंजीकरण और सुरक्षा प्रमाणपत्र सत्यापित करने के लिए वेबसाइट या अवसर का आधिकारिक लिंक जोड़ें।"
          : "Add an opportunity link or website URL to verify domain age and SSL security."
      );
    } else if (signal === "official sources") {
      suggestions.push(
        isHi
          ? "आधिकारिक सरकारी या संस्थागत रजिस्ट्रियों से मिलान के लिए कंपनी/संस्थान का सटीक नाम या आधिकारिक पोर्टल लिंक जोड़ें।"
          : "Add the claimed company or institution name and official portal link to verify against authoritative registries."
      );
    } else if (signal === "reputation") {
      suggestions.push(
        isHi
          ? "सार्वजनिक धोखाधड़ी रिपोर्ट और समीक्षाओं की जांच के लिए भर्तीकर्ता का सोशल मीडिया हैंडल या संपर्क जोड़ें।"
          : "Add the recruiter's handle or social profile to check public scam reports and community reviews."
      );
    } else if (signal === "message") {
      suggestions.push(
        isHi
          ? "भर्ती शर्तों और भाषा के गहन विश्लेषण के लिए संपूर्ण संदेश पाठ या स्क्रीनशॉट जोड़ें।"
          : "Add the complete offer text or screenshot to analyze message patterns and job terms."
      );
    }
  }

  return suggestions;
}

/**
 * Builds a deterministic evidence pack from raw agent findings and pure scoreResult.
 *
 * @param {Array<object>} findings - List of AgentResult objects from all rounds
 * @param {object} scoreResult - Output from scoreCase()
 * @param {object} [options]
 * @returns {object} EvidencePack
 */
export function buildEvidencePack(findings = [], scoreResult = {}, options = {}) {
  const checkId = options.checkId || findings[0]?.checkId || "00000000-0000-0000-0000-000000000000";
  const safeFindings = Array.isArray(findings) ? findings : [];

  // Index ok findings' flags by flagId
  const agentFlagMap = new Map();
  const verifiedSet = new Set();
  const couldNotCheckSet = new Set();
  const notApplicableSet = new Set();
  const manualCheckUrls = new Map(); // url -> { label, url }
  let classifierBand = null;

  for (const res of safeFindings) {
    if (!res) continue;

    // Skipped agents appear under notApplicable and NEVER under couldNotCheck
    if (res.status === "skipped") {
      notApplicableSet.add(`${res.agent}: ${res.reason || "Eligibility criteria not met"}`);
      continue;
    }

    // Could not check agents
    if (res.status === "could_not_check") {
      couldNotCheckSet.add(`${res.agent}: ${res.reason || "Execution failed or timed out"}`);
      continue;
    }

    // Unchecked items from agent result
    if (Array.isArray(res.unchecked)) {
      for (const u of res.unchecked) {
        if (typeof u === "string" && u.trim().length > 0) {
          couldNotCheckSet.add(`${res.agent}: ${u.trim()}`);
        }
      }
    }

    // Inspect failed trace items using real agent shapes
    if (Array.isArray(res.trace)) {
      for (const tr of res.trace) {
        if (!tr) continue;

        // Explicitly exclude non-failure statuses
        if (
          tr.status === "skipped" ||
          tr.status === "ok" ||
          tr.status === "match" ||
          tr.status === "no_match" ||
          tr.status === "invalid_format" ||
          tr.ok === true ||
          tr.type === "manual_check"
        ) {
          continue;
        }

        const isFailedTrace =
          tr.status === "error" ||
          tr.status === "failed" ||
          tr.ok === false ||
          Boolean(tr.error);

        if (isFailedTrace) {
          const detail =
            tr.code ||
            tr.reason ||
            tr.detail ||
            (typeof tr.error === "string" ? tr.error : tr.error?.code) ||
            "check failed";
          const checkName = tr.check || tr.item || tr.type || "check";
          const entity = tr.entity || tr.domain || tr.url || "";
          const msg = `${res.agent}: ${entity ? `${entity} ` : ""}${checkName} (${detail})`;
          couldNotCheckSet.add(msg);
        }
      }
    }

    // Status is OK
    if (res.status === "ok") {
      // Verified items
      if (Array.isArray(res.verified)) {
        for (const v of res.verified) {
          if (typeof v === "string" && v.trim().length > 0) {
            verifiedSet.add(v.trim());
          }
        }
      }

      // Flags
      if (Array.isArray(res.flags)) {
        for (const f of res.flags) {
          if (f && f.id && !agentFlagMap.has(f.id)) {
            agentFlagMap.set(f.id, {
              id: f.id,
              agent: res.agent,
              explanation: f.explanation,
              evidence: Array.isArray(f.evidence) ? f.evidence : [],
            });
          }
        }
      }

      // Manual checks from direct property or trace
      if (Array.isArray(res.manualChecks)) {
        for (const mc of res.manualChecks) {
          if (mc && mc.url && !manualCheckUrls.has(mc.url)) {
            manualCheckUrls.set(mc.url, { label: mc.label || "Manual Verification", url: mc.url });
          }
        }
      }
      if (Array.isArray(res.trace)) {
        for (const tr of res.trace) {
          if (tr && tr.type === "manual_check" && tr.url && !manualCheckUrls.has(tr.url)) {
            manualCheckUrls.set(tr.url, { label: tr.label || "Manual Verification", url: tr.url });
          } else if (tr && typeof tr.item === "string" && tr.item.startsWith("manual_check:") && tr.detail) {
            if (!manualCheckUrls.has(tr.detail)) {
              manualCheckUrls.set(tr.detail, { label: tr.label || tr.item.replace("manual_check:", "Check "), url: tr.detail });
            }
          }
        }
      }

      // Classifier band if present
      if (res.agent === "classifier_client" && res.classifierResult) {
        const prob = res.classifierResult.probability;
        if (typeof prob === "number" && !Number.isNaN(prob)) {
          if (prob >= 0.8) classifierBand = "High statistical scam probability (>= 80%)";
          else if (prob >= 0.5) classifierBand = "Moderate statistical scam probability (50% - 79%)";
          else classifierBand = "Low statistical scam probability (< 50%)";
        }
      }
    }
  }

  // Counted flags strictly from scoreResult.flagPoints with status === "counted"
  // Group suppressed flags (status: "group_suppressed") and duplicate ignored are not shown as separate flags
  const flags = [];
  const safeFlagPoints = Array.isArray(scoreResult.flagPoints) ? scoreResult.flagPoints : [];

  for (const fp of safeFlagPoints) {
    if (fp.status !== "counted") {
      continue;
    }
    const agentData = agentFlagMap.get(fp.id);
    const regMeta = FLAG_REGISTRY[fp.id];
    const title = regMeta?.description || fp.id;
    const severity = regMeta?.severity || defaultSeverity(fp.id) || "medium";

    // Format evidence objects: pass through unchanged (deep copies, never rewritten)
    const rawEvidence = agentData?.evidence || [];
    const evidence = rawEvidence.map((ev) => ({ ...ev }));

    // For technical facts checked on the site itself (ssl_anomaly, lookalike_domain, domain_new),
    // mark in evidence pack metadata that this was inspected directly on the target host
    const isCheckedFact =
      fp.id === "ssl_anomaly" ||
      fp.id === "lookalike_domain" ||
      fp.id === "domain_new";

    flags.push({
      id: fp.id,
      title,
      severity,
      explanation: agentData?.explanation || regMeta?.description || "Flag identified during verification",
      evidence: evidence.length > 0 ? evidence : [{ type: "url", value: "https://unknown.target" }],
      isCheckedFact,
    });
  }

  return {
    checkId,
    riskLevel: scoreResult.level || scoreResult.riskLevel || "cannot_verify",
    score: typeof scoreResult.score === "number" ? scoreResult.score : 0,
    confidence: scoreResult.confidence || "low",
    confidenceCapped: Boolean(scoreResult.confidenceCapped),
    rulesFired: Array.isArray(scoreResult.rulesFired) ? scoreResult.rulesFired : [],
    reasonCodes: Array.isArray(scoreResult.reasonCodes) ? scoreResult.reasonCodes : [],
    flags,
    verified: Array.from(verifiedSet),
    couldNotCheck: Array.from(couldNotCheckSet),
    notApplicable: Array.from(notApplicableSet),
    manualChecks: Array.from(manualCheckUrls.values()),
    classifierBand,
    whereDisagreed: Array.isArray(scoreResult.contradictions)
      ? scoreResult.contradictions
      : (Array.isArray(options?.reconciliation?.contradictions) ? options.reconciliation.contradictions : []),
    coverage: scoreResult.coverage || { checked: [], notChecked: [] },
    improveCheck: buildImproveCheck(scoreResult.coverage || { checked: [], notChecked: [] }, options.language || "en"),
  };
}

/**
 * Formats plain-language explanations for scoring safeguards (group caps, mutual exclusions, soft cap, no-high-evidence cap).
 *
 * @param {Array<string>} rulesFired
 * @param {"en" | "hi"} [language="en"]
 * @returns {Array<string>}
 */
export function formatSafeguardExplanations(rulesFired = [], language = "en") {
  if (!Array.isArray(rulesFired) || rulesFired.length === 0) return [];
  const isHi = language === "hi";
  const explanations = [];

  for (const rule of rulesFired) {
    if (rule === "exclusion:fee_equipment") {
      explanations.push(
        isHi
          ? "शुल्क या उपकरण भुगतान के कई परस्पर जुड़े संकेतक पाए गए; अंकों की पुनरावृत्ति रोकने के लिए केवल उच्चतम प्रभाव वाले संकेतक को गिना गया।"
          : "Multiple overlapping fee or equipment payment demands were detected; only the highest-weight indicator was counted to prevent double-counting."
      );
    } else if (rule === "correlation_cap:hiring_process") {
      explanations.push(
        isHi
          ? "भर्ती प्रक्रिया से जुड़े कई चेतावनी संकेतों को समूहीकृत किया गया ताकि वे जोखिम स्कोर को अस्वाभाविक रूप से न बढ़ाएं।"
          : "Multiple hiring-process warning signs were grouped so they do not artificially inflate the score."
      );
    } else if (rule === "correlation_cap:pay") {
      explanations.push(
        isHi
          ? "वेतन से जुड़े कई चेतावनी संकेतों को समूहीकृत किया गया ताकि वे जोखिम स्कोर को अस्वाभाविक रूप से न बढ़ाएं।"
          : "Multiple compensation-related warning signs were grouped so they do not artificially inflate the score."
      );
    } else if (rule === "soft_flag_cap_applied") {
      explanations.push(
        isHi
          ? "कम और मध्यम गंभीरता वाले संकेतकों का कुल योगदान 45 अंकों पर सीमित किया गया ताकि अकेले सामान्य चेतावनियां उच्च जोखिम का कारण न बनें।"
          : "Total contribution from low and medium severity indicators was capped at 45 points to prevent soft warnings alone from triggering a high-risk rating."
      );
    } else if (rule === "no_high_evidence_cap") {
      explanations.push(
        isHi
          ? "क्योंकि कोई उच्च गंभीरता का संकेतक या डेटाबेस मिलान नहीं था, इसलिए अंतिम स्कोर को मध्यम जोखिम सीमा (अधिकतम 59) पर सुरक्षित रखा गया।"
          : "Because no high-severity flag, hard rule, or confirmed scam database match was present, the overall score was safeguarded to stay within the Medium risk tier (capped at 59)."
      );
    } else if (rule === "big_brand_no_official_channel") {
      explanations.push(
        isHi
          ? "किसी प्रतिष्ठित ब्रांड या संस्थान के नाम का उपयोग किया गया लेकिन कोई आधिकारिक कॉर्पोरेट चैनल या वेबसाइट डोमेन प्रदान नहीं किया गया।"
          : "A well-known brand or institution was claimed without an official domain or verified corporate channel."
      );
    } else if (rule === "thin_coverage") {
      explanations.push(
        isHi
          ? "सत्यापन का दायरा सीमित था (2 से कम स्वतंत्र संकेतकों की जांच हो सकी); अपर्याप्त साक्ष्य के कारण पुष्टि नहीं की जा सकी।"
          : "Verification coverage was thin (fewer than 2 independent signal types could be checked); cannot verify the offer."
      );
    } else if (rule === "high_flag_baseline") {
      explanations.push(
        isHi
          ? "एक उच्च गंभीरता वाला जोखिम संकेतक मौजूद होने के कारण जोखिम स्तर न्यूनतम मध्यम निर्धारित किया गया।"
          : "A high-severity risk indicator was detected; baseline risk established as at least Medium."
      );
    } else if (rule === "medium_flag_without_verified_signal") {
      explanations.push(
        isHi
          ? "बिना किसी पुष्ट सत्यापन के मध्यम गंभीरता की चेतावनी मिली; जोखिम स्तर न्यूनतम मध्यम निर्धारित किया गया।"
          : "A medium-severity warning sign was found with no positive verified signal; risk set to at least Medium."
      );
    }
  }

  return explanations;
}

/**
 * Builds deterministic fallback report conforming strictly to ReportSchema.
 *
 * @param {object} pack - Evidence pack produced by buildEvidencePack
 * @param {"en" | "hi"} language
 * @param {object} [deps]
 * @returns {object} Validated Report
 */
export function buildFallbackReport(pack, language = "en", deps = {}) {
  const isHi = language === "hi";
  const nowFn = deps.now || (() => new Date().toISOString());

  // Deterministic summary built dynamically from actual counted flags
  let summary = "";
  if (pack.riskLevel === "high") {
    const topFlags = pack.flags.slice(0, 3);
    const indicatorsEn = topFlags.map((f) => f.title).join("; ");
    const indicatorsHi = topFlags.map((f) => f.title).join(", ");
    if (isHi) {
      summary = indicatorsHi
        ? `इस प्रस्ताव में उच्च जोखिम वाले संकेतक पाए गए हैं (${indicatorsHi})। आगे न बढ़ें और स्वतंत्र रूप से पुष्टि करें।`
        : "इस प्रस्ताव में उच्च जोखिम वाले चेतावनी संकेतक पाए गए हैं। अत्यधिक सावधानी बरतें।";
    } else {
      summary = indicatorsEn
        ? `This offer exhibits high-risk warning signs (${indicatorsEn}). Exercise extreme caution and do not proceed without independent verification.`
        : "This offer exhibits high-risk warning signs. Exercise extreme caution and do not proceed without independent verification.";
    }
  } else if (pack.riskLevel === "medium") {
    const topFlags = pack.flags.slice(0, 3);
    const indicatorsEn = topFlags.map((f) => f.title).join("; ");
    const indicatorsHi = topFlags.map((f) => f.title).join(", ");
    if (isHi) {
      summary = indicatorsHi
        ? `इस अवसर में विसंगतियां पाई गईं (${indicatorsHi})। साक्ष्य सीमित हैं; आगे बढ़ने से पहले स्वतंत्र रूप से पुष्टि करें।`
        : "इस अवसर में कुछ चेतावनी संकेत पाए गए हैं, लेकिन साक्ष्य सीमित हैं। आगे बढ़ने से पहले स्वतंत्र रूप से पुष्टि करें।";
    } else {
      summary = indicatorsEn
        ? `Cautionary indicators were identified in this opportunity (${indicatorsEn}). Evidence is thin; verify these items independently before taking action.`
        : "Some warning signs were identified, but evidence is thin. Verify these items independently before taking action.";
    }
  } else if (pack.riskLevel === "cannot_verify") {
    const isCriticalAgentFailed = Array.isArray(pack.reasonCodes) && pack.reasonCodes.includes("critical_agent_failed");
    if (isCriticalAgentFailed) {
      summary = isHi
        ? `सार्वजनिक रिकॉर्ड में अपर्याप्त जानकारी के कारण इस प्रस्ताव को सत्यापित नहीं किया जा सका। ${CRITICAL_AGENT_FAILED_NOTICE_HI}`
        : `We could not verify this offer due to insufficient details in public records. ${CRITICAL_AGENT_FAILED_NOTICE_EN}`;
    } else {
      summary = isHi
        ? "सार्वजनिक रिकॉर्ड में अपर्याप्त जानकारी के कारण इस प्रस्ताव को सत्यापित नहीं किया जा सका। सावधानी बरतें।"
        : "We could not verify this offer due to insufficient details in public records. Exercise extreme caution.";
    }
  } else {
    // low risk
    summary = isHi
      ? `प्रारंभिक जांच में कोई सक्रिय जोखिम संकेतक नहीं मिला। ${LOW_RISK_NOTICE_HI}`
      : `No immediate suspicious indicators were detected during preliminary public record checks. ${LOW_RISK_NOTICE_EN}`;
  }

  // If confidence is low or capped, explicitly state what could not be checked
  if ((pack.confidence === "low" || pack.confidenceCapped) && pack.riskLevel !== "cannot_verify") {
    const cncDetails = pack.couldNotCheck.length > 0
      ? ` (${pack.couldNotCheck.slice(0, 2).join("; ")})`
      : "";
    if (isHi) {
      summary += ` नोट: सार्वजनिक रिकॉर्ड में अपर्याप्त जानकारी के कारण सत्यापन विश्वास सीमित है${cncDetails}।`;
    } else {
      summary += ` Note: Verification confidence is limited as some checks could not be verified in public records${cncDetails}.`;
    }
  }

  // If scoring safeguards fired, append plain-language explanations to summary
  const safeguards = formatSafeguardExplanations(pack.rulesFired, language);
  if (safeguards.length > 0) {
    const prefix = isHi ? "स्कोरिंग सुरक्षा उपाय:" : "Scoring safeguards applied:";
    summary += ` ${prefix} ${safeguards.join(" ")}`;
  }

  // Mark fallback summary as deterministic automatic summary
  const autoSummaryPrefix = isHi ? "[स्वचालित सारांश] " : "[Automatic summary] ";
  if (!summary.startsWith(autoSummaryPrefix)) {
    summary = `${autoSummaryPrefix}${summary}`;
  }

  // Assemble quality checklist with deduplication, entity grouping, and 10-item cap
  const { checklist, moreChecks } = assembleQualityChecklist(pack, language);

  // Action buttons
  const actions = [];
  const langActions = isHi ? ACTIONS_MAP.hi : ACTIONS_MAP.en;
  if (pack.riskLevel === "high") {
    actions.push(langActions.fraud_help);
    actions.push(langActions.college_email);
  } else if (pack.riskLevel === "medium") {
    actions.push(langActions.college_email);
    actions.push(langActions.copy_checklist);
  } else {
    actions.push(langActions.copy_checklist);
  }

  // Flags: remove internal isCheckedFact key for ReportSchema conformity
  const cleanFlags = pack.flags.map((f) => ({
    id: f.id,
    title: f.title,
    severity: f.severity,
    explanation: f.explanation,
    evidence: f.evidence,
  }));

  const disclaimer = isHi ? DISCLAIMER_HI : DISCLAIMER_EN;

  const reportData = {
    checkId: pack.checkId,
    riskLevel: pack.riskLevel,
    score: pack.score,
    confidence: pack.confidence,
    scamTypeGuess: "unknown",
    language,
    summary,
    flags: cleanFlags,
    verified: pack.verified,
    couldNotCheck: pack.couldNotCheck,
    notApplicable: pack.notApplicable,
    checklist,
    moreChecks,
    actions,
    whereDisagreed: pack.whereDisagreed || [],
    coverage: pack.coverage || { checked: [], notChecked: [] },
    improveCheck: pack.improveCheck || buildImproveCheck(pack.coverage, language),
    disclaimer,
    generatedAt: nowFn(),
  };

  return ReportSchema.parse(reportData);
}

/**
 * Validates text against safety policies and hallucination guards.
 * Returns true if text passes, false if text violates policy.
 */
function validateGeneratedText(text, level, language, pack = null) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();

  // 1. Safety claims rejection
  for (const phrase of BANNED_SAFETY_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      return false;
    }
  }

  // 2. Defamatory / Named Scammer pattern rejection
  for (const regex of BANNED_SCAMMER_PATTERNS) {
    if (regex.test(text)) {
      return false;
    }
  }

  // 2b. Medium risk neutrality guard: disallow "likely scam" or "probable scam"
  if (level === "medium") {
    if (/(?:likely|probable)\s+scam/i.test(text)) {
      return false;
    }
  }

  // 3. cannot_verify requires insufficient-evidence statement
  if (level === "cannot_verify") {
    const list = language === "hi" ? INSUFFICIENT_EVIDENCE_PHRASES_HI : INSUFFICIENT_EVIDENCE_PHRASES_EN;
    const hasInsufficientEvidenceClaim = list.some((phrase) => lower.includes(phrase.toLowerCase()));
    if (!hasInsufficientEvidenceClaim) {
      return false;
    }
  }

  // 4. low level requires not-a-guarantee notice
  if (level === "low") {
    const hasNotice =
      lower.includes("not a guarantee") ||
      lower.includes("guarantee of safety") ||
      lower.includes("कोई गारंटी नहीं") ||
      lower.includes("सतर्क रहें");
    if (!hasNotice) {
      return false;
    }
  }

  // 5. If no payment/fee flag exists, summary must not mention payment demands or upfront fees
  if (pack && Array.isArray(pack.flags)) {
    const hasPayment = pack.flags.some((f) =>
      ["scholarship_fee_demand", "fee_demand", "personal_payment_id", "qr_code_payment_request", "task_deposit_script"].includes(f.id)
    );
    if (!hasPayment) {
      if (lower.includes("payment demand") || lower.includes("upfront payment") || lower.includes("upfront fee")) {
        return false;
      }
    }
  }

  // 6. If search or reputation agent failed, summary must not say "no reports found"
  if (pack && Array.isArray(pack.couldNotCheck)) {
    const hasSearchFailure = pack.couldNotCheck.some((c) => {
      const lowerC = c.toLowerCase();
      return lowerC.includes("search") || lowerC.includes("timeout") || lowerC.includes("timed out") || lowerC.includes("reputation_osint");
    });
    if (hasSearchFailure) {
      if (lower.includes("no reports found") || lower.includes("no scam reports found") || lower.includes("no complaints found")) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Assembles and orders checklist items according to quality, deduplication,
 * entity grouping, and capping rules.
 *
 * @param {object} pack Evidence pack
 * @param {"en" | "hi"} [language="en"]
 * @param {Array<object>} [extraChecklist=[]]
 * @returns {{ checklist: Array<object>, moreChecks: Array<object> }}
 */
export function assembleQualityChecklist(pack, language = "en", extraChecklist = []) {
  const isHi = language === "hi";

  const tier1Urgent = [];
  const tier2Flags = [];
  const tier3Manual = [];
  const tier4EntityFailures = [];
  const tier5General = [];

  const seenTexts = new Set();
  const seenUrls = new Set();

  function addItem(bucket, item) {
    if (!item || !item.text) return;
    const normText = item.text.trim().toLowerCase();
    if (seenTexts.has(normText)) return;
    if (item.url) {
      const normUrl = item.url.trim().toLowerCase();
      if (seenUrls.has(normUrl)) return;
      seenUrls.add(normUrl);
    }
    seenTexts.add(normText);
    bucket.push(item);
  }

  // 1. Context-aware urgent warning for high / medium
  if (pack.riskLevel === "high" || pack.riskLevel === "medium") {
    const hasPaymentFlag = pack.flags.some((f) =>
      ["scholarship_fee_demand", "fee_demand", "personal_payment_id", "qr_code_payment_request", "task_deposit_script"].includes(f.id)
    );
    const hasMuleFlag = pack.flags.some((f) => f.id === "mule_account_request");
    if (hasMuleFlag) {
      addItem(tier1Urgent, {
        text: isHi
          ? "कभी भी अपना बैंक खाता, एटीएम कार्ड या यूपीआई क्रेडेंशियल किसी तीसरे पक्ष को हस्तांतरण के लिए न दें।"
          : "Never transfer, rent, or provide access to your bank account, ATM, or UPI credentials to third parties.",
        url: null,
      });
    } else if (hasPaymentFlag) {
      addItem(tier1Urgent, {
        text: isHi
          ? "किसी भी व्यक्ति को अग्रिम शुल्क या सत्यापन राशि का भुगतान न करें।"
          : "Do NOT make any upfront payments or transfer fees for job or scholarship processing.",
        url: null,
      });
    } else {
      addItem(tier1Urgent, {
        text: isHi
          ? "अज्ञात व्यक्तियों के साथ संवेदनशील क्रेडेंशियल या दस्तावेज साझा न करें।"
          : "Do NOT share banking credentials, OTPs, or un-redacted personal documents with unknown contacts.",
        url: null,
      });
    }
  }

  // 2. Base flag checklist items
  const URGENT_FLAG_IDS = new Set([
    "scholarship_fee_demand",
    "fee_demand",
    "task_deposit_script",
    "mule_account_request",
    "url_in_threat_feed",
    "crypto_payment_request",
    "paid_placement_guarantee",
    "apk_download_prompt",
    "qr_code_payment_request",
  ]);

  for (const flag of pack.flags) {
    const mapEntry = FLAG_CHECKLIST_MAP[flag.id];
    if (mapEntry) {
      const stepText = isHi && mapEntry.hi ? mapEntry.hi : mapEntry.en;
      const targetBucket = URGENT_FLAG_IDS.has(flag.id) ? tier1Urgent : tier2Flags;
      addItem(targetBucket, { text: stepText, url: mapEntry.url || null });
    }
  }

  // Extra flag-specific checklist items from LLM (mapped to valid pack flags)
  if (Array.isArray(extraChecklist)) {
    const validFlagIds = new Set(pack.flags.map((f) => f.id));
    for (const extra of extraChecklist) {
      if (extra && extra.step && extra.flagId && validFlagIds.has(extra.flagId)) {
        if (validateGeneratedText(extra.step, pack.riskLevel, language, pack)) {
          addItem(tier2Flags, { text: extra.step.trim(), url: null });
        }
      }
    }
  }

  // 3. Manual check links from agents
  const manualChecks = Array.isArray(pack.manualChecks) ? pack.manualChecks : [];
  for (const mc of manualChecks) {
    if (!mc || !mc.url) continue;
    const text = isHi
      ? `आधिकारिक पोर्टल पर मैन्युअल रूप से जांचें: ${mc.label}`
      : `Verify manually on official portal: ${mc.label}`;
    addItem(tier3Manual, {
      text,
      url: mc.url,
      ...(mc.provenance ? { provenance: mc.provenance } : {}),
      ...(mc.sourceUrl ? { sourceUrl: mc.sourceUrl } : {}),
    });
  }

  // 4. Grouped failure guidance per entity from couldNotCheck
  const couldNotCheckList = Array.isArray(pack.couldNotCheck) ? pack.couldNotCheck : [];
  const entityFailures = new Map();
  const ungroupedFailures = [];

  for (const cnc of couldNotCheckList) {
    if (typeof cnc !== "string" || !cnc.trim()) continue;
    const clean = cnc.trim();

    let matched = false;

    // Check for domain
    const domainMatch = clean.match(/(?:domain[:\s]+)?([a-z0-9][a-z0-9-]*\.(?:[a-z]{2,}|example|test|invalid|localhost))\b/i);
    if (domainMatch && !clean.includes("scholarships.gov.in") && !clean.includes("mca.gov.in")) {
      const dom = domainMatch[1].toLowerCase();
      if (!entityFailures.has(`domain:${dom}`)) {
        entityFailures.set(`domain:${dom}`, { type: "domain", entity: dom, reasons: new Set() });
      }
      entityFailures.get(`domain:${dom}`).reasons.add(clean);
      matched = true;
    }

    // Check for handle
    if (!matched) {
      const handleMatch = clean.match(/(?:handle[:\s]+)?(@[a-zA-Z0-9_.]+)/);
      if (handleMatch) {
        const h = handleMatch[1].toLowerCase();
        if (!entityFailures.has(`handle:${h}`)) {
          entityFailures.set(`handle:${h}`, { type: "handle", entity: h, reasons: new Set() });
        }
        entityFailures.get(`handle:${h}`).reasons.add(clean);
        matched = true;
      }
    }

    // Check for UPI
    if (!matched) {
      const upiMatch = clean.match(/([a-zA-Z0-9_.-]+@[a-zA-Z0-9]+)/);
      if (upiMatch && !upiMatch[1].includes("@gmail") && !upiMatch[1].includes("@yahoo")) {
        const u = upiMatch[1].toLowerCase();
        if (!entityFailures.has(`upi:${u}`)) {
          entityFailures.set(`upi:${u}`, { type: "upi", entity: u, reasons: new Set() });
        }
        entityFailures.get(`upi:${u}`).reasons.add(clean);
        matched = true;
      }
    }

    // Check for company/scheme
    if (!matched) {
      const compMatch = clean.match(/(?:company|scheme)[:\s]+([^:(]+)/i);
      if (compMatch) {
        const comp = compMatch[1].trim();
        if (!entityFailures.has(`entity:${comp}`)) {
          entityFailures.set(`entity:${comp}`, { type: "entity", entity: comp, reasons: new Set() });
        }
        entityFailures.get(`entity:${comp}`).reasons.add(clean);
        matched = true;
      }
    }

    if (!matched) {
      ungroupedFailures.push(clean);
    }
  }

  // Synthesize grouped entity failures
  for (const [, info] of entityFailures) {
    if (info.type === "domain") {
      const text = isHi
        ? `डोमेन ${info.entity} की स्वचालित जांच पूरी नहीं हो सकी; मैन्युअल रूप से पुष्टि करें: पंजीकरण तिथि, एसएसएल प्रमाणपत्र और अभिलेखागार इतिहास`
        : `Could not check domain ${info.entity} automatically; verify it manually: registration date, certificate, archive history`;
      addItem(tier4EntityFailures, { text, url: `https://${info.entity}` });
    } else if (info.type === "handle") {
      const text = isHi
        ? `सोशल हैंडल ${info.entity} की स्वचालित जांच पूरी नहीं हो सकी; प्रोफ़ाइल आयु, फ़ॉलोअर्स और बायो लिंक की मैन्युअल रूप से पुष्टि करें`
        : `Could not check profile ${info.entity} automatically; verify profile age, follower count, and bio links manually`;
      addItem(tier4EntityFailures, { text, url: null });
    } else if (info.type === "upi") {
      const text = isHi
        ? `भुगतानकर्ता ${info.entity} की स्वचालित पुष्टि नहीं हो सकी; पैसे भेजने से पहले अपने यूपीआई ऐप में खाते के नाम की जांच करें`
        : `Could not verify payee ${info.entity} automatically; verify account name directly in your UPI app before sending money`;
      addItem(tier4EntityFailures, { text, url: null });
    } else {
      const text = isHi
        ? `${info.entity} की स्वचालित आधिकारिक जांच पूरी नहीं हो सकी; आधिकारिक पोर्टल या एमसीए पर मैन्युअल रूप से पुष्टि करें`
        : `Could not verify ${info.entity} in official portals automatically; verify registration and public notices manually`;
      addItem(tier4EntityFailures, { text, url: null });
    }
  }

  for (const cnc of ungroupedFailures) {
    const text = isHi
      ? `यह जांच पूरी नहीं हो सकी, मैन्युअल रूप से पुष्टि करें (${cnc})`
      : `Check could not be completed automatically; verify manually (${cnc})`;
    addItem(tier4EntityFailures, { text, url: null });
  }

  // 5. Tier 5 General: Medium risk manual verification items
  if (pack.riskLevel === "medium") {
    for (const item of Object.values(MANUAL_VERIFICATION_CHECKLIST)) {
      const stepText = isHi && item.hi ? item.hi : item.en;
      addItem(tier5General, { text: stepText, url: item.url || null });
    }
  }

  // Reporting channels for high risk
  if (pack.riskLevel === "high") {
    for (const channel of REPORTING_CHANNELS) {
      const channelText = isHi && channel.hiText ? channel.hiText : channel.text;
      addItem(tier5General, {
        text: channelText,
        url: channel.verified && channel.url ? channel.url : null,
      });
    }
  }

  const allOrdered = [
    ...tier1Urgent,
    ...tier2Flags,
    ...tier3Manual,
    ...tier4EntityFailures,
    ...tier5General,
  ];

  const checklist = allOrdered.slice(0, 10);
  const moreChecks = allOrdered.slice(10);

  return { checklist, moreChecks };
}

/**
 * Generates the full opportunity verification report using the LLM writer with safe deterministic overrides.
 *
 * @param {object} params
 * @param {Array<object>} params.findings - Agent findings
 * @param {object} params.scoreResult - ScoreResult from scoreCase
 * @param {"en" | "hi"} [params.language="en"]
 * @param {string} [params.checkInputsSummary]
 * @param {object} [deps] - Injected dependencies { generate, now }
 * @returns {Promise<object>} Report conforming to ReportSchema
 */
export async function generateReport(params, deps = {}) {
  const { findings = [], scoreResult = {}, language = "en", checkInputsSummary = "" } = params;
  const generateFn = deps.generate || defaultGenerate;
  const nowFn = deps.now || (() => new Date().toISOString());

  // 1. Build deterministic evidence pack
  const pack = buildEvidencePack(findings, scoreResult, { checkId: params.checkId });

  // 2. Format evidence pack for the LLM prompt, wrapping untrusted pieces
  const formattedFlags = pack.flags.map((f) => {
    const evText = f.evidence
      .map((e) => {
        if (e.type === "quote") {
          return `Quote: "${e.value}"`;
        }
        return `Source URL: ${e.value}`;
      })
      .join("; ");

    return [
      `- Flag ID: ${f.id}`,
      `  Title: ${f.title}`,
      `  Severity: ${f.severity}`,
      `  Agent Explanation: ${f.explanation}`,
      f.isCheckedFact ? `  [NOTE: Technical fact verified directly on the target host itself, not from third-party report]` : "",
      `  Evidence: ${evText}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const promptSections = [
    `You are the Opportunity Verifier Report Writer. You write clear, objective, evidence-based risk reports for students.`,
    `Language required: ${language === "hi" ? "HINDI" : "ENGLISH"}.`,
    ``,
    `RISK EVALUATION (FIXED - ESTABLISHED BY DETERMINISTIC RULES; DO NOT ALTER):`,
    `- Risk Level: ${pack.riskLevel}`,
    `- Numerical Score: ${pack.score}/100`,
    `- Confidence: ${pack.confidence}`,
    pack.confidenceCapped ? `- Note: Confidence was capped because no external online evidence could be validated.` : "",
    `- Verified Items: ${pack.verified.join(", ") || "None"}`,
    `- Could Not Check: ${pack.couldNotCheck.join(", ") || "None"}`,
    `- Skipped Checks: ${pack.notApplicable.join(", ") || "None"}`,
    pack.classifierBand ? `- Classifier probability: ${pack.classifierBand}` : "",
    ``,
    `DETECTED FLAGS:`,
    formattedFlags.length > 0 ? formattedFlags.join("\n\n") : "No risk flags detected.",
    ``,
    `MANDATORY COMPLIANCE RULES:`,
    `1. NEVER claim or state that anything is safe, genuine, or guaranteed (e.g. do not say "is safe", "100% safe", "guaranteed genuine").`,
    `2. Output a risk assessment only. NEVER state that a named person or organisation is a scammer or criminal.`,
    `3. If Risk Level is "cannot_verify", your summary MUST explicitly state that the evidence was insufficient to verify the offer.`,
    `4. If Risk Level is "low", your summary MUST explicitly include: "${language === "hi" ? LOW_RISK_NOTICE_HI : LOW_RISK_NOTICE_EN}".`,
    `5. Do NOT invent facts or URLs. Base all statements strictly on the evidence pack above.`,
    `6. If technical flags ssl_anomaly, lookalike_domain, or domain_new are present, present them as checked facts on the site, not independent external sources.`,
    `7. Output strictly valid JSON conforming to the schema.`,
    `8. Build your summary directly from the specific detected flags and evidence provided. NEVER invent scam signals or mention upfront payment demands unless a payment-related flag is actually present in the detected flags list.`,
    `9. If confidence is low or capped, explicitly state what could not be checked.`,
    pack.riskLevel === "medium"
      ? `10. Because Risk Level is "medium", your summary MUST use neutral wording ("some warning signs, verify these items", NEVER "likely scam" or "probable scam"), and state that evidence is thin.`
      : "",
    Array.isArray(pack.reasonCodes) && pack.reasonCodes.includes("critical_agent_failed")
      ? `11. Because critical message analysis failed, your summary MUST explicitly state that the offer message could not be analysed and the user must not treat the result as safe: "${language === "hi" ? CRITICAL_AGENT_FAILED_NOTICE_HI : CRITICAL_AGENT_FAILED_NOTICE_EN}".`
      : "",
    Array.isArray(pack.whereDisagreed) && pack.whereDisagreed.length > 0
      ? `12. Explain the following method disagreements in plain language in your summary: ${pack.whereDisagreed.join("; ")}`
      : "",
  ].filter(Boolean);

  if (checkInputsSummary) {
    promptSections.push(
      ``,
      wrapUntrusted("USER_SUBMISSION_CONTEXT", checkInputsSummary)
    );
  }

  const prompt = promptSections.join("\n");

  const system = [
    "You are a professional security and risk assessment report writer for student opportunities.",
    "Your output must be objective, factual, concise, and adhere strictly to legal and defamation safety rules.",
    "Return only valid JSON matching the expected format:",
    '{ "summary": "<string>", "scamTypeGuess": "<scholarship|job|internship|task_job|mule_account|competition|unknown>", "flagExplanations": [ { "flagId": "<id>", "text": "<explanation>" } ], "extraChecklist": [ { "flagId": "<id>", "step": "<actionable verification step>" } ] }',
  ].join("\n");

  try {
    const llmRes = await generateFn({
      system,
      prompt,
      schema: LLMReportOutputSchema,
      timeoutMs: 35000,
      purpose: "report_generation",
    });

    if (!llmRes.ok) {
      return buildFallbackReport(pack, language, deps);
    }

    const { summary, scamTypeGuess, flagExplanations, extraChecklist } = llmRes.data;

    // Post-validation: safety claims, scammer declarations, level-specific notices, and flag alignment
    if (!validateGeneratedText(summary, pack.riskLevel, language, pack)) {
      return buildFallbackReport(pack, language, deps);
    }

    // Assemble quality checklist with deduplication, entity grouping, and 10-item cap
    const { checklist, moreChecks } = assembleQualityChecklist(pack, language, extraChecklist);

    // Map LLM flag explanations to pack flags
    const validFlagIds = new Set(pack.flags.map((f) => f.id));
    const explanationMap = new Map();
    if (Array.isArray(flagExplanations)) {
      for (const fe of flagExplanations) {
        if (fe && fe.flagId && validFlagIds.has(fe.flagId) && typeof fe.text === "string") {
          if (validateGeneratedText(fe.text, pack.riskLevel, language)) {
            explanationMap.set(fe.flagId, fe.text);
          }
        }
      }
    }

    const finalFlags = pack.flags.map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      explanation: explanationMap.get(f.id) || f.explanation,
      evidence: f.evidence,
    }));

    // Action buttons
    const actions = [];
    const langActions = language === "hi" ? ACTIONS_MAP.hi : ACTIONS_MAP.en;
    if (pack.riskLevel === "high") {
      actions.push(langActions.fraud_help);
      actions.push(langActions.college_email);
    } else if (pack.riskLevel === "medium") {
      actions.push(langActions.college_email);
      actions.push(langActions.copy_checklist);
    } else {
      actions.push(langActions.copy_checklist);
    }

    // If scoring safeguards fired, ensure plain-language explanations are included in summary
    let finalSummary = summary;
    const safeguards = formatSafeguardExplanations(pack.rulesFired, language);
    if (safeguards.length > 0) {
      const missingSafeguards = safeguards.filter((s) => !finalSummary.includes(s));
      if (missingSafeguards.length > 0) {
        const prefix = language === "hi" ? "स्कोरिंग सुरक्षा उपाय:" : "Scoring safeguards applied:";
        finalSummary = `${finalSummary} ${prefix} ${missingSafeguards.join(" ")}`;
      }
    }

    const reportData = {
      checkId: pack.checkId,
      riskLevel: pack.riskLevel,
      score: pack.score,
      confidence: pack.confidence,
      scamTypeGuess: scamTypeGuess || "unknown",
      language,
      summary: finalSummary,
      flags: finalFlags,
      verified: pack.verified,
      couldNotCheck: pack.couldNotCheck,
      notApplicable: pack.notApplicable,
      checklist,
      moreChecks,
      actions,
      whereDisagreed: pack.whereDisagreed || [],
      coverage: pack.coverage || { checked: [], notChecked: [] },
      improveCheck: pack.improveCheck || buildImproveCheck(pack.coverage, language),
      disclaimer: language === "hi" ? DISCLAIMER_HI : DISCLAIMER_EN,
      generatedAt: nowFn(),
    };

    return ReportSchema.parse(reportData);
  } catch {
    // Unhandled error / parse crash degrades gracefully to deterministic fallback
    return buildFallbackReport(pack, language, deps);
  }
}
