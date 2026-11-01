/**
 * lib/agents/reputation-osint.js
 *
 * Reputation / OSINT Specialist Agent for Layer L4.
 *
 * Rules:
 * - Deterministic canRun(snapshot): synchronous, no I/O, no LLM. True only if there is
 *   at least one unprocessed company, domain, handle, or youtube_url entity.
 * - Injected dependencies: { search, youtubeComments, generate, now }.
 * - Dorks are built in code from entity values with operators stripped/escaped.
 * - Searches are strictly bounded by REPUTATION_SEARCH_BUDGET (6) across all items.
 * - For scam_reports_found:
 *     1. Code requires the entity value to appear in title or snippet.
 *     2. A REPUTATION_SCAM_WORDS term must appear within REPUTATION_PROXIMITY_CHARS (120) of it.
 *     3. One generate() call wrapped in wrapUntrusted disambiguates whether surviving results
 *        are about the same entity.
 *     4. Flag is emitted ONLY for results judged 'yes' with the result URL as evidence.
 *     5. Explanation uses neutral wording, never asserts the entity is a scammer.
 *     6. If LLM call fails, emits nothing from search and records llm_unavailable in trace.
 * - youtube_url items:
 *     - If tool absent: trace item 'tool_unavailable', no flag, no failure.
 *     - If key missing: trace item 'not_configured', no flag, no failure.
 *     - If heuristic crosses YOUTUBE_BURST_THRESHOLD: emit review_burst with video URL as evidence.
 * - copied_content: not emitted since input entities in L4 do not provide distinctive quoted text.
 * - Adds a Trustpilot manual_check entry in trace and manualChecks for company and domain items.
 * - Returns newEntities: [].
 * - Status is could_not_check ONLY if every eligible item failed (not_configured/tool_unavailable
 *   items do not count as failed).
 * - "No reports found" produces an ok result with notes 'no reports found, not a safety guarantee',
 *   and empty flags and empty verified arrays.
 * - Failure reasons are fixed codes and never contain entity values, URLs, or message text.
 */

import { z } from "zod";
import { FLAG_REGISTRY, canEmit } from "../contracts/flags.js";
import { wrapUntrusted, generate as defaultGenerate } from "../llm/generate.js";
import { search as defaultSearch } from "../tools/search.js";
import {
  sanitizeQueryText,
  buildScamQuery,
  buildRedditQuery,
  buildComplaintSitesQuery,
  buildMinusSiteQuery,
} from "../tools/dorks.js";
import {
  REPUTATION_SEARCH_BUDGET,
  REPUTATION_SCAM_WORDS,
  REPUTATION_PROXIMITY_CHARS,
  YOUTUBE_BURST_THRESHOLD,
  BIG_BRANDS,
  OFFICIAL_BODIES_AND_PORTALS,
} from "./config.js";
import { isGovIn } from "../tools/domain.js";
import { findCuratedOfficialDomain } from "./official-verifier.js";
import { classifySource } from "../evidence/source-classifier.js";
import {
  getCheckId,
  getRound,
  safeToolCall,
  buildOkResult,
  buildCouldNotCheckResult,
  buildSkippedResult,
  buildCompleteEntityStatus,
} from "./base.js";
import { createActivityRecorder } from "./activity.js";

export const NAME = "reputation_osint";
export const KIND = "check";

export const OSINT_OVERALL_BUDGET_MS = 18000;
export const OSINT_PER_QUERY_TIMEOUT_MS = 5000;

export const ELIGIBLE_KINDS = Object.freeze([
  "company",
  "domain",
  "handle",
  "youtube_url",
  "scheme",
]);

export const GENERIC_GOV_NAMES = new Set([
  "government of india",
  "india government",
  "central government",
  "state government",
  "department of higher education",
  "ministry of education",
  "pib",
  "nsp",
  "ugc",
  "aicte",
]);

function timeoutPromise(ms) {
  return new Promise((_, reject) => {
    const err = new Error(`Operation timed out after ${ms}ms`);
    err.code = "TIMEOUT";
    setTimeout(() => reject(err), ms);
  });
}

const SingleJudgementSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const url = raw.resultUrl || raw.url || raw.result_url || raw.link || "";
    let same = raw.aboutSameEntity ?? raw.about_same_entity ?? raw.sameEntity ?? raw.same_entity ?? raw.isSameEntity;
    if (typeof same === "boolean") {
      same = same ? "yes" : "no";
    } else if (typeof same === "string") {
      const lower = same.trim().toLowerCase();
      if (lower === "true" || lower === "yes") same = "yes";
      else if (lower === "false" || lower === "no") same = "no";
      else if (lower === "unclear" || lower === "maybe" || lower === "unknown") same = "unclear";
    }
    const reason = raw.reason || raw.explanation || raw.detail || undefined;
    return {
      resultUrl: String(url),
      aboutSameEntity: same,
      reason: typeof reason === "string" ? reason : undefined,
    };
  },
  z.object({
    resultUrl: z.string(),
    aboutSameEntity: z.enum(["yes", "no", "unclear"]),
    reason: z.string().optional(),
  })
);

export const DisambiguationJudgementsSchema = z.preprocess(
  (val) => {
    if (Array.isArray(val)) {
      return { judgements: val };
    }
    if (val && typeof val === "object") {
      const list = val.judgements || val.results || val.items || val.evaluations || val.judgments;
      if (Array.isArray(list)) {
        return { judgements: list };
      }
    }
    return val;
  },
  z.object({
    judgements: z.array(SingleJudgementSchema),
  })
);

