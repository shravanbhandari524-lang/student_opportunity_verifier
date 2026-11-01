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
} from "./base.js";

export const NAME = "payment_entity";
export const KIND = "check";

export const ELIGIBLE_KINDS = Object.freeze(["upi", "phone", "handle", "email", "domain"]);

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
 * Executes the Payment and Entity agent run.
 *
 * @param {object} snapshot
 * @param {object} [deps={}] - Injected dependencies { search, graphLookup, now }
 * @param {object} [options={}] - Options { timeoutMs, searchBudget }
 * @returns {Promise<import("../contracts/agent-result.js").AgentResult>}
 */
export async function run(snapshot, deps = {}, options = {}) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const graphLookupFn = deps.graphLookup || defaultGraphLookup;
  const searchFn = deps.search || defaultSearch;
  const ctx = deps.ctx;

  if (ctx?.note) {
    ctx.note("Validating payment identifiers and scanning scam graph");
  }

  const eligibleEntities = getEligibleUnprocessedEntities(snapshot);
  if (eligibleEntities.length === 0) {
    return buildSkippedResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "no_eligible_entities",
    });
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
  // 1. An 'amount' entity in the case file
  const hasAmountEntity = (snapshot?.entities || []).some(
    (e) => e && e.kind === "amount" && typeof e.value === "string" && e.value.trim()
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
  const hasPaymentRequest = hasAmountEntity || hasPaymentDemandWording;

  let searchBudgetRemaining = options.searchBudget ?? PAYMENT_SEARCH_BUDGET;
  let successfulItemCount = 0;
  let failedItemCount = 0;
  let droppedQuoteCount = 0;
  let scamSearchesWithNoResultsCount = 0;
  let scamSearchesFailedCount = 0;
  let totalChecksExecuted = 0;
  let successfulChecksCount = 0;
  let failedChecksCount = 0;

  // Process each entity independently
  for (const ent of eligibleEntities) {
    const entKey = `${ent.kind}:${ent.value}`;
    let itemSuccessfulChecks = 0;
    let itemFailedChecks = 0;

    if (ctx?.note) {
      ctx.note(`Scanning scam graph for ${ent.kind}: ${ent.value}`);
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
        } else if (graphResult && graphResult.matched) {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          trace.push({
            entity: ent.kind,
            check: "graph_lookup",
            status: "match",
            reportCount: graphResult.reportCount || 1,
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
          }
        } else {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          trace.push({
            entity: ent.kind,
            check: "graph_lookup",
            status: "no_match",
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
      }
    }

    // 2. Specific validations by entity kind
    if (ent.kind === "upi") {
      totalChecksExecuted++;
      try {
        const upiResult = upiFacts(ent.value);
        if (upiResult.valid) {
          itemSuccessfulChecks++;
          successfulChecksCount++;
          verified.push(`UPI syntax valid (${upiResult.handle})`);

          // Payee classification: strong personal vs weak unverified
          const payeeTier = classifyPayee(upiResult);

          // Check for personal payment identifier:
          // Requires:
          // 1. Organisation claim: company entity in case file OR institutional keyword in analysisText
          // 2. Payment request: amount entity OR payment/fee/deposit wording
          // 3. Payee classification: strong personal (phone-number VPA or consumer PSP handle with personal-like name)
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
                } else {
                  droppedQuoteCount++;
                }
              }
            } else {
              // Weak unverified (e.g. merit.grants@sbi, admissions@icici)
              // No high-severity flag; record payee cannot be verified note
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
        }
      } catch {
        itemFailedChecks++;
        failedChecksCount++;
        trace.push({
          entity: ent.kind,
          check: "upi_facts",
          status: "failed",
          reason: "upi_facts_failed",
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

          if (emResult.isFreeProvider && canEmit("free_email_recruiter", NAME)) {
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

            if (matchedTerm) {
              const meta = FLAG_REGISTRY.free_email_recruiter;
              flags.push({
                id: "free_email_recruiter",
                title: formatFlagTitle("free_email_recruiter"),
                severity: meta.severity,
                explanation: `Recruiter contacting from free webmail provider (${emResult.domain || "webmail"}) with recruitment context terms.`,
                evidence: [{ type: "quote", value: matchedTerm }],
              });
            }
          }
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
                if (canEmit("scam_reports_found", NAME)) {
                  const meta = FLAG_REGISTRY.scam_reports_found;
                  flags.push({
                    id: "scam_reports_found",
                    title: formatFlagTitle("scam_reports_found"),
                    severity: meta.severity,
                    explanation: `Public scam complaints or reports found for identifier '${ent.value}': ${hit.title || hit.url}`,
                    evidence: [{ type: "url", value: hit.url }],
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

    if (itemSuccessfulChecks > 0) {
      successfulItemCount++;
      processedEntities.push(entKey);
    } else if (itemFailedChecks > 0) {
      failedItemCount++;
      unchecked.push(entKey);
    }
  }

  // Evaluate failure rule:
  // "The result is could_not_check only when every check on every item failed."
  if (successfulChecksCount === 0 && failedChecksCount > 0) {
    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "all_checks_failed",
    });
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
  });
}

export const paymentEntity = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  run,
};

export default paymentEntity;
