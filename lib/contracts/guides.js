import { z } from "zod";
import { GUIDE_TYPES, GUIDE_REVIEW_STATUSES, LANGUAGES } from "./enums.js";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates an ISO calendar date YYYY-MM-DD.
 *
 * @param {string} val
 * @returns {boolean}
 */
export function isValidIsoDate(val) {
  if (typeof val !== "string" || !ISO_DATE_REGEX.test(val)) return false;
  const parts = val.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return (
    d.getUTCFullYear() === parts[0] &&
    d.getUTCMonth() === parts[1] - 1 &&
    d.getUTCDate() === parts[2]
  );
}

export const GuideSourceSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    publisher: z.string().min(1).max(200),
    url: z.string().min(1).max(500),
    publishedDate: z
      .string()
      .refine(isValidIsoDate, { message: "publishedDate must be a valid YYYY-MM-DD date" })
      .optional(),
    verified: z.boolean(),
    retrievalNote: z.string().min(1).max(500).optional(),
  })
  .strict();

export const GuideClaimSchema = z
  .object({
    claim: z.string().min(1).max(1000),
    sourceIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const GuideSchema = z
  .object({
    type: z.enum(GUIDE_TYPES),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(1000),
    howItWorks: z.array(z.string().min(1)).min(1),
    redFlags: z.array(z.string().min(1)).min(3),
    whatToVerify: z.array(z.string().min(1)).min(1),
    whatToDo: z.array(z.string().min(1)).min(1),
    alreadyPaid: z.array(z.string().min(1)).min(1),
    claims: z.array(GuideClaimSchema).min(1),
    sources: z.array(GuideSourceSchema).min(1),
    reviewStatus: z.enum(GUIDE_REVIEW_STATUSES),
    language: z.enum(LANGUAGES).default("en"),
    lastReviewed: z
      .string()
      .refine(isValidIsoDate, { message: "lastReviewed must be a valid YYYY-MM-DD date" }),
  })
  .strict();

export const GuideSummarySchema = z
  .object({
    type: z.enum(GUIDE_TYPES),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(1000),
  })
  .strict();

export const GuideListResponseSchema = z
  .object({
    guides: z.array(GuideSummarySchema),
  })
  .strict();
