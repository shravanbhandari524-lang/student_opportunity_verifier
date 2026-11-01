import { z } from "zod";
import { API_ERROR_CODES } from "./enums.js";

export const ApiErrorSchema = z
  .object({
    code: z.enum(API_ERROR_CODES),
    message: z.string().min(1),
    details: z.any().optional(),
  })
  .strict();
