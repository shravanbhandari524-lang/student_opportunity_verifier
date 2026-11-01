import { z } from "zod";
import { SEVERITIES } from "./enums.js";
import { EvidenceSchema } from "./evidence.js";
import { isFlagId, defaultSeverity } from "./flags.js";

/**
 * Flag schema:
 * id: must be in fixed 36-flag registry
 * severity: must equal registry default for that id
 * title: max 120 chars
 * explanation: max 500 chars
 * evidence: at least 1 Evidence item
 */
export const FlagSchema = z
  .object({
    id: z.string(),
    title: z.string().min(1).max(120),
    severity: z.enum(SEVERITIES),
    explanation: z.string().min(1).max(500),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!isFlagId(data.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unknown flag id: '${data.id}'. Flag id must be registered in FLAG_REGISTRY.`,
        path: ["id"],
      });
      return;
    }
    const expectedSev = defaultSeverity(data.id);
    if (data.severity !== expectedSev) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Flag severity mismatch for '${data.id}'. Expected '${expectedSev}', received '${data.severity}'.`,
        path: ["severity"],
      });
    }
  });
