import { z } from "zod";

const envSchema = z.object({
  // Required
  LLM_PROVIDER: z.string().min(1, "LLM_PROVIDER is required"),
  LLM_API_KEY: z.string().min(1, "LLM_API_KEY is required"),
  LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),

  // Optional
  SEARCH_PROVIDER: z.string().optional(),
  SEARCH_API_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  URLHAUS_AUTH_KEY: z.string().optional(),
  URLSCAN_API_KEY: z.string().optional(),
  CLASSIFIER_URL: z.string().optional(),
  CRAWLER_URL: z.string().default("http://127.0.0.1:3001"),
  CRAWLER_API_KEY: z.string().optional(),
  DB_PATH: z.string().default("./data/app.db"),
  UPLOAD_DIR: z.string().default("./uploads"),
  TRUST_PROXY: z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return false;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const lower = val.trim().toLowerCase();
      if (lower === "true" || lower === "1") return true;
      if (lower === "false" || lower === "0") return false;
      return "invalid_boolean";
    }
    return "invalid_boolean";
  }, z.boolean({ message: "TRUST_PROXY must be a boolean (true/false or 1/0)" }).default(false)),
  TRUSTED_PROXY_HOPS: z.coerce.number().int({ message: "TRUSTED_PROXY_HOPS must be an integer" }).positive({ message: "TRUSTED_PROXY_HOPS must be positive" }).default(1),
  MAX_CONCURRENT_CREATES: z.coerce.number().int({ message: "MAX_CONCURRENT_CREATES must be an integer" }).positive({ message: "MAX_CONCURRENT_CREATES must be positive" }).default(2),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int({ message: "RATE_LIMIT_WINDOW_MS must be an integer" }).positive({ message: "RATE_LIMIT_WINDOW_MS must be positive" }).default(900000),
  RATE_LIMIT_CREATE_MAX: z.coerce.number().int({ message: "RATE_LIMIT_CREATE_MAX must be an integer" }).positive({ message: "RATE_LIMIT_CREATE_MAX must be positive" }).default(10),
  RATE_LIMIT_CONFIRM_MAX: z.coerce.number().int({ message: "RATE_LIMIT_CONFIRM_MAX must be an integer" }).positive({ message: "RATE_LIMIT_CONFIRM_MAX must be positive" }).default(10),
  RATE_LIMIT_READ_MAX: z.coerce.number().int({ message: "RATE_LIMIT_READ_MAX must be an integer" }).positive({ message: "RATE_LIMIT_READ_MAX must be positive" }).default(60),
  RATE_LIMIT_STREAM_MAX: z.coerce.number().int({ message: "RATE_LIMIT_STREAM_MAX must be an integer" }).positive({ message: "RATE_LIMIT_STREAM_MAX must be positive" }).default(10),
  RATE_LIMIT_ACTION_MAX: z.coerce.number().int({ message: "RATE_LIMIT_ACTION_MAX must be an integer" }).positive({ message: "RATE_LIMIT_ACTION_MAX must be positive" }).default(15),
  RATE_LIMIT_GUIDE_MAX: z.coerce.number().int({ message: "RATE_LIMIT_GUIDE_MAX must be an integer" }).positive({ message: "RATE_LIMIT_GUIDE_MAX must be positive" }).default(60),
  MAX_CONCURRENT_INVESTIGATIONS: z.coerce.number().int().positive().default(4),
  CRAWL_MAX_CONCURRENT: z.coerce.number().int().positive().default(1),
  GLOBAL_DAILY_CHECK_CAP: z.coerce.number().int().positive().default(500),
  RECORD_REPLAY_MODE: z.enum(["off", "record", "replay"]).default("off"),
  RECORD_REPLAY_DIR: z.string().default(".recordings"),
  DISABLE_CACHE: z.preprocess((val) => {
    if (val === undefined || val === null || val === "") return false;
    if (typeof val === "boolean") return val;
    if (typeof val === "string") {
      const lower = val.trim().toLowerCase();
      if (lower === "true" || lower === "1") return true;
      if (lower === "false" || lower === "0") return false;
      return false;
    }
    return false;
  }, z.boolean().default(false)),

  // Optional: Google OAuth & Authentication
  PORT: z.coerce.number().int({ message: "PORT must be an integer" }).positive().default(3000),
  CLIENT_URL: z.string().default("http://localhost:3000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().default("http://localhost:3000/auth/google/callback"),
  JWT_SECRET: z.string().optional(),
}).superRefine((data, ctx) => {
  const hasGoogle = Boolean(data.GOOGLE_CLIENT_ID || data.GOOGLE_CLIENT_SECRET);
  if (hasGoogle) {
    if (!data.GOOGLE_CLIENT_ID || !data.GOOGLE_CLIENT_ID.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CLIENT_ID"],
        message: "GOOGLE_CLIENT_ID is required when Google OAuth is configured",
      });
    }
    if (!data.GOOGLE_CLIENT_SECRET || !data.GOOGLE_CLIENT_SECRET.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "GOOGLE_CLIENT_SECRET is required when Google OAuth is configured",
      });
    }
    if (!data.JWT_SECRET || data.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message: "JWT_SECRET must be at least 32 characters when Google OAuth is configured",
      });
    }
  } else if (data.JWT_SECRET && data.JWT_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must be at least 32 characters",
    });
  }
});

/**
 * Validates and parses environment variables.
 * Prints clear error messages naming missing variables without exposing values.
 *
 * @param {Record<string, string | undefined>} [sourceEnv]
 * @returns {z.infer<typeof envSchema>}
 */
export function getEnv(sourceEnv = process.env) {
  const result = envSchema.safeParse(sourceEnv);

  if (!result.success) {
    const missingOrInvalid = result.error.issues.map((issue) => {
      const field = issue.path.join(".");
      return ` - ${field}: ${issue.message}`;
    });

    const errorMessage = [
      "Environment validation failed. The following environment variables are missing or invalid:",
      ...missingOrInvalid,
      "Please check your .env.local or environment settings (see .env.example).",
    ].join("\n");

    throw new Error(errorMessage);
  }

  return result.data;
}

// Lazy or safe singleton for runtime usage
let cachedEnv = null;

export const env = new Proxy({}, {
  get(_target, prop) {
    if (prop === "IS_TEST") {
      return Boolean(process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "test");
    }
    if (!cachedEnv) {
      cachedEnv = getEnv(process.env);
    }
    return cachedEnv[prop];
  },
});
