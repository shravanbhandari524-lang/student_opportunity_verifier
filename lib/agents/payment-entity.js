/**
 * lib/agents/payment-entity.js
 *
 * Payment and Entity Specialist Agent for Layer L4.
 *
 * Rules:
 * - Pure code orchestrator using injected services/tools: { search, graphLookup, now }.
 * - No direct database or LLM imports.
 * - Processes each eligible entity independently:
 *     (a) graph lookup for upi, domain, handle, phone -> graph_match (URL or quote evidence)
 *     (b) UPI validation & consistency -> personal_payment_id with verified quote evidence
 *     (c) Phone validation & classification -> foreign_or_voip_number
 *     (d) Scam-report search -> scam_reports_found (URL evidence) capped by budget
 *     (e) Email validation -> recorded in trace only
 * - Partial failure rule: if some items check and others fail, status is "ok".
 *   Status is "could_not_check" ONLY if every eligible item failed.
 * - Never trace, locate or name a phone number. No lookup of a person.
 * - Failure reasons are fixed codes and never contain raw phone numbers, UPIs or message text.
 * - Return flags only from "ok" results. Empty arrays for non-ok.
 * - newEntities is always [].
 */

import { FLAG_REGISTRY, canEmit } from "../contracts/flags.js";
import { upiFacts, phoneFacts, emailFacts } from "../tools/payments.js";
import { search as defaultSearch } from "../tools/search.js";
import { buildScamQuery, buildUpiQuery } from "../tools/dorks.js";
import { createActivityRecorder } from "./activity.js";
import {
  PAYMENT_SEARCH_BUDGET,
  RECRUITMENT_CONTEXT_TERMS,
  REPUTATION_SCAM_WORDS,
  REPUTATION_PROXIMITY_CHARS,
  PAYMENT_REQUEST_SIGNALS,
} from "./config.js";

/**
 * Default graph lookup stub.
 * The default graph dependency is a no-op failure; the coordinator injects the real lookup.
 *
 * @returns {{ ok: false, error: { code: string, message: string } }}
 */
export function defaultGraphLookup() {
  return {
    ok: false,
    error: {
      code: "GRAPH_UNAVAILABLE",
      message: "Graph lookup unavailable: coordinator must inject graphLookup",
    },
  };
}
import {
  getCheckId,
  getMessageText,
  getAnalysisText,
  getRound,
  quoteInText,
  safeToolCall,
  buildOkResult,
  buildSkippedResult,
  buildCouldNotCheckResult,
  buildCompleteEntityStatus,
} from "./base.js";

export const NAME = "payment_entity";
export const KIND = "check";

export const ELIGIBLE_KINDS = Object.freeze(["upi", "phone", "handle", "email", "domain", "amount"]);

/**
 * Returns the set of processed entity keys for this agent from the snapshot.
 * Reads control.processedEntitiesByAgent.payment_entity or falls back to prior findings.
 *
 * @param {object} snapshot
 * @returns {Set<string>}
 */
export function getProcessedEntityKeys(snapshot) {
  const processed = new Set();

  if (snapshot?.control?.processedEntitiesByAgent?.[NAME]) {
    const list = snapshot.control.processedEntitiesByAgent[NAME];
    if (Array.isArray(list)) {
      for (const item of list) {
        if (typeof item === "string") {
          processed.add(item);
        }
      }
    }
  }

  // Also check existing findings for payment_entity in previous rounds
  if (Array.isArray(snapshot?.findings)) {
    for (const finding of snapshot.findings) {
      if (finding && finding.agent === NAME && Array.isArray(finding.processedEntities)) {
        for (const item of finding.processedEntities) {
          if (typeof item === "string") {
            processed.add(item);
          }
        }
      }
    }
  }

  return processed;
}

/**
 * Returns unprocessed entities eligible for payment_entity.
 *
 * @param {object} snapshot
 * @returns {Array<{ kind: string, value: string, id?: number }>}
 */
export function getEligibleUnprocessedEntities(snapshot) {
  if (!Array.isArray(snapshot?.entities)) {
    return [];
  }

  const processed = getProcessedEntityKeys(snapshot);
  const eligible = [];
  const seenThisBatch = new Set();

  for (const ent of snapshot.entities) {
    if (!ent || typeof ent.kind !== "string" || typeof ent.value !== "string") {
      continue;
    }
    if (!ELIGIBLE_KINDS.includes(ent.kind)) {
      continue;
    }

    const key = `${ent.kind}:${ent.value}`;
    if (!processed.has(key) && !seenThisBatch.has(key)) {
      seenThisBatch.add(key);
      eligible.push(ent);
    }
  }

  return eligible;
}

/**
 * Deterministic, synchronous eligibility check (no I/O, no LLM).
 * True only if snapshot has at least one entity of kind upi, phone, handle, email,
 * or domain that this agent has not yet processed.
 *
 * @param {object} snapshot
 * @returns {boolean}
 */
export function canRun(snapshot) {
  const eligible = getEligibleUnprocessedEntities(snapshot);
  return eligible.length > 0;
}

/**
 * Reason helper when skipped.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function skippedReason(snapshot) {
  if (!Array.isArray(snapshot?.entities) || snapshot.entities.length === 0) {
    return "no_eligible_entities";
  }
  const eligible = getEligibleUnprocessedEntities(snapshot);
  if (eligible.length === 0) {
    return "all_entities_already_processed";
  }
  return "not_eligible";
}

/**
 * Determines whether an amount entity represents a payment demand from the candidate.
 * Only from_candidate counts as a payment demand.
 * Stipend/salary is NEVER a demand.
 *
 * @param {object} entity
 * @returns {boolean}
 */
export function isPaymentDemand(entity) {
  if (!entity || entity.kind !== "amount") return false;
  if (entity.direction === "to_candidate" || entity.purpose === "stipend/salary") {
    return false;
  }
  if (entity.direction === "from_candidate") {
    return true;
  }
  // If direction is unclear or null, check purpose
  if (
    entity.purpose &&
    [
      "refundable deposit",
      "application fee",
      "registration charge",
      "registration fee",
      "security deposit",
      "document verification",
      "processing charge",
      "training kit",
      "advance payment",
    ].includes(entity.purpose)
  ) {
    return true;
  }
  return false;
}

