import { z } from "zod";
import { EVENT_TYPES, AGENT_NAMES, AGENT_STATUSES, RISK_LEVELS, API_ERROR_CODES } from "./enums.js";

const AgentProgressEventSchema = z
  .object({
    id: z.number().int().positive().optional(),
    type: z.literal("agent"),
    round: z.number().int().min(1).max(2),
    agent: z.enum(AGENT_NAMES),
    status: z.enum(["started", "completed", ...AGENT_STATUSES]),
  })
  .strict();

const RoundProgressEventSchema = z
  .object({
    id: z.number().int().positive().optional(),
    type: z.literal("round"),
    round: z.number().int().min(1).max(2),
    status: z.enum(["started", "completed"]),
  })
  .strict();

const StageProgressEventSchema = z
  .object({
    id: z.number().int().positive().optional(),
    type: z.literal("stage"),
    stage: z.string().min(1),
  })
  .strict();

const CompleteProgressEventSchema = z
  .object({
    id: z.number().int().positive().optional(),
    type: z.literal("complete"),
    riskLevel: z.enum(RISK_LEVELS),
  })
  .strict();

const ErrorProgressEventSchema = z
  .object({
    id: z.number().int().positive().optional(),
    type: z.literal("error"),
    code: z.enum(API_ERROR_CODES),
    message: z.string().min(1),
  })
  .strict();

export const ProgressEventSchema = z.discriminatedUnion("type", [
  AgentProgressEventSchema,
  RoundProgressEventSchema,
  StageProgressEventSchema,
  CompleteProgressEventSchema,
  ErrorProgressEventSchema,
]);

export const CheckEventRowSchema = z
  .object({
    id: z.number().int().positive().optional(),
    checkId: z.string().uuid(),
    seq: z.number().int().nonnegative().optional(),
    round: z.number().int().min(0).max(2).nullable().optional(),
    type: z.enum(EVENT_TYPES),
    agent: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    payloadJson: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
