import { z } from "zod";
import { FEEDBACK_VERDICTS, FEEDBACK_OUTCOMES, RISK_LEVELS } from "./enums.js";

export const FeedbackSchema = z
  .object({
    id: z.number().int().positive().optional(),
    checkId: z.string().uuid().nullable().optional(),
    verdict: z.enum(FEEDBACK_VERDICTS),
    outcome: z.enum(FEEDBACK_OUTCOMES).nullable().optional(),
    riskLevelShown: z.enum(RISK_LEVELS),
    comment: z
      .string()
      .max(500, "Comment must not exceed 500 characters")
      .nullable()
      .optional(),
    createdAt: z.string().datetime().optional(),
  })
  .strict();

export const FeedbackRequestSchema = z
  .object({
    verdict: z.enum(FEEDBACK_VERDICTS),
    outcome: z.enum(FEEDBACK_OUTCOMES).optional(),
    comment: z
      .string()
      .max(500, "Comment must not exceed 500 characters")
      .nullable()
      .optional(),
  })
  .strict();
