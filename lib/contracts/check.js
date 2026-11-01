import { z } from "zod";
import { CHECK_STATUSES, LANGUAGES, RISK_LEVELS, CONFIDENCE_LEVELS, FAILURE_REASON_CODES } from "./enums.js";

/**
 * Normalizes reading failureReason:
 * - null / undefined -> null / undefined
 * - member of FAILURE_REASON_CODES -> itself
 * - any legacy string or unlisted value -> "unknown_error"
 */
function preprocessFailureReason(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === "string" && FAILURE_REASON_CODES.includes(val)) {
    return val;
  }
  return "unknown_error";
}

/**
 * Check contract schema:
 * Matches checks table row and CaseFile.check.
 * On read: maps legacy/unknown failure reasons to "unknown_error".
 */
export const CheckSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(CHECK_STATUSES).default("created"),
    currentRound: z.number().int().min(0).max(2).default(0),
    language: z.enum(LANGUAGES).default("en"),
    riskLevel: z.enum(RISK_LEVELS).nullable().optional(),
    score: z.number().int().min(0).max(100).nullable().optional(),
    confidence: z.enum(CONFIDENCE_LEVELS).nullable().optional(),
    failureReason: z.preprocess(
      preprocessFailureReason,
      z.enum(FAILURE_REASON_CODES).nullable().optional()
    ),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

/**
 * Strict write schema for Check mutations:
 * Validates strictly against FAILURE_REASON_CODES without preprocessing.
 * Writing free-text or unlisted reasons throws a ZodError.
 */
export const CheckWriteSchema = CheckSchema.extend({
  failureReason: z.enum(FAILURE_REASON_CODES).nullable().optional(),
});
