import { z } from "zod";
import { ENTITY_KINDS } from "./enums.js";

export const GraphNodeSchema = z
  .object({
    id: z.number().int().positive().optional(),
    kind: z.enum(ENTITY_KINDS),
    value: z.string().min(1),
    firstSeen: z.string().datetime(),
    lastSeen: z.string().datetime(),
    reportCount: z.number().int().nonnegative().default(1),
  })
  .strict();

export const GraphEdgeSchema = z
  .object({
    id: z.number().int().positive().optional(),
    nodeA: z.number().int().positive(),
    nodeB: z.number().int().positive(),
    checkRef: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export const GraphMatchSchema = z
  .object({
    matched: z.boolean(),
    nodeId: z.number().int().positive().optional(),
    kind: z.enum(ENTITY_KINDS).optional(),
    value: z.string().optional(),
    reportCount: z.number().int().nonnegative().optional(),
    connectedNodesCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const SaveToGraphRequestSchema = z
  .object({
    consent: z.literal(true, {
      errorMap: () => ({ message: "consent must be true" }),
    }),
  })
  .strict();

export const SaveToGraphResponseSchema = z
  .object({
    saved: z.number().int().nonnegative(),
    checkRef: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();
