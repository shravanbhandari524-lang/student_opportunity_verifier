import { z } from "zod";

export const ClassifierResultSchema = z
  .object({
    probability: z
      .number()
      .min(0, "Probability must be >= 0")
      .max(1, "Probability must be <= 1")
      .refine((n) => !Number.isNaN(n), { message: "Probability must not be NaN" }),
    label: z.enum(["suspicious", "benign"]),
    topTerms: z.array(z.string()).default([]),
    scamType: z.string().optional(),
  })
  .strict();
