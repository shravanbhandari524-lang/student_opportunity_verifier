// Uses pure synchronous functions exported by lib/tools/ssrf.js: parseAndUnwrapIp, isForbiddenIp
import { parseAndUnwrapIp, isForbiddenIp } from "../tools/ssrf.js";
import { normalizeDomain, normalizeHandle, normalizeCompany } from "../contracts/normalize.js";
import { AgentResultSchema } from "../contracts/agent-result.js";
import {
  AGENT_TIMEOUT_MS,
  MAX_NEW_ENTITIES,
  ALLOWED_DISCOVERY_KINDS,
} from "./config.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "instance-data",
  "metadata",
]);

/**
 * Extracts the check ID from a snapshot.
 *
 * @param {object} snapshot
 * @returns {string} UUID string
 */
export function getCheckId(snapshot) {
  return (
    snapshot?.check?.id ??
    snapshot?.checkId ??
    "00000000-0000-0000-0000-000000000000"
  );
}

/**
 * Extracts the current round from a snapshot.
 *
 * @param {object} snapshot
 * @returns {number} Round (1 or 2)
 */
export function getRound(snapshot) {
  const r = snapshot?.check?.currentRound ?? snapshot?.round ?? 1;
  return r >= 2 ? 2 : 1;
}

/**
 * Checks if a snapshot already contains a finding for a given agent and optional round.
 *
 * @param {object} snapshot
 * @param {string} agentName
 * @param {number} [round]
 * @returns {boolean}
 */
export function hasResultFor(snapshot, agentName, round) {
  const findings = Array.isArray(snapshot?.findings) ? snapshot.findings : [];
  return findings.some(
    (f) =>
      f &&
      f.agent === agentName &&
      (round === undefined || f.round === round)
  );
}

/**
 * Extracts and consolidates all message text from a snapshot.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function getMessageText(snapshot) {
  const textParts = [];

  if (Array.isArray(snapshot?.inputs)) {
    for (const input of snapshot.inputs) {
      if (input && input.type === "text" && typeof input.value === "string") {
        const val = input.value.trim();
        if (val && !textParts.includes(val)) {
          textParts.push(val);
        }
      }
    }
  }

  if (
    textParts.length === 0 &&
    snapshot?.submission &&
    typeof snapshot.submission.text === "string"
  ) {
    const val = snapshot.submission.text.trim();
    if (val) {
      textParts.push(val);
    }
  }

  return textParts.join("\n\n");
}

/**
 * Extracts candidate user notes from snapshot inputs or submission.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function getUserNotes(snapshot) {
  if (Array.isArray(snapshot?.inputs)) {
    for (const input of snapshot.inputs) {
      if (input && input.type === "user_notes" && typeof input.value === "string") {
        const val = input.value.trim();
        if (val) return val;
      }
    }
  }

  if (snapshot?.submission && typeof snapshot.submission.userNotes === "string") {
    const val = snapshot.submission.userNotes.trim();
    if (val) return val;
  }

  return "";
}

/**
 * Consolidates all opportunity text: main message text, user testimony notes, and OCR text.
 * Deduplicates identical text snippets.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function getAnalysisText(snapshot) {
  const parts = [];

  if (Array.isArray(snapshot?.inputs)) {
    for (const input of snapshot.inputs) {
      if (input && typeof input.value === "string") {
        const val = input.value.trim();
        if (val && !parts.includes(val)) {
          parts.push(val);
        }
      }
    }
  }

  if (snapshot?.submission) {
    const sub = snapshot.submission;
    const subFields = [
      sub.text,
      sub.userNotes,
      sub.upiId,
      sub.upi,
      sub.company,
      sub.handle,
      sub.phone,
      sub.url,
      sub.youtubeUrl,
    ];
    for (const field of subFields) {
      if (typeof field === "string") {
        const val = field.trim();
        if (val && !parts.includes(val)) {
          parts.push(val);
        }
      }
    }
  }

  if (Array.isArray(snapshot?.entities)) {
    for (const ent of snapshot.entities) {
      if (ent && (ent.source === "user" || ent.source === "user_form" || ent.source === "submission") && typeof ent.value === "string") {
        const val = ent.value.trim();
        if (val && !parts.includes(val)) {
          parts.push(val);
        }
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Normalizes text for evidence quote matching:
 * - NFC Unicode normalization
 * - Lowercase
 * - Normalizes non-breaking spaces and unicode spaces to ASCII space
 * - Normalizes typographic quotes (single and double curly quotes)
 * - Normalizes em-dashes and en-dashes to hyphen
 * - Normalizes currency symbol variations ('Rs.' vs 'Rs')
 * - Collapses consecutive whitespace
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeForQuoteMatch(text) {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u00A0\u202F\u2000-\u200B]/g, " ")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[—–―]/g, "-")
    .replace(/\brs\.\s*/g, "rs ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Searches for the best-matching contiguous token span in sourceText that matches quote.
 * Returns the exact sourceText substring when token overlap similarity >= threshold.
 *
 * @param {string} quote
 * @param {string} sourceText
 * @param {number} [threshold=0.70]
 * @returns {{ span: string, similarity: number, start: number, end: number } | null}
 */
