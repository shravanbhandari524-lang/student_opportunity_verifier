import crypto from "node:crypto";
import { logger as defaultLogger } from "../logger.js";

/**
 * Creates structured request logger context conforming to DR-8:
 * Logs: requestId, route, method, status, durationMs, and optional checkId.
 * Strictly guarantees NEVER logging raw message text, candidate phone numbers,
 * email addresses, UPI IDs, company names, URLs, or image contents.
 *
 * @param {Request} request
 * @param {string} route
 * @param {object} [options]
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 * @returns {{
 *   requestId: string,
 *   setCheckId: (id: string) => void,
 *   logResponse: (status: number, extraMeta?: Record<string, unknown>) => void,
 *   logError: (err: unknown, status?: number) => void
 * }}
 */
export function createRequestLogger(request, route, options = {}) {
  const logger = options.logger || defaultLogger;
  const nowFn = options.now || (() => Date.now());
  const startTime = nowFn();

  // Generate or extract unique request ID
  const requestId =
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    `req_${crypto.randomUUID().slice(0, 12)}`;

  const method = request.method || "GET";
  let associatedCheckId = null;

  function setCheckId(id) {
    if (id && typeof id === "string") {
      associatedCheckId = id;
    }
  }

  function sanitizeMeta(meta = {}) {
    // Whitelist only safe operational metadata keys
    const allowed = ["bytesRead", "bytesSent", "activeJobs", "staleRecovered", "ip"];
    const sanitized = {};
    for (const [k, v] of Object.entries(meta)) {
      if (allowed.includes(k) && typeof v !== "object") {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  function logResponse(status, extraMeta = {}) {
    const durationMs = Math.max(0, nowFn() - startTime);
    const entry = {
      requestId,
      route,
      method,
      status,
      durationMs,
      ...sanitizeMeta(extraMeta),
    };
    if (associatedCheckId) {
      entry.checkId = associatedCheckId;
    }

    if (status >= 500) {
      logger.error(entry, "Request completed with server error");
    } else if (status >= 400) {
      logger.warn(entry, "Request completed with client error");
    } else {
      logger.info(entry, "Request completed");
    }
  }

  function logError(err, status = 500) {
    const durationMs = Math.max(0, nowFn() - startTime);
    const entry = {
      requestId,
      route,
      method,
      status,
      durationMs,
      errorName: err instanceof Error ? err.name : "UnknownError",
    };
    if (associatedCheckId) {
      entry.checkId = associatedCheckId;
    }

    logger.error(entry, "Request handler threw an error");
  }

  return {
    requestId,
    setCheckId,
    logResponse,
    logError,
  };
}
