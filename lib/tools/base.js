/**
 * lib/tools/base.js
 *
 * Base utilities and helpers for L2 tools:
 * - ok() and fail() helpers producing ToolResult
 * - withTimeout(fn, timeoutMs) using AbortController (default 10s)
 * - cachedTool(key, ttlSeconds, fn) using lib/cache.js (cache keys hash user-derived input; only successful results cached)
 * - context shape { checkId, budget, now } where budget is { remaining }
 * - logging of tool name, status, duration, cached, and error code only (NEVER URLs, queries or bodies)
 */

import crypto from "node:crypto";
import { get as cacheGet, set as cacheSet, isCacheDisabled } from "../cache.js";
import { logger } from "../logger.js";

/**
 * Creates a successful ToolResult.
 *
 * @template T
 * @param {T} data
 * @param {boolean} [cached=false]
 * @param {string} [fetchedAt] ISO string
 * @returns {import("../contracts/tool-result.js").ToolResult}
 */
export function ok(data, cached = false, fetchedAt = new Date().toISOString()) {
  return {
    ok: true,
    data,
    cached,
    fetchedAt,
  };
}

import { TOOL_ERROR_CODES } from "../contracts/enums.js";

const VALID_ERROR_CODES = new Set(TOOL_ERROR_CODES);

/**
 * Creates a failed ToolResult.
 * Does not throw. If an invalid or unknown code is provided, it maps to UPSTREAM_ERROR
 * and logs a warning with the code name only.
 * Message MUST NEVER contain secrets, request URLs with keys, or response bodies.
 *
 * @param {import("../contracts/tool-result.js").ToolErrorCode | string} code
 * @param {string} message
 * @returns {import("../contracts/tool-result.js").ToolResult}
 */
export function fail(code, message) {
  let resolvedCode = code;
  if (!VALID_ERROR_CODES.has(code)) {
    logger.warn({ tool: "base", event: "unknown_error_code", originalCode: String(code) });
    resolvedCode = "UPSTREAM_ERROR";
  }
  return {
    ok: false,
    error: {
      code: resolvedCode,
      message,
    },
  };
}

/**
 * Wraps an async function with an AbortController timeout.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<T>}
 */
export async function withTimeout(fn, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hashes a string using SHA-256 for safe, fixed-length cache keys without user data leakage.
 * @param {string} input
 * @returns {string}
 */
export function hashKey(input) {
  return crypto.createHash("sha256").update(String(input).trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * Executes a tool function with TTL caching.
 * Caches ONLY successful results ({ ok: true }). Failures are NEVER cached.
 * Emits logToolExecution on cache hits (with cached: true) and on fresh execution.
 *
 * @template T
 * @param {string} cacheKey Safe cache key (e.g. prefix + hashKey(input))
 * @param {number} ttlSeconds Time-to-live in seconds
 * @param {() => Promise<import("../contracts/tool-result.js").ToolResult>} fn
 * @param {object} [db]
 * @param {string} [toolName="tool"] Name of tool for logging
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function cachedTool(cacheKey, ttlSeconds, fn, db, toolName) {
  if (isCacheDisabled()) {
    return await fn();
  }
  const start = Date.now();
  const cached = cacheGet(cacheKey, db);
  if (cached) {
    if (toolName) {
      logToolExecution({
        tool: toolName,
        status: "ok",
        durationMs: Date.now() - start,
        cached: true,
      });
    }
    return ok(cached.data, true, cached.fetchedAt || new Date().toISOString());
  }

  const result = await fn();
  if (result.ok) {
    cacheSet(cacheKey, { data: result.data, fetchedAt: result.fetchedAt }, ttlSeconds, db);
  }
  return result;
}

/**
 * Creates a standard execution context for tools.
 *
 * @param {object} options
 * @param {string} [options.checkId]
 * @param {number} [options.budgetRemaining=10]
 * @param {Date} [options.now]
 * @returns {{ checkId: string, budget: { remaining: number }, now: string }}
 */
export function createToolContext({ checkId = "standalone", budgetRemaining = 10, now = new Date() } = {}) {
  return {
    checkId,
    budget: { remaining: budgetRemaining },
    now: now.toISOString(),
  };
}

/**
 * Logs tool execution safely.
 * Redaction invariant: logs tool name, status, duration, cached, and error code only.
 * NEVER logs URLs, queries, headers, or response bodies.
 *
 * @param {object} params
 * @param {string} params.tool Name of the tool
 * @param {string} params.status "ok" | "error" | "timeout"
 * @param {number} params.durationMs
 * @param {boolean} [params.cached=false]
 * @param {string} [params.code]
 */
export function logToolExecution({ tool, status, durationMs, cached = false, code }) {
  const payload = {
    tool,
    status,
    durationMs,
    cached,
  };
  if (code) {
    payload.code = code;
  }

  if (status === "ok") {
    logger.info(payload);
  } else {
    logger.warn(payload);
  }
}
