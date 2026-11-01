/**
 * lib/classifier.js
 *
 * HTTP client for the Python classification microservice.
 *
 * Rules:
 * - Calls `POST /classify` at `CLASSIFIER_URL` (default: http://localhost:8000).
 * - Enforces short timeout (default 3000ms).
 * - If CLASSIFIER_URL is not configured, returns fail("NO_KEY", ...) or fail("UPSTREAM_ERROR", ...).
 * - On network error, timeout, or non-200 response, returns a failed ToolResult (never throws).
 * - Validates response shape with `ClassifierResultSchema`.
 * - Emits logToolExecution.
 */

import { env } from "./env.js";
import { ok, fail, withTimeout, logToolExecution } from "./tools/base.js";
import { ClassifierResultSchema } from "./contracts/classifier-result.js";

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * Filters out normalization placeholder tokens (e.g. <AMT>, <URL>, <PHONE>, <EMAIL>, <NUM>)
 * and raw placeholder words from top terms.
 *
 * @param {string[]} terms
 * @returns {string[]}
 */
export function filterPlaceholderTokens(terms) {
  if (!Array.isArray(terms)) return [];
  const placeholderRegex = /^(<[^>]+>|amt|amount|placeholder|url|phone|email|num|upi)$/i;
  return terms
    .filter((t) => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !placeholderRegex.test(t));
}

/**
 * Classifies message or offer text using the Python ML classifier service.
 *
 * @param {string} text The text to classify
 * @param {object} [options]
 * @param {string} [options.url] Override classifier service URL
 * @param {number} [options.timeoutMs=3000]
 * @param {object} [options.customEnv] Custom environment overrides
 * @param {typeof fetch} [options.fetchFn=globalThis.fetch]
 * @param {object} [options.recorder] Optional activity recorder
 * @returns {Promise<import("./contracts/tool-result.js").ToolResult>}
 */
