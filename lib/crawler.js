/**
 * lib/crawler.js
 *
 * HTTP client for the Node/Playwright crawler microservice.
 *
 * Rules:
 * - Starts a job with the `x-api-key` header (`POST /api/crawl`).
 * - Polls every 1s up to the service time limit plus 15s (`GET /api/crawl/:jobId`).
 * - DELETEs the job on timeout (`DELETE /api/crawl/:jobId`).
 * - Validates the result with CrawlResultSchema.
 * - Never throws; returns structured ok / error objects.
 * - If CRAWLER_URL is set and CRAWLER_API_KEY is missing, returns CRAWLER_UNAVAILABLE
 *   with reason "crawler_not_configured" without making any HTTP request.
 * - Never logs URLs with query strings or page content.
 */

import { env } from "./env.js";
import { CrawlResultSchema } from "./contracts/crawl.js";

const DEFAULT_SERVICE_URL = "http://127.0.0.1:3001";
const DEFAULT_CRAWL_TIMEOUT_SEC = 60;
const EXTRA_POLL_MARGIN_SEC = 15;

/**
 * Strips query parameters and fragments for safe logging.
 *
 * @param {string} rawUrl
 * @returns {string} Sanitized URL
 */
export function sanitizeUrlForLog(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[invalid-url]";
  }
}

/**
 * Triggers a crawl on the crawler service and polls for the result.
 *
 * @param {string} targetUrl
 * @param {object} [options={}]
 * @param {number} [options.maxPages=10]
 * @param {number} [options.maxDepth=2]
 * @param {number} [options.totalTimeSec=60]
 * @param {boolean} [options.sameHostOnly=true]
 * @param {string} [options.url] Custom crawler service base URL
 * @param {string} [options.apiKey] Custom crawler API key
 * @param {object} [options.customEnv] Custom environment overrides
 * @param {typeof fetch} [options.fetchFn=globalThis.fetch]
 * @param {(ms: number) => Promise<void>} [options.sleepFn]
 * @returns {Promise<{ ok: true, result: object } | { ok: false, code: string, reason: string, details?: any }>}
 */
export async function runCrawl(targetUrl, options = {}) {
  const customEnv = options.customEnv;
  const baseUrl = (options.url || customEnv?.CRAWLER_URL || env.CRAWLER_URL || DEFAULT_SERVICE_URL).replace(/\/+$/, "");
  const apiKey = options.apiKey !== undefined ? options.apiKey : (customEnv?.CRAWLER_API_KEY !== undefined ? customEnv.CRAWLER_API_KEY : env.CRAWLER_API_KEY);

  // Invariant B3: If CRAWLER_URL is used and key is missing, return typed error without request
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      ok: false,
      code: "CRAWLER_UNAVAILABLE",
      reason: "crawler_not_configured",
    };
  }

  const fetchFn = options.fetchFn || globalThis.fetch;
  const sleepFn = options.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const totalTimeSec = options.totalTimeSec || DEFAULT_CRAWL_TIMEOUT_SEC;
  const maxPollDurationMs = (totalTimeSec + EXTRA_POLL_MARGIN_SEC) * 1000;

  let jobId = null;

  try {
    // 1. Submit crawl job
    const postRes = await fetchFn(`${baseUrl}/api/crawl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
        Accept: "application/json",
      },
      body: JSON.stringify({
        url: targetUrl,
        maxPages: options.maxPages || 10,
        maxDepth: options.maxDepth !== undefined ? options.maxDepth : 2,
        totalTimeSec,
        sameHostOnly: options.sameHostOnly !== false,
      }),
    });

    if (postRes.status === 401) {
      return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "unauthorized" };
    }
    if (postRes.status === 429 || postRes.status === 503) {
      return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "busy" };
    }
    if (postRes.status === 400) {
      const errBody = await postRes.json().catch(() => ({}));
      return { ok: false, code: "CRAWL_NOT_ALLOWED", reason: errBody.error || "bad_request" };
    }
    if (!postRes.ok) {
      return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: `upstream_error_${postRes.status}` };
    }

    const postData = await postRes.json().catch(() => null);
    if (!postData || !postData.jobId) {
      return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "invalid_response" };
    }

    jobId = postData.jobId;

    // 2. Poll job status
    const startTime = Date.now();
    while (Date.now() - startTime < maxPollDurationMs) {
      await sleepFn(1000);

      let statusRes;
      try {
        statusRes = await fetchFn(`${baseUrl}/api/crawl/${jobId}`, {
          method: "GET",
          headers: {
            "x-api-key": apiKey.trim(),
            Accept: "application/json",
          },
        });
      } catch {
        return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "service_down" };
      }

      if (statusRes.status === 401) {
        return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "unauthorized" };
      }
      if (statusRes.status === 404) {
        return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "job_not_found" };
      }
      if (!statusRes.ok) {
        return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: `upstream_error_${statusRes.status}` };
      }

      const statusData = await statusRes.json().catch(() => null);
      if (!statusData || typeof statusData.status !== "string") {
        return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "invalid_response" };
      }

      if (statusData.status === "completed") {
        const rawResult = statusData.result;
        if (!rawResult) {
          // Attempt dedicated result endpoint
          const resRes = await fetchFn(`${baseUrl}/api/crawl/${jobId}/result`, {
            method: "GET",
            headers: { "x-api-key": apiKey.trim(), Accept: "application/json" },
          }).catch(() => null);
          if (resRes && resRes.ok) {
            const fetchedResult = await resRes.json().catch(() => null);
            const parsed = CrawlResultSchema.safeParse(fetchedResult);
            if (parsed.success) {
              return { ok: true, result: parsed.data };
            }
          }
          return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "invalid_response" };
        }

        const parsed = CrawlResultSchema.safeParse(rawResult);
        if (!parsed.success) {
          return {
            ok: false,
            code: "CRAWLER_UNAVAILABLE",
            reason: "invalid_response",
            details: parsed.error.issues,
          };
        }
        return { ok: true, result: parsed.data };
      }

      if (statusData.status === "failed") {
        return {
          ok: false,
          code: "CRAWLER_UNAVAILABLE",
          reason: statusData.errors?.[0] || "crawl_failed",
        };
      }

      if (statusData.status === "cancelled") {
        return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "crawl_cancelled" };
      }

      // If queued or running, continue loop
    }

    // 3. Timeout reached: send cancellation request
    if (jobId) {
      fetchFn(`${baseUrl}/api/crawl/${jobId}`, {
        method: "DELETE",
        headers: { "x-api-key": apiKey.trim() },
      }).catch(() => {});
    }

    return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "timeout" };
  } catch (err) {
    if (jobId) {
      fetchFn(`${baseUrl}/api/crawl/${jobId}`, {
        method: "DELETE",
        headers: { "x-api-key": apiKey?.trim() || "" },
      }).catch(() => {});
    }
    return { ok: false, code: "CRAWLER_UNAVAILABLE", reason: "service_down", details: err.message };
  }
}
