/**
 * lib/tools/urlhaus.js
 *
 * abuse.ch URLhaus threat feed lookup tool for Layer L2.
 *
 * Official URLhaus API Documentation:
 * https://urlhaus-api.abuse.ch/
 * POST https://urlhaus-api.abuse.ch/v1/url/ (parameter 'url')
 * POST https://urlhaus-api.abuse.ch/v1/host/ (parameter 'host')
 * Request format: application/x-www-form-urlencoded or multipart/form-data
 * Header:
 *   Auth-Key: <token> (required for API access)
 *
 * Response fields:
 * - query_status: "ok", "no_results", "invalid_url", "invalid_host", etc.
 * - threat: string (e.g. "malware_download")
 * - url_status: string (e.g. "online", "offline")
 * - date_added: string (UTC timestamp)
 * - tags: string[]
 * - urlhaus_reference: string (link to URLhaus incident)
 *
 * Rules:
 * - Cache TTL: 1 hour (3,600s).
 * - Cache key: 'urlhaus:' + hashKey(target)
 * - Safety Invariant: Absence of findings (query_status == "no_results" or HTTP 404) is { listed: false },
 *   NEVER described as "safe" in comments, field names, or messages.
 * - Missing Auth-Key -> fail("NO_KEY", ...)
 * - 401 / 403 -> fail("AUTH", ...)
 * - 429 -> fail("RATE_LIMITED", ...)
 * - NEVER fetch or open the looked-up URL or host.
 */

import { env } from "../env.js";
import { normalizeDomain } from "../contracts/normalize.js";
import { ok, fail, withTimeout, cachedTool, logToolExecution, hashKey } from "./base.js";

const URLHAUS_URL_ENDPOINT = "https://urlhaus-api.abuse.ch/v1/url/";
const URLHAUS_HOST_ENDPOINT = "https://urlhaus-api.abuse.ch/v1/host/";
const URLHAUS_CACHE_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Looks up a URL or host in the abuse.ch URLhaus feed.
 *
 * @param {object} target
 * @param {string} [target.url]
 * @param {string} [target.host]
 * @param {object} [options]
 * @param {object} [options.customEnv] Custom environment overrides
 * @param {typeof fetch} [options.fetchFn]
 * @param {object} [options.db]
 * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export async function urlhausLookup(target = {}, {
  customEnv,
  fetchFn = globalThis.fetch,
  db,
} = {}) {
  const start = Date.now();

  const isUrl = Boolean(target.url);
  const isHost = Boolean(target.host);

  if ((!isUrl && !isHost) || (isUrl && isHost)) {
    logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
    return fail("INVALID_INPUT", "Must provide exactly one of target.url or target.host");
  }

  let endpoint;
  let bodyParam;
  let targetKey;

  if (isUrl) {
    endpoint = URLHAUS_URL_ENDPOINT;
    bodyParam = new URLSearchParams({ url: target.url }).toString();
    targetKey = `url:${target.url}`;
  } else {
    const normHost = normalizeDomain(target.host);
    if (!normHost) {
      logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
      return fail("INVALID_INPUT", "Invalid host format");
    }
    endpoint = URLHAUS_HOST_ENDPOINT;
    bodyParam = new URLSearchParams({ host: normHost }).toString();
    targetKey = `host:${normHost}`;
  }

  const cacheKey = `urlhaus:${hashKey(targetKey)}`;

  return cachedTool(cacheKey, URLHAUS_CACHE_TTL_SECONDS, async () => {
    const authKey = customEnv?.URLHAUS_AUTH_KEY ?? env.URLHAUS_AUTH_KEY;
    if (!authKey) {
      logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "NO_KEY" });
      return fail("NO_KEY", "URLhaus Auth-Key is not configured");
    }

    try {
      const response = await withTimeout(async (signal) => {
        return await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Auth-Key": authKey,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: bodyParam,
          signal,
        });
      }, 10000);

      if (response.status === 401 || response.status === 403) {
        logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "AUTH" });
        return fail("AUTH", "URLhaus API authentication failed");
      }

      if (response.status === 429) {
        logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "RATE_LIMITED" });
        return fail("RATE_LIMITED", "URLhaus API rate limit reached");
      }

      if (response.status === 404) {
        // Not found in threat feed -> unlisted fact
        logToolExecution({ tool: "urlhaus", status: "ok", durationMs: Date.now() - start, cached: false });
        return ok({
          listed: false,
          threat: null,
          urlStatus: null,
          dateAdded: null,
          tags: [],
          reference: null,
        }, false);
      }

      if (!response.ok) {
        logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "UPSTREAM_ERROR" });
        return fail("UPSTREAM_ERROR", `URLhaus API responded with HTTP ${response.status}`);
      }

      let json;
      try {
        json = await response.json();
      } catch {
        logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "PARSE_ERROR" });
        return fail("PARSE_ERROR", "Invalid JSON from URLhaus API");
      }

      if (json.query_status === "no_results") {
        logToolExecution({ tool: "urlhaus", status: "ok", durationMs: Date.now() - start, cached: false });
        return ok({
          listed: false,
          threat: null,
          urlStatus: null,
          dateAdded: null,
          tags: [],
          reference: null,
        }, false);
      }

      if (json.query_status === "ok") {
        logToolExecution({ tool: "urlhaus", status: "ok", durationMs: Date.now() - start, cached: false });
        return ok({
          listed: true,
          threat: json.threat || json.firstseen || "malware",
          urlStatus: json.url_status || null,
          dateAdded: json.date_added || null,
          tags: Array.isArray(json.tags) ? json.tags : [],
          reference: json.urlhaus_reference || null,
        }, false);
      }

      // Other query statuses like "invalid_url" or "invalid_host"
      logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "INVALID_INPUT" });
      return fail("INVALID_INPUT", `URLhaus returned query status: ${json.query_status}`);
    } catch (err) {
      if (err.name === "AbortError" || err.code === "ABORT_ERR") {
        logToolExecution({ tool: "urlhaus", status: "timeout", durationMs: Date.now() - start, code: "TIMEOUT" });
        return fail("TIMEOUT", "URLhaus API request timed out");
      }
      logToolExecution({ tool: "urlhaus", status: "error", durationMs: Date.now() - start, code: "NETWORK" });
      return fail("NETWORK", "Network error contacting URLhaus API");
    }
  }, db, "urlhaus");
}