export async function classifyText(text, {
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  customEnv,
  fetchFn = globalThis.fetch,
  recorder,
} = {}) {
  const start = Date.now();

  if (typeof text !== "string" || !text.trim()) {
    const durationMs = Date.now() - start;
    logToolExecution({ tool: "classifier", status: "error", durationMs, code: "INVALID_INPUT" });
    if (recorder) {
      recorder.step({
        title: "Classifier input check",
        detail: "Empty or invalid input text.",
        tool: "classifier",
        status: "failed",
      });
    }
    const res = fail("INVALID_INPUT", "Text cannot be empty for classification");
    res.durationMs = durationMs;
    return res;
  }

  const baseUrl = url || customEnv?.CLASSIFIER_URL || env.CLASSIFIER_URL || "http://localhost:8000";
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/classify`;

  try {
    const response = await withTimeout(async (signal) => {
      return await fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ text: text.trim() }),
        signal,
      });
    }, timeoutMs);

    const durationMs = Date.now() - start;

    if (response.status === 429) {
      logToolExecution({ tool: "classifier", status: "error", durationMs, code: "RATE_LIMITED" });
      if (recorder) {
        recorder.step({
          title: "Classifier rate limit",
          detail: `Rate limit reached (${durationMs}ms).`,
          tool: "classifier",
          status: "failed",
        });
      }
      const res = fail("RATE_LIMITED", "Classifier rate limit reached");
      res.durationMs = durationMs;
      return res;
    }

    if (!response.ok) {
      logToolExecution({ tool: "classifier", status: "error", durationMs, code: "UPSTREAM_ERROR" });
      if (recorder) {
        recorder.step({
          title: "Classifier upstream error",
          detail: `HTTP ${response.status} from classifier service (${durationMs}ms).`,
          tool: "classifier",
          status: "failed",
        });
      }
      const res = fail("UPSTREAM_ERROR", `Classifier service responded with HTTP ${response.status}`);
      res.durationMs = durationMs;
      return res;
    }

    let json;
    try {
      json = await response.json();
    } catch {
      logToolExecution({ tool: "classifier", status: "error", durationMs, code: "PARSE_ERROR" });
      if (recorder) {
        recorder.step({
          title: "Classifier parse error",
          detail: `Invalid JSON from classifier (${durationMs}ms).`,
          tool: "classifier",
          status: "failed",
        });
      }
      const res = fail("PARSE_ERROR", "Invalid JSON from classifier service");
      res.durationMs = durationMs;
      return res;
    }

    const parseResult = ClassifierResultSchema.safeParse(json);
    if (!parseResult.success) {
      logToolExecution({ tool: "classifier", status: "error", durationMs, code: "PARSE_ERROR" });
      if (recorder) {
        recorder.step({
          title: "Classifier validation failure",
          detail: `Schema validation error (${durationMs}ms).`,
          tool: "classifier",
          status: "failed",
        });
      }
      const res = fail("PARSE_ERROR", `Classifier response failed schema validation: ${parseResult.error.message}`);
      res.durationMs = durationMs;
      return res;
    }

    const cleanData = {
      ...parseResult.data,
      topTerms: filterPlaceholderTokens(parseResult.data.topTerms),
    };

    logToolExecution({ tool: "classifier", status: "ok", durationMs, cached: false });
    if (recorder) {
      const probPercent = Math.round(cleanData.probability * 100);
      const termsStr = cleanData.topTerms.length > 0 ? cleanData.topTerms.join(", ") : "none";
      recorder.step({
        title: "Classifier microservice response",
        detail: `Service reachable (${durationMs}ms). Output: ${probPercent}% scam probability (${cleanData.label}). Top words: ${termsStr}.`,
        tool: "classifier",
        status: "ok",
      });
    }

    const res = ok(cleanData, false);
    res.durationMs = durationMs;
    return res;
  } catch (err) {
    const durationMs = Date.now() - start;
    if (err.name === "AbortError" || err.code === "ABORT_ERR") {
      logToolExecution({ tool: "classifier", status: "timeout", durationMs, code: "TIMEOUT" });
      if (recorder) {
        recorder.step({
          title: "Classifier timeout",
          detail: `Request timed out after ${durationMs}ms.`,
          tool: "classifier",
          status: "failed",
        });
      }
      const res = fail("TIMEOUT", "Classifier request timed out");
      res.durationMs = durationMs;
      return res;
    }
    logToolExecution({ tool: "classifier", status: "error", durationMs, code: "NETWORK" });
    if (recorder) {
      recorder.step({
        title: "Classifier network error",
        detail: `Network error contacting classifier (${durationMs}ms).`,
        tool: "classifier",
        status: "failed",
      });
    }
    const res = fail("NETWORK", "Network error contacting classifier service");
    res.durationMs = durationMs;
    return res;
  }
}

/**
 * Checks health of the classifier microservice.
 *
 * @param {object} [options]
 * @param {string} [options.url] Override classifier service URL
 * @param {number} [options.timeoutMs=2000]
 * @param {object} [options.customEnv] Custom environment overrides
 * @param {typeof fetch} [options.fetchFn=globalThis.fetch]
 * @returns {Promise<import("./contracts/tool-result.js").ToolResult>}
 */
export async function classifierHealth({
  url,
  timeoutMs = 2000,
  customEnv,
  fetchFn = globalThis.fetch,
} = {}) {
  const start = Date.now();
  const baseUrl = url || customEnv?.CLASSIFIER_URL || env.CLASSIFIER_URL || "http://localhost:8000";
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/health`;

  try {
    const response = await withTimeout(async (signal) => {
      return await fetchFn(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal,
      });
    }, timeoutMs);

    const durationMs = Date.now() - start;

    if (!response.ok) {
      logToolExecution({ tool: "classifierHealth", status: "error", durationMs, code: "UPSTREAM_ERROR" });
      const res = fail("UPSTREAM_ERROR", `Classifier health check returned HTTP ${response.status}`);
      res.durationMs = durationMs;
      return res;
    }

    const json = await response.json();
    logToolExecution({ tool: "classifierHealth", status: "ok", durationMs, cached: false });
    const res = ok(json, false);
    res.durationMs = durationMs;
    return res;
  } catch (err) {
    const durationMs = Date.now() - start;
    if (err.name === "AbortError" || err.code === "ABORT_ERR") {
      logToolExecution({ tool: "classifierHealth", status: "timeout", durationMs, code: "TIMEOUT" });
      const res = fail("TIMEOUT", "Classifier health request timed out");
      res.durationMs = durationMs;
      return res;
    }
    logToolExecution({ tool: "classifierHealth", status: "error", durationMs, code: "NETWORK" });
    const res = fail("NETWORK", "Network error contacting classifier health endpoint");
    res.durationMs = durationMs;
    return res;
  }
}
