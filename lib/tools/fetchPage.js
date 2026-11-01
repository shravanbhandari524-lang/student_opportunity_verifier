/**
 * lib/tools/fetchPage.js
 *
 * Web page fetcher with SSRF protection, redirect verification, size limits,
 * timeout, and clean text/metadata extraction.
 *
 * Rules:
 * - Factory pattern createFetchPage({ resolve, request }) for easy test injection.
 * - Enforces assertPublicUrl on initial URL and on EVERY redirect hop.
 * - Follows at most 3 redirects manually.
 * - Aborts if target is blocked, redirect goes to forbidden address, or redirects > 3.
 * - Total timeout: 8000ms.
 * - Content-Type allowlist: text/html, application/xhtml+xml, text/plain.
 * - Max body size: 1MB (1,048,576 bytes) decoded. Aborts if exceeded.
 * - Strips script, style, noscript, iframe, svg, and form/input elements using cheerio.
 * - Extracts:
 *     title (trimmed, max 300 chars)
 *     metaDescription (trimmed, max 500 chars)
 *     text (trimmed, normalized whitespace, max 20,000 chars)
 *     links (unique absolute http/https URLs, max 50)
 * - Connects directly to pinnedIp while sending the original Host header and TLS SNI.
 * - NEVER executes JavaScript or follows meta-refresh.
 * - Returns ok({ finalUrl, title, metaDescription, text, links }) or fail(code, message).
 * - Never throws.
 */

import http from "node:http";
import https from "node:https";
import * as cheerio from "cheerio";
import { ok, fail, withTimeout, logToolExecution } from "./base.js";
import { assertPublicUrl, SSRFError } from "./ssrf.js";

const MAX_REDIRECTS = 3;
const MAX_BYTES = 1024 * 1024; // 1MB
const TOTAL_TIMEOUT_MS = 8000;
const MAX_TEXT_CHARS = 20000;
const MAX_TITLE_CHARS = 300;
const MAX_DESC_CHARS = 500;
const MAX_LINKS = 50;

const ALLOWED_CONTENT_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
];

/**
 * Default network transport connecting directly to pinnedIp.
 * Sends the target hostname as the Host header and TLS SNI servername.
 *
 * @param {object} options
 * @param {URL} options.urlObj
 * @param {string} options.pinnedIp
 * @param {AbortSignal} options.signal
 * @returns {Promise<{ statusCode: number, headers: Record<string, string>, body: Buffer }>}
 */
async function defaultRequest({ urlObj, pinnedIp, signal }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(new Error("Request aborted"));
    }

    const isHttps = urlObj.protocol === "https:";
    const transport = isHttps ? https : http;
    const port = urlObj.port ? Number(urlObj.port) : (isHttps ? 443 : 80);

    const reqOptions = {
      host: pinnedIp, // connect to pinned IP to prevent DNS rebinding
      port,
      path: `${urlObj.pathname}${urlObj.search}`,
      method: "GET",
      headers: {
        Host: urlObj.host, // original Host header
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (StudentOpportunityVerifier/1.0; +https://example.test)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Mode": "navigate",
      },
      servername: isHttps ? urlObj.hostname : undefined, // SNI
    };

    const req = transport.request(reqOptions, (res) => {
      const chunks = [];
      let totalBytes = 0;

      res.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          req.destroy(new Error(`Response exceeded maximum size of ${MAX_BYTES} bytes`));
        } else {
          chunks.push(chunk);
        }
      });

      res.on("end", () => {
        const headers = {};
        for (const [key, val] of Object.entries(res.headers)) {
          headers[key.toLowerCase()] = Array.isArray(val) ? val.join(", ") : val || "";
        }
        resolve({
          statusCode: res.statusCode || 200,
          headers,
          body: Buffer.concat(chunks),
        });
      });

      res.on("error", (err) => {
        reject(err);
      });
    });

    const onAbort = () => {
      req.destroy(new Error("Request timeout/aborted"));
      reject(new Error("Request timeout/aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    req.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });

    req.end();
  });
}

/**
 * Checks if the content-type header is allowed.
 * @param {string} [contentTypeHeader]
 * @returns {boolean}
 */
function isAllowedContentType(contentTypeHeader) {
  if (!contentTypeHeader) {
    // Some basic web servers do not send content-type; check cautiously
    return true;
  }
  const mime = contentTypeHeader.split(";")[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.includes(mime);
}

/**
 * Cleans and extracts HTML data using cheerio.
 *
 * @param {string} htmlContent
 * @param {string} pageUrl
 * @returns {{ title: string, metaDescription: string, text: string, links: string[] }}
 */
export function extractPageData(htmlContent, pageUrl) {
  const $ = cheerio.load(htmlContent);

  // Remove dangerous or non-content tags
  $("script, style, noscript, iframe, svg, form, input, button, select, textarea, audio, video").remove();

  const rawTitle = $("title").first().text() || $('meta[property="og:title"]').attr("content") || "";
  const title = rawTitle.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);

  const rawDesc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";
  const metaDescription = rawDesc.replace(/\s+/g, " ").trim().slice(0, MAX_DESC_CHARS);

  // Clean text from body
  const rawBodyText = $("body").text() || $.text();
  const text = rawBodyText
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  // Extract links
  const linksSet = new Set();
  let baseOrigin = "";
  try {
    baseOrigin = new URL(pageUrl).origin;
  } catch {
    baseOrigin = "";
  }

  $("a[href]").each((_, el) => {
    if (linksSet.size >= MAX_LINKS) return;
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, pageUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        // Exclude userinfo in resolved links
        resolved.username = "";
        resolved.password = "";
        // Strip fragment
        resolved.hash = "";
        linksSet.add(resolved.toString());
      }
    } catch {
      // Ignore unparseable link
    }
  });

  return {
    title,
    metaDescription,
    text,
    links: Array.from(linksSet).slice(0, MAX_LINKS),
  };
}