/**
 * Detects whether an amount entity or payment demand exists in snapshot text/entities
 * when no payee identifier (UPI, phone, etc.) was provided.
 *
 * @param {object} snapshot
 * @returns {{ hasPaymentDemand: boolean, amountStr: string | null }}
 */
export function detectFeeDemandWithoutPayee(snapshot) {
  const messageText = getMessageText(snapshot) || "";
  const analysisText = getAnalysisText(snapshot) || messageText;

  // Look for specific fee/deposit phrases with amounts
  const feeRegexes = [
    /(?:verification deposit|deposit|application fee|registration fee|registration charge|processing fee|security deposit)[^.!?\n]{0,80}?(?:₹|rs\.?|inr)?\s*([0-9,]+)/i,
    /(?:₹|rs\.?|inr)\s*([0-9,]+)[^.!?\n]{0,80}?(?:verification deposit|deposit|application fee|registration fee|registration charge|processing fee|security deposit|refundable)/i,
    /(?:refundable)[^.!?\n]{0,60}?(?:deposit|fee)[^.!?\n]{0,40}?(?:₹|rs\.?|inr)?\s*([0-9,]+)/i,
    /(?:pay|payment|deposit)[^.!?\n]{0,40}?(?:₹|rs\.?|inr)\s*([0-9,]+)/i,
  ];

  let amountStr = null;
  for (const rx of feeRegexes) {
    const match = rx.exec(analysisText) || rx.exec(messageText);
    if (match) {
      amountStr = `₹${match[1]}`;
      break;
    }
  }

  // If regex didn't extract amount, check snapshot entities that are demands
  if (!amountStr && Array.isArray(snapshot?.entities)) {
    const amountEnts = snapshot.entities.filter((e) => e && isPaymentDemand(e));
    if (amountEnts.length > 0) {
      // If one of the amounts is mentioned near deposit/fee/verification, prefer it
      for (const ent of amountEnts) {
        const val = String(ent.value).trim();
        if (new RegExp(`(?:deposit|fee|pay|verification)[^.!?\\n]{0,40}?${val}`, "i").test(analysisText)) {
          amountStr = `₹${val}`;
          break;
        }
      }
      if (!amountStr) {
        amountStr = `₹${amountEnts[0].value}`;
      }
    }
  }

  const hasPaymentDemand = Boolean(
    amountStr ||
    /\b(?:refundable document verification deposit|verification deposit|application fee|registration fee|registration charge|deposit of)\b/i.test(analysisText)
  );

  return { hasPaymentDemand, amountStr };
}

/**
 * Builds the canonical skipped result for payment_entity, incorporating
 * payment demand detection and manual guidance if payment is requested without an identifier.
 *
 * @param {object} snapshot
 * @param {object} _deps
 * @returns {import("../contracts/agent-result.js").AgentResult}
 */
export function skippedResult(snapshot, _deps = {}) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const reason = skippedReason(snapshot) || "no_eligible_entities";

  const { hasPaymentDemand, amountStr } = detectFeeDemandWithoutPayee(snapshot);

  if (hasPaymentDemand) {
    const summary = amountStr
      ? `No payment ID or phone found, but the message asks for ${amountStr}`
      : "No payment ID or phone found, but the message asks for payment";

    const activity = [
      {
        seq: 0,
        atMs: 0,
        type: "limit",
        status: "skipped",
        title: "Check skipped",
        detail: "No payment details, UPI ID, or phone number found to check.",
        sources: [],
      },
      {
        seq: 1,
        atMs: 0,
        type: "manual",
        status: "info",
        title: "Ask where the money is to be sent. A scholarship never needs a deposit.",
        detail: "Ask where the money is to be sent. A scholarship never needs a deposit.",
        sources: [],
      },
    ];

    return buildSkippedResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason,
      summary,
      activity,
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
    });
  }

  return buildSkippedResult({
    checkId,
    agent: NAME,
    kind: KIND,
    round,
    reason,
    summary: "No payment details, UPI ID, or phone number found to check.",
    entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
  });
}

/**
 * Formats a registry flag ID into Title Case.
 *
 * @param {string} flagId
 * @returns {string}
 */
