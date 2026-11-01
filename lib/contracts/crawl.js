import { z } from "zod";
import { CRAWL_ERROR_CODES } from "./enums.js";

export const CrawlPageSchema = z
  .object({
    url: z.string().url(),
    finalUrl: z.string().url(),
    status: z.number().int().nullable(),
    title: z.string().default(""),
    textExcerpt: z.string().max(2000).default(""),
    linkCount: z.number().int().nonnegative().default(0),
  })
  .strict();

export const CrawlFormSchema = z
  .object({
    actionHost: z.string(),
    method: z.string(),
    fieldTypes: z.array(z.string()),
    hasPassword: z.boolean(),
    hasOtp: z.boolean(),
    hasUpi: z.boolean(),
    hasPayment: z.boolean(),
  })
  .strict();

export const CrawlLimitsUsedSchema = z
  .object({
    maxPages: z.number().int().positive(),
    maxDepth: z.number().int().nonnegative(),
    totalTimeSec: z.number().int().nonnegative(),
    totalBytesReceived: z.number().int().nonnegative(),
    sameHostOnly: z.boolean(),
  })
  .strict();

export const CrawlResultSchema = z
  .object({
    pages: z.array(CrawlPageSchema),
    forms: z.array(CrawlFormSchema),
    externalDomains: z.array(z.string()),
    truncated: z.boolean(),
    limitsUsed: CrawlLimitsUsedSchema,
    errorCode: z.enum(CRAWL_ERROR_CODES).optional(),
  })
  .strict();
