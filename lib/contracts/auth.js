/**
 * lib/contracts/auth.js
 *
 * Zod schemas for user authentication, session management, and auth API responses.
 */

import { z } from "zod";
import { CHECK_STATUSES, RISK_LEVELS, CONFIDENCE_LEVELS } from "./enums.js";

/**
 * User schema representing the `users` SQLite row.
 */
export const UserSchema = z
  .object({
    id: z.string().uuid(),
    googleSub: z.string().min(1),
    email: z.string().email(),
    name: z.string().min(1),
    avatarUrl: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
    lastLoginAt: z.string().datetime(),
  })
  .strict();

/**
 * Session schema representing the `sessions` SQLite row.
 */
export const SessionSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().uuid(),
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();

/**
 * Public User profile shape (never exposes Google sub, tokens, or internal credentials).
 */
export const AuthUserPublicSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    avatarUrl: z.string().nullable().optional(),
  })
  .strict();

/**
 * GET /api/auth/me response schema.
 */
export const AuthMeResponseSchema = z
  .object({
    user: AuthUserPublicSchema.nullable(),
  })
  .strict();

/**
 * Non-expired check summary for user check history.
 */
export const UserCheckSummarySchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(CHECK_STATUSES),
    riskLevel: z.enum(RISK_LEVELS).nullable().optional(),
    score: z.number().int().min(0).max(100).nullable().optional(),
    confidence: z.enum(CONFIDENCE_LEVELS).nullable().optional(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

/**
 * GET /api/me/checks response schema.
 */
export const UserChecksResponseSchema = z
  .object({
    checks: z.array(UserCheckSummarySchema),
  })
  .strict();