export function findBestContiguousSpan(quote, sourceText, threshold = 0.70) {
  if (typeof quote !== "string" || typeof sourceText !== "string") return null;

  const quoteTrimmed = quote.trim();
  const sourceTrimmed = sourceText.trim();
  if (!quoteTrimmed || !sourceTrimmed) return null;

  const TOKEN_REGEX = /[^\s,;!?()[\]{}|]+/g;
  const sourceTokens = [];
  let match;
  while ((match = TOKEN_REGEX.exec(sourceText)) !== null) {
    const raw = match[0];
    const norm = normalizeForQuoteMatch(raw).replace(/^['".,;:!?—–-]+|['".,;:!?—–-]+$/g, "");
    if (norm) {
      sourceTokens.push({
        raw,
        norm,
        start: match.index,
        end: match.index + raw.length,
      });
    }
  }

  const quoteTokens = [];
  while ((match = TOKEN_REGEX.exec(quote)) !== null) {
    const raw = match[0];
    const norm = normalizeForQuoteMatch(raw).replace(/^['".,;:!?—–-]+|['".,;:!?—–-]+$/g, "");
    if (norm && norm !== "...") {
      quoteTokens.push(norm);
    }
  }

  const N = quoteTokens.length;
  if (N === 0 || sourceTokens.length === 0) return null;

  const countQ = {};
  for (const t of quoteTokens) {
    countQ[t] = (countQ[t] || 0) + 1;
  }

  let bestSim = 0;
  let bestWindow = null;

  const minLen = Math.max(1, N <= 3 ? 1 : N - 4);
  const maxLen = Math.min(sourceTokens.length, N <= 3 ? N + 2 : N + 5);

  for (let i = 0; i < sourceTokens.length; i++) {
    for (let len = minLen; len <= maxLen; len++) {
      const j = i + len - 1;
      if (j >= sourceTokens.length) break;

      const qCopy = { ...countQ };
      let matched = 0;

      for (let k = i; k <= j; k++) {
        const tok = sourceTokens[k].norm;
        if (qCopy[tok] && qCopy[tok] > 0) {
          matched++;
          qCopy[tok]--;
        }
      }

      const sim = (2 * matched) / (N + len);
      if (sim > bestSim) {
        bestSim = sim;
        bestWindow = {
          start: sourceTokens[i].start,
          end: sourceTokens[j].end,
        };
      }
    }
  }

  if (bestSim >= threshold && bestWindow) {
    return {
      span: sourceText.slice(bestWindow.start, bestWindow.end).trim(),
      similarity: bestSim,
      start: bestWindow.start,
      end: bestWindow.end,
    };
  }

  return null;
}

/**
 * Case-insensitive substring match with robust quote normalization and contiguous snapping.
 * Conforms to the L5 quote evidence policy.
 *
 * @param {string} quote
 * @param {string} text
 * @returns {boolean}
 */
export function quoteInText(quote, text) {
  if (typeof quote !== "string" || typeof text !== "string") return false;
  const qNorm = normalizeForQuoteMatch(quote);
  const tNorm = normalizeForQuoteMatch(text);
  if (!qNorm || !tNorm) return false;

  // 1. Direct normalized match
  if (tNorm.includes(qNorm)) return true;

  // 2. Direct normalized match without leading/trailing quote or punctuation
  const qStripped = qNorm.replace(/^['".,;:!?—–-]+|['".,;:!?—–-]+$/g, "").trim();
  if (qStripped && tNorm.includes(qStripped)) return true;

  // 3. Fallback to contiguous token similarity snapping
  const match = findBestContiguousSpan(quote, text, 0.75);
  return Boolean(match && match.similarity >= 0.75);
}

/**
 * Collapses whitespace in a string and converts to lowercase.
 *
 * @param {string} s
 * @returns {string}
 */
export function collapseWhitespace(s) {
  if (typeof s !== "string") return "";
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Helper to verify an evidence item against known message text.
 *
 * @param {object} evidence
 * @param {string} text
 * @returns {boolean}
 */
export function verifyEvidence(evidence, text, snapshot) {
  if (!evidence || typeof evidence !== "object") return false;
  if (evidence.type === "quote") {
    if (typeof text === "string" && quoteInText(evidence.value, text)) return true;
    if (snapshot) {
      const fullText = getAnalysisText(snapshot);
      if (fullText && quoteInText(evidence.value, fullText)) return true;
    }
    return false;
  }
  if (evidence.type === "url") {
    return (
      typeof evidence.value === "string" &&
      /^https?:\/\//i.test(evidence.value.trim())
    );
  }
  return false;
}

/**
 * Safely executes an async or sync tool function, guaranteeing that any thrown error
 * is caught and unified into a standard `{ ok: false, error: { code, message } }` failure shape.
 *
 * @template T
 * @param {Function} fn
 * @param {string} [defaultErrorCode="UPSTREAM_ERROR"]
 * @returns {Promise<{ ok: boolean, data?: T, error?: { code: string, message?: string } }>}
 */
export async function safeToolCall(fn, defaultErrorCode = "UPSTREAM_ERROR") {
  try {
    const res = await fn();
    if (res && typeof res === "object" && typeof res.ok === "boolean") {
      return res;
    }
    return { ok: true, data: res };
  } catch (err) {
    const code = err?.code || defaultErrorCode;
    const message = err?.message || String(err);
    return { ok: false, error: { code, message } };
  }
}

/**
 * Result builder for status 'ok'.
 *
 * @param {object} params
 * @returns {import("../contracts/agent-result.js").AgentResult}
 */
export function buildOkResult({
  checkId,
  agent,
  kind = "agent",
  round = 1,
  summary = "",
  activity = [],
  entityStatus = [],
  flags = [],
  verified = [],
  newEntities = [],
  processedEntities = [],
  unchecked = [],
  manualChecks = [],
  trace = [],
  notes = "",
  durationMs = 0,
  classifierResult,
}) {
  const result = {
    checkId,
    agent,
    kind,
    round,
    status: "ok",
    reason: null,
    summary,
    activity,
    entityStatus,
    flags,
    verified,
    newEntities,
    processedEntities,
    unchecked,
    manualChecks,
    trace,
    notes,
    durationMs,
  };

  if (classifierResult !== undefined) {
    result.classifierResult = classifierResult;
  }
  if (summary !== undefined) {
    result.summary = summary;
  }
  if (activity !== undefined) {
    result.activity = activity;
  }

  return AgentResultSchema.parse(result);
}

/**
 * Result builder for status 'skipped'.
 *
 * @param {object} params
 * @returns {import("../contracts/agent-result.js").AgentResult}
 */
export function buildSkippedResult({
  checkId,
  agent,
  kind = "agent",
  round = 1,
  reason,
  summary = "",
  activity = [],
  entityStatus = [],
  durationMs = 0,
}) {
  const result = {
    checkId,
    agent,
    kind,
    round,
    status: "skipped",
    reason: reason || "skipped",
    summary,
    activity,
    entityStatus,
    flags: [],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    trace: [],
    notes: "",
    durationMs,
  };

  if (summary !== undefined) {
    result.summary = summary;
  }
  if (activity !== undefined) {
    result.activity = activity;
  }
  if (entityStatus !== undefined) {
    result.entityStatus = entityStatus;
  }

  return AgentResultSchema.parse(result);
}

/**
 * Result builder for status 'could_not_check'.
 *
 * @param {object} params
 * @returns {import("../contracts/agent-result.js").AgentResult}
 */
export function buildCouldNotCheckResult({
  checkId,
  agent,
  kind = "agent",
  round = 1,
  reason,
  summary = "",
  activity = [],
  entityStatus = [],
  durationMs = 0,
  trace = [],
  notes = "",
}) {
  const result = {
    checkId,
    agent,
    kind,
    round,
    status: "could_not_check",
    reason: reason || "error",
    summary,
    activity,
    entityStatus,
    flags: [],
    verified: [],
    newEntities: [],
    processedEntities: [],
    unchecked: [],
    manualChecks: [],
    trace,
    notes,
    durationMs,
  };

  if (summary !== undefined) {
    result.summary = summary;
  }
  if (activity !== undefined) {
    result.activity = activity;
  }
  if (entityStatus !== undefined) {
    result.entityStatus = entityStatus;
  }

  return AgentResultSchema.parse(result);
}

/**
 * Ensures all confirmed entities from snapshot have an entry in entityStatus.
 * Unchecked/unhandled entities default to status 'skipped' with an informative reason.
 *
 * @param {object} snapshot
 * @param {string} agentName
 * @param {Array<object>} [existingStatuses=[]]
 * @returns {Array<object>}
 */
export function buildCompleteEntityStatus(snapshot, agentName, existingStatuses = []) {
  const result = [];
  const seen = new Set();

  if (Array.isArray(existingStatuses)) {
    for (const s of existingStatuses) {
      if (!s || !s.entityKind || !s.entityValue) continue;
      const key = `${s.entityKind}:${s.entityValue}`;
      if (!seen.has(key)) {
        seen.add(key);
        const entry = { ...s };
        if ((entry.status === "skipped" || entry.status === "could_not_check") && !entry.reason?.trim()) {
          entry.reason =
            entry.status === "skipped"
              ? `Not eligible for ${agentName}`
              : `Check unavailable in ${agentName}`;
        }
        result.push(entry);
      }
    }
  }

  const confirmedEntities = Array.isArray(snapshot?.entities)
    ? snapshot.entities.filter((e) => e && e.confirmed !== false && e.kind && e.value)
    : [];

  for (const ent of confirmedEntities) {
    const key = `${ent.kind}:${ent.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        entityKind: ent.kind,
        entityValue: ent.value,
        status: "skipped",
        reason: `Not eligible for ${agentName}`,
      });
    }
  }

  return result;
}

/**
 * Filters, normalizes, SSRF-checks, and limits newly discovered entities.
 *
 * @param {Array<object>} candidates
 * @param {object} [options]
 * @param {string} [options.agentName]
 * @param {Set<string> | Array<string>} [options.existingEntityKeys]
 * @returns {{ accepted: Array<object>, droppedCount: number }}
 */
export function limitNewEntities(
  candidates,
  { existingEntityKeys } = {}
) {
  if (!Array.isArray(candidates)) {
    return { accepted: [], droppedCount: 0 };
  }

  const existingSet = new Set(
    Array.isArray(existingEntityKeys)
      ? existingEntityKeys
      : existingEntityKeys instanceof Set
      ? Array.from(existingEntityKeys)
      : []
  );

  const accepted = [];
  let droppedCount = 0;
  const seenKeys = new Set();

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      droppedCount++;
      continue;
    }

    const { kind, value, evidence } = candidate;

    // 1. Allowed kinds only
    if (!ALLOWED_DISCOVERY_KINDS.includes(kind)) {
      droppedCount++;
      continue;
    }

    // 2. Evidence required (must be non-empty object with non-empty string value)
    if (
      !evidence ||
      typeof evidence !== "object" ||
      typeof evidence.value !== "string" ||
      evidence.value.trim().length === 0
    ) {
      droppedCount++;
      continue;
    }

    // 3. Normalization & SSRF check
    let normalized = "";
    if (kind === "domain") {
      const rawHost = String(value || "").trim().toLowerCase();
      if (
        BLOCKED_HOSTNAMES.has(rawHost) ||
        rawHost.endsWith(".internal") ||
        rawHost.endsWith(".local")
      ) {
        droppedCount++;
        continue;
      }
      const rawIp = parseAndUnwrapIp(rawHost);
      if (rawIp && isForbiddenIp(rawIp)) {
        droppedCount++;
        continue;
      }

      normalized = normalizeDomain(value);
      if (!normalized) {
        droppedCount++;
        continue;
      }

      if (
        BLOCKED_HOSTNAMES.has(normalized) ||
        normalized.endsWith(".internal") ||
        normalized.endsWith(".local")
      ) {
        droppedCount++;
        continue;
      }
      const normIp = parseAndUnwrapIp(normalized);
      if (normIp && isForbiddenIp(normIp)) {
        droppedCount++;
        continue;
      }
    } else if (kind === "handle") {
      normalized = normalizeHandle(value);
    } else if (kind === "company") {
      normalized = normalizeCompany(value);
    }

    if (!normalized || normalized.length === 0) {
      droppedCount++;
      continue;
    }

    // 4. Deduplication
    const key = `${kind}:${normalized}`;
    if (seenKeys.has(key) || existingSet.has(key) || existingSet.has(normalized)) {
      droppedCount++;
      continue;
    }

    // 5. Cap at MAX_NEW_ENTITIES
    if (accepted.length >= MAX_NEW_ENTITIES) {
      droppedCount++;
      continue;
    }

    seenKeys.add(key);
    accepted.push({
      kind,
      value: normalized,
      evidence: {
        type: evidence.type || "quote",
        value: evidence.value.trim(),
      },
    });
  }

  return { accepted, droppedCount };
}

/**
 * Executes an agent safely under a timeout with strict error wrapping and contract validation.
 *
 * @param {object} agent - Agent definition with name, kind, canRun, run
 * @param {object} snapshot - CaseFile snapshot
 * @param {object} [deps={}] - Injected dependencies { generate, classify, now }
 * @param {object} [options={}] - Execution options { timeoutMs }
 * @returns {Promise<import("../contracts/agent-result.js").AgentResult>}
 */
export async function runAgent(agent, snapshot, deps = {}, options = {}) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const agentName = agent?.name || "unknown_agent";
  const agentKind = agent?.kind || "agent";

  // Check eligibility first
  if (!agent || typeof agent.canRun !== "function" || !agent.canRun(snapshot)) {
    if (typeof agent?.skippedResult === "function") {
      try {
        return agent.skippedResult(snapshot, deps);
      } catch {
        // Fall back to default skipped result
      }
    }
    const reason =
      typeof agent?.skippedReason === "function"
        ? agent.skippedReason(snapshot)
        : "not_eligible";
    return buildSkippedResult({
      checkId,
      agent: agentName,
      kind: agentKind,
      round,
      reason: reason || "not_eligible",
      durationMs: 0,
    });
  }

  const timeoutMs = options.timeoutMs ?? AGENT_TIMEOUT_MS;
  const startTime = deps.now ? deps.now() : 0;

  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("TIMEOUT_TRIGGERED"));
    }, timeoutMs);
  });

  try {
    const rawResult = await Promise.race([
      Promise.resolve(agent.run(snapshot, deps, options)),
      timeoutPromise,
    ]);

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const durationMs = deps.now
      ? Math.max(0, deps.now() - startTime)
      : rawResult?.durationMs ?? 0;

    // Validate result against AgentResultSchema
    const parseResult = AgentResultSchema.safeParse({
      ...rawResult,
      durationMs,
    });

    if (!parseResult.success) {
      return buildCouldNotCheckResult({
        checkId,
        agent: agentName,
        kind: agentKind,
        round,
        reason: "invalid_result",
        durationMs,
      });
    }

    return parseResult.data;
  } catch (err) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    const durationMs = deps.now ? Math.max(0, deps.now() - startTime) : 0;
    const isTimeout =
      err &&
      (err.message === "TIMEOUT_TRIGGERED" || err.name === "TimeoutError");
    const reasonCode = isTimeout ? "timeout" : "error";

    return buildCouldNotCheckResult({
      checkId,
      agent: agentName,
      kind: agentKind,
      round,
      reason: reasonCode,
      durationMs,
    });
  }
}
