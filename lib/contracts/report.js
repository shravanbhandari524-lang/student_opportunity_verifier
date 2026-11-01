import { z } from "zod";
import { RISK_LEVELS, CONFIDENCE_LEVELS, LANGUAGES } from "./enums.js";
import { FlagSchema } from "./flag.js";
import { EvidenceCoverageSchema } from "./score-result.js";

export const SCAM_TYPE_GUESSES = [
  "scholarship",
  "internship",
  "task_job",
  "mule_offer",
  "competition",
  "overseas_agent",
  "unknown",
];

export const ACTION_ITEM_IDS = [
  "college_email",
  "fraud_help",
  "copy_checklist",
];

export const ChecklistItemSchema = z
  .object({
    text: z.string().min(1),
    url: z.string().url().nullable().optional(),
    provenance: z.enum(["search_result", "fetched", "curated_list"]).optional(),
    sourceUrl: z.string().optional(),
  })
  .strict();

export const ActionItemSchema = z
  .object({
    id: z.enum(ACTION_ITEM_IDS),
    label: z.string().min(1),
  })
  .strict();

export const ReportSchema = z
  .object({
    checkId: z.string().uuid(),
    riskLevel: z.enum(RISK_LEVELS),
    score: z.number().int().min(0).max(100),
    confidence: z.enum(CONFIDENCE_LEVELS),
    scamTypeGuess: z.enum(SCAM_TYPE_GUESSES),
    language: z.enum(LANGUAGES),
    summary: z.string().min(1),
    flags: z.array(FlagSchema).default([]),
    verified: z.array(z.string()).default([]),
    couldNotCheck: z.array(z.string()).default([]),
    notApplicable: z.array(z.string()).default([]),
    checklist: z.array(ChecklistItemSchema).default([]),
    moreChecks: z.array(ChecklistItemSchema).default([]),
    actions: z.array(ActionItemSchema).default([]),
    whereDisagreed: z.array(z.string()).default([]),
    coverage: EvidenceCoverageSchema.default({ checked: [], notChecked: [] }),
    improveCheck: z.array(z.string()).default([]),
    disclaimer: z.string().min(1),
    generatedAt: z.string().datetime(),
  })
  .strict();

