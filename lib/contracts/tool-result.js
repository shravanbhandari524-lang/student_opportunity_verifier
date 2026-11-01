import { z } from "zod";
import { TOOL_ERROR_CODES } from "./enums.js";

export const ToolErrorCodeSchema = z.enum(TOOL_ERROR_CODES);

/**
 * ToolResult Contract:
 * Success: { ok: true, data: T, cached: boolean, fetchedAt: string }
 * Failure: { ok: false, error: { code: ToolErrorCode, message: string } }
 *
 * Rules:
 * - Messages must never contain secrets, request URLs with keys, or raw response bodies.
 */
export const ToolResultSuccessSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
  cached: z.boolean(),
  fetchedAt: z.string().datetime({ offset: true }),
});

export const ToolResultFailureSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: ToolErrorCodeSchema,
    message: z.string().min(1, "Error message must not be empty"),
  }),
});

export const ToolResultSchema = z.discriminatedUnion("ok", [
  ToolResultSuccessSchema,
  ToolResultFailureSchema,
]);
