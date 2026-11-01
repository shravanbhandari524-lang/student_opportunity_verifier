import { z } from "zod";

export const AgentStepSchema = z.object({
  timestamp: z.string(),
  action: z.string(),
  result: z.union([z.string(), z.record(z.any()), z.array(z.any()), z.null()]).transform((val) => {
    if (typeof val === "object" && val !== null) {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return String(val ?? "");
  }),
});

export const AgentStatusSchema = z.enum(["queued", "running", "completed", "failed"]);

export const AgentEntrySchema = z.object({
  agent_name: z.string().min(1),
  purpose: z.string().default(""),
  status: AgentStatusSchema.default("queued"),
  started_at: z.string().nullable().optional().default(null),
  ended_at: z.string().nullable().optional().default(null),
  input_received: z.any().optional().default(null),
  steps: z.array(AgentStepSchema).default([]),
  raw_output: z.any().nullable().optional().default(null),
  summary: z.string().default(""),
  score_contribution: z.union([z.number(), z.string(), z.record(z.any()), z.null()]).optional().default(null),
  error: z.string().nullable().optional().default(null),
});

export const RunRecordSchema = z.object({
  run_id: z.string().min(1),
  created_at: z.string(),
  input: z.any().default({}),
  final_score: z.union([z.number(), z.string(), z.null()]).default(null),
  score_unavailable_reason: z.string().nullable().optional().default(null),
  verdict: z.string().default("pending"),
  final_summary: z.string().default(""),
  agents: z.array(AgentEntrySchema).default([]),
  updated_at: z.string().optional(),
});

export const RunListItemSchema = z.object({
  id: z.string(),
  date: z.string(),
  input: z.any(),
  score: z.union([z.number(), z.string()]),
  verdict: z.string(),
});
