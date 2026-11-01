/**
 * lib/tools/urlscan.js
 *
 * urlscan.io public search tool for Layer L2.
 *
 * Official urlscan.io API Documentation:
 * https://urlscan.io/docs/api/
 * GET https://urlscan.io/api/v1/search/?q=<query>
 *
 * Headers:
 *   API-Key: <key> (optional for public search, but required if configured or rate limited)
 *
 * Rules:
 * - Query existing public scans only.
 * - NO submission (/api/v1/scan/) and NO Pro endpoints.
 * - Cache TTL: 1 hour (3,600s).
 * - Cache key: 'urlscan:' + hashKey(query)
 * - Result shape:
 *   {
 *     total: number,
 *     results: [{
 *       resultUrl: string,
 *       scanDate: string,
 *       pageDomain: string
 *     }]
 *   }
 * - Invariant: Absence of results ({ total: 0, results: [] }) is NEVER described as "safe".
 * - Error handling:
 *   - 401 / 403 -> fail("AUTH", ...)
 *   - 429 -> fail("RATE_LIMITED", ...)
 *   - 5xx -> fail("UPSTREAM_ERROR", ...)
 *   - Timeout / abort -> fail("TIMEOUT", ...)
 *   - Network error -> fail("NETWORK", ...)
 */

import { env } from "../env.js";
import { normalizeDomain } from "../contracts/normalize.js";
import { ok, fail, withTimeout, cachedTool, logToolExecution, hashKey } from "./base.js";

const URLSCAN_SEARCH_ENDPOINT = "https://urlscan.io/api/v1/search/";
const URLSCAN_CACHE_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Searches public scans on urlscan.io by domain or URL.
 *
 * @param {object} target
 * @param {string} [target.domain]
 * @param {string} [target.url]
 * @param {number} [target.size=10] Max number of results to return (capped at 100)
 * @param {object} [options]
 * @param {object} [options.customEnv] Custom environment overrides
 * @param {typeof fetch} [options.fetchFn]
 * @param {object} [options.db]
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function urlscanSearch(target = {}, {
  customEnv,
  fetchFn = globalThis.fetch,
  db,
} = {}) {
  const start = Date.now();

  const isDomain = Boolean(target.domain);
  const isUrl = Boolean(target.url);

  if ((!isDomain && !isUrl) || (isDomain && isUrl)) {
    logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
    return fail("INVALID_INPUT", "Must provide exactly one of target.domain or target.url");
  }

  let searchQuery = "";
  if (isDomain) {
    const norm = normalizeDomain(target.domain);
    if (!norm) {
      logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
      return fail("INVALID_INPUT", "Invalid domain format for urlscan search");
    }
    searchQuery = `domain:${norm}`;
  } else {
    // Strip trailing slash / whitespace
    const cleanUrl = String(target.url).trim();
    if (!cleanUrl) {
      logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
      return fail("INVALID_INPUT", "Invalid url for urlscan search");
    }
    searchQuery = `page.url:"${cleanUrl.replace(/"/g, "")}"`;
  }

  const cacheKey = `urlscan:${hashKey(searchQuery)}`;

  return cachedTool(cacheKey, URLSCAN_CACHE_TTL_SECONDS, async () => {
    const apiKey = customEnv?.URLSCAN_API_KEY ?? env.URLSCAN_API_KEY;

    const requestHeaders = {
      Accept: "application/json",
    };
    if (apiKey) {
      requestHeaders["API-Key"] = apiKey;
    }

    const url = `${URLSCAN_SEARCH_ENDPOINT}?q=${encodeURIComponent(searchQuery)}&size=10`;

    try {
      const response = await withTimeout(async (signal) => {
        return await fetchFn(url, {
          method: "GET",
          headers: requestHeaders,
          signal,
        });
      }, 10000);

      if (response.status === 401 || response.status === 403) {
        logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "AUTH" });
        return fail("AUTH", "urlscan API authentication failed");
      }

      if (response.status === 429) {
        logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "RATE_LIMITED" });
        return fail("RATE_LIMITED", "urlscan API rate limit reached");
      }

      if (!response.ok) {
        // urlscan returns 400 with "Invalid API key format" when an invalid or malformed key is provided
        try {
          const errJson = await response.json();
          if (response.status === 400 && String(errJson?.message || "").includes("API key")) {
            logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "AUTH" });
            return fail("AUTH", `urlscan API authentication failed: ${errJson.message}`);
          }
        } catch {
          // Fall through to generic UPSTREAM_ERROR
        }
        logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "UPSTREAM_ERROR" });
        return fail("UPSTREAM_ERROR", `urlscan API responded with HTTP ${response.status}`);
      }

      let json;
      try {
        json = await response.json();
      } catch {
        logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "PARSE_ERROR" });
        return fail("PARSE_ERROR", "Invalid JSON from urlscan API");
      }

      const total = typeof json?.total === "number" ? json.total : 0;
      const rawResults = Array.isArray(json?.results) ? json.results : [];

      const normalizedResults = rawResults.map((item) => ({
        resultUrl: item.result || `https://urlscan.io/result/${item._id}/`,
        scanDate: item.task?.time || null,
        pageDomain: item.page?.domain || null,
      }));

      logToolExecution({ tool: "urlscanSearch", status: "ok", durationMs: Date.now() - start, cached: false });
      return ok({
        total,
        results: normalizedResults,
      }, false);
    } catch (err) {
      if (err.name === "AbortError" || err.code === "ABORT_ERR") {
        logToolExecution({ tool: "urlscanSearch", status: "timeout", durationMs: Date.now() - start, code: "TIMEOUT" });
        return fail("TIMEOUT", "urlscan API request timed out");
      }
      logToolExecution({ tool: "urlscanSearch", status: "error", durationMs: Date.now() - start, code: "NETWORK" });
      return fail("NETWORK", "Network error contacting urlscan API");
    }
  }, db, "urlscanSearch");
}
