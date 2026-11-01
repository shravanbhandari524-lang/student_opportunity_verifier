import pino from "pino";

/**
 * Structured logger configured with pino.
 * Redacts secrets, api keys, authorization headers, passwords, and user message content.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "apiKey",
      "*.apiKey",
      "key",
      "*.key",
      "secret",
      "*.secret",
      "token",
      "*.token",
      "password",
      "*.password",
      "text",
      "*.text",
      "rawText",
      "*.rawText",
      "messageContent",
      "*.messageContent",
      "comment",
      "*.comment",
    ],
    censor: "[REDACTED]",
  },
  base: {
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
