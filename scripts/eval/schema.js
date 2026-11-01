/**
 * scripts/eval/schema.js
 *
 * Zod schemas and validation rules for the evaluation dataset.
 *
 * Rules:
 * - Columns: id, text, link, upi_id, company, handle, phone, language,
 *   expected_level, scam_type, why, source_type, source_url, source_date,
 *   license_note, group_id, labeler_1, labeler_2, notes.
 * - Enums:
 *   - language: "en" | "hi"
 *   - expected_level: "low" | "medium" | "high" | "cannot_verify"
 *   - scam_type: "scholarship" | "internship" | "task_job" | "mule_offer" | "competition" | "overseas_agent" | "unknown"
 *   - source_type: "synthetic" | "real_public" | "paraphrased"
 * - Either text or link must be non-empty.
 * - Exactly two labels (labeler_1 and labeler_2); disagreement is allowed but flagged.
 */

import { z } from "zod";

export const EVAL_RISK_LEVELS = ["low", "medium", "high", "cannot_verify"];
export const EVAL_SCAM_TYPES = [
  "scholarship",
  "internship",
  "task_job",
  "mule_offer",
  "competition",
  "overseas_agent",
  "unknown",
];
export const EVAL_SOURCE_TYPES = ["synthetic", "real_public", "paraphrased"];
export const EVAL_LANGUAGES = ["en", "hi"];
export const EVAL_TEXT_LANGUAGES = ["en", "hi", "hinglish", "other"];

/**
 * Raw CSV / JSON row representation.
 */
export const EvalCaseRawSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().optional().default(""),
    link: z.string().optional().default(""),
    upi_id: z.string().optional().default(""),
    company: z.string().optional().default(""),
    handle: z.string().optional().default(""),
    phone: z.string().optional().default(""),
    language: z.enum(EVAL_LANGUAGES),
    text_language: z.enum(EVAL_TEXT_LANGUAGES).optional(),
    expected_level: z.enum(EVAL_RISK_LEVELS),
    scam_type: z.enum(EVAL_SCAM_TYPES),
    why: z.string().min(1),
    source_type: z.enum(EVAL_SOURCE_TYPES),
    source_url: z.string().optional().default(""),
    source_date: z.string().optional().default(""),
    license_note: z.string().optional().default(""),
    group_id: z.string().optional().default(""),
    labeler_1: z.enum(EVAL_RISK_LEVELS),
    labeler_2: z.enum(EVAL_RISK_LEVELS),
    notes: z.string().optional().default(""),
  })
  .refine(
    (data) => {
      const hasText = Boolean(data.text && data.text.trim().length > 0);
      const hasLink = Boolean(data.link && data.link.trim().length > 0);
      return hasText || hasLink;
    },
    {
      message: "At least one of text or link must be non-empty",
      path: ["text"],
    }
  );

/**
 * CamelCase normalized case used throughout the eval pipeline.
 */
export const EvalCaseSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().default(""),
    link: z.string().default(""),
    upiId: z.string().default(""),
    company: z.string().default(""),
    handle: z.string().default(""),
    phone: z.string().default(""),
    language: z.enum(EVAL_LANGUAGES),
    textLanguage: z.enum(EVAL_TEXT_LANGUAGES).optional(),
    expectedLevel: z.enum(EVAL_RISK_LEVELS),
    scamType: z.enum(EVAL_SCAM_TYPES),
    why: z.string().min(1),
    sourceType: z.enum(EVAL_SOURCE_TYPES),
    sourceUrl: z.string().default(""),
    sourceDate: z.string().default(""),
    licenseNote: z.string().default(""),
    groupId: z.string().default(""),
    labeler1: z.enum(EVAL_RISK_LEVELS),
    labeler2: z.enum(EVAL_RISK_LEVELS),
    hasLabelDisagreement: z.boolean().default(false),
    notes: z.string().default(""),
  })
  .refine(
    (data) => {
      const hasText = Boolean(data.text && data.text.trim().length > 0);
      const hasLink = Boolean(data.link && data.link.trim().length > 0);
      return hasText || hasLink;
    },
    {
      message: "At least one of text or link must be non-empty",
      path: ["text"],
    }
  );

/**
 * Maps raw snake_case row to normalized EvalCase object.
 *
 * @param {object} raw
 * @returns {import("zod").infer<typeof EvalCaseSchema>}
 */
export function normalizeEvalCase(raw) {
  const parsedRaw = EvalCaseRawSchema.parse(raw);
  const disagreement = parsedRaw.labeler_1 !== parsedRaw.labeler_2;

  return EvalCaseSchema.parse({
    id: parsedRaw.id,
    text: parsedRaw.text || "",
    link: parsedRaw.link || "",
    upiId: parsedRaw.upi_id || "",
    company: parsedRaw.company || "",
    handle: parsedRaw.handle || "",
    phone: parsedRaw.phone || "",
    language: parsedRaw.language,
    textLanguage: parsedRaw.text_language,
    expectedLevel: parsedRaw.expected_level,
    scamType: parsedRaw.scam_type,
    why: parsedRaw.why,
    sourceType: parsedRaw.source_type,
    sourceUrl: parsedRaw.source_url || "",
    sourceDate: parsedRaw.source_date || "",
    licenseNote: parsedRaw.license_note || "",
    groupId: parsedRaw.group_id || "",
    labeler1: parsedRaw.labeler_1,
    labeler2: parsedRaw.labeler_2,
    hasLabelDisagreement: disagreement,
    notes: parsedRaw.notes || "",
  });
}
