import {
  classifyText as defaultClassify,
  classifierHealth as defaultClassifierHealth,
  filterPlaceholderTokens,
} from "../classifier.js";
import { ClassifierResultSchema } from "../contracts/classifier-result.js";
import { FLAG_REGISTRY, canEmit } from "../contracts/flags.js";
import { CLASSIFIER_HIGH_THRESHOLD } from "./config.js";
import { createActivityRecorder } from "./activity.js";
import {
  getCheckId,
  getMessageText,
  getRound,
  hasResultFor,
  quoteInText,
  buildOkResult,
  buildCouldNotCheckResult,
  buildSkippedResult,
  buildCompleteEntityStatus,
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
  const nowFn = deps.now || (() => new Date().getTime());

  const recorder =
    deps.activity ||
    deps.recorder ||
    deps.ctx?.activity ||
    deps.ctx?.recorder ||
    createActivityRecorder({
      agent: NAME,
      round,
      nowFn: deps.now,
    });

  const isProd = Boolean(
    deps.isProd ??
    options.isProd ??
    (typeof process !== "undefined" && process?.["env"]?.NODE_ENV === "production")
  );
  const devStartCmd = "npm run dev:all";
  const downHelpMessage = isProd
    ? "the classifier was unavailable"
    : `Classifier service unreachable. Start with ${devStartCmd} for development.`;

  const text = getMessageText(snapshot);
  if (!text || text.trim().length === 0) {
    recorder.input({
      title: "Analyzed opportunity text",
      detail: "Main message text is empty (0 characters).",
      tool: "classifier",
      status: "warn",
    });
    recorder.limit({
      title: "No message text available",
      detail: "Classifier requires main message text to evaluate opportunity risk.",
      tool: "classifier",
      status: "skipped",
    });
    recorder.setSummary("No message text provided to classify.");

    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: "no_message_text",
      activity: recorder.getEntries(),
      summary: recorder.getSummary(),
    });
  }

  // Record input: text length analyzed (main message only)
  recorder.input({
    title: "Analyzed opportunity text",
    detail: `Main message text only (${text.length} characters).`,
    tool: "classifier",
    status: "info",
  });

  if (ctx?.note) {
    ctx.note("Running ML text classifier on opportunity text");
  }

  try {
    const timeoutMs = options.timeoutMs ?? 20000;
    let classifierMaxPoints = 25;
    const trace = [];

    if (healthFn) {
      const healthStart = nowFn();
      let healthRes;
      try {
        healthRes = await healthFn({ timeoutMs: Math.min(timeoutMs, 3000) });
      } catch {
        const healthDuration = Math.max(0, nowFn() - healthStart);
        recorder.step({
          title: "Classifier service check",
          detail: `Service not reachable (${healthDuration}ms).`,
          tool: "classifier",
          status: "failed",
        });
        recorder.limit({
          title: "Classifier service unavailable",
          detail: downHelpMessage,
          tool: "classifier",
          status: "failed",
        });
        recorder.setSummary(isProd ? "The classifier was unavailable." : `Classifier service unavailable (start with ${devStartCmd}).`);

        return buildCouldNotCheckResult({
          checkId,
          agent: NAME,
          kind: KIND,
          round,
          reason: "classifier_service_unavailable",
          activity: recorder.getEntries(),
          summary: recorder.getSummary(),
        });
      }

      const healthDuration = healthRes?.durationMs ?? Math.max(0, nowFn() - healthStart);

      if (!healthRes || !healthRes.ok) {
        recorder.step({
          title: "Classifier service check",
          detail: `Service not reachable (${healthDuration}ms).`,
          tool: "classifier",
          status: "failed",
        });
        recorder.limit({
          title: "Classifier service unavailable",
          detail: downHelpMessage,
          tool: "classifier",
          status: "failed",
        });
        recorder.setSummary(isProd ? "The classifier was unavailable." : `Classifier service unavailable (start with ${devStartCmd}).`);

        return buildCouldNotCheckResult({
          checkId,
          agent: NAME,
          kind: KIND,
          round,
          reason: "classifier_service_unavailable",
          activity: recorder.getEntries(),
          summary: recorder.getSummary(),
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

    const classifyStart = nowFn();
    const rawResult = await classifyFn(text, { timeoutMs, recorder });
    const responseTimeMs = rawResult?.durationMs ?? Math.max(0, nowFn() - classifyStart);

    if (!rawResult || !rawResult.ok) {
      const errCode = rawResult?.error?.code;
      const isTimeout = errCode === "TIMEOUT";

      if (isTimeout) {
        recorder.step({
          title: "Classifier service check",
          detail: `Classifier request timed out (${responseTimeMs}ms).`,
          tool: "classifier",
          status: "failed",
        });
        recorder.limit({
          title: "Classifier request timed out",
          detail: "The classifier service took too long to respond.",
          tool: "classifier",
          status: "failed",
        });
        recorder.setSummary("Classifier request timed out.");

        return buildCouldNotCheckResult({
          checkId,
          agent: NAME,
          kind: KIND,
          round,
          reason: "timeout",
          activity: recorder.getEntries(),
          summary: recorder.getSummary(),
        });
      }

      recorder.step({
        title: "Classifier service check",
        detail: `Service not reachable (${responseTimeMs}ms).`,
        tool: "classifier",
        status: "failed",
      });
      recorder.limit({
        title: "Classifier service unavailable",
        detail: downHelpMessage,
        tool: "classifier",
        status: "failed",
      });
      recorder.setSummary(isProd ? "The classifier was unavailable." : `Classifier service unavailable (start with ${devStartCmd}).`);

      return buildCouldNotCheckResult({
        checkId,
        agent: NAME,
        kind: KIND,
        round,
        reason: "classifier_unavailable",
        activity: recorder.getEntries(),
        summary: recorder.getSummary(),
      });
    }

    const parseResult = ClassifierResultSchema.safeParse(rawResult.data);
    if (!parseResult.success) {
      recorder.step({
        title: "Classifier service check",
        detail: `Service reachable (${responseTimeMs}ms) but returned invalid response structure.`,
        tool: "classifier",
        status: "failed",
      });
      recorder.limit({
        title: "Invalid classifier response",
        detail: "Classifier response failed schema validation.",
        tool: "classifier",
        status: "failed",
      });
      recorder.setSummary("Classifier returned an invalid response.");

      return buildCouldNotCheckResult({
        checkId,
        agent: NAME,
        kind: KIND,
        round,
        reason: "invalid_result",
        activity: recorder.getEntries(),
        summary: recorder.getSummary(),
      });
    }

    const classifierResult = parseResult.data;
    const cleanTerms = filterPlaceholderTokens(classifierResult.topTerms);
    const topTermsStr = cleanTerms.length > 0 ? cleanTerms.join(", ") : "none";
    const probPercent = Math.round(classifierResult.probability * 100);

    // Step entry: service reachable or not, response time; scam probability %, label, top words in plain language (no placeholder tokens)
    recorder.step({
      title: "Classifier evaluation",
      detail: `Service reachable (${responseTimeMs}ms). Output: ${probPercent}% scam probability (${classifierResult.label}). Top words: ${topTermsStr}.`,
      tool: "classifier",
      status: "ok",
    });

    // Info entry: points contribution and synthetic weak-signal explanation
    const ratio = Math.max(0, (classifierResult.probability - 0.5) / 0.5);
    const points = Math.round(classifierMaxPoints * ratio);

    recorder.step({
      title: "Scoring points contribution",
      detail: `Adds ${points} point${points === 1 ? "" : "s"} to risk score (capped at ${classifierMaxPoints} points: trained mostly on synthetic examples; treat as a weak signal, not proof).`,
      tool: "classifier",
      status: "info",
    });

    if (ctx?.note) {
      ctx.note(`Classification complete via TF-IDF & Logistic Regression: ${classifierResult.label} (${probPercent}%)`);
    }

    const flags = [];

    // Decision D6: classifier_high emitted only when probability >= CLASSIFIER_HIGH_THRESHOLD
    // and at least one topTerm appears verbatim in the text (at most 3 quote items).
    if (
      classifierResult.probability >= CLASSIFIER_HIGH_THRESHOLD &&
      canEmit("classifier_high", NAME)
    ) {
      const matchingTerms = [];
      for (const term of cleanTerms) {
        if (quoteInText(term, text) && !matchingTerms.includes(term)) {
          matchingTerms.push(term);
          if (matchingTerms.length >= 3) {
            break;
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

        recorder.finding({
          title: "Classifier High",
          detail: `Model probability ${probPercent}% exceeds high threshold (${Math.round(CLASSIFIER_HIGH_THRESHOLD * 100)}%) with matching terms: ${matchingTerms.join(", ")}.`,
          tool: "classifier",
          flagId: "classifier_high",
        });
      }
    }

    // Summary: "Language model says 88% scam-like (weak signal; adds 6 points)."
    const summary = `Language model says ${probPercent}% scam-like (weak signal; adds ${points} point${points === 1 ? "" : "s"}).`;
    recorder.setSummary(summary);

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
      classifierResult: {
        ...classifierResult,
        topTerms: cleanTerms,
      },
      activity: recorder.getEntries(),
      summary: recorder.getSummary(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
    });
  } catch (err) {
    const isTimeout =
      err && (err.name === "TimeoutError" || err.message === "TIMEOUT_TRIGGERED");

    if (isTimeout) {
      recorder.step({
        title: "Classifier service check",
        detail: "Classifier request timed out.",
        tool: "classifier",
        status: "failed",
      });
      recorder.limit({
        title: "Classifier request timed out",
        detail: "The classifier service took too long to respond.",
        tool: "classifier",
        status: "failed",
      });
      recorder.setSummary("Classifier request timed out.");
    } else {
      recorder.step({
        title: "Classifier service check",
        detail: "Service not reachable.",
        tool: "classifier",
        status: "failed",
      });
      recorder.limit({
        title: "Classifier service unavailable",
        detail: downHelpMessage,
        tool: "classifier",
        status: "failed",
      });
      recorder.setSummary(isProd ? "The classifier was unavailable." : `Classifier service unavailable (start with ${devStartCmd}).`);
    }

    return buildCouldNotCheckResult({
      checkId,
      agent: NAME,
      kind: KIND,
      round,
      reason: isTimeout ? "timeout" : "classifier_unavailable",
      activity: recorder.getEntries(),
      summary: recorder.getSummary(),
      entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
    });
  }
}

export function skippedResult(snapshot) {
  const checkId = getCheckId(snapshot);
  const round = getRound(snapshot);
  const reason = skippedReason(snapshot) || "no_message_text";
  return buildSkippedResult({
    checkId,
    agent: NAME,
    kind: KIND,
    round,
    reason,
    entityStatus: buildCompleteEntityStatus(snapshot, NAME, []),
  });
}

export const classifierClient = {
  name: NAME,
  kind: KIND,
  canRun,
  skippedReason,
  skippedResult,
  run,
};

export default classifierClient;
