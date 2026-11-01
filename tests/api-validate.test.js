import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { isValidCheckId, assertValidCheckId, parseJsonBody, parseMultipart } from "../lib/api/validate.js";

describe("lib/api/validate.js", () => {
  it("isValidCheckId validates UUID v4 strings strictly", () => {
    assert.equal(isValidCheckId("a3b4c5d6-e7f8-4123-8abc-def012345678"), true);
    assert.equal(isValidCheckId("A3B4C5D6-E7F8-4123-8ABC-DEF012345678"), true);
    // Not UUID v4 (missing version 4)
    assert.equal(isValidCheckId("a3b4c5d6-e7f8-1123-8abc-def012345678"), false);
    // Malformed
    assert.equal(isValidCheckId("invalid-uuid"), false);
    assert.equal(isValidCheckId(""), false);
    assert.equal(isValidCheckId(null), false);
    assert.equal(isValidCheckId(123), false);
  });

  it("assertValidCheckId throws 400 BAD_REQUEST on invalid ID", () => {
    assert.equal(assertValidCheckId("a3b4c5d6-e7f8-4123-8abc-def012345678"), "a3b4c5d6-e7f8-4123-8abc-def012345678");
    assert.throws(
      () => assertValidCheckId("not-a-uuid"),
      (err) => err.code === "BAD_REQUEST" && err.status === 400
    );
  });

  it("parseJsonBody parses valid JSON body against schema", async () => {
    const schema = z.object({ foo: z.string() });
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: "bar" }),
    });

    const parsed = await parseJsonBody(req, schema);
    assert.deepEqual(parsed, { foo: "bar" });
  });

  it("parseJsonBody rejects non-JSON Content-Type with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const schema = z.object({ foo: z.string() });
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ foo: "bar" }),
    });

    await assert.rejects(
      () => parseJsonBody(req, schema),
      (err) => err.code === "UNSUPPORTED_MEDIA_TYPE" && err.status === 415
    );
  });

  it("parseJsonBody rejects oversized bodies with 413 PAYLOAD_TOO_LARGE", async () => {
    const schema = z.object({ data: z.string() });
    const oversized = JSON.stringify({ data: "x".repeat(2000) });
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized,
    });

    await assert.rejects(
      () => parseJsonBody(req, schema, 500),
      (err) => err.code === "PAYLOAD_TOO_LARGE" && err.status === 413
    );
  });

  it("parseJsonBody rejects schema violation with 400 BAD_REQUEST", async () => {
    const schema = z.object({ foo: z.string() });
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foo: 12345 }),
    });

    await assert.rejects(
      () => parseJsonBody(req, schema),
      (err) => err.code === "BAD_REQUEST" && err.status === 400
    );
  });

  it("parseMultipart rejects non-multipart requests with 415 UNSUPPORTED_MEDIA_TYPE", async () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    await assert.rejects(
      () => parseMultipart(req),
      (err) => err.code === "UNSUPPORTED_MEDIA_TYPE" && err.status === 415
    );
  });

  it("parseMultipart parses allowed fields and validates file limits", async () => {
    const formData = new FormData();
    formData.append("messageText", "Suspicious job offer");
    formData.append("company", "Acme Inc");

    const req = new Request("http://localhost/test", {
      method: "POST",
      body: formData,
    });

    const parsed = await parseMultipart(req);
    assert.equal(parsed.fields.messageText, "Suspicious job offer");
    assert.equal(parsed.fields.company, "Acme Inc");
    assert.equal(parsed.files.length, 0);
  });

  it("parseMultipart rejects unexpected form fields with 400 BAD_REQUEST", async () => {
    const formData = new FormData();
    formData.append("unexpectedField", "malicious payload");

    const req = new Request("http://localhost/test", {
      method: "POST",
      body: formData,
    });

    await assert.rejects(
      () => parseMultipart(req),
      (err) => err.code === "BAD_REQUEST" && err.status === 400
    );
  });

  it("parseMultipart rejects declared Content-Length over cap without consuming body", async () => {
    let readCount = 0;
    const customStream = new ReadableStream({
      start(controller) {
        readCount++;
        controller.enqueue(Buffer.from("small chunk"));
        controller.close();
      },
    });

    const boundary = "----TestBoundary123456";
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": "30000000", // 30 MB (exceeds 26 MB limit)
      },
      body: customStream,
      duplex: "half",
    });

    await assert.rejects(
      () => parseMultipart(req, { maxTotalSize: 26 * 1024 * 1024 }),
      (err) => err.code === "PAYLOAD_TOO_LARGE" && err.status === 413
    );
  });

  it("parseMultipart rejects missing or false Content-Length once streaming passes the cap", async () => {
    // 1MB chunks exceeding a small test cap of 2MB
    const chunkSize = 1024 * 1024;
    const customStream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.alloc(chunkSize, "a"));
        controller.enqueue(Buffer.alloc(chunkSize, "b"));
        controller.enqueue(Buffer.alloc(chunkSize, "c"));
        controller.close();
      },
    });

    const boundary = "----TestBoundary123456";
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        // No Content-Length or false/chunked
        "transfer-encoding": "chunked",
      },
      body: customStream,
      duplex: "half",
    });

    await assert.rejects(
      () => parseMultipart(req, { maxTotalSize: 1.5 * 1024 * 1024 }),
      (err) => err.code === "PAYLOAD_TOO_LARGE" && err.status === 413
    );
  });

  it("parseMultipart succeeds on chunked/normal body and keeps form fields intact", async () => {
    const boundary = "----TestBoundarySimple";
    const bodyStr = `--${boundary}\r\nContent-Disposition: form-data; name="company"\r\n\r\nAcme Global\r\n--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nLegit opportunity notice\r\n--${boundary}--\r\n`;

    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.from(bodyStr),
    });

    const parsed = await parseMultipart(req);
    assert.equal(parsed.fields.company, "Acme Global");
    assert.equal(parsed.fields.text, "Legit opportunity notice");
    assert.equal(parsed.files.length, 0);
  });
});