/**
 * Factory creating the fetchPage tool function.
 *
 * @param {object} [deps]
 * @param {(host: string) => Promise<string[]>} [deps.resolve] Custom DNS resolver for assertPublicUrl
 * @param {(options: { urlObj: URL, pinnedIp: string, signal: AbortSignal }) => Promise<{ statusCode: number, headers: Record<string, string>, body: Buffer }>} [deps.request]
 * @returns {(targetUrl: string, options?: { timeoutMs?: number }) => Promise<import("../contracts/tool-result.js").ToolResult>}
 */
export function createFetchPage({ resolve, request = defaultRequest } = {}) {
  /**
   * Fetches and parses a public web page securely.
   *
   * @param {string} targetUrl
   * @param {object} [options]
   * @param {number} [options.timeoutMs=8000]
   * @returns {Promise<import("../contracts/tool-result.js").ToolResult>}
   */
  return async function fetchPage(targetUrl, { timeoutMs = TOTAL_TIMEOUT_MS } = {}) {
    const start = Date.now();

    try {
      const result = await withTimeout(async (signal) => {
        let currentUrl = targetUrl;
        let redirectCount = 0;

        while (redirectCount <= MAX_REDIRECTS) {
          // Validate current URL through SSRF guard
          let ssrfCheck;
          try {
            ssrfCheck = await assertPublicUrl(currentUrl, { resolve });
          } catch (err) {
            if (err instanceof SSRFError) {
              return fail("BLOCKED", err.message);
            }
            return fail("NETWORK", `SSRF verification error: ${err.message}`);
          }

          // Execute request using pinned IP
          let res;
          try {
            res = await request({
              urlObj: ssrfCheck.urlObj,
              pinnedIp: ssrfCheck.pinnedIp,
              signal,
            });
          } catch (netErr) {
            if (signal.aborted || netErr.message?.includes("aborted") || netErr.message?.includes("timeout")) {
              return fail("TIMEOUT", "Request timed out or was aborted");
            }
            if (netErr.message?.includes("maximum size")) {
              return fail("UPSTREAM_ERROR", "Page exceeded size limit of 1MB");
            }
            return fail("NETWORK", `Network error: ${netErr.message}`);
          }

          // Check redirects: 301, 302, 303, 307, 308
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            const location = res.headers["location"];
            if (!location) {
              return fail("UPSTREAM_ERROR", `Redirect HTTP ${res.statusCode} missing Location header`);
            }

            redirectCount++;
            if (redirectCount > MAX_REDIRECTS) {
              return fail("UPSTREAM_ERROR", `Too many redirects (exceeded limit of ${MAX_REDIRECTS})`);
            }

            try {
              const nextUrlObj = new URL(location, currentUrl);
              currentUrl = nextUrlObj.toString();
            } catch {
              return fail("INVALID_INPUT", `Invalid redirect target URL: ${location}`);
            }

            continue;
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            return fail("UPSTREAM_ERROR", `Server responded with HTTP status ${res.statusCode}`);
          }

          // Validate Content-Type
          const contentType = res.headers["content-type"];
          if (!isAllowedContentType(contentType)) {
            return fail("UPSTREAM_ERROR", `Unsupported Content-Type: ${contentType || "unknown"}`);
          }

          // Check body size limit if not caught in stream
          if (res.body.length > MAX_BYTES) {
            return fail("UPSTREAM_ERROR", `Page body exceeded size limit of ${MAX_BYTES} bytes`);
          }

          const rawText = res.body.toString("utf-8");
          const extracted = extractPageData(rawText, currentUrl);

          return ok({
            finalUrl: currentUrl,
            title: extracted.title,
            metaDescription: extracted.metaDescription,
            text: extracted.text,
            links: extracted.links,
          });
        }

        return fail("UPSTREAM_ERROR", `Too many redirects`);
      }, timeoutMs);

      logToolExecution({
        tool: "fetchPage",
        status: result.ok ? "ok" : "error",
        durationMs: Date.now() - start,
        code: result.ok ? undefined : result.error.code,
      });

      return result;
    } catch (err) {
      const isTimeout = err.name === "AbortError" || err.message?.includes("aborted") || (Date.now() - start >= timeoutMs);
      const code = isTimeout ? "TIMEOUT" : "INTERNAL";
      const message = isTimeout ? `Operation timed out after ${timeoutMs}ms` : "Internal fetch failure";

      logToolExecution({
        tool: "fetchPage",
        status: "error",
        durationMs: Date.now() - start,
        code,
      });

      return fail(code, message);
    }
  };
}

// Export default singleton instance
export const fetchPage = createFetchPage();
