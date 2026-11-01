import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequestLogger } from "../lib/api/log.js";

describe("lib/api/log.js", () => {
  it("logs structured operational metadata and respects privacy", () => {
    const logs = [];
    const mockLogger = {
      info: (entry) => logs.push({ level: "info", entry }),
      warn: (entry) => logs.push({ level: "warn", entry }),
      error: (entry) => logs.push({ level: "error", entry }),
    };

    const req = new Request("http://localhost/api/checks", {
      method: "POST",
      headers: {
        "x-request-id": "req-custom-123",
      },
    });

    const reqLogger = createRequestLogger(req, "/api/checks", {
      logger: mockLogger,
      now: () => 1050,
    });

    assert.equal(reqLogger.requestId, "req-custom-123");
    reqLogger.setCheckId("uuid-check-abc");

    // Attempt to pass sensitive fields in extraMeta (should be filtered out by sanitizeMeta)
    reqLogger.logResponse(201, {
      bytesRead: 1024,
      messageText: "Do not log this sensitive scam message",
      upiId: "scammer@okaxis",
      phone: "+919876543210",
      company: "Fake Corp",
    });

    assert.equal(logs.length, 1);
    const entry = logs[0].entry;
    assert.equal(entry.requestId, "req-custom-123");
    assert.equal(entry.route, "/api/checks");
    assert.equal(entry.method, "POST");
    assert.equal(entry.status, 201);
    assert.equal(entry.checkId, "uuid-check-abc");
    assert.equal(entry.bytesRead, 1024);

    // Assert strictly no PII leaked into log object
    assert.equal(entry.messageText, undefined);
    assert.equal(entry.upiId, undefined);
    assert.equal(entry.phone, undefined);
    assert.equal(entry.company, undefined);
  });
});
