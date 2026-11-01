import { z } from "zod";

/**
 * Validates an HTTP or HTTPS URL string.
 * Rejects javascript:, data:, file:, etc.
 */
export function isHttpOrHttps(val) {
  if (typeof val !== "string") return false;
  try {
    const u = new URL(val);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Evidence schema:
 * At least one of quote or url must be present.
 * quote max 300 chars.
 * url must be valid HTTP/HTTPS.
 */
export const EvidenceSchema = z
  .object({
    type: z.enum(["quote", "url"]),
    value: z.string().min(1),
    evidenceId: z.string().optional(),
    sourceAgent: z.string().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === "quote") {
      if (data.value.length > 300) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Quote evidence must not exceed 300 characters",
          path: ["value"],
        });
      }
    } else if (data.type === "url") {
      if (!isHttpOrHttps(data.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "URL evidence must be a valid HTTP or HTTPS URL",
          path: ["value"],
        });
      }
    }
  });
