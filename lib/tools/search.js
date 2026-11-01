/**
 * lib/tools/search.js
 *
 * Web search tool interface and Serper provider adapter for Layer L2.
 *
 * Official Serper API Documentation:
 * https://serper.dev/playground
 * POST https://google.serper.dev/search
 * Headers:
 *   X-API-KEY: <key>
 *   Content-Type: application/json
 * Request Body:
 *   { q: string, gl: "in", hl: "en", num: number }
 * Response:
 *   { organic: [{ title, link, snippet, position }] }
 *
 * Budget & Cache Rules:
 * - Default budget: 8 queries per check run.
 * - Cache TTL: 6 hours (21,600s).
 * - Cache key: 'search:' + hashKey(query + ':' + gl + ':' + hl)
 * - Cache hits cost 0 from the budget.
 * - Uncached queries decrement budget.remaining by 1.
 * - When budget.remaining <= 0, returns fail("BUDGET_EXCEEDED", ...).
 * - Error handling:
 *   - Missing key -> fail("NO_KEY", ...)
 *   - 401 / 403 -> fail("AUTH", ...)
 *   - 429 -> fail("RATE_LIMITED", ...)
 *   - 5xx -> fail("UPSTREAM_ERROR", ...)
 *   - Timeout / abort -> fail("TIMEOUT", ...)
 *   - Network error -> fail("NETWORK", ...)
 */

import { env } from "../env.js";
import { ok, fail, withTimeout, cachedTool, logToolExecution, hashKey } from "./base.js";

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const SEARCH_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * Executes a web search using the configured provider (default: Serper).
 *
 * @param {string} query Search query string
 * @param {object} [options]
 * @param {object} [options.context] Tool context { checkId, budget: { remaining }, now }
 * @param {string} [options.gl="in"] Geolocation for results (India)
 * @param {string} [options.hl="en"] Host language (English)
 * @param {number} [options.num=10] Number of results requested
 * @param {object} [options.customEnv] Custom environment overrides
 * @param {typeof fetch} [options.fetchFn] Custom fetch function
 * @param {object} [options.db] Database instance for cache
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function search(query, {
  context,
  gl = "in",
  hl = "en",
  num = 10,
  customEnv,
  fetchFn = globalThis.fetch,
  db,
} = {}) {
  const start = Date.now();

  if (typeof query !== "string" || !query.trim()) {
    logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
    return fail("INVALID_INPUT", "Search query cannot be empty");
  }

  const trimmedQuery = query.trim();
  const cacheKey = `search:${hashKey(`${trimmedQuery}:${gl}:${hl}`)}`;

  // Use cachedTool to check cache first. Note: If it's a cache hit, cachedTool handles logging.
  return cachedTool(cacheKey, SEARCH_CACHE_TTL_SECONDS, async () => {
    // Check budget before making external call
    if (context && context.budget) {
      if (typeof context.budget.remaining === "number") {
        if (context.budget.remaining <= 0) {
          logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "BUDGET_EXCEEDED" });
          return fail("BUDGET_EXCEEDED", "Search query budget exceeded for this run");
        }
      }
    }

    const apiKey = customEnv?.SEARCH_API_KEY ?? env.SEARCH_API_KEY;
    if (!apiKey) {
      logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "NO_KEY" });
      return fail("NO_KEY", "Search API key is not configured");
    }

    try {
      const response = await withTimeout(async (signal) => {
        return await fetchFn(SERPER_ENDPOINT, {
          method: "POST",
          headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            q: trimmedQuery,
            gl,
            hl,
            num,
          }),
          signal,
        });
      }, 10000);

      if (!response.ok) {
        let safeDetail = "";
        try {
          const errJson = await response.json();
          if (errJson && typeof errJson.message === "string") {
            safeDetail = errJson.message;
          }
        } catch {
          try {
            safeDetail = await response.text();
          } catch {
            // Ignore text read error
          }
        }

        // Redact anything key-like (20+ alphanumeric, hyphens or underscores) and cap at 100 characters
        if (safeDetail) {
          safeDetail = safeDetail
            .replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
            .trim()
            .slice(0, 100);
        }

        if (response.status === 401 || response.status === 403) {
          logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "AUTH" });
          return fail("AUTH", safeDetail ? `Search API authentication failed: ${safeDetail}` : "Search API authentication failed");
        }

        if (response.status === 429) {
          logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "RATE_LIMITED" });
          return fail("RATE_LIMITED", safeDetail ? `Search API rate limit reached: ${safeDetail}` : "Search API rate limit reached");
        }

        logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "UPSTREAM_ERROR" });
        return fail(
          "UPSTREAM_ERROR",
          safeDetail
            ? `Search API responded with HTTP ${response.status}: ${safeDetail}`
            : `Search API responded with HTTP ${response.status}`
        );
      }

      let json;
      try {
        json = await response.json();
      } catch {
        logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "PARSE_ERROR" });
        return fail("PARSE_ERROR", "Invalid JSON from search provider");
      }

      const organic = Array.isArray(json?.organic) ? json.organic : [];
      const normalizedResults = organic.map((item, index) => ({
        title: item.title || "",
        url: item.link || "",
        snippet: item.snippet || "",
        position: typeof item.position === "number" ? item.position : index + 1,
      }));

      // Decrement budget on successful fresh call
      if (context && context.budget && typeof context.budget.remaining === "number") {
        context.budget.remaining -= 1;
      }

      logToolExecution({ tool: "search", status: "ok", durationMs: Date.now() - start, cached: false });
      return ok({
        query: trimmedQuery,
        total: normalizedResults.length,
        results: normalizedResults,
      }, false);
    } catch (err) {
      if (err.name === "AbortError" || err.code === "ABORT_ERR") {
        logToolExecution({ tool: "search", status: "timeout", durationMs: Date.now() - start, code: "TIMEOUT" });
        return fail("TIMEOUT", "Search API request timed out");
      }
      logToolExecution({ tool: "search", status: "error", durationMs: Date.now() - start, code: "NETWORK" });
      return fail("NETWORK", "Network error contacting search API");
    }
  }, db, "search");
}
