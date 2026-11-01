import { apiError } from "./errors.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether an input string is a valid UUID v4 format.
 *
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidCheckId(id) {
  if (typeof id !== "string") {
    return false;
  }
  return UUID_V4_REGEX.test(id.trim());
}

/**
 * Asserts checkId is valid UUID v4 or throws an ApiError 400 BAD_REQUEST.
 *
 * @param {unknown} id
 * @returns {string}
 */
export function assertValidCheckId(id) {
  if (!isValidCheckId(id)) {
    throw apiError("BAD_REQUEST", "Invalid check ID format (must be UUID v4)", 400);
  }
  return String(id).trim();
}

/**
 * Reads and parses a JSON request body with Content-Type and streaming byte limit checks.
 *
 * @param {Request} request
 * @param {import("zod").ZodTypeAny} schema
 * @param {number} [maxBytes=1048576] Default 1MB
 * @returns {Promise<unknown>}
 */
export async function parseJsonBody(request, schema, maxBytes = 1024 * 1024) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw apiError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", 415);
  }

  // Check declared content-length header if present
  const declaredLen = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
    throw apiError("PAYLOAD_TOO_LARGE", `Request body exceeds maximum size of ${maxBytes} bytes`, 413);
  }

  if (!request.body) {
    throw apiError("BAD_REQUEST", "Missing request body", 400);
  }

  // Streaming read with size limit
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          // Cancel reader immediately so client stops streaming
          await reader.cancel();
          throw apiError("PAYLOAD_TOO_LARGE", `Request body exceeds maximum size of ${maxBytes} bytes`, 413);
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err && err.name === "ApiError") throw err;
    throw apiError("BAD_REQUEST", "Failed to read request body", 400);
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder("utf-8").decode(combined);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    throw apiError("BAD_REQUEST", "Malformed JSON body", 400);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw apiError("BAD_REQUEST", "JSON schema validation failed", 400, {
      issues: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  return result.data;
}

/**
 * Validates multipart/form-data request and enforces file count, size, and field limits.
 *
 * @param {Request} request
 * @param {object} [limits]
 * @param {number} [limits.maxFileSize=5242880] Default 5MB
 * @param {number} [limits.maxFiles=5] Default 5
 * @param {number} [limits.maxTotalSize=27262976] Default 26MB
 * @param {string[]} [limits.allowedFields]
 * @returns {Promise<{ fields: Record<string, string>, files: Array<{ name: string, filename: string, mimeType: string, buffer: Buffer, size: number }> }>}
 */
export async function parseMultipart(request, limits = {}) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw apiError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be multipart/form-data", 415);
  }

  const maxFileSize = limits.maxFileSize ?? 5 * 1024 * 1024;
  const maxFiles = limits.maxFiles ?? 5;
  const maxTotalSize = limits.maxTotalSize ?? 26 * 1024 * 1024;

  // 1. Check Content-Length header if present
  const clHeader = request.headers.get("content-length");
  if (clHeader !== null && clHeader !== undefined && clHeader !== "") {
    const declaredLen = parseInt(clHeader, 10);
    if (!Number.isNaN(declaredLen) && declaredLen > maxTotalSize) {
      throw apiError("PAYLOAD_TOO_LARGE", `Request body exceeds maximum size of ${maxTotalSize} bytes`, 413);
    }
  }

  // 2. Stream and count bytes before calling formData()
  let rawBodyBuffer;
  if (!request.body) {
    throw apiError("BAD_REQUEST", "Missing request body", 400);
  }

  const reader = request.body.getReader();
  const chunks = [];
  let totalStreamedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalStreamedBytes += value.length;
        if (totalStreamedBytes > maxTotalSize) {
          try {
            await reader.cancel();
          } catch (_e) {}
          throw apiError("PAYLOAD_TOO_LARGE", `Request body exceeds maximum size of ${maxTotalSize} bytes`, 413);
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err && err.name === "ApiError") throw err;
    throw apiError("BAD_REQUEST", "Failed to read request body stream", 400);
  }

  // Reassemble raw body into a single Buffer
  rawBodyBuffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

  const allowedFields = new Set(
    limits.allowedFields ?? [
      "text",
      "url",
      "upiId",
      "company",
      "handle",
      "handlePlatform",
      "userNotes",
      "phone",
      "youtubeUrl",
      "language",
      "consent",
      "images",
      "image",
      "messageText",
      "shareLink",
    ]
  );

  let formData;
  try {
    // Reconstruct Request from the collected buffer to parse formData without reading stream twice
    const reconstructedReq = new Request(request.url || "http://localhost", {
      method: "POST",
      headers: {
        "content-type": contentType,
      },
      body: rawBodyBuffer,
    });
    formData = await reconstructedReq.formData();
  } catch (_e) {
    throw apiError("BAD_REQUEST", "Malformed multipart form data", 400);
  }

  const fields = {};
  const files = [];
  let totalBytes = 0;

  for (const [key, value] of formData.entries()) {
    if (!allowedFields.has(key)) {
      throw apiError("BAD_REQUEST", "Unexpected form field", 400);
    }

    if (typeof value === "string") {
      fields[key] = value;
      totalBytes += Buffer.byteLength(value, "utf8");
    } else if (value && typeof value.arrayBuffer === "function") {
      // File entry
      if (files.length >= maxFiles) {
        throw apiError("BAD_REQUEST", `Exceeded maximum file count of ${maxFiles}`, 400);
      }

      const size = value.size;
      if (size > maxFileSize) {
        throw apiError("PAYLOAD_TOO_LARGE", `File exceeds limit of ${maxFileSize} bytes`, 413);
      }

      totalBytes += size;
      if (totalBytes > maxTotalSize) {
        throw apiError("PAYLOAD_TOO_LARGE", `Total payload exceeds maximum size of ${maxTotalSize} bytes`, 413);
      }

      const arrayBuffer = await value.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      files.push({
        fieldName: key,
        filename: value.name || "upload",
        mimeType: value.type || "application/octet-stream",
        size: buffer.length,
        buffer,
      });
    }
  }

  return { fields, files };
}
