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

// Strict LLM Output Schema: ONLY summary, scamTypeGuess, flagExplanations, extraChecklist allowed
export const LLMReportOutputSchema = z
  .object({
    summary: z.string().min(10).max(1000),
    scamTypeGuess: z.enum(SCAM_TYPE_GUESSES).default("unknown"),
    flagExplanations: z
      .array(
        z.object({
          flagId: z.string().min(1),
          text: z.string().min(5).max(1000),
        })
      )
      .default([]),
    extraChecklist: z
      .array(
        z.object({
          flagId: z.string().min(1),
          step: z.string().min(5).max(300),
        })
      )
      .max(5)
      .default([]),
  })
  .strict();

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
    riskLevel: scoreResult.level || "cannot_verify",
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

  // Base checklist from flags
  const checklist = [];
  const seenChecklistTexts = new Set();

  function addStep(text, url = null) {
    if (text && !seenChecklistTexts.has(text)) {
      seenChecklistTexts.add(text);
      checklist.push({ text, url });
    }
  }

  for (const flag of pack.flags) {
    const mapEntry = FLAG_CHECKLIST_MAP[flag.id];
    if (mapEntry) {
      const stepText = isHi && mapEntry.hi ? mapEntry.hi : mapEntry.en;
      addStep(stepText, mapEntry.url || null);
    }
  }

  // For Medium risk, include manual verification checklist items and official registry links
  if (pack.riskLevel === "medium") {
    for (const item of Object.values(MANUAL_VERIFICATION_CHECKLIST)) {
      const stepText = isHi && item.hi ? item.hi : item.en;
      addStep(stepText, item.url || null);
    }
  }

  // Add manual check links
  for (const mc of pack.manualChecks) {
    const text = isHi
      ? `आधिकारिक पोर्टल पर मैन्युअल रूप से जांचें: ${mc.label}` // needs native review
      : `Verify manually on official portal: ${mc.label}`;
    addStep(text, mc.url);
  }

  // Add steps for couldNotCheck items
  for (const cnc of pack.couldNotCheck) {
    const text = isHi
      ? `यह जांच पूरी नहीं हो सकी, मैन्युअल रूप से पुष्टि करें (${cnc})` // needs native review
      : `Check could not be completed automatically; verify manually (${cnc})`;
    addStep(text, null);
  }

  // Context-aware high/medium warnings (never assume payment unless payment/fee flags present)
  if (pack.riskLevel === "high" || pack.riskLevel === "medium") {
    const hasPaymentFlag = pack.flags.some((f) =>
      ["scholarship_fee_demand", "fee_demand", "personal_payment_id", "qr_code_payment_request", "task_deposit_script"].includes(f.id)
    );
    const hasMuleFlag = pack.flags.some((f) => f.id === "mule_account_request");
    let warningStep = "";
    if (hasMuleFlag) {
      warningStep = isHi
        ? "कभी भी अपना बैंक खाता, एटीएम कार्ड या यूपीआई क्रेडेंशियल किसी तीसरे पक्ष को हस्तांतरण के लिए न दें।"
        : "Never transfer, rent, or provide access to your bank account, ATM, or UPI credentials to third parties.";
    } else if (hasPaymentFlag) {
      warningStep = isHi
        ? "किसी भी व्यक्ति को अग्रिम शुल्क या सत्यापन राशि का भुगतान न करें।"
        : "Do NOT make any upfront payments or transfer fees for job or scholarship processing.";
    } else {
      warningStep = isHi
        ? "अज्ञात व्यक्तियों के साथ संवेदनशील क्रेडेंशियल या दस्तावेज साझा न करें।"
        : "Do NOT share banking credentials, OTPs, or un-redacted personal documents with unknown contacts.";
    }
    addStep(warningStep, null);
  }

  // Reporting channels for high risk (rendered only as unverified advice text, never confirmed contacts)
  if (pack.riskLevel === "high") {
    for (const channel of REPORTING_CHANNELS) {
      const channelText = isHi && channel.hiText ? channel.hiText : channel.text;
      addStep(channelText, channel.verified && channel.url ? channel.url : null);
    }
  }

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
    actions,
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

  return true;
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
    "Return only valid JSON.",
  ].join("\n");

  try {
    const llmRes = await generateFn({
      system,
      prompt,
      schema: LLMReportOutputSchema,
      timeoutMs: 25000,
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

    // Assemble deterministic checklist
    const checklist = [];
    const seenSteps = new Set();

    function addChecklistStep(text, url = null) {
      if (text && !seenSteps.has(text)) {
        seenSteps.add(text);
        checklist.push({ text, url });
      }
    }

    // Base flag checklist
    for (const flag of pack.flags) {
      const mapEntry = FLAG_CHECKLIST_MAP[flag.id];
      if (mapEntry) {
        const stepText = language === "hi" && mapEntry.hi ? mapEntry.hi : mapEntry.en;
        addChecklistStep(stepText, mapEntry.url || null);
      }
    }

    // For Medium risk, include manual verification checklist items and official registry links
    if (pack.riskLevel === "medium") {
      for (const item of Object.values(MANUAL_VERIFICATION_CHECKLIST)) {
        const stepText = language === "hi" && item.hi ? item.hi : item.en;
        addChecklistStep(stepText, item.url || null);
      }
    }

    // Manual check links
    for (const mc of pack.manualChecks) {
      const stepText = language === "hi"
        ? `आधिकारिक पोर्टल पर मैन्युअल रूप से जांचें: ${mc.label}` // needs native review
        : `Verify manually on official portal: ${mc.label}`;
      addChecklistStep(stepText, mc.url);
    }

    // Could-not-check manual steps
    for (const cnc of pack.couldNotCheck) {
      const stepText = language === "hi"
        ? `यह जांच पूरी नहीं हो सकी, मैन्युअल रूप से पुष्टि करें (${cnc})` // needs native review
        : `Check could not be completed automatically; verify manually (${cnc})`;
      addChecklistStep(stepText, null);
    }

    // Extra checklist items from LLM (up to 5, mapped to valid pack flags)
    const validFlagIds = new Set(pack.flags.map((f) => f.id));
    if (Array.isArray(extraChecklist)) {
      for (const extra of extraChecklist) {
        if (extra && extra.step && validFlagIds.has(extra.flagId)) {
          if (validateGeneratedText(extra.step, pack.riskLevel, language, pack)) {
            addChecklistStep(extra.step, null);
          }
        }
      }
    }

    // Context-aware high/medium caution step (never assume payment unless payment/fee flags present)
    if (pack.riskLevel === "high" || pack.riskLevel === "medium") {
      const hasPaymentFlag = pack.flags.some((f) =>
        ["scholarship_fee_demand", "fee_demand", "personal_payment_id", "qr_code_payment_request", "task_deposit_script"].includes(f.id)
      );
      const hasMuleFlag = pack.flags.some((f) => f.id === "mule_account_request");
      let caution = "";
      if (hasMuleFlag) {
        caution = language === "hi"
          ? "कभी भी अपना बैंक खाता, एटीएम कार्ड या यूपीआई क्रेडेंशियल किसी तीसरे पक्ष को हस्तांतरण के लिए न दें।"
          : "Never transfer, rent, or provide access to your bank account, ATM, or UPI credentials to third parties.";
      } else if (hasPaymentFlag) {
        caution = language === "hi"
          ? "किसी भी व्यक्ति को अग्रिम शुल्क या सत्यापन राशि का भुगतान न करें।"
          : "Do NOT make any upfront payments or transfer fees for job or scholarship processing.";
      } else {
        caution = language === "hi"
          ? "अज्ञात व्यक्तियों के साथ संवेदनशील क्रेडेंशियल या दस्तावेज साझा न करें।"
          : "Do NOT share banking credentials, OTPs, or un-redacted personal documents with unknown contacts.";
      }
      addChecklistStep(caution, null);
    }

    // Reporting channels for high risk (rendered only as unverified advice text, never confirmed contacts)
    if (pack.riskLevel === "high") {
      for (const channel of REPORTING_CHANNELS) {
        const channelText = language === "hi" && channel.hiText ? channel.hiText : channel.text;
        addChecklistStep(channelText, channel.verified && channel.url ? channel.url : null);
      }
    }

    // Map LLM flag explanations to pack flags
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
      actions,
      disclaimer: language === "hi" ? DISCLAIMER_HI : DISCLAIMER_EN,
      generatedAt: nowFn(),
    };

    return ReportSchema.parse(reportData);
  } catch {
    // Unhandled error / parse crash degrades gracefully to deterministic fallback
    return buildFallbackReport(pack, language, deps);
  }
}