/**
 * Formats a flag ID into Title Case.
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

/**
 * Hiring and recruitment keywords commonly used in social media lookalike handles.
 */
export const HIRING_KEYWORDS = Object.freeze([
  "careers",
  "career",
  "hr",
  "jobs",
  "job",
  "official",
  "recruitment",
  "recruit",
  "recruiter",
  "hiring",
]);

/**
 * Splits a handle into normalized lowercase tokens by punctuation, numbers, and camelCase transitions.
 *
 * @param {string} handle
 * @returns {string[]}
 */
export function tokenizeHandle(handle) {
  if (!handle || typeof handle !== "string") return [];
  let clean = handle.replace(/^@+/, "").trim();
  clean = clean.replace(/([a-z])([A-Z])/g, "$1 $2");
  return clean
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

/**
 * Checks if any token from a handle matches an established brand or company entity in the snapshot.
 *
 * @param {string[]} tokens
 * @param {object} snapshot
 * @returns {string|null} The matched brand name or null
 */
export function findMatchingBrand(tokens, snapshot) {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;

  const companyTokens = new Set();
  if (Array.isArray(snapshot?.entities)) {
    for (const e of snapshot.entities) {
      if (e && e.kind === "company" && typeof e.value === "string") {
        const val = e.value.trim().toLowerCase();
        companyTokens.add(val);
        const sub = val.split(/[^a-zA-Z0-9]+/).filter((t) => t.length >= 2);
        for (const s of sub) {
          if (!["pvt", "ltd", "private", "limited", "inc", "corp", "llc", "group", "technologies", "tech", "solutions"].includes(s)) {
            companyTokens.add(s);
          }
        }
      }
    }
  }

  for (const token of tokens) {
    if (companyTokens.has(token)) {
      return token;
    }
    if (BIG_BRANDS.has(token)) {
      return token;
    }
  }
  return null;
}

/**
 * Checks if an entity is an official body, statutory authority, official portal,
 * major bank, or verified official (.gov.in or curated registry).
 *
 * @param {object} ent
 * @returns {boolean}
 */
export function isOfficialOrProtectedEntity(ent, snapshot = null) {
  if (!ent || typeof ent.value !== "string") return false;
  const val = ent.value.trim().toLowerCase();
  if (OFFICIAL_BODIES_AND_PORTALS.has(val) || BIG_BRANDS.has(val)) {
    return true;
  }
  if (ent.kind === "domain" || ent.kind === "url") {
    let host = val;
    try {
      if (ent.kind === "url") {
        host = new URL(val).hostname.toLowerCase();
      }
    } catch {}
    if (isGovIn(host) || findCuratedOfficialDomain(host) !== null) {
      return true;
    }
  }
  if (ent.orgType === "government") {
    return true;
  }
  if (ent.kind === "scheme") {
    if (snapshot && Array.isArray(snapshot.entities)) {
      const hasVerifiedDomain = snapshot.entities.some((e) => {
        if (!e || typeof e.value !== "string") return false;
        if (e.kind === "domain" || e.kind === "url") {
          let host = e.value.toLowerCase().trim();
          try {
            if (e.kind === "url") host = new URL(e.value).hostname.toLowerCase();
          } catch {}
          return isGovIn(host) || findCuratedOfficialDomain(host) !== null;
        }
        return false;
      });
      if (hasVerifiedDomain) return true;
    }
  }
  return false;
}

/**
 * Composes a concise, factual 1-sentence activity summary (max 160 characters).
 *
 * @param {object} params
 * @returns {string}
 */
export function buildOsintSummary({
  entities = [],
  flags = [],
  brandContextNotes = [],
  entityOsintStates = new Map(),
  hasHandleLookalike = false,
  hasHandle = false,
  hasSearchBudgetExhausted = false,
  hasYoutubeUnconfigured = false,
  hasLlmFailure = false,
}) {
  const targetDescriptions = [];
  const companiesCount = entities.filter((e) => e.kind === "company").length;
  const schemesCount = entities.filter((e) => e.kind === "scheme").length;
  const domainsCount = entities.filter((e) => e.kind === "domain").length;
  const handlesCount = entities.filter((e) => e.kind === "handle").length;
  const ytCount = entities.filter((e) => e.kind === "youtube_url").length;

  if (companiesCount > 0) targetDescriptions.push(companiesCount === 1 ? "the company" : `${companiesCount} companies`);
  if (schemesCount > 0) targetDescriptions.push(schemesCount === 1 ? "the scheme" : `${schemesCount} schemes`);
  if (domainsCount > 0) targetDescriptions.push(domainsCount === 1 ? "1 domain" : `${domainsCount} domains`);
  if (handlesCount > 0) targetDescriptions.push(handlesCount === 1 ? "1 handle" : `${handlesCount} handles`);
  if (ytCount > 0) targetDescriptions.push(ytCount === 1 ? "1 video link" : `${ytCount} video links`);

  const targetsStr = targetDescriptions.length > 0 ? targetDescriptions.join(" and ") : "targets";
  const intro = `Searched web for ${targetsStr}`;

  const findingsParts = [];
  const hasScamReports = flags.some((f) => f.id === "scam_reports_found");
  const hasReviewBurst = flags.some((f) => f.id === "review_burst");

  const statesList = entityOsintStates && entityOsintStates.size > 0
    ? Array.from(new Set(entityOsintStates.values()))
    : [];
  const hasTimedOut = statesList.includes("search_timed_out");
  const hasUnavailable = statesList.includes("search_unavailable");
  const hasSupporting = statesList.includes("supporting_evidence_found");

  if (hasScamReports) {
    findingsParts.push("found public scam complaints matching this offer");
  } else if (brandContextNotes.length > 0) {
    findingsParts.push("no reports specific to this offer");
  } else if (hasLlmFailure) {
    findingsParts.push("disambiguation could not complete for candidate reports");
  } else if (hasSupporting) {
    findingsParts.push("supporting evidence found (not proof of legitimacy)");
  } else if (hasTimedOut && !hasUnavailable) {
    findingsParts.push("search timed out");
  } else if (hasUnavailable && !hasTimedOut) {
    findingsParts.push("search unavailable");
  } else if (hasTimedOut && hasUnavailable) {
    findingsParts.push("search unavailable or timed out");
  } else {
    findingsParts.push("no reports found (not a safety guarantee)");
  }

  if (hasHandleLookalike) {
    findingsParts.push("handle looks like a branded recruiter account");
  }
  if (hasReviewBurst) {
    findingsParts.push("detected suspicious comment review burst");
  }

  if (hasHandle) {
    findingsParts.push("could not check the profile itself");
  } else if (hasSearchBudgetExhausted) {
    findingsParts.push("search budget reached for some items");
  } else if (hasYoutubeUnconfigured) {
    findingsParts.push("video comments could not be inspected");
  }

  const sentence = `${intro}: ${findingsParts.join("; ")}.`;
  return sentence.length <= 160 ? sentence : sentence.slice(0, 157).trim() + "...";
}

/**
 * Checks whether text contains an entity value within proximity of any scam word.
 *
 * @param {string} text Full searchable text (title + snippet)
 * @param {string} entityValue The entity string to find
 * @param {readonly string[]} scamWords Words denoting scam/fraud/complaint
 * @param {number} proximityLimit Maximum character distance
 * @returns {boolean}
 */
export function isNearScamWord(text, entityValue, scamWords, proximityLimit) {
  if (!text || !entityValue || typeof text !== "string" || typeof entityValue !== "string") {
    return false;
  }

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
 * Returns the set of processed entity keys for reputation_osint from snapshot.
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
 * Returns unprocessed entities eligible for reputation_osint.
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
 * Deterministic eligibility check (synchronous, no I/O, no LLM).
 * True only if at least one unprocessed eligible entity exists.
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
  const hasEligibleKind = snapshot.entities.some(
    (e) => e && ELIGIBLE_KINDS.includes(e.kind)
  );
  if (!hasEligibleKind) {
    return "no_eligible_entities";
  }
  return "all_entities_processed";
}

/**
 * Runs the Reputation / OSINT Agent on the snapshot.
 *
 * @param {object} snapshot
 * @param {object} [deps] Injected dependencies for testing
 * @param {Function} [deps.search]
 * @param {Function} [deps.youtubeComments]
 * @param {Function} [deps.generate]
 * @param {Function} [deps.now]
 * @param {object} [options]
 * @returns {Promise<import("../contracts/agent-result.js").AgentResult>}
 */
export async function run(snapshot, deps = {}, options = {}) {
  const nowFn = deps.now || (() => new Date().getTime());
  const toEpoch = (v) => {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const parsed = new Date(v).getTime();
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  };
  const startTime = toEpoch(nowFn());
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);

  const isTimeExpired = () => toEpoch(nowFn()) - startTime > OSINT_OVERALL_BUDGET_MS;

  const activity = deps.activity || deps.recorder || createActivityRecorder({
    agent: NAME,
    round,
    nowFn,
  });

  if (!canRun(snapshot)) {
    const durationMs = Math.max(0, nowFn() - startTime);
    const reason = skippedReason(snapshot) || "no_eligible_entities";
    activity.setSummary(`Check skipped: ${reason}`);
    return buildSkippedResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason,
      summary: activity.getSummary(),
      activity: activity.getEntries(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
      durationMs,
    });
  }

  const searchFn = deps.search || defaultSearch;
  const generateFn = deps.generate || defaultGenerate;
  const ytToolFn = deps.youtubeComments || null;
  const ctx = deps.ctx;

  if (ctx?.note) {
    ctx.note("Investigating reputation across public reports and platforms");
  }

  const eligibleEntities = getEligibleUnprocessedEntities(snapshot);
  if (eligibleEntities.length === 0) {
    const reason = skippedReason(snapshot) || "no_eligible_entities";
    activity.setSummary(`Check skipped: ${reason}`);
    return buildSkippedResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason,
      summary: activity.getSummary(),
      activity: activity.getEntries(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
      durationMs: Math.max(0, nowFn() - startTime),
    });
  }

  const flags = [];
  const processedEntities = [];
  const unchecked = [];
  const manualChecks = [];
  const trace = [];
  const brandContextNotes = [];
  const entityStatuses = [];
  const entityOsintStates = new Map();

  let searchCallsCount = 0;
  let eligibleEvaluatedCount = 0;
  let successfulItemCount = 0;
  let failedItemCount = 0;

  const survivingCandidateResults = [];

  // Collect specific suspicious/non-official offer identifiers (domain, handle, upi, phone) from snapshot
  const specificIdentifiers = [];
  const specificGovEntities = [];
  if (Array.isArray(snapshot?.entities)) {
    for (const e of snapshot.entities) {
      if (!e || typeof e.value !== "string") continue;
      const val = e.value.trim().toLowerCase();
      if (e.kind === "domain") {
        const isOfficial = isGovIn(val) || findCuratedOfficialDomain(val) !== null;
        if (!isOfficial && val.length >= 3) {
          specificIdentifiers.push(val);
        }
      } else if (e.kind === "handle" || e.kind === "upi" || e.kind === "phone") {
        if (val.length >= 3) {
          specificIdentifiers.push(val);
        }
      }
      if (
        e.kind === "company" &&
        (val.includes("department of") || val.includes("ministry of") || val.includes("dept of"))
      ) {
        specificGovEntities.push(val);
      }
    }
  }

  for (const ent of eligibleEntities) {
    const entKey = `${ent.kind}:${ent.value}`;

    if (isTimeExpired()) {
      activity.limit({
        title: "OSINT time limit reached",
        detail: "Investigation reached 18-second time budget. Remaining items left unchecked.",
      });
      failedItemCount++;
      unchecked.push(`${entKey}: time budget reached`);
      continue;
    }

    // Record activity input
    if (ent.kind === "company") {
      activity.input({ title: `Company to search: ${ent.value}`, tool: "search" });
    } else if (ent.kind === "domain") {
      activity.input({ title: `Domain to search: ${ent.value}`, tool: "search" });
    } else if (ent.kind === "handle") {
      activity.input({ title: `Handle to analyze: ${ent.value}`, tool: "search" });
    } else if (ent.kind === "youtube_url") {
      activity.input({ title: `YouTube video link: ${ent.value}`, tool: "search" });
    } else if (ent.kind === "scheme") {
      activity.input({ title: `Scheme to search: ${ent.value}`, tool: "search" });
    }

    if (ent.kind === "youtube_url") {
      if (!ytToolFn) {
        trace.push({
          item: `youtube_comments:${ent.value}`,
          status: "skipped",
          detail: "not_configured",
        });
        activity.limit({
          title: "YouTube tool not configured",
          detail: "YouTube Data API credentials not configured; video comments could not be inspected.",
        });
        processedEntities.push(entKey);
        continue;
      }

      eligibleEvaluatedCount++;
      let ytRes;
      try {
        ytRes = await ytToolFn(ent.value, { timeoutMs: 5000 });
      } catch {
        ytRes = { ok: false, error: { code: "UPSTREAM_ERROR", message: "YouTube lookup error" } };
      }

      if (!ytRes.ok) {
        if (ytRes.error?.code === "NO_KEY") {
          trace.push({
            item: `youtube_comments:${ent.value}`,
            status: "skipped",
            detail: "not_configured",
          });
          activity.limit({
            title: "YouTube tool not configured",
            detail: "YouTube Data API credentials not configured; video comments could not be inspected.",
          });
          eligibleEvaluatedCount--;
        } else {
          failedItemCount++;
          trace.push({
            item: `youtube_comments:${ent.value}`,
            status: "failed",
            detail: ytRes.error?.code || "UPSTREAM_ERROR",
          });
        }
      } else {
        successfulItemCount++;
        const burstRatio = ytRes.data?.burstRatio ?? ytRes.data?.heuristics?.burstRatio ?? 0;
        const isBurst =
          ytRes.data?.reviewBurst === true ||
          ytRes.data?.heuristics?.reviewBurst === true ||
          (typeof burstRatio === "number" && burstRatio >= YOUTUBE_BURST_THRESHOLD);

        trace.push({
          item: `youtube_comments:${ent.value}`,
          status: "ok",
          detail: isBurst ? "burst_detected" : "normal",
        });

        if (isBurst && canEmit("review_burst", NAME)) {
          const existingBurst = flags.find((f) => f.id === "review_burst");
          if (existingBurst) {
            if (!existingBurst.evidence.some((e) => e.value === ent.value)) {
              existingBurst.evidence.push({ type: "url", value: ent.value });
            }
          } else {
            flags.push({
              id: "review_burst",
              title: formatFlagTitle("review_burst"),
              severity: FLAG_REGISTRY.review_burst?.severity || "medium",
              explanation: "Suspicious temporal burst of similar or repetitive comments detected on YouTube video link.",
              evidence: [{ type: "url", value: ent.value }],
            });
            activity.finding({
              title: "Suspicious YouTube comment review burst",
              detail: "Suspicious temporal burst of similar or repetitive comments detected on YouTube video link.",
              flagId: "review_burst",
              sources: [{ label: "YouTube Video", url: ent.value }],
            });
          }
        }
      }

      processedEntities.push(entKey);
      continue;
    }

    // Handle analysis (deterministic, no platform scraping)
    if (ent.kind === "handle") {
      const handleTokens = tokenizeHandle(ent.value);
      const matchedBrand = findMatchingBrand(handleTokens, snapshot);
      const matchedHiring = handleTokens.filter((t) => HIRING_KEYWORDS.includes(t));

      if (matchedBrand && matchedHiring.length > 0 && canEmit("brand_handle_lookalike", NAME)) {
        const existingLookalike = flags.find((f) => f.id === "brand_handle_lookalike");
        if (!existingLookalike) {
          flags.push({
            id: "brand_handle_lookalike",
            title: formatFlagTitle("brand_handle_lookalike"),
            severity: FLAG_REGISTRY.brand_handle_lookalike?.severity || "medium",
            explanation: `Social media or messaging handle "${ent.value}" mimics brand "${matchedBrand}" combined with recruitment keywords (${matchedHiring.join(", ")}), but is not verified as an authentic company account.`,
            evidence: [{ type: "quote", value: ent.value }],
          });
          activity.finding({
            title: "Brand handle lookalike detected",
            detail: `Handle "${ent.value}" mimics brand "${matchedBrand}" with recruitment keywords (${matchedHiring.join(", ")})`,
            flagId: "brand_handle_lookalike",
          });
        }
      }

      // Always add limit and manual steps for social handles
      activity.limit({
        title: "Social media profile limitation",
        detail: "Instagram, Facebook and LinkedIn profiles cannot be checked automatically.",
      });

      activity.manual({
        title: "Verify social handle profile manually",
        detail: "Check for verified badge, account age and first posts, followers versus the real brand, links in the bio, and whether the company's own website lists this handle.",
      });

      manualChecks.push({
        label: `Manual profile check for ${ent.value} (verified badge, account age, bio links)`,
        url: `https://www.google.com/search?q=${encodeURIComponent(ent.value)}`,
      });
    }

    // company, domain, or handle
    eligibleEvaluatedCount++;

    // Check budget limit before attempting queries for this item
    if (searchCallsCount >= REPUTATION_SEARCH_BUDGET) {
      unchecked.push(entKey);
      trace.push({
        item: `search_budget_exhausted:${entKey}`,
        status: "skipped",
        detail: "budget_limit",
      });
      activity.limit({
        title: "Search budget exhausted",
        detail: "Search budget limit reached; remaining items left unchecked to prevent quota exhaustion.",
      });
      continue;
    }

    if (ent.kind === "company" || ent.kind === "domain") {
      const lowerCompany = ent.value.trim().toLowerCase();
      const isGovOrEdu =
        ent.orgType === "government" ||
        ent.orgType === "education" ||
        GENERIC_GOV_NAMES.has(lowerCompany);

      if (!isGovOrEdu) {
        const cleanTarget = sanitizeQueryText(ent.value);
        const trustpilotUrl = `https://www.trustpilot.com/search?query=${encodeURIComponent(cleanTarget)}`;
        manualChecks.push({
          label: `Trustpilot review search for ${cleanTarget}`,
          url: trustpilotUrl,
        });
        trace.push({
          item: `manual_check:trustpilot:${ent.value}`,
          status: "ok",
          detail: trustpilotUrl,
        });
      }
    }

    const cleanVal = sanitizeQueryText(ent.value);
    const queries = [];
    if (ent.kind === "company") {
      const lowerCompany = ent.value.trim().toLowerCase();
      const isGenericGov =
        ent.orgType === "government" ||
        GENERIC_GOV_NAMES.has(lowerCompany);

      if (isGenericGov) {
        activity.step({
          title: `Skipping generic authority search: ${ent.value}`,
          detail: `Generic government authority names are not queried standalone in OSINT to avoid false generic scam matches.`,
          tool: "search",
          status: "info",
        });
        processedEntities.push(entKey);
        successfulItemCount++;
        continue;
      }

      const q1 = buildScamQuery(cleanVal);
      const q2 = buildRedditQuery(cleanVal);
      const q3 = buildComplaintSitesQuery(cleanVal);
      if (q1) queries.push(q1);
      if (q2) queries.push(q2);
      if (q3) queries.push(q3);
    } else if (ent.kind === "scheme") {
      const qScheme = `"${cleanVal}" fake OR scam OR fraud OR "PIB"`;
      queries.push(qScheme);
    } else if (ent.kind === "domain") {
      const q1 = buildMinusSiteQuery(cleanVal, cleanVal);
      const q2 = buildRedditQuery(cleanVal);
      if (q1) queries.push(q1);
      if (q2) queries.push(q2);
    } else if (ent.kind === "handle") {
      const q1 = buildScamQuery(cleanVal);
      if (q1) queries.push(q1);
    }

    let itemHadSuccess = false;
    let itemHadTimeout = false;
    let itemAttempts = 0;
    let totalResultsCount = 0;
    let hasAuthoritativeMentions = false;

    for (const query of queries) {
      if (isTimeExpired()) {
        itemHadTimeout = true;
        activity.limit({
          title: "OSINT time limit reached",
          detail: "Investigation reached 18-second time budget. Query skipped.",
        });
        trace.push({
          item: `timeout:${query}`,
          status: "skipped",
          detail: "time_budget_reached",
        });
        break;
      }

      if (searchCallsCount >= REPUTATION_SEARCH_BUDGET) {
        trace.push({
          item: `search_budget_exhausted:${query}`,
          status: "skipped",
          detail: "budget_limit",
        });
        activity.limit({
          title: "Search budget exhausted",
          detail: "Search budget limit reached; remaining items left unchecked to prevent quota exhaustion.",
        });
        break;
      }

      searchCallsCount++;
      itemAttempts++;

      const sRes = await safeToolCall(
        () => Promise.race([
          searchFn(query, {
            timeoutMs: OSINT_PER_QUERY_TIMEOUT_MS,
            context: { checkId },
          }),
          timeoutPromise(OSINT_PER_QUERY_TIMEOUT_MS),
        ]),
        "UPSTREAM_ERROR"
      );

      if (sRes.ok) {
        itemHadSuccess = true;
        const results = Array.isArray(sRes.data?.results) ? sRes.data.results : [];
        totalResultsCount += results.length;
        trace.push({
          item: `search:${query}`,
          status: "ok",
          detail: `results:${results.length}`,
        });

        const keptForQuery = [];

        for (const r of results) {
          if (!r.url || !r.title) continue;

          try {
            const h = new URL(r.url).hostname.toLowerCase();
            if (h.endsWith(".gov.in") || h.endsWith(".nic.in")) {
              hasAuthoritativeMentions = true;
            }
          } catch {}

          // Free-tier dorks do not use -site:; filter excluded host in code
          if (ent.kind === "domain") {
            try {
              const parsed = new URL(r.url);
              const host = parsed.hostname.toLowerCase();
              const target = ent.value.toLowerCase().trim();
              if (host === target || host.endsWith("." + target)) {
                continue;
              }
            } catch {
              // ignore URL parsing error
            }
          }

          const combinedText = `${r.title} ${r.snippet || ""}`;
          const lowerCombined = combinedText.toLowerCase();

          // Government / Scheme relevance check:
          // Scheme entity must match ONLY on the full scheme name;
          // Government organization must match on a specific ministry or department name;
          // Generic scam articles go to context note, never flags.
          if (ent.kind === "scheme") {
            const schemeWithoutYear = cleanVal.toLowerCase().replace(/\s+20\d{2}$/, "").trim();
            const hasSchemeName =
              cleanVal &&
              (lowerCombined.includes(cleanVal.toLowerCase()) ||
                (schemeWithoutYear.length >= 10 && lowerCombined.includes(schemeWithoutYear)));

            if (!hasSchemeName) {
              brandContextNotes.push(ent.value);
              trace.push({
                item: `scheme_context:${ent.value}`,
                status: "ok",
                detail: `no_full_scheme_name:${r.url.slice(0, 40)}`,
              });
              continue;
            }
          } else if (ent.orgType === "government") {
            const specificDeptMatches = specificGovEntities.filter((dept) =>
              (dept.startsWith("ministry of") || dept.startsWith("department of") || dept.includes("dept of")) &&
              dept.length >= 8 &&
              lowerCombined.includes(dept)
            );

            if (specificDeptMatches.length === 0) {
              brandContextNotes.push(ent.value);
              trace.push({
                item: `gov_context:${ent.value}`,
                status: "ok",
                detail: `generic_gov_scam_article:${r.url.slice(0, 40)}`,
              });
              continue;
            }
          }

          if (isNearScamWord(combinedText, ent.value, REPUTATION_SCAM_WORDS, REPUTATION_PROXIMITY_CHARS)) {
            const lowerText = combinedText.toLowerCase();
            const hasSpecificIdentifier = specificIdentifiers.some((ident) => lowerText.includes(ident));

            // Source quality check:
            // Forum/Q&A results (Quora, Reddit) and caller-ID aggregators are context only
            // unless they match a specific suspicious identifier from this check.
            const sourceClf = classifySource(r.url, r.title, r.snippet || "");
            if ((sourceClf.type === "forum" || sourceClf.type === "aggregator") && !hasSpecificIdentifier) {
              brandContextNotes.push(ent.value);
              trace.push({
                item: `forum_context:${ent.value}`,
                status: "ok",
                detail: `${sourceClf.type}:${r.url.slice(0, 40)}`,
              });
              continue;
            }

            // Check relevance for official bodies, portals, and big brands:
            // Scam-report results about the brand or portal are context only and never raise scam_reports_found;
            // only identifier-specific matches (the exact suspicious domain, UPI ID, phone or handle) can.
            // Advisories about impersonators must not count against the real portal.
            const isProtected = isOfficialOrProtectedEntity(ent, snapshot);
            if (isProtected) {
              if (!hasSpecificIdentifier) {
                // Advisory about impersonators / generic warning: goes into context notes, never a flag
                brandContextNotes.push(ent.value);
                trace.push({
                  item: `official_context:${ent.value}`,
                  status: "ok",
                  detail: `advisory_or_generic_warning:${r.url.slice(0, 40)}`,
                });
                continue;
              }
            }

            keptForQuery.push(r);
            survivingCandidateResults.push({
              entityName: ent.value,
              entityKind: ent.kind,
              entityKey: entKey,
              url: r.url,
              title: r.title,
              snippet: r.snippet || "",
            });
          }
        }

        const droppedCount = results.length - keptForQuery.length;
        activity.step({
          title: "Web intelligence search",
          detail: `Query: ${query} - ${results.length} result(s) returned, ${keptForQuery.length} kept after relevance filter, ${droppedCount} dropped`,
          tool: "search",
          status: "ok",
        });
      } else {
        if (sRes.error?.code === "TIMEOUT" || sRes.error?.code === "timeout") {
          itemHadTimeout = true;
        }
        trace.push({
          item: `search:${query}`,
          status: "failed",
          detail: sRes.error?.code || "UPSTREAM_ERROR",
        });
        activity.step({
          title: "Web search failed",
          detail: `Query: ${query} failed: ${sRes.error?.code || "UPSTREAM_ERROR"}`,
          tool: "search",
          status: "failed",
        });
      }
    }

    let osintState = "no_relevant_results";
    if (itemAttempts > 0 && !itemHadSuccess) {
      failedItemCount++;
      osintState = itemHadTimeout ? "search_timed_out" : "search_unavailable";
      unchecked.push(`${entKey}: ${osintState}`);
      entityStatuses.push({
        entityKind: ent.kind,
        entityValue: ent.value,
        status: "could_not_check",
        reason: osintState,
      });
      activity.step({
        title: `OSINT result: ${ent.value}`,
        detail: `OSINT status: ${osintState}`,
        tool: "rules",
        status: "failed",
      });
    } else if (itemHadSuccess) {
      successfulItemCount++;
      processedEntities.push(entKey);
      if (totalResultsCount === 0) {
        osintState = "no_relevant_results";
      } else if (hasAuthoritativeMentions) {
        osintState = "supporting_evidence_found";
      } else {
        osintState = "no_negative_reports_found";
      }
      activity.step({
        title: `OSINT result: ${ent.value}`,
        detail: `OSINT status: ${osintState}`,
        tool: "rules",
        status: "ok",
      });
      entityStatuses.push({
        entityKind: ent.kind,
        entityValue: ent.value,
        status: osintState === "supporting_evidence_found" ? "unverified" : "checked_no_issue",
        ...(osintState === "supporting_evidence_found"
          ? { reason: "Supporting evidence found in public sources (never presented as proof of legitimacy)" }
          : {}),
      });
    }
    entityOsintStates.set(entKey, osintState);
  }

  // LLM Disambiguation across surviving results
  if (survivingCandidateResults.length > 0) {
    // Deduplicate candidate results by URL
    const uniqueCandidates = [];
    const seenUrls = new Set();
    for (const cand of survivingCandidateResults) {
      if (!seenUrls.has(cand.url)) {
        seenUrls.add(cand.url);
        uniqueCandidates.push(cand);
      }
    }

    for (const cand of uniqueCandidates) {
      cand.read = true;
      if (ctx?.note) {
        ctx.note(`Evaluating public report from ${cand.url.slice(0, 50)}`);
      }
    }

    const snippetsText = uniqueCandidates
      .map(
        (c, idx) =>
          `Result [${idx + 1}]:\nURL: ${c.url}\nTitle: ${c.title}\nSnippet: ${c.snippet}\nTarget Entity: ${c.entityName} (${c.entityKind})`
      )
      .join("\n\n");

    const promptText =
      `Target entities under check: ${Array.from(new Set(uniqueCandidates.map((c) => c.entityName))).join(", ")}\n\n` +
      wrapUntrusted("SEARCH_RESULTS", snippetsText) +
      `\n\nFor each search result above, evaluate whether the complaint or scam report is genuinely about the target entity under check, or about an unrelated third party with a similar or common name.\n\n` +
      `Return strictly valid JSON matching this schema:\n` +
      `{\n` +
      `  "judgements": [\n` +
      `    {\n` +
      `      "resultUrl": "exact URL from search result",\n` +
      `      "aboutSameEntity": "yes" | "no" | "unclear",\n` +
      `      "reason": "concise explanation"\n` +
      `    }\n` +
      `  ]\n` +
      `}\n` +
      `aboutSameEntity MUST be exactly one of: "yes" (the complaint directly accuses the target entity), "no" (the report discusses an unrelated party, impersonator, or generic warning), or "unclear".`;

    let genRes;
    try {
      genRes = await generateFn({
        system:
          "You are an OSINT reputation analysis assistant. For each search result snippet, determine if the scam or fraud complaint specifically discusses the target entity, or an unrelated entity that shares a generic name. Return strictly valid JSON with a 'judgements' array where aboutSameEntity is 'yes', 'no', or 'unclear'.",
        prompt: promptText,
        schema: DisambiguationJudgementsSchema,
        timeoutMs: 15000,
        purpose: "reputation_disambiguation",
      });
    } catch {
      genRes = { ok: false, error: { code: "UPSTREAM_ERROR", message: "LLM generation error" } };
    }

    if (!genRes.ok) {
      trace.push({
        item: "llm_disambiguation",
        status: "failed",
        detail: "llm_unavailable",
      });

      activity.step({
        title: "Disambiguation failed",
        detail: "Language model could not evaluate complaint relevance due to upstream service failure",
        tool: "llm",
        status: "failed",
      });

      // Disambiguation failed after retry. Mark the entities involved as unchecked.
      const candidateEntityKeys = new Set(uniqueCandidates.map((c) => c.entityKey));
      for (const eKey of candidateEntityKeys) {
        if (!unchecked.includes(eKey)) {
          unchecked.push(eKey);
        }
        const idx = processedEntities.indexOf(eKey);
        if (idx !== -1) {
          processedEntities.splice(idx, 1);
        }
      }

      // If every eligible item failed (or was lost to disambiguation failure), return could_not_check
      if (processedEntities.length === 0) {
        activity.setSummary("Could not complete check: disambiguation_failed");
        return buildCouldNotCheckResult({
          agent: NAME,
          checkId,
          round,
          reason: "disambiguation_failed",
          summary: activity.getSummary(),
          activity: activity.getEntries(),
          durationMs: Math.max(0, nowFn() - startTime),
        });
      }
    } else {
      let parsedData = genRes.data;
      if (Array.isArray(parsedData) || (parsedData && !Array.isArray(parsedData.judgements))) {
        try {
          parsedData = DisambiguationJudgementsSchema.parse(parsedData);
        } catch {
          // ignore parsing error if already validated
        }
      }
      const judgements = Array.isArray(parsedData?.judgements) ? parsedData.judgements : [];
      trace.push({
        item: "llm_disambiguation",
        status: "ok",
        detail: `judgements:${judgements.length}`,
      });

      for (const j of judgements) {
        const matchingCand = uniqueCandidates.find((c) => c.url === j.resultUrl);
        const candSources = matchingCand
          ? [{ label: matchingCand.title.slice(0, 50), url: matchingCand.url }]
          : (j.resultUrl ? [{ label: "Source", url: j.resultUrl }] : []);

        activity.step({
          title: `Disambiguation: same offer ${j.aboutSameEntity}`,
          detail: j.reason || `Judged ${j.aboutSameEntity} for target entity`,
          tool: "llm",
          status: j.aboutSameEntity === "yes" ? "warn" : "ok",
          sources: candSources,
        });

        if (j.aboutSameEntity === "yes") {
          if (matchingCand && canEmit("scam_reports_found", NAME)) {
            const candText = `${matchingCand.title} ${matchingCand.snippet}`.toLowerCase();
            const hasSpecific = specificIdentifiers.some((ident) => candText.includes(ident));

            // Guard: forum/Q&A results and aggregators require a specific identifier match
            const sourceClf = classifySource(matchingCand.url, matchingCand.title, matchingCand.snippet || "");
            if ((sourceClf.type === "forum" || sourceClf.type === "aggregator") && !hasSpecific) {
              continue;
            }
            // Guard: ensure an official body/portal/scheme never gets scam_reports_found unless the result mentions a specific non-official identifier
            const isProtectedCand = isOfficialOrProtectedEntity({
              kind: matchingCand.entityKind,
              value: matchingCand.entityName,
            }, snapshot);
            if (isProtectedCand && !hasSpecific) {
              continue;
            }
            const existingStatus = entityStatuses.find(
              (es) => es.entityKind === matchingCand.entityKind && es.entityValue === matchingCand.entityName
            );
            if (existingStatus) {
              existingStatus.status = "contradicted";
              existingStatus.reason = "Public scam reports found";
            }
            if (ctx?.verdict) {
              ctx.verdict(
                `Public scam reports about ${matchingCand.entityName}`,
                "contradicted",
                [matchingCand.url]
              );
            }
            const existingFlag = flags.find((f) => f.id === "scam_reports_found");
            if (existingFlag) {
              if (!existingFlag.evidence.some((e) => e.value === matchingCand.url)) {
                existingFlag.evidence.push({ type: "url", value: matchingCand.url });
              }
            } else {
              flags.push({
                id: "scam_reports_found",
                title: formatFlagTitle("scam_reports_found"),
                severity: FLAG_REGISTRY.scam_reports_found?.severity || "high",
                explanation: `Public search results mention complaints or scam reports regarding ${matchingCand.entityName}.`,
                evidence: [{ type: "url", value: matchingCand.url }],
              });
              activity.finding({
                title: "Public scam reports found",
                detail: `Public search results corroborate scam reports regarding ${matchingCand.entityName}`,
                flagId: "scam_reports_found",
                sources: [{ label: matchingCand.title.slice(0, 50), url: matchingCand.url }],
              });
            }
          }
        }
      }
    }
  }

  const durationMs = Math.max(0, nowFn() - startTime);

  // If all eligible evaluated items failed or were left unchecked due to errors/starvation, return could_not_check
  if (eligibleEvaluatedCount > 0 && processedEntities.length === 0) {
    const reason = failedItemCount > 0 ? "search_failed" : (unchecked.length > 0 ? "search_budget_exhausted" : "search_failed");
    activity.setSummary(`Could not complete check: ${reason}`);
    return buildCouldNotCheckResult({
      agent: NAME,
      checkId,
      round,
      reason,
      summary: activity.getSummary(),
      activity: activity.getEntries(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, entityStatuses),
      durationMs,
    });
  }

  const noteParts = [];
  const hasLlmFailure = trace.some((t) => t.item === "llm_disambiguation" && t.status === "failed");
  const hasStarvedEntities = trace.some((t) => t.item.startsWith("search_budget_exhausted") && t.detail === "budget_limit");

  if (brandContextNotes.length > 0) {
    const uniqueBrands = Array.from(new Set(brandContextNotes));
    activity.step({
      title: "Brand impersonation context",
      detail: `General scam warnings exist about people impersonating ${uniqueBrands.join(", ")}; none mention this specific offer`,
      status: "info",
    });
  }

  if (flags.length === 0) {
    if (brandContextNotes.length > 0) {
      const uniqueBrands = Array.from(new Set(brandContextNotes));
      noteParts.push(`Generic public scam warnings exist regarding parties impersonating ${uniqueBrands.join(", ")}, but no complaints specific to this offer were corroborated`);
    } else if (!hasLlmFailure) {
      noteParts.push("no reports found, not a safety guarantee");
    }
  }

  if (unchecked.length > 0) {
    if (hasStarvedEntities) {
      noteParts.push("search budget exhausted for some items");
    }
    if (hasLlmFailure) {
      noteParts.push("reputation disambiguation could not complete for candidate reports");
    }
  }

  const notes = noteParts.length > 0 ? noteParts.join("; ") : undefined;

  const hasHandleLookalike = flags.some((f) => f.id === "brand_handle_lookalike");
  const hasHandle = eligibleEntities.some((e) => e.kind === "handle");
  const hasSearchBudgetExhausted = hasStarvedEntities;
  const hasYoutubeUnconfigured = eligibleEntities.some((e) => e.kind === "youtube_url" && !ytToolFn);

  const summaryText = buildOsintSummary({
    entities: eligibleEntities,
    flags,
    brandContextNotes,
    entityOsintStates,
    hasHandleLookalike,
    hasHandle,
    hasSearchBudgetExhausted,
    hasYoutubeUnconfigured,
    hasLlmFailure,
  });
  activity.setSummary(summaryText);

  return buildOkResult({
    agent: NAME,
    checkId,
    round,
    summary: activity.getSummary(),
    activity: activity.getEntries(),
    flags,
    verified: [],
    newEntities: [],
    processedEntities,
    unchecked,
    manualChecks,
    trace,
    notes,
    entityStatus: buildCompleteEntityStatus(snapshot, NAME, entityStatuses),
    durationMs,
  });
}

export function skippedResult(snapshot) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const reason = skippedReason(snapshot) || "no_eligible_entities";
  return buildSkippedResult({
    checkId,
    agent: NAME,
    kind: KIND,
    round,
    reason,
    entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
  });
}

export const reputationOsint = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  skippedResult,
  run,
};

export default reputationOsint;
