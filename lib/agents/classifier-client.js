import { classifyText as defaultClassify, classifierHealth as defaultClassifierHealth } from "../classifier.js";
import { ClassifierResultSchema } from "../contracts/classifier-result.js";
import { FLAG_REGISTRY, canEmit } from "../contracts/flags.js";
import { CLASSIFIER_HIGH_THRESHOLD } from "./config.js";
import {
  getCheckId,
  getMessageText,
  getRound,
  hasResultFor,
  quoteInText,
  buildOkResult,
  buildCouldNotCheckResult,
} from "./base.js";

export const NAME = "classifier_client";
export const KIND = "agent";

/**
 * Deterministic eligibility check.
 * Classifier client runs in round 1 only when:
 * - snapshot contains non-empty message text
 * - round is 1
 * - snapshot has no existing result for classifier_client
 *
 * @param {object} snapshot
 * @returns {boolean}
 */
export function canRun(snapshot) {
  const text = getMessageText(snapshot);
  if (!text || text.trim().length === 0) {
    return false;
  }
  if (getRound(snapshot) !== 1) {
    return false;
  }
  if (hasResultFor(snapshot, NAME)) {
    return false;
  }
  return true;
}

/**
 * Deterministic reason helper when skipped.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function skippedReason(snapshot) {
  const text = getMessageText(snapshot);
  if (!text || text.trim().length === 0) {
    return "no_message_text";
  }
  if (getRound(snapshot) !== 1) {
    return "round_not_supported";
  }
  if (hasResultFor(snapshot, NAME)) {
    return "already_ran";
  }
  return "not_eligible";
}

/**
 * Runs the classifier client on the message text.
 *
 * Default classification function is classifyText from lib/classifier.js:
 * Return shape:
 * - Success: { ok: true, data: { probability: number, label: "suspicious" | "benign", topTerms: string[], scamType?: string }, cached: boolean }
 * - Failure: { ok: false, error: { code: string, message: string } }
 *
 * @param {object} snapshot
 * @param {object} [deps={}] - Injected dependencies { classify, classifierHealth, now }
 * @param {object} [options={}] - Options { timeoutMs }
 * @returns {Promise<import("../contracts/agent-result.js").AgentResult>}
 */
export async function run(snapshot, deps = {}, options = {}) {
  const classifyFn = deps.classify || defaultClassify;
  const healthFn =
    deps.classifierHealth !== undefined
      ? deps.classifierHealth
      : deps.classify
        ? null
        : defaultClassifierHealth;
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const ctx = deps.ctx;

  const text = getMessageText(snapshot);
  if (!text || text.trim().length === 0) {
    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "no_message_text",
    });
  }

  if (ctx?.note) {
    ctx.note("Running ML text classifier on opportunity text");
  }

  try {
    const timeoutMs = options.timeoutMs ?? 20000;

    // Check health endpoint for provenance and dataset size to wire scoring cap
    let classifierMaxPoints = 25;
    const trace = [];

    if (healthFn) {
      let healthRes;
      try {
        healthRes = await healthFn({ timeoutMs: Math.min(timeoutMs, 3000) });
      } catch {
        return buildCouldNotCheckResult({
          checkId,
          agent: NAME,
          kind: KIND,
          round,
          reason: "classifier_service_unavailable",
        });
      }

      if (!healthRes || !healthRes.ok) {
        return buildCouldNotCheckResult({
          checkId,
          agent: NAME,
          kind: KIND,
          round,
          reason: "classifier_service_unavailable",
        });
      }

      const provenance =
        healthRes.data?.data_provenance ||
        healthRes.data?.datasetProvenance ||
        "synthetic";
      const realRowCount =
        typeof healthRes.data?.real_row_count === "number"
          ? healthRes.data.real_row_count
          : (healthRes.data?.real_test_metrics?.row_count ?? 0);

      const isCapped =
        provenance === "synthetic" ||
        provenance === "mixed_synthetic_and_public" ||
        realRowCount < 60;

      classifierMaxPoints = isCapped ? 10 : 25;

      trace.push({
        check: "health",
        status: "ok",
        data_provenance: provenance,
        real_row_count: realRowCount,
        classifierMaxPoints,
      });
    }

    const rawResult = await classifyFn(text, { timeoutMs });

    if (!rawResult || !rawResult.ok) {
      return buildCouldNotCheckResult({
        checkId,
        agent: NAME,
        kind: KIND,
        round,
        reason: "classifier_unavailable",
      });
    }

    const parseResult = ClassifierResultSchema.safeParse(rawResult.data);
    if (!parseResult.success) {
      return buildCouldNotCheckResult({
        checkId,
        agent: NAME,
        kind: KIND,
        round,
        reason: "invalid_result",
      });
    }

    const classifierResult = parseResult.data;
    if (ctx?.note) {
      ctx.note(`Classification complete via TF-IDF & Logistic Regression: ${classifierResult.label} (${Math.round(classifierResult.probability * 100)}%)`);
    }
    const flags = [];

    // Decision D6: classifier_high emitted only when probability >= CLASSIFIER_HIGH_THRESHOLD
    // and at least one topTerm appears verbatim in the text (at most 3 quote items).
    if (
      classifierResult.probability >= CLASSIFIER_HIGH_THRESHOLD &&
      canEmit("classifier_high", NAME)
    ) {
      const matchingTerms = [];
      if (Array.isArray(classifierResult.topTerms)) {
        for (const term of classifierResult.topTerms) {
          if (typeof term === "string" && term.trim()) {
            const cleanTerm = term.trim();
            if (quoteInText(cleanTerm, text) && !matchingTerms.includes(cleanTerm)) {
              matchingTerms.push(cleanTerm);
              if (matchingTerms.length >= 3) {
                break;
              }
            }
          }
        }
      }

      if (matchingTerms.length > 0) {
        const meta = FLAG_REGISTRY.classifier_high;
        flags.push({
          id: "classifier_high",
          title: "Classifier High",
          severity: meta.severity,
          explanation: meta.description,
          evidence: matchingTerms.map((term) => ({ type: "quote", value: term })),
        });
      }
    }

    const notes = `classifierMaxPoints=${classifierMaxPoints}. Classifier probability is an informational model output and does not constitute a definitive assessment or safety guarantee.`;

    return buildOkResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      flags,
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace,
      notes,
      classifierResult,
    });
  } catch (err) {
    const isTimeout =
      err && (err.name === "TimeoutError" || err.message === "TIMEOUT_TRIGGERED");
    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: isTimeout ? "timeout" : "classifier_unavailable",
    });
  }
}

export const classifierClient = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  run,
};

export default classifierClient;
