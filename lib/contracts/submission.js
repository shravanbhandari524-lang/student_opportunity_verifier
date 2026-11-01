import { z } from "zod";
import { LANGUAGES, INPUT_TYPES, HANDLE_PLATFORMS } from "./enums.js";
import { isHttpOrHttps } from "./evidence.js";

const ImageMetadataSchema = z
  .object({
    filename: z.string().min(1),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    sizeBytes: z.number().int().positive().max(5 * 1024 * 1024, "Image size must not exceed 5 MB"),
  })
  .strict();

export const CheckSubmissionSchema = z
  .object({
    text: z.string().max(10000, "Text must not exceed 10,000 characters").optional(),
    userNotes: z.string().max(5000, "User notes must not exceed 5,000 characters").optional(),
    images: z.array(ImageMetadataSchema).max(5, "At most 5 images allowed").optional(),
    url: z.string().refine(isHttpOrHttps, {
      message: "URL must be a valid HTTP or HTTPS URL",
    }).optional(),
    upiId: z.string().optional(),
    company: z.string().optional(),
    handle: z.string().optional(),
    handlePlatform: z.enum(HANDLE_PLATFORMS).optional(),
    phone: z.string().optional(),
    youtubeUrl: z.string().refine(isHttpOrHttps, {
      message: "YouTube URL must be a valid HTTP or HTTPS URL",
    }).optional(),
    language: z.enum(LANGUAGES).default("en"),
    consent: z.literal(true, {
      errorMap: () => ({ message: "Consent must be explicitly set to true" }),
    }),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasText = typeof data.text === "string" && data.text.trim().length > 0;
    const hasImages = Array.isArray(data.images) && data.images.length > 0;
    const hasUrl = typeof data.url === "string" && data.url.trim().length > 0;

    if (!hasText && !hasImages && !hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one primary input (text, images, or url) must be provided",
        path: ["text"],
      });
    }
  });

export const CheckInputRowSchema = z
  .object({
    id: z.number().int().positive().optional(),
    checkId: z.string().uuid(),
    type: z.enum(INPUT_TYPES),
    value: z.string().nullable().optional(),
    filePath: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    sizeBytes: z.number().int().positive().nullable().optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