export function formatFlagTitle(flagId) {
  return flagId
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Known consumer-facing / third-party app PSP handles (commonly tied to individuals)
export const CONSUMER_PSP_HANDLES = new Set([
  "okaxis",
  "okhdfcbank",
  "okicici",
  "oksbi",
  "ybl",
  "ibl",
  "axl",
  "paytm",
  "ptsbi",
  "ptaxis",
  "pthdfc",
  "pticici",
  "apl",
  "rapl",
]);

// Non-person/functional username prefixes commonly used by genuine institutional departments
const INSTITUTIONAL_USERNAME_TOKENS = new Set([
  "merit",
  "grants",
  "grant",
  "admissions",
  "admission",
  "finance",
  "exam",
  "exams",
  "scholarship",
  "scholarships",
  "support",
  "trust",
  "foundation",
  "council",
  "treasury",
  "collection",
  "collections",
  "fee",
  "fees",
  "portal",
  "edu",
  "ac",
  "gov",
  "nic",
  "admin",
  "desk",
  "office",
  "proctor",
  "bursar",
  "accounts",
  "dept",
]);

/**
 * Checks whether an identifier string appears near any scam words in text.
 *
 * @param {string} text
 * @param {string} entityValue
 * @param {readonly string[]} scamWords
 * @param {number} [proximityLimit=120]
 * @returns {boolean}
 */
export function isNearScamWord(text, entityValue, scamWords, proximityLimit = REPUTATION_PROXIMITY_CHARS) {
  if (typeof text !== "string" || typeof entityValue !== "string") return false;
  const lowerText = text.toLowerCase();
  const lowerEntity = entityValue.toLowerCase().trim();
  if (!lowerEntity) return false;

  const entityIndices = [];
  let entIdx = -1;
  let fromIdx = 0;
  while ((entIdx = lowerText.indexOf(lowerEntity, fromIdx)) !== -1) {
    entityIndices.push(entIdx);
    fromIdx = entIdx + lowerEntity.length;
  }

  if (entityIndices.length === 0) {
    return false;
  }

  for (const word of scamWords) {
    const lowerWord = (word || "").toLowerCase().trim();
    if (!lowerWord) continue;

    let wIdx = -1;
    let wFromIdx = 0;
    while ((wIdx = lowerText.indexOf(lowerWord, wFromIdx)) !== -1) {
      for (const eIdx of entityIndices) {
        const dist = Math.abs(wIdx - eIdx);
        if (dist <= proximityLimit) {
          return true;
        }
      }
      wFromIdx = wIdx + lowerWord.length;
    }
  }

  return false;
}

/**
 * Classifies a UPI payee into 'strong_personal', 'weak_unverified', or 'institutional'.
 *
 * Tiers:
 * - strong: phone-number VPA (looksLikePhone), OR consumer PSP handle with a person-like name
 * - weak: bank handle (such as @sbi) with a non-person name (e.g. merit.grants@sbi)
 *
 * @param {object} upiResult
 * @returns {"strong_personal" | "weak_unverified"}
 */
export function classifyPayee(upiResult) {
  if (!upiResult || !upiResult.valid) {
    return "weak_unverified";
  }

  // 1. Phone number VPA (e.g. 9876543210@paytm, 9876543210@sbi) -> definitely personal
  if (upiResult.looksLikePhone) {
    return "strong_personal";
  }

  const handle = (upiResult.handle || "").toLowerCase();
  const username = (upiResult.username || "").toLowerCase();

  // Split username tokens on dot, hyphen, underscore, or digits
  const nameTokens = username.split(/[._\-\d]+/).filter(Boolean);
  const hasInstitutionalToken = nameTokens.some((tok) => INSTITUTIONAL_USERNAME_TOKENS.has(tok));

  // If handle is a consumer PSP (Google Pay, PhonePe, Paytm, Amazon Pay)
  if (CONSUMER_PSP_HANDLES.has(handle)) {
    // If it has institutional tokens like admissions.desk@okaxis, still suspect because consumer PSP,
    // but person-like name (e.g. rahul.sharma99@okaxis) is strong personal.
    return "strong_personal";
  }

  // If handle is a direct bank handle (e.g. @sbi, @icici, @hdfcbank) and name has institutional tokens
  if (hasInstitutionalToken) {
    return "weak_unverified";
  }

  // If handle is direct bank handle without institutional tokens, check if it looks like person name
  if (nameTokens.length >= 2) {
    return "strong_personal";
  }

  return "weak_unverified";
}

/**
 * Builds a concise 1-sentence plain summary (max 160 characters)
 * conforming to:
 * "1 UPI ID: looks personal, offer claims Google, payment requested; no database match."
 *
 * @param {object} params
 * @returns {string}
 */
export function buildPaymentSummary({
  upiEntities = [],
  phoneEntities = [],
  emailEntities = [],
  handleEntities = [],
  domainEntities = [],
  amountEntities = [],
  firstUpiFacts = null,
  claimedCompanyName = null,
  hasInstitutionalKeyword = false,
  hasPaymentRequest = false,
  hasGraphMatch = false,
  flags = [],
}) {
  const dbText = hasGraphMatch ? "database match" : "no database match";

  if (upiEntities.length > 0) {
    const upiCount = upiEntities.length;
    let payeeLook = "looks personal";
    if (firstUpiFacts) {
      if (!firstUpiFacts.valid) {
        payeeLook = "invalid format";
      } else if (firstUpiFacts.looksLikePhone) {
        payeeLook = "looks like personal phone number";
      } else if (classifyPayee(firstUpiFacts) === "strong_personal") {
        payeeLook = "looks personal";
      } else {
        payeeLook = "institutional bank handle";
      }
    }

    const claimText = claimedCompanyName
      ? `offer claims ${claimedCompanyName}`
      : (hasInstitutionalKeyword ? "offer claims institutional program" : "no organisation claimed");
    const payText = hasPaymentRequest ? "payment requested" : "no payment requested";

    const s = `${upiCount} UPI ID${upiCount > 1 ? "s" : ""}: ${payeeLook}, ${claimText}, ${payText}; ${dbText}.`;
    return s.slice(0, 160);
  }

  // Amount demand without payee identifier
  if (
    amountEntities.length > 0 &&
    !upiEntities.length &&
    !phoneEntities.length &&
    !handleEntities.length &&
    !emailEntities.length &&
    !domainEntities.length
  ) {
    const amt = amountEntities[0];
    const s = `Message demands ₹${amt.value}${amt.purpose ? ` (${amt.purpose})` : ""}: recipient cannot be verified; 0 red flags.`;
    return s.slice(0, 160);
  }

  // Non-UPI entities
  const items = [];
  if (emailEntities.length > 0) items.push(`${emailEntities.length} email`);
  if (phoneEntities.length > 0) items.push(`${phoneEntities.length} phone`);
  if (handleEntities.length > 0) items.push(`${handleEntities.length} handle`);
  if (domainEntities.length > 0) items.push(`${domainEntities.length} domain`);
  if (amountEntities.length > 0) items.push(`${amountEntities.length} payment demand`);
  const itemsDesc = items.join(" and ") || "identifiers";

  if (flags.length > 0) {
    const flagNames = flags.map((f) => f.id.replace(/_/g, " ")).slice(0, 2).join(", ");
    const s = `Checked ${itemsDesc}: ${flags.length} red flag(s) (${flagNames}); ${dbText}.`;
    return s.slice(0, 160);
  }

  const s = `Checked ${itemsDesc}: no suspicious signals found; ${dbText}.`;
  return s.slice(0, 160);
}

/**
 * Executes the Payment and Entity agent run.
 *
 * @param {object} snapshot
 * @param {object} [deps={}] - Injected dependencies { search, graphLookup, now, activity }
 * @param {object} [options={}] - Options { timeoutMs, searchBudget }
 * @returns {Promise<import("../contracts/agent-result.js").AgentResult>}
 */
export async function run(snapshot, deps = {}, options = {}) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const graphLookupFn = deps.graphLookup || defaultGraphLookup;
  const searchFn = deps.search || defaultSearch;
  const ctx = deps.ctx;
  const recorder = deps.activity || deps.recorder || createActivityRecorder({
    agent: NAME,
    round,
    nowFn: deps.now,
  });

  if (ctx?.note) {
    ctx.note("Validating payment identifiers and scanning scam graph");
  }

  const eligibleEntities = getEligibleUnprocessedEntities(snapshot);
  if (eligibleEntities.length === 0) {
    return skippedResult(snapshot, deps);
  }

  const messageText = getMessageText(snapshot);
  const analysisText = getAnalysisText(snapshot) || messageText;
  const trace = [];
  const flags = [];
  const verified = [];
  const processedEntities = [];
  const unchecked = [];
  const manualChecks = [];

  // Determine if there is an organisation claim in the case file
  // 1. Company entity present in snapshot.entities OR submission.company
  const companyEntities = (snapshot?.entities || []).filter(
    (e) => e && e.kind === "company" && typeof e.value === "string" && e.value.trim()
  );
  const submissionCompany =
    typeof snapshot?.submission?.company === "string" && snapshot.submission.company.trim()
      ? snapshot.submission.company.trim()
      : null;
  const hasCompanyClaim = companyEntities.length > 0 || Boolean(submissionCompany);
  const claimedCompanyName = companyEntities[0]?.value || submissionCompany || null;

  // 2. Institutional / recruitment / opportunity keywords in analysisText
  const INSTITUTIONAL_REGEX =
    /\b(?:scholarship|scholarships|ministry|government|govt|portal|admission|admissions|exam|exams|registration|recruitment|recruiter|internship|internships|job|jobs|onboarding|hiring|selected|placement|fellowship)\b/i;
  const hasInstitutionalKeyword = INSTITUTIONAL_REGEX.test(analysisText);
  const hasOrganisationClaim = hasCompanyClaim || hasInstitutionalKeyword;

  // Determine if there is a payment request in text or case file
  // 1. An 'amount' entity representing a payment demand in the case file
  const hasPaymentDemandEntity = (snapshot?.entities || []).some(
    (e) => e && isPaymentDemand(e)
  );
  // 2. Explicit payment demand words in analysisText
  // Note: Bare UPI IDs alone do NOT constitute a payment request
  const EXPLICIT_PAYMENT_REGEX =
    /\b(?:fee|fees|deposit|charge|charges|cost|payment|payments|token\s+amount|advance|security\s+deposit|processing\s+charge|registration\s+fee|onboarding\s+fee|verification\s+fee|application\s+fee)\b/i;
  const EXPLICIT_PAY_VERBS_REGEX =
    /\b(?:pay|paying|paid|transfer|transfers|transferred|send|remit|deposit)\b/i;
  const CURRENCY_REGEX =
    /(?:\b(?:rs\.?|inr|rupees?)|₹)\s*\d+/i;
  // Also include "registration notice" or program payment signals when scholarship/registration occurs
  const REGISTRATION_SCHEME_REGEX =
    /\b(?:registration\s+(?:notice|form|portal|process)|admissions?\s+(?:notice|form)|scholarship\s+(?:portal|scheme))\b/i;

  const hasPaymentDemandWording =
    EXPLICIT_PAYMENT_REGEX.test(analysisText) ||
    EXPLICIT_PAY_VERBS_REGEX.test(analysisText) ||
    CURRENCY_REGEX.test(analysisText) ||
    REGISTRATION_SCHEME_REGEX.test(analysisText);
  const hasPaymentRequest = hasPaymentDemandEntity || hasPaymentDemandWording;

  let searchBudgetRemaining = options.searchBudget ?? PAYMENT_SEARCH_BUDGET;
  let successfulItemCount = 0;
  let failedItemCount = 0;
  let droppedQuoteCount = 0;
  let scamSearchesWithNoResultsCount = 0;
  let scamSearchesFailedCount = 0;
  let totalChecksExecuted = 0;
  let successfulChecksCount = 0;
  let failedChecksCount = 0;
  let totalGraphMatches = 0;
  let firstUpiFacts = null;

  const entityStatuses = [];
  const hasPayeeIdentifier = (snapshot?.entities || []).some(
    (e) => ["upi", "phone", "handle", "email"].includes(e?.kind) && Boolean(e?.value)
  );

  // Process each entity independently
  for (const ent of eligibleEntities) {
    const entKey = `${ent.kind}:${ent.value}`;
    let itemSuccessfulChecks = 0;
    let itemFailedChecks = 0;

    if (ctx?.note) {
      ctx.note(`Scanning scam graph for ${ent.kind}: ${ent.value}`);
    }

    if (ent.kind === "amount") {
      const isDemand = isPaymentDemand(ent);
      if (isDemand) {
        recorder.input({
          title: `Payment demand: ₹${ent.value}`,
          detail: `Analyzing payment demand amount (₹${ent.value})${ent.purpose ? ` for ${ent.purpose}` : ""}`,
        });

        // Payment demand analysis (no flag, no points)
        trace.push({
          type: "payment_demand_analysis",
          amount: ent.value,
          purpose: ent.purpose || null,
          payeeIdentifierPresent: hasPayeeIdentifier,
        });

        if (!hasPayeeIdentifier) {
          manualChecks.push({
            label: "Ask where the money is to be sent. A scholarship or genuine employer does not charge a deposit.",
            url: "https://scholarships.gov.in",
          });
          recorder.step({
            title: "Payment demand analysis",
            detail: `Message demands payment of ₹${ent.value}${ent.purpose ? ` (${ent.purpose})` : ""}; recipient cannot be verified.`,
            tool: "rules",
            status: "warn",
          });
          recorder.manual({
            title: "Ask where the money is to be sent. A scholarship or genuine employer does not charge a deposit.",
            detail: "Ask where the money is to be sent. A scholarship or genuine employer does not charge a deposit.",
            sources: [{ label: "Official Portal", url: "https://scholarships.gov.in" }],
          });
          entityStatuses.push({
            entityKind: "amount",
            entityValue: ent.value,
            status: "unverified",
            reason: "Recipient cannot be verified: fee demand with no payee identifier",
          });
        } else {
          recorder.step({
            title: "Payment demand analysis",
            detail: `Payment demand of ₹${ent.value}${ent.purpose ? ` (${ent.purpose})` : ""} analyzed alongside payee identifiers.`,
            tool: "rules",
            status: "info",
          });
          entityStatuses.push({
            entityKind: "amount",
            entityValue: ent.value,
            status: "checked_no_issue",
          });
        }
      } else {
        recorder.input({
          title: `Candidate compensation: ₹${ent.value}`,
          detail: `Analyzing offered compensation (₹${ent.value})${ent.purpose ? ` (${ent.purpose})` : ""}; candidate compensation, not a payment demand.`,
        });

        trace.push({
          type: "compensation_amount_analysis",
          amount: ent.value,
          purpose: ent.purpose || "stipend/salary",
          direction: "to_candidate",
        });

        recorder.step({
          title: "Compensation analysis",
          detail: `Offered stipend or compensation of ₹${ent.value}${ent.purpose ? ` (${ent.purpose})` : ""} is candidate income, not a payment demand.`,
          tool: "rules",
          status: "ok",
        });

        entityStatuses.push({
          entityKind: "amount",
          entityValue: ent.value,
          status: "checked_no_issue",
        });
      }

      processedEntities.push(entKey);
      successfulChecksCount++;
      successfulItemCount++;
      continue;
    }

    // Activity: input entry for each identifier checked
    if (ent.kind === "upi") {
      recorder.input({
        title: `Checked UPI ID: ${ent.value}`,
        detail: `Analyzing handle format, payee consistency, and scam records for ${ent.value}`,
      });
    } else if (ent.kind === "phone") {
      recorder.input({
        title: `Checked phone number: ${ent.value}`,
        detail: `Validating country code, line type, and scam records for ${ent.value}`,
      });
    } else if (ent.kind === "email") {
      recorder.input({
        title: `Checked email address: ${ent.value}`,
        detail: `Analyzing email provider and recruitment context for ${ent.value}`,
      });
    } else if (ent.kind === "handle") {
      recorder.input({
        title: `Checked handle: @${ent.value}`,
        detail: `Scanning scam database and search records for @${ent.value}`,
      });
    } else if (ent.kind === "domain") {
      recorder.input({
        title: `Checked domain: ${ent.value}`,
        detail: `Scanning scam database and search records for ${ent.value}`,
      });
    }

    // 1. Graph lookup for upi, domain, handle, phone
    if (["upi", "domain", "handle", "phone"].includes(ent.kind)) {
      totalChecksExecuted++;
      try {
        const graphResult = graphLookupFn(ent.kind, ent.value);
        if (graphResult && (graphResult.ok === false || graphResult.error)) {
          itemFailedChecks++;
          failedChecksCount++;
          trace.push({
            entity: ent.kind,
            check: "graph_lookup",
            status: "failed",
            reason: graphResult.error?.code || "graph_lookup_failed",
          });
          recorder.step({
            title: "Checked our scam database: lookup failed",
            detail: `Could not query scam database for ${ent.value}.`,
            tool: "graph",
            status: "failed",
          });
        } else if (graphResult && graphResult.matched) {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          totalGraphMatches++;
          trace.push({
            entity: ent.kind,
            check: "graph_lookup",
            status: "match",
            reportCount: graphResult.reportCount || 1,
          });

          recorder.step({
            title: `Scam database match: ${ent.value}`,
            detail: `Matched known scam identifier in scam intelligence graph with ${graphResult.connectedNodesCount || 0} linked identifier(s).`,
            tool: "graph",
            status: "warn",
          });

          if (canEmit("graph_match", NAME)) {
            // Find evidence: prefer quote of identifier in message text, otherwise official/placeholder URL
            let evidenceItem = null;
            if (quoteInText(ent.value, messageText)) {
              evidenceItem = { type: "quote", value: ent.value };
            } else {
              // Construct a valid HTTP evidence reference representing internal graph match
              evidenceItem = {
                type: "url",
                value: `https://verifier.internal/graph/nodes/${graphResult.nodeId || 0}`,
              };
            }

            const meta = FLAG_REGISTRY.graph_match;
            const explanation = `Identifier matched known scam entity in intelligence graph (${graphResult.reportCount || 1} prior report(s), ${graphResult.connectedNodesCount || 0} linked identifier(s)).`;

            flags.push({
              id: "graph_match",
              title: formatFlagTitle("graph_match"),
              severity: meta.severity,
              explanation,
              evidence: [evidenceItem],
            });

            recorder.finding({
              title: "Known scam database match",
              detail: explanation,
              flagId: "graph_match",
              tool: "graph",
              status: "warn",
              sources: evidenceItem.type === "url" ? [{ label: "Scam Graph Node", url: evidenceItem.value }] : [],
            });
          }
        } else {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          trace.push({
            entity: ent.kind,
            check: "graph_lookup",
            status: "no_match",
          });
          recorder.step({
            title: "Checked our scam database: no earlier reports for this identifier",
            detail: `Checked our scam database: no earlier reports for this identifier (${ent.value}).`,
            tool: "graph",
            status: "ok",
          });
        }
      } catch (err) {
        itemFailedChecks++;
        failedChecksCount++;
        trace.push({
          entity: ent.kind,
          check: "graph_lookup",
          status: "failed",
          reason: err?.code || "graph_lookup_failed",
        });
        recorder.step({
          title: "Checked our scam database: lookup failed",
          detail: `Could not query scam database for ${ent.value}.`,
          tool: "graph",
          status: "failed",
        });
      }
    }

    // 2. Specific validations by entity kind
    if (ent.kind === "upi") {
      totalChecksExecuted++;
      try {
        const upiResult = upiFacts(ent.value);
        if (firstUpiFacts === null) {
          firstUpiFacts = upiResult;
        }

        if (upiResult.valid) {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          verified.push(`UPI syntax valid (${upiResult.handle})`);

          // Payee classification: strong personal vs weak unverified
          const payeeTier = classifyPayee(upiResult);
          const handleRecognised = upiResult.isKnownPsp
            ? ([upiResult.bankName, upiResult.pspName].filter(Boolean).join(" / ") || upiResult.handle)
            : "unrecognised handle";
          const typeDesc = upiResult.looksLikePhone
            ? "phone-number ID"
            : (payeeTier === "strong_personal" ? "name-like ID" : "institution-like ID");
          const payeeReason = upiResult.looksLikePhone
            ? "phone-number VPA tied to an individual"
            : (payeeTier === "strong_personal"
              ? "consumer PSP handle or person-like username"
              : "bank handle with institutional tokens");

          // Step rules (UPI): format valid or not; handle recognised; type; payee classification result with reason.
          recorder.step({
            title: "UPI rules: format valid",
            detail: `Format valid; handle recognised: ${handleRecognised}; type: ${typeDesc}; payee classification: ${payeeTier === "strong_personal" ? "personal" : "unverified institutional"} (${payeeReason}).`,
            tool: "rules",
            status: "ok",
          });

          // Step rules (consistency): claimed organisation vs payee type, and whether payment requested; explain mismatch in one sentence.
          const claimedOrg = claimedCompanyName
            ? `claimed ${claimedCompanyName}`
            : (hasInstitutionalKeyword ? "claimed institutional/scheme program" : "no organisation claimed");
          const payeeType = upiResult.looksLikePhone
            ? "phone-number ID"
            : (payeeTier === "strong_personal" ? "personal-looking ID" : "institution-like ID");
          const paymentStatus = hasPaymentRequest ? "payment requested" : "no payment requested";

          let mismatchSentence = "";
          let consistencyStatus = "ok";

          if (hasOrganisationClaim && hasPaymentRequest && payeeTier === "strong_personal") {
            mismatchSentence = claimedCompanyName
              ? `Offer claims ${claimedCompanyName} and requests payment, but payment is directed to a personal-looking UPI ID.`
              : "Offer claims an institutional opportunity and requests payment, but payment is directed to a personal-looking UPI ID.";
            consistencyStatus = "warn";
          } else if (hasOrganisationClaim && !hasPaymentRequest) {
            mismatchSentence = `Offer claims ${claimedCompanyName || "an institutional program"}, but no payment was requested to this UPI ID.`;
          } else if (!hasOrganisationClaim && hasPaymentRequest && payeeTier === "strong_personal") {
            mismatchSentence = "Payment requested to a personal UPI ID, but no official organisation was claimed.";
            consistencyStatus = "info";
          } else if (payeeTier !== "strong_personal") {
            mismatchSentence = "Payee uses a bank handle with non-person name; no corporate/personal mismatch detected.";
          } else {
            mismatchSentence = "No organisation claim or payment request mismatch detected.";
          }

          recorder.step({
            title: "Payee consistency check",
            detail: `${claimedOrg} vs ${payeeType}, ${paymentStatus}. ${mismatchSentence}`,
            tool: "rules",
            status: consistencyStatus,
          });

          // Check for personal payment identifier:
          if (hasOrganisationClaim && hasPaymentRequest) {
            if (payeeTier === "strong_personal") {
              if (canEmit("personal_payment_id", NAME)) {
                // Find quote evidence: check messageText, then full analysisText (which includes submitted form fields)
                let evidenceValue = null;
                if (quoteInText(ent.value, messageText)) {
                  evidenceValue = ent.value;
                } else if (
                  snapshot?.submission?.upiId &&
                  quoteInText(ent.value, snapshot.submission.upiId)
                ) {
                  evidenceValue = ent.value;
                }

                if (evidenceValue) {
                  const meta = FLAG_REGISTRY.personal_payment_id;
                  const explanation = claimedCompanyName
                    ? `Payment requested to personal or consumer UPI handle (${upiResult.handle}) despite claiming corporate/institutional affiliation (${claimedCompanyName}).`
                    : `Payment requested to personal or consumer UPI handle (${upiResult.handle}) for purported institutional or scholarship program.`;

                  flags.push({
                    id: "personal_payment_id",
                    title: formatFlagTitle("personal_payment_id"),
                    severity: meta.severity,
                    explanation,
                    evidence: [{ type: "quote", value: evidenceValue }],
                  });

                  recorder.finding({
                    title: "Personal payment ID mismatch",
                    detail: explanation,
                    flagId: "personal_payment_id",
                    tool: "rules",
                    status: "warn",
                  });
                } else {
                  droppedQuoteCount++;
                }
              }
            } else {
              // Weak unverified (e.g. merit.grants@sbi, admissions@icici)
              trace.push({
                entity: ent.kind,
                check: "payee_classification",
                status: "weak_unverified",
                note: `Payee ${ent.value} uses institutional/bank handle and cannot be verified via public registry.`,
              });
            }
          }
        } else {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          trace.push({
            entity: ent.kind,
            check: "syntax",
            status: "invalid_format",
          });
          recorder.step({
            title: "UPI rules: invalid format",
            detail: `Format invalid: ${ent.value} does not match valid UPI VPA syntax.`,
            tool: "rules",
            status: "warn",
          });
        }

        // Limit (always shown for UPI IDs):
        recorder.limit({
          title: "Lookup limitation",
          detail: "Whether this UPI ID exists or who owns it cannot be checked from here.",
          tool: "rules",
        });

        // Manual (always for UPI IDs):
        recorder.manual({
          title: "Verify payee in your UPI app",
          detail: "Before paying, type the ID into your own UPI app and read the verified name. A scheme or a large company never asks fees to a personal ID. If the name does not match the organisation, do not pay.",
          tool: "rules",
        });
      } catch {
        itemFailedChecks++;
        failedChecksCount++;
        trace.push({
          entity: ent.kind,
          check: "upi_facts",
          status: "failed",
          reason: "upi_facts_failed",
        });
        recorder.step({
          title: "UPI rules: check failed",
          detail: `Could not evaluate UPI rules for ${ent.value}.`,
          tool: "rules",
          status: "failed",
        });
      }
    } else if (ent.kind === "company") {
      // Company entity read by payment_entity: recorded as verified background claim
      totalChecksExecuted++;
      itemSuccessfulChecks++;
      successfulChecksCount++;
      trace.push({
        entity: ent.kind,
        check: "organisation_claim",
        status: "ok",
        value: ent.value,
      });
    } else if (ent.kind === "phone") {
      totalChecksExecuted++;
      try {
        const pResult = phoneFacts(ent.value);
        if (pResult.valid) {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          verified.push(`Phone number valid format`);

          // Check if non-Indian country code or VoIP/unknown line type
          const isForeign = pResult.country && pResult.country !== "IN";
          const isVoipOrUnknown = pResult.type === "VOIP" || pResult.type === "UNKNOWN";

          // Step rules (phone): valid or not, country, line type
          recorder.step({
            title: "Phone rules: valid format",
            detail: `Phone format: valid; Country: ${pResult.country || "unknown"}; Line type: ${pResult.type || "unknown"}.${(isForeign || isVoipOrUnknown) ? " Flagged non-domestic or virtual line." : ""}`,
            tool: "rules",
            status: (isForeign || isVoipOrUnknown) ? "warn" : "ok",
          });

          if ((isForeign || isVoipOrUnknown) && canEmit("foreign_or_voip_number", NAME)) {
            const meta = FLAG_REGISTRY.foreign_or_voip_number;
            let evidenceItem = null;

            if (quoteInText(ent.value, messageText)) {
              evidenceItem = { type: "quote", value: ent.value };
            } else if (pResult.raw && quoteInText(pResult.raw, messageText)) {
              evidenceItem = { type: "quote", value: pResult.raw };
            } else {
              // Quote substring or URL evidence
              evidenceItem = {
                type: "url",
                value: "https://verifier.internal/tools/phone-validation",
              };
            }

            if (evidenceItem) {
              const desc = isForeign
                ? `Phone number uses non-domestic country code (${pResult.country || "international"}).`
                : `Phone number is identified as virtual/VoIP or unassigned line type (${pResult.type}).`;

              flags.push({
                id: "foreign_or_voip_number",
                title: formatFlagTitle("foreign_or_voip_number"),
                severity: meta.severity,
                explanation: desc,
                evidence: [evidenceItem],
              });

              recorder.finding({
                title: "Foreign or virtual phone number",
                detail: desc,
                flagId: "foreign_or_voip_number",
                tool: "rules",
                status: "warn",
              });
            } else {
              droppedQuoteCount++;
            }
          }
        } else {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          trace.push({
            entity: ent.kind,
            check: "syntax",
            status: "invalid_format",
          });
          recorder.step({
            title: "Phone rules: invalid format",
            detail: `Phone format: invalid; could not parse ${ent.value} as a valid phone number.`,
            tool: "rules",
            status: "warn",
          });
        }
      } catch {
        itemFailedChecks++;
        failedChecksCount++;
        trace.push({
          entity: ent.kind,
          check: "phone_facts",
          status: "failed",
          reason: "phone_facts_failed",
        });
        recorder.step({
          title: "Phone rules: check failed",
          detail: `Could not evaluate phone rules for ${ent.value}.`,
          tool: "rules",
          status: "failed",
        });
      }
    } else if (ent.kind === "email") {
      totalChecksExecuted++;
      try {
        const emResult = emailFacts(ent.value);
        if (emResult.valid) {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          verified.push(`Email syntax valid`);
          trace.push({
            entity: ent.kind,
            check: "email_facts",
            isFreeProvider: emResult.isFreeProvider,
            isEduOrGov: emResult.isEduOrGov,
          });

          // Check if message text contains recruitment context
          let matchedTerm = null;
          if (typeof messageText === "string") {
            for (const term of RECRUITMENT_CONTEXT_TERMS) {
              if (quoteInText(term, messageText)) {
                matchedTerm = term;
                break;
              }
            }
          }

          // Step rules (email): free-mail provider or not
          recorder.step({
            title: `Email rules: ${emResult.isFreeProvider ? "free-mail provider" : "custom domain"}`,
            detail: `Email format: valid; Domain: ${emResult.domain || "unknown"}; Free-mail provider: ${emResult.isFreeProvider ? "yes" : "no"}.${emResult.isFreeProvider && matchedTerm ? ` Flagged free email used in recruitment context ("${matchedTerm}").` : ""}`,
            tool: "rules",
            status: (emResult.isFreeProvider && matchedTerm) ? "warn" : "ok",
          });

          if (emResult.isFreeProvider && canEmit("free_email_recruiter", NAME)) {
            if (matchedTerm) {
              const meta = FLAG_REGISTRY.free_email_recruiter;
              flags.push({
                id: "free_email_recruiter",
                title: formatFlagTitle("free_email_recruiter"),
                severity: meta.severity,
                explanation: `Recruiter contacting from free webmail provider (${emResult.domain || "webmail"}) with recruitment context terms.`,
                evidence: [{ type: "quote", value: matchedTerm }],
              });

              recorder.finding({
                title: "Free email recruiter",
                detail: `Recruiter contacting from free webmail provider (${emResult.domain || "webmail"}) with recruitment context terms ("${matchedTerm}").`,
                flagId: "free_email_recruiter",
                tool: "rules",
                status: "warn",
              });
            }
          }
        } else {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          trace.push({
            entity: ent.kind,
            check: "syntax",
            status: "invalid_format",
          });
          recorder.step({
            title: "Email rules: invalid format",
            detail: `Email format: invalid; could not parse ${ent.value} as a valid email address.`,
            tool: "rules",
            status: "warn",
          });
        }
      } catch {
        itemFailedChecks++;
        failedChecksCount++;
        trace.push({
          entity: ent.kind,
          check: "email_facts",
          status: "failed",
          reason: "email_facts_failed",
        });
        recorder.step({
          title: "Email rules: check failed",
          detail: `Could not evaluate email rules for ${ent.value}.`,
          tool: "rules",
          status: "failed",
        });
      }
    }

    // 3. Scam-report search per upi, domain, handle, phone (respecting query budget)
    if (["upi", "domain", "handle", "phone"].includes(ent.kind)) {
      if (searchBudgetRemaining > 0) {
        searchBudgetRemaining -= 1;
        const query =
          ent.kind === "upi" ? buildUpiQuery(ent.value) : buildScamQuery(ent.value);

        if (query) {
          totalChecksExecuted++;
          const searchResult = await safeToolCall(
            () => searchFn(query, {
              context: { budget: { remaining: searchBudgetRemaining } },
            }),
            "SEARCH_ERROR"
          );

          if (searchResult && searchResult.ok && Array.isArray(searchResult.data?.results)) {
            itemSuccessfulChecks++;
            successfulChecksCount++;
            const hits = searchResult.data.results;
            let foundCorroboratedScamReport = false;
            const evidenceSources = [];

            for (const hit of hits) {
              const combinedSnippet = `${hit.title || ""} ${hit.snippet || ""}`;
              const hasExactIdentifier = combinedSnippet.toLowerCase().includes(ent.value.toLowerCase().trim());
              const hasNearbyScamWord = isNearScamWord(
                combinedSnippet,
                ent.value,
                REPUTATION_SCAM_WORDS,
                REPUTATION_PROXIMITY_CHARS
              );

              if (hasExactIdentifier && hasNearbyScamWord && hit.url && /^https?:\/\//i.test(hit.url)) {
                foundCorroboratedScamReport = true;
                evidenceSources.push({
                  label: hit.title || hit.url,
                  url: hit.url,
                });
                if (canEmit("scam_reports_found", NAME)) {
                  const meta = FLAG_REGISTRY.scam_reports_found;
                  flags.push({
                    id: "scam_reports_found",
                    title: formatFlagTitle("scam_reports_found"),
                    severity: meta.severity,
                    explanation: `Public scam complaints or reports found for identifier '${ent.value}': ${hit.title || hit.url}`,
                    evidence: [{ type: "url", value: hit.url }],
                  });

                  recorder.finding({
                    title: `Public scam complaint found for ${ent.value}`,
                    detail: `Public complaint or scam report found: ${hit.title || hit.url}`,
                    flagId: "scam_reports_found",
                    tool: "search",
                    status: "warn",
                    sources: [{ label: hit.title || hit.url, url: hit.url }],
                  });
                }
                break;
              }
            }

            if (!foundCorroboratedScamReport) {
              scamSearchesWithNoResultsCount++;
            }

            trace.push({
              entity: ent.kind,
              check: "scam_search",
              status: "ok",
              hitsCount: hits.length,
              corroborated: foundCorroboratedScamReport,
            });

            // Step search: query run as plain text, number of results, exact-match results used as evidence
            recorder.step({
              title: `Web scam search: ${hits.length} result(s)`,
              detail: `Query: ${query}. Results found: ${hits.length}.${evidenceSources.length > 0 ? ` Exact-match evidence: ${evidenceSources.map((e) => e.label).join(", ")}.` : ""}`,
              tool: "search",
              status: foundCorroboratedScamReport ? "warn" : "ok",
              sources: evidenceSources,
            });
          } else {
            // Search failed or returned error
            itemFailedChecks++;
            failedChecksCount++;
            scamSearchesFailedCount++;
            trace.push({
              entity: ent.kind,
              check: "scam_search",
              status: "error",
              code: searchResult?.error?.code || "SEARCH_ERROR",
            });
            recorder.step({
              title: "Web scam search: search failed",
              detail: `Query: ${query}. Search provider error.`,
              tool: "search",
              status: "failed",
            });
          }
        }
      } else {
        trace.push({
          entity: ent.kind,
          check: "scam_search",
          status: "skipped_budget",
        });
      }
    }

    if (itemFailedChecks > 0) {
      failedItemCount++;
      unchecked.push(entKey);
      entityStatuses.push({
        entityKind: ent.kind,
        entityValue: ent.value,
        status: "could_not_check",
        reason: "Lookup or search failed",
      });
    } else if (itemSuccessfulChecks > 0) {
      successfulItemCount++;
      processedEntities.push(entKey);
      const isContradicted = flags.some((f) =>
        f.evidence?.some(
          (ev) => ev.value === ent.value || (typeof ev.value === "string" && ev.value.includes(ent.value))
        )
      );
      entityStatuses.push({
        entityKind: ent.kind,
        entityValue: ent.value,
        status: isContradicted ? "contradicted" : "checked_no_issue",
        ...(isContradicted ? { reason: "Red flag identified for entity" } : {}),
      });
    }
  }

  // Deduplicate flags by id
  const seenFlagIds = new Set();
  const dedupedFlags = [];
  for (const f of flags) {
    if (!seenFlagIds.has(f.id)) {
      seenFlagIds.add(f.id);
      dedupedFlags.push(f);
    }
  }

  // Build summary and set on activity recorder
  const upiEntities = eligibleEntities.filter((e) => e.kind === "upi");
  const phoneEntities = eligibleEntities.filter((e) => e.kind === "phone");
  const emailEntities = eligibleEntities.filter((e) => e.kind === "email");
  const handleEntities = eligibleEntities.filter((e) => e.kind === "handle");
  const domainEntities = eligibleEntities.filter((e) => e.kind === "domain");
  const amountEntities = eligibleEntities.filter((e) => e.kind === "amount");

  const summary = buildPaymentSummary({
    upiEntities,
    phoneEntities,
    emailEntities,
    handleEntities,
    domainEntities,
    amountEntities: amountEntities.filter(isPaymentDemand),
    firstUpiFacts,
    claimedCompanyName,
    hasInstitutionalKeyword,
    hasPaymentRequest,
    hasGraphMatch: totalGraphMatches > 0,
    flags: dedupedFlags,
  });
  recorder.setSummary(summary);

  // Evaluate failure rule:
  // "The result is could_not_check only when every check on every item failed."
  if (successfulChecksCount === 0 && failedChecksCount > 0) {
    recorder.setSummary("Payment and entity checks could not be completed.");
    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "all_checks_failed",
      summary: recorder.getSummary(),
      activity: recorder.getEntries(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, entityStatuses),
    });
  }

  // Build notes
  let notes = "";
  if (dedupedFlags.length > 0) {
    notes = `Identified ${dedupedFlags.length} risk factor(s) across payment and entity identifiers.`;
  } else {
    notes = "No payment or entity red flags found; this does not mean the offer is safe (not a safety guarantee).";
  }

  if (scamSearchesWithNoResultsCount > 0) {
    notes += ` Search checks returned no public complaints for ${scamSearchesWithNoResultsCount} identifier(s) (not a safety guarantee).`;
  }
  if (scamSearchesFailedCount > 0) {
    notes += ` Scam-report search was unavailable for ${scamSearchesFailedCount} identifier(s).`;
  }
  if (droppedQuoteCount > 0) {
    notes += ` (${droppedQuoteCount} potential finding(s) dropped due to unverified quote evidence)`;
  }
  if (failedItemCount > 0) {
    notes += ` (${failedItemCount} item(s) could not be checked)`;
  }

  return buildOkResult({
    checkId,
    agent: NAME,
    kind: KIND,
    round,
    flags: dedupedFlags,
    verified,
    newEntities: [],
    processedEntities,
    unchecked,
    manualChecks,
    trace,
    notes,
    summary: recorder.getSummary(),
    activity: recorder.getEntries(),
    entityStatus: buildCompleteEntityStatus(snapshot, NAME, entityStatuses),
  });
}

export const paymentEntity = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  skippedResult,
  run,
};

export default paymentEntity;
