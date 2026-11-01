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
} from "./config.js";
import {
  getCheckId,
  getRound,
  safeToolCall,
  buildOkResult,
  buildCouldNotCheckResult,
  buildSkippedResult,
} from "./base.js";

export const NAME = "reputation_osint";
export const KIND = "check";

export const ELIGIBLE_KINDS = Object.freeze([
  "company",
  "domain",
  "handle",
  "youtube_url",
]);

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
  const startTime = nowFn();
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);

  if (!canRun(snapshot)) {
    const durationMs = Math.max(0, nowFn() - startTime);
    return {
      checkId,
      agent: NAME,
      round,
      kind: KIND,
      status: "skipped",
      reason: skippedReason(snapshot),
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      durationMs,
    };
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
    return buildSkippedResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: skippedReason(snapshot) || "no_eligible_entities",
      durationMs: Math.max(0, nowFn() - startTime),
    });
  }

  const flags = [];
  const processedEntities = [];
  const unchecked = [];
  const manualChecks = [];
  const trace = [];
  const brandContextNotes = [];

  let searchCallsCount = 0;
  let eligibleEvaluatedCount = 0;
  let successfulItemCount = 0;
  let failedItemCount = 0;

  const survivingCandidateResults = [];

  // Collect specific offer identifiers (domain, handle, upi, phone) from snapshot
  const specificIdentifiers = [];
  if (Array.isArray(snapshot?.entities)) {
    for (const e of snapshot.entities) {
      if (!e || typeof e.value !== "string") continue;
      if (e.kind === "domain" || e.kind === "handle" || e.kind === "upi" || e.kind === "phone") {
        const val = e.value.trim().toLowerCase();
        if (val.length >= 3) {
          specificIdentifiers.push(val);
        }
      }
    }
  }

  for (const ent of eligibleEntities) {
    const entKey = `${ent.kind}:${ent.value}`;

    if (ent.kind === "youtube_url") {
      if (!ytToolFn) {
        trace.push({
          item: `youtube_comments:${ent.value}`,
          status: "skipped",
          detail: "not_configured",
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
          }
        }
      }

      processedEntities.push(entKey);
      continue;
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
      continue;
    }

    if (ent.kind === "company" || ent.kind === "domain") {
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

    const cleanVal = sanitizeQueryText(ent.value);
    const queries = [];
    if (ent.kind === "company") {
      const q1 = buildScamQuery(cleanVal);
      const q2 = buildRedditQuery(cleanVal);
      const q3 = buildComplaintSitesQuery(cleanVal);
      if (q1) queries.push(q1);
      if (q2) queries.push(q2);
      if (q3) queries.push(q3);
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
    let itemAttempts = 0;

    for (const query of queries) {
      if (searchCallsCount >= REPUTATION_SEARCH_BUDGET) {
        trace.push({
          item: `search_budget_exhausted:${query}`,
          status: "skipped",
          detail: "budget_limit",
        });
        break;
      }

      searchCallsCount++;
      itemAttempts++;

      const sRes = await safeToolCall(
        () => searchFn(query, {
          timeoutMs: 5000,
          context: { checkId },
        }),
        "UPSTREAM_ERROR"
      );

      if (sRes.ok) {
        itemHadSuccess = true;
        const results = Array.isArray(sRes.data?.results) ? sRes.data.results : [];
        trace.push({
          item: `search:${query}`,
          status: "ok",
          detail: `results:${results.length}`,
        });

        for (const r of results) {
          if (!r.url || !r.title) continue;

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
          if (isNearScamWord(combinedText, ent.value, REPUTATION_SCAM_WORDS, REPUTATION_PROXIMITY_CHARS)) {
            // Check relevance for big brands: requires mentioning a specific identifier from this check
            const isBigBrand = ent.kind === "company" && BIG_BRANDS.has(ent.value.trim().toLowerCase());
            if (isBigBrand) {
              const lowerText = combinedText.toLowerCase();
              const hasSpecificIdentifier = specificIdentifiers.some((ident) => lowerText.includes(ident));
              if (!hasSpecificIdentifier) {
                // Generic brand scam warning: goes into context notes, never a flag
                brandContextNotes.push(ent.value);
                trace.push({
                  item: `brand_context:${ent.value}`,
                  status: "ok",
                  detail: `generic_warning:${r.url.slice(0, 40)}`,
                });
                continue;
              }
            }

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
      } else {
        trace.push({
          item: `search:${query}`,
          status: "failed",
          detail: sRes.error?.code || "UPSTREAM_ERROR",
        });
      }
    }

    if (itemAttempts > 0 && !itemHadSuccess) {
      failedItemCount++;
      unchecked.push(entKey);
    } else if (itemHadSuccess) {
      successfulItemCount++;
      processedEntities.push(entKey);
    }
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
        return buildCouldNotCheckResult({
          agent: NAME,
          checkId,
          round,
          reason: "disambiguation_failed",
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
        if (j.aboutSameEntity === "yes") {
          const matchingCand = uniqueCandidates.find((c) => c.url === j.resultUrl);
          if (matchingCand && canEmit("scam_reports_found", NAME)) {
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
    return buildCouldNotCheckResult({
      agent: NAME,
      checkId,
      round,
      reason,
      durationMs,
    });
  }

  const noteParts = [];
  const hasLlmFailure = trace.some((t) => t.item === "llm_disambiguation" && t.status === "failed");
  const hasStarvedEntities = trace.some((t) => t.item.startsWith("search_budget_exhausted") && t.detail === "budget_limit");

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

  return buildOkResult({
    agent: NAME,
    checkId,
    round,
    flags,
    verified: [],
    newEntities: [],
    processedEntities,
    unchecked,
    manualChecks,
    trace,
    notes,
    durationMs,
  });
}

export const reputationOsint = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  run,
};

export default reputationOsint;
