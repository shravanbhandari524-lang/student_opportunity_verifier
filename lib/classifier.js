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
 * Classifies message or offer text using the Python ML classifier service.
 *
 * @param {string} text The text to classify
 * @param {object} [options]
 * @param {string} [options.url] Override classifier service URL
 * @param {number} [options.timeoutMs=3000]
 * @param {object} [options.customEnv] Custom environment overrides
 * @param {typeof fetch} [options.fetchFn=globalThis.fetch]
 * @returns {Promise<import("./contracts/tool-result.js").ToolResult>}
 */
export async function classifyText(text, {
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  customEnv,
  fetchFn = globalThis.fetch,
} = {}) {
  const start = Date.now();

  if (typeof text !== "string" || !text.trim()) {
    logToolExecution({ tool: "classifier", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
    return fail("INVALID_INPUT", "Text cannot be empty for classification");
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

    if (response.status === 429) {
      logToolExecution({ tool: "classifier", status: "error", durationMs: Date.now() - start, code: "RATE_LIMITED" });
      return fail("RATE_LIMITED", "Classifier rate limit reached");
    }

    if (!response.ok) {
      logToolExecution({ tool: "classifier", status: "error", durationMs: Date.now() - start, code: "UPSTREAM_ERROR" });
      return fail("UPSTREAM_ERROR", `Classifier service responded with HTTP ${response.status}`);
    }

    let json;
    try {
      json = await response.json();
    } catch {
      logToolExecution({ tool: "classifier", status: "error", durationMs: Date.now() - start, code: "PARSE_ERROR" });
      return fail("PARSE_ERROR", "Invalid JSON from classifier service");
    }

    const parseResult = ClassifierResultSchema.safeParse(json);
    if (!parseResult.success) {
      logToolExecution({ tool: "classifier", status: "error", durationMs: Date.now() - start, code: "PARSE_ERROR" });
      return fail("PARSE_ERROR", `Classifier response failed schema validation: ${parseResult.error.message}`);
    }

    logToolExecution({ tool: "classifier", status: "ok", durationMs: Date.now() - start, cached: false });
    return ok(parseResult.data, false);
  } catch (err) {
    if (err.name === "AbortError" || err.code === "ABORT_ERR") {
      logToolExecution({ tool: "classifier", status: "timeout", durationMs: Date.now() - start, code: "TIMEOUT" });
      return fail("TIMEOUT", "Classifier request timed out");
    }
    logToolExecution({ tool: "classifier", status: "error", durationMs: Date.now() - start, code: "NETWORK" });
    return fail("NETWORK", "Network error contacting classifier service");
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

    if (!response.ok) {
      logToolExecution({ tool: "classifierHealth", status: "error", durationMs: Date.now() - start, code: "UPSTREAM_ERROR" });
      return fail("UPSTREAM_ERROR", `Classifier health check returned HTTP ${response.status}`);
    }

    const json = await response.json();
    logToolExecution({ tool: "classifierHealth", status: "ok", durationMs: Date.now() - start, cached: false });
    return ok(json, false);
  } catch (err) {
    if (err.name === "AbortError" || err.code === "ABORT_ERR") {
      logToolExecution({ tool: "classifierHealth", status: "timeout", durationMs: Date.now() - start, code: "TIMEOUT" });
      return fail("TIMEOUT", "Classifier health request timed out");
    }
    logToolExecution({ tool: "classifierHealth", status: "error", durationMs: Date.now() - start, code: "NETWORK" });
    return fail("NETWORK", "Network error contacting classifier health endpoint");
  }
}
