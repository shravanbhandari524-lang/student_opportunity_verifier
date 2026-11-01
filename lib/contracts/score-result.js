import { z } from "zod";
import { RISK_LEVELS, CONFIDENCE_LEVELS } from "./enums.js";

export const FlagPointItemSchema = z
  .object({
    id: z.string().min(1),
    weight: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    status: z.enum(["counted", "group_suppressed", "duplicate_ignored"]),
    agents: z.array(z.string().min(1)),
  })
  .strict();

export const ScoreResultSchema = z
  .object({
    level: z.enum(RISK_LEVELS),
    score: z.number().int().min(0, "Score must be >= 0").max(100, "Score must be <= 100"),
    confidence: z.enum(CONFIDENCE_LEVELS),
    completedCount: z.number().int().nonnegative(),
    eligibleCount: z.number().int().nonnegative(),
    completionRatio: z.number().min(0).max(1),
    rulesFired: z.array(z.string()),
    flagPoints: z.array(FlagPointItemSchema),
    classifierPoints: z.number().int().min(0).max(25),
    confidenceCapped: z.boolean(),
    reasonCodes: z.array(z.string()),
    fallbackWeightFlags: z.array(z.string()),
  })
  .strict();
