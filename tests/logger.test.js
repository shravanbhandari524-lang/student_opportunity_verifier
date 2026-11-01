import test from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { logger } from "../lib/logger.js";

test("lib/logger.js: redacts secrets and user message content from logs", () => {
  const chunks = [];
  const destination = {
    write(str) {
      chunks.push(str);
    },
  };

  const testLogger = pino(
    {
      level: "info",
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
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination
  );

  testLogger.info({
    checkId: "test-check-123",
    stage: "investigation",
    apiKey: "super-secret-key-123",
    text: "Confidential student personal text",
    nested: {
      secret: "shhh",
      rawText: "untrusted user screenshot text",
      normalField: "public-metadata",
    },
  });

  assert.equal(chunks.length, 1);
  const logObj = JSON.parse(chunks[0]);

  assert.equal(logObj.checkId, "test-check-123");
  assert.equal(logObj.stage, "investigation");
  assert.equal(logObj.apiKey, "[REDACTED]");
  assert.equal(logObj.text, "[REDACTED]");
  assert.equal(logObj.nested.secret, "[REDACTED]");
  assert.equal(logObj.nested.rawText, "[REDACTED]");
  assert.equal(logObj.nested.normalField, "public-metadata");
});
