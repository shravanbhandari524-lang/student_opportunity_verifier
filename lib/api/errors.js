import { ApiErrorSchema } from "../contracts/api-error.js";
import { API_ERROR_CODES } from "../contracts/enums.js";

/**
 * Custom error class for API errors with status code and contract-compliant fields.
 */
export class ApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} status
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Creates an ApiError instance.
 *
 * @param {string} code
 * @param {string} message
 * @param {number} status
 * @param {Record<string, unknown>} [details]
 * @returns {ApiError}
 */
export function apiError(code, message, status = 400, details) {
  return new ApiError(code, message, status, details);
}

/**
 * Maps any error into a safe ApiError instance.
 * Preserves user-safe text and maps known domain errors:
 * - ApiError -> itself
 * - ZodError -> 400 VALIDATION_ERROR or BAD_REQUEST
 * - InvalidStateTransitionError -> 409 STATE_CONFLICT
 * - Not found -> 404 NOT_FOUND
 * - Default -> 500 INTERNAL_ERROR with generic user-safe message, never exposing stack traces, SQL, or file paths.
 *
 * @param {unknown} err
 * @returns {ApiError}
 */
export function mapError(err) {
  if (err instanceof ApiError || (err && typeof err === "object" && err.name === "ApiError" && typeof err.status === "number")) {
    return err;
  }

  // Zod validation error
  if (err && typeof err === "object" && (err.name === "ZodError" || Array.isArray(err.issues))) {
    const issues = err.issues || [];
    return new ApiError(
      "BAD_REQUEST",
      "Input validation failed",
      400,
      {
        issues: issues.map((i) => ({
          path: Array.isArray(i.path) ? i.path.join(".") : String(i.path || ""),
          message: i.message,
        })),
      }
    );
  }

  // State transition error
  if (err && typeof err === "object" && err.name === "InvalidStateTransitionError") {
    return new ApiError(
      "STATE_CONFLICT",
      "Invalid check state transition",
      409
    );
  }

  // Duplicate agent result error
  if (err && typeof err === "object" && err.name === "DuplicateAgentResultError") {
    return new ApiError(
      "STATE_CONFLICT",
      "Duplicate agent result",
      409
    );
  }

  // Not found check
  if (err instanceof Error && /not found/i.test(err.message)) {
    return new ApiError(
      "NOT_FOUND",
      "Resource not found",
      404
    );
  }

  // Fallback 500 internal error: strictly generic and user-safe
  return new ApiError(
    "INTERNAL_ERROR",
    "Internal server error",
    500
  );
}

/**
 * Converts an ApiError or arbitrary error to a Response object conforming to ApiErrorSchema.
 *
 * @param {unknown} error
 * @param {HeadersInit} [extraHeaders]
 * @returns {Response}
 */
export function toResponse(error, extraHeaders = {}) {
  const err = mapError(error);
  
  const payload = {
    code: API_ERROR_CODES.includes(err.code) ? err.code : "INTERNAL_ERROR",
    message: err.message,
  };
  if (err.details !== undefined) {
    payload.details = err.details;
  }

  // Validate output against ApiErrorSchema
  const validated = ApiErrorSchema.parse(payload);

  const headers = new Headers(extraHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (err.code === "RATE_LIMITED" && err.details?.retryAfterSeconds) {
    headers.set("Retry-After", String(err.details.retryAfterSeconds));
  }

  return new Response(JSON.stringify(validated), {
    status: err.status,
    headers,
  });
}
