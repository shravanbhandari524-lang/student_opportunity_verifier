/**
 * lib/tools/ocr.js
 *
 * Local OCR reader for screenshot images using tesseract.js and sharp.
 * Soft-fail, 15-second timeout per image.
 *
 * Scans:
 * 1. Full image.
 * 2. Upscaled bottom third (for fine print, footers, terms and conditions).
 * 3. Upscaled top fifth (for headers, banners, organization names).
 */

import sharp from "sharp";
import { createWorker } from "tesseract.js";

export const OCR_PER_IMAGE_TIMEOUT_MS = 15000;

/**
 * Normalizes a line of text for fuzzy deduplication.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizeLineForDedupe(line) {
  if (typeof line !== "string") return "";
  return line
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Runs local OCR extraction on an image buffer.
 * Runs on the full image, upscaled bottom third, and upscaled top fifth.
 * Soft-fails on timeout or error; never throws.
 *
 * @param {Buffer} buffer - Validated image buffer
 * @param {object} [options={}]
 * @param {number} [options.timeoutMs=OCR_PER_IMAGE_TIMEOUT_MS]
 * @returns {Promise<{ ok: boolean, lines: string[], text: string, error?: string }>}
 */
export async function runLocalOcr(buffer, options = {}) {
  const timeoutMs = options.timeoutMs || OCR_PER_IMAGE_TIMEOUT_MS;
  let worker = null;
  let timerId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error("OCR_TIMEOUT"));
    }, timeoutMs);
  });

  const performOcr = async () => {
    const meta = await sharp(buffer).metadata();
    const width = meta.width;
    const height = meta.height;

    if (!width || !height || width < 10 || height < 10) {
      return { ok: false, lines: [], text: "", error: "INVALID_IMAGE_DIMENSIONS" };
    }

    // 1. Prepare crops with 2x Lanczos3 upscaling
    const bottomH = Math.max(1, Math.floor(height / 3));
    const bottomTop = height - bottomH;
    const bottomBuf = await sharp(buffer)
      .extract({ left: 0, top: bottomTop, width, height: bottomH })
      .resize(width * 2, bottomH * 2, { kernel: "lanczos3" })
      .toBuffer();

    const topH = Math.max(1, Math.floor(height / 5));
    const topBuf = await sharp(buffer)
      .extract({ left: 0, top: 0, width, height: topH })
      .resize(width * 2, topH * 2, { kernel: "lanczos3" })
      .toBuffer();

    // 2. Initialize worker
    worker = await createWorker("eng");

    // 3. Process crops in sequence
    const fullRes = await worker.recognize(buffer);
    const bottomRes = await worker.recognize(bottomBuf);
    const topRes = await worker.recognize(topBuf);

    const rawLines = [
      ...(fullRes.data?.text || "").split("\n"),
      ...(bottomRes.data?.text || "").split("\n"),
      ...(topRes.data?.text || "").split("\n"),
    ];

    const dedupeMap = new Map();
    for (const raw of rawLines) {
      const trimmed = raw.trim();
      const norm = normalizeLineForDedupe(trimmed);
      if (norm.length >= 3) {
        if (!dedupeMap.has(norm)) {
          dedupeMap.set(norm, trimmed);
        } else {
          // If we found a longer/more complete version of the same line, keep the better one
          const existing = dedupeMap.get(norm);
          if (trimmed.length > existing.length) {
            dedupeMap.set(norm, trimmed);
          }
        }
      }
    }

    const lines = Array.from(dedupeMap.values());
    return { ok: true, lines, text: lines.join("\n") };
  };

  try {
    const result = await Promise.race([performOcr(), timeoutPromise]);
    return result;
  } catch (err) {
    return {
      ok: false,
      lines: [],
      text: "",
      error: err.message || "OCR_PROCESSING_FAILED",
    };
  } finally {
    if (timerId) clearTimeout(timerId);
    if (worker) {
      try {
        await worker.terminate();
      } catch {}
    }
  }
}
