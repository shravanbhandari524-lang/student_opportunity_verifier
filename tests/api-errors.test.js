import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { apiError, mapError, toResponse, ApiError } from "../lib/api/errors.js";
import { InvalidStateTransitionError, DuplicateAgentResultError } from "../lib/db/index.js";

describe("lib/api/errors.js", () => {
  it("apiError creates an ApiError instance with custom code and status", () => {
    const err = apiError("BAD_REQUEST", "Invalid input", 400, { field: "upiId" });
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, "BAD_REQUEST");
    assert.equal(err.message, "Invalid input");
    assert.equal(err.status, 400);
    assert.deepEqual(err.details, { field: "upiId" });
  });

  it("mapError preserves existing ApiError", () => {
    const orig = apiError("RATE_LIMITED", "Too many requests", 429);
    const mapped = mapError(orig);
    assert.equal(mapped, orig);
  });

  it("mapError maps ZodError to 400 BAD_REQUEST", () => {
    const schema = z.object({ name: z.string() });
    const parseRes = schema.safeParse({ name: 123 });
    assert.ok(!parseRes.success);

    const mapped = mapError(parseRes.error);
    assert.equal(mapped.code, "BAD_REQUEST");
    assert.equal(mapped.status, 400);
    assert.ok(Array.isArray(mapped.details?.issues));
  });

  it("mapError maps InvalidStateTransitionError to 409 STATE_CONFLICT", () => {
    const err = new InvalidStateTransitionError("created", "report_ready");
    const mapped = mapError(err);
    assert.equal(mapped.code, "STATE_CONFLICT");
    assert.equal(mapped.status, 409);
  });

  it("mapError maps DuplicateAgentResultError to 409 STATE_CONFLICT", () => {
    const err = new DuplicateAgentResultError("test-uuid", "message_analyst", 1);
    const mapped = mapError(err);
    assert.equal(mapped.code, "STATE_CONFLICT");
    assert.equal(mapped.status, 409);
  });

  it("mapError maps not found errors to 404 NOT_FOUND", () => {
    const err = new Error("Check not found: 123");
    const mapped = mapError(err);
    assert.equal(mapped.code, "NOT_FOUND");
    assert.equal(mapped.status, 404);
  });

  it("mapError suppresses internal details, stack traces, and SQL queries on generic errors", () => {
    const secretSqlErr = new Error("SELECT * FROM users WHERE password_hash = 'secret'; failed in /var/app/index.js:52");
    const mapped = mapError(secretSqlErr);

    assert.equal(mapped.code, "INTERNAL_ERROR");
    assert.equal(mapped.status, 500);
    assert.equal(mapped.message, "Internal server error");
    assert.equal(mapped.details, undefined);
    assert.ok(!JSON.stringify(mapped).includes("password_hash"));
    assert.ok(!JSON.stringify(mapped).includes("/var/app"));
  });

  it("toResponse serializes error to JSON conforming to ApiErrorSchema", async () => {
    const err = apiError("BAD_REQUEST", "Invalid UUID", 400);
    const res = toResponse(err);

    assert.equal(res.status, 400);
    assert.equal(res.headers.get("content-type"), "application/json");

    const json = await res.json();
    assert.deepEqual(json, {
      code: "BAD_REQUEST",
      message: "Invalid UUID",
    });
  });

  it("supports all 12 API_ERROR_CODES conforming to ApiErrorSchema", async () => {
    const { API_ERROR_CODES } = await import("../lib/contracts/enums.js");
    const { ApiErrorSchema } = await import("../lib/contracts/api-error.js");

    assert.equal(API_ERROR_CODES.length, 12);
    for (const code of API_ERROR_CODES) {
      const err = apiError(code, `Test error message for ${code}`, 400);
      const res = toResponse(err);
      const json = await res.json();
      const parsed = ApiErrorSchema.safeParse(json);
      assert.ok(parsed.success, `ApiError with code ${code} must validate against ApiErrorSchema`);
      assert.equal(json.code, code);
      assert.equal(json.message, `Test error message for ${code}`);
    }
  });

  it("zero-echo: ensures canary tokens in unknown field names, values, or filenames never leak in response", async () => {
    const { parseMultipart } = await import("../lib/api/validate.js");
    const CANARY_FIELD = "CANARY_INJECTED_FIELD_777";
    const CANARY_VALUE = "CANARY_INJECTED_VAL_888";
    const CANARY_FILENAME = "CANARY_EVIL_FILENAME_999.png";

    // 1. Unknown form field name
    const fd1 = new FormData();
    fd1.append(CANARY_FIELD, CANARY_VALUE);
    const req1 = new Request("http://localhost/api/checks", { method: "POST", body: fd1 });
    let caught1;
    try {
      await parseMultipart(req1);
    } catch (e) {
      caught1 = e;
    }
    assert.ok(caught1 instanceof ApiError);
    const res1 = toResponse(caught1);
    const text1 = await res1.text();
    assert.ok(!text1.includes(CANARY_FIELD), "Canary field name must never leak in error response");
    assert.ok(!text1.includes(CANARY_VALUE), "Canary field value must never leak in error response");

    // 2. Oversized file name
    const fd2 = new FormData();
    const bigBlob = new Blob([new Uint8Array(200)], { type: "image/png" });
    fd2.append("images", bigBlob, CANARY_FILENAME);
    const req2 = new Request("http://localhost/api/checks", { method: "POST", body: fd2 });
    let caught2;
    try {
      await parseMultipart(req2, { maxFileSize: 100 });
    } catch (e) {
      caught2 = e;
    }
    assert.ok(caught2 instanceof ApiError);
    const res2 = toResponse(caught2);
    const text2 = await res2.text();
    assert.ok(!text2.includes(CANARY_FILENAME), "Canary file name must never leak in error response");
  });
});

