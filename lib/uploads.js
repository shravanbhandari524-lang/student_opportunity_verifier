/**
 * lib/uploads.js
 *
 * Image upload validation and processing for Layer L5.
 *
 * Requirements:
 * - Detect type by magic bytes with file-type (never trust extension or MIME).
 * - Allow only "image/png" and "image/jpeg".
 * - Enforce size limits (zero-byte rejected, max 5MB).
 * - Strip metadata, decode, downscale to max dimension (1600px), and re-encode with sharp.
 * - Return typed result `{ ok: true, buffer, mimeType, width, height, sizeBytes }`
 *   or typed error `{ ok: false, error: { code, message } }`.
 * - Never throw raw library errors outward.
 */

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMAGE_DIMENSION = 1600; // 1600px max width or height
export const MAX_INPUT_PIXELS = 25000000; // 25 million pixels (5000x5000) max canvas
export const ALLOWED_IMAGE_MIME_TYPES = Object.freeze(["image/png", "image/jpeg"]);

/**
 * Validates and normalizes an image buffer.
 *
 * @param {Buffer | Uint8Array} buffer
 * @param {object} [options]
 * @param {number} [options.maxSizeBytes=MAX_IMAGE_SIZE_BYTES]
 * @param {number} [options.maxDimension=MAX_IMAGE_DIMENSION]
 * @returns {Promise<{
 *   ok: true,
 *   buffer: Buffer,
 *   mimeType: "image/png" | "image/jpeg",
 *   width: number,
 *   height: number,
 *   sizeBytes: number
 * } | {
 *   ok: false,
 *   error: { code: string, message: string }
 * }>}
 */
export async function validateImageBuffer(buffer, options = {}) {
  const maxSizeBytes = options.maxSizeBytes ?? MAX_IMAGE_SIZE_BYTES;
  const maxDimension = options.maxDimension ?? MAX_IMAGE_DIMENSION;

  if (!buffer || !(buffer instanceof Uint8Array || Buffer.isBuffer(buffer))) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Image buffer must be a non-null Buffer or Uint8Array",
      },
    };
  }

  const byteLength = buffer.byteLength || buffer.length || 0;
  if (byteLength === 0) {
    return {
      ok: false,
      error: {
        code: "EMPTY_FILE",
        message: "Image file is empty (0 bytes)",
      },
    };
  }

  if (byteLength > maxSizeBytes) {
    return {
      ok: false,
      error: {
        code: "FILE_TOO_LARGE",
        message: `Image exceeds maximum allowed size of ${maxSizeBytes} bytes`,
      },
    };
  }

  // 1. Detect magic bytes via file-type
  let typeResult;
  try {
    typeResult = await fileTypeFromBuffer(buffer);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "DETECTION_FAILED",
        message: "Failed to detect file type from buffer",
      },
    };
  }

  if (!typeResult || !ALLOWED_IMAGE_MIME_TYPES.includes(typeResult.mime)) {
    const detected = typeResult ? typeResult.mime : "unknown";
    return {
      ok: false,
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: `Unsupported image type '${detected}'. Only PNG and JPEG are allowed.`,
      },
    };
  }

  const mimeType = typeResult.mime;

  // 2. Decode, strip metadata, resize, and re-encode with sharp
  try {
    const pipeline = sharp(buffer, {
      failOnError: true,
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate() // auto-orient based on EXIF before stripping
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      });

    let processedBuffer;
    if (mimeType === "image/png") {
      processedBuffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
    } else {
      processedBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
    }

    const metadata = await sharp(processedBuffer).metadata();

    return {
      ok: true,
      buffer: processedBuffer,
      mimeType,
      width: metadata.width || 0,
      height: metadata.height || 0,
      sizeBytes: processedBuffer.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "CORRUPTED_IMAGE",
        message: "Image could not be decoded or processed",
      },
    };
  }
}
