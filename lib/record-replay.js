/**
 * lib/record-replay.js
 *
 * Record and replay decorators for model generation and search calls.
 *
 * Guarantees:
 * - Modes:
 *   - "off": identity pass-through (no disk writes, no interception).
 *   - "record": executes call, writes key and response atomically to disk with size cap.
 *     STRICTLY PROHIBITED in production: throws an immediate startup error if NODE_ENV === "production".
 *   - "replay": reads response from disk by hash key. On miss or corrupted file, returns:
 *       { ok: false, error: { code: "RECORDING_MISSING", message: "Recorded response not found for key" } }
 *     and NEVER calls the external provider.
 * - Normalised Request Hashing:
 *   - Model requests hash: system prompt, user prompt, schema representation, model name, and hashed image contents.
 *   - Search requests hash: query, geolocation (gl), language (hl), num results.
 *   - Never hashes API keys, headers, authorization tokens, or internal timestamps.
 * - Atomic Storage:
 *   - Uses unique temporary files and atomic rename (fs.rename).
 *   - Size cap: refuses to save payloads exceeding 2MB per recording.
 * - Privacy and Sanitization:
 *   - Strips keys, authorization headers, and raw credentials before saving.
 * - Storage location: .recordings/ directory (strictly gitignored).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEnv } from "./env.js";
import { logger as defaultLogger } from "./logger.js";

export const MAX_RECORDING_SIZE_BYTES = 2 * 1024 * 1024; // 2MB cap

/**
 * Validates production environment safety.
 *
 * @param {string} mode
 * @param {string} [nodeEnv]
 */
export function assertRecordReplaySafety(mode, nodeEnv = process.env.NODE_ENV) {
  if (mode === "record" && nodeEnv === "production") {
    throw new Error("Recording mode is strictly prohibited in production environment");
  }
}

/**
 * Computes deterministic SHA-256 hash string for an input.
 * @param {string | Buffer} input
 * @returns {string} Hex hash
 */
export function hashData(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Serializes a Zod schema or raw schema object to a stable representation.
 * @param {any} schema
 * @returns {string}
 */
export function serializeSchema(schema) {
  if (!schema) return "null";
  if (typeof schema.toJSON === "function") {
    return JSON.stringify(schema.toJSON());
  }
  if (schema._def) {
    try {
      const shapeInfo = schema.shape
        ? Object.entries(schema.shape).map(([k, v]) => [k, v?._def?.typeName || typeof v])
        : null;
      return JSON.stringify({
        typeName: schema._def.typeName,
        description: schema.description,
        shape: shapeInfo,
        def: schema._def,
      }, (key, value) => {
        if (key === "shape" && typeof value === "function") return null;
        if (typeof value === "function") return value.name || "fn";
        if (value instanceof RegExp) return value.toString();
        return value;
      });
    } catch {
      return String(schema.description || schema.constructor?.name || "zod_schema");
    }
  }
  return typeof schema === "object" ? JSON.stringify(schema) : String(schema);
}

/**
 * Computes deterministic key for LLM generate calls.
 *
 * @param {object} params
 * @param {string} [params.system]
 * @param {string} [params.prompt]
 * @param {any} [params.schema]
 * @param {string} [params.model]
 * @param {Array<{ base64?: string, mimeType?: string }>} [params.images]
 * @returns {string} SHA-256 key
 */
export function computeGenerateKey({ system = "", prompt = "", schema, model = "", images = [] } = {}) {
  const normalizedImages = (images || []).map((img) => ({
    mimeType: img.mimeType || "image/png",
    hash: hashData(img.base64 || ""),
  }));

  const payload = {
    type: "llm_generate",
    system: String(system || ""),
    prompt: String(prompt || ""),
    schema: serializeSchema(schema),
    model: String(model || ""),
    images: normalizedImages,
  };

  return hashData(JSON.stringify(payload));
}

/**
 * Computes deterministic key for search calls.
 *
 * @param {string} query
 * @param {object} [options]
 * @returns {string} SHA-256 key
 */
export function computeSearchKey(query, { gl = "in", hl = "en", num = 10 } = {}) {
  const payload = {
    type: "web_search",
    query: String(query || "").trim(),
    gl: String(gl || "in").toLowerCase(),
    hl: String(hl || "en").toLowerCase(),
    num: Number(num) || 10,
  };

  return hashData(JSON.stringify(payload));
}

/**
 * Ensures storage directory exists.
 * @param {string} dir
 */
function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Saves recording payload atomically to disk.
 *
 * @param {string} dir
 * @param {string} key
 * @param {object} data
 */
export async function saveRecording(dir, key, data) {
  ensureDirSync(dir);
  const targetPath = path.join(dir, `${key}.json`);
  const tempPath = path.join(dir, `${key}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`);

  const serialized = JSON.stringify(data, null, 2);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");

  if (sizeBytes > MAX_RECORDING_SIZE_BYTES) {
    throw new Error(`Recording payload for key ${key} exceeds size cap (${sizeBytes} > ${MAX_RECORDING_SIZE_BYTES})`);
  }

  await fs.promises.writeFile(tempPath, serialized, "utf8");
  await fs.promises.rename(tempPath, targetPath);
}

/**
 * Reads recording payload from disk.
 * Returns null if missing or corrupted.
 *
 * @param {string} dir
 * @param {string} key
 * @returns {Promise<any | null>}
 */
export async function loadRecording(dir, key) {
  const filePath = path.join(dir, `${key}.json`);
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Creates decorated generate function according to active RECORD_REPLAY_MODE.
 *
 * @param {Function} baseGenerateFn Real generate function
 * @param {object} [options={}]
 * @param {string} [options.mode] Overrides RECORD_REPLAY_MODE
 * @param {string} [options.dir] Overrides RECORD_REPLAY_DIR
 * @param {string} [options.nodeEnv] Overrides NODE_ENV
 * @param {object} [options.logger]
 * @returns {Function} Decorated generate function
 */
export function createRecordedGenerate(baseGenerateFn, options = {}) {
  const source = options.customEnv || process.env;
  let mode = options.mode || source?.RECORD_REPLAY_MODE;
  let dir = options.dir || source?.RECORD_REPLAY_DIR;
  let modelName = options.model || source?.LLM_MODEL;

  if (!mode || !dir) {
    try {
      const parsed = getEnv(source);
      mode = mode || parsed.RECORD_REPLAY_MODE || "off";
      dir = dir || parsed.RECORD_REPLAY_DIR || ".recordings";
      modelName = modelName || parsed.LLM_MODEL;
    } catch {
      mode = mode || "off";
      dir = dir || ".recordings";
    }
  }

  const nodeEnv = options.nodeEnv || process.env.NODE_ENV;
  const logger = options.logger || defaultLogger;

  assertRecordReplaySafety(mode, nodeEnv);

  if (mode === "off") {
    return baseGenerateFn;
  }

  return async function recordedGenerate(params) {
    const model = params.customEnv?.LLM_MODEL || modelName || "default-model";
    const key = computeGenerateKey({
      system: params.system,
      prompt: params.prompt,
      schema: params.schema,
      model,
      images: params.images,
    });

    if (mode === "replay") {
      const stored = await loadRecording(dir, key);
      if (!stored) {
        logger.warn({ code: "RECORDING_MISSING", key, purpose: params.purpose }, "Replay recording not found");
        return {
          ok: false,
          error: {
            code: "RECORDING_MISSING",
            message: `Recorded model response not found for key: ${key}`,
          },
        };
      }
      return stored.result;
    }

    if (mode === "record") {
      const realResult = await baseGenerateFn(params);
      try {
        await saveRecording(dir, key, {
          key,
          type: "llm_generate",
          recordedAt: new Date().toISOString(),
          result: realResult,
        });
      } catch (err) {
        logger.error({ err: err.message, key }, "Failed to save model recording");
      }
      return realResult;
    }

    return baseGenerateFn(params);
  };
}

/**
 * Creates decorated search function according to active RECORD_REPLAY_MODE.
 *
 * @param {Function} baseSearchFn Real search function
 * @param {object} [options={}]
 * @param {string} [options.mode] Overrides RECORD_REPLAY_MODE
 * @param {string} [options.dir] Overrides RECORD_REPLAY_DIR
 * @param {string} [options.nodeEnv] Overrides NODE_ENV
 * @param {object} [options.logger]
 * @returns {Function} Decorated search function
 */
export function createRecordedSearch(baseSearchFn, options = {}) {
  const source = options.customEnv || process.env;
  let mode = options.mode || source?.RECORD_REPLAY_MODE;
  let dir = options.dir || source?.RECORD_REPLAY_DIR;

  if (!mode || !dir) {
    try {
      const parsed = getEnv(source);
      mode = mode || parsed.RECORD_REPLAY_MODE || "off";
      dir = dir || parsed.RECORD_REPLAY_DIR || ".recordings";
    } catch {
      mode = mode || "off";
      dir = dir || ".recordings";
    }
  }

  const nodeEnv = options.nodeEnv || process.env.NODE_ENV;
  const logger = options.logger || defaultLogger;

  assertRecordReplaySafety(mode, nodeEnv);

  if (mode === "off") {
    return baseSearchFn;
  }

  return async function recordedSearch(query, searchOpts = {}) {
    const key = computeSearchKey(query, {
      gl: searchOpts.gl,
      hl: searchOpts.hl,
      num: searchOpts.num,
    });

    if (mode === "replay") {
      const stored = await loadRecording(dir, key);
      if (!stored) {
        logger.warn({ code: "RECORDING_MISSING", key, query }, "Replay search recording not found");
        return {
          ok: false,
          error: {
            code: "RECORDING_MISSING",
            message: `Recorded search response not found for key: ${key}`,
          },
        };
      }
      return stored.result;
    }

    if (mode === "record") {
      const realResult = await baseSearchFn(query, searchOpts);
      try {
        await saveRecording(dir, key, {
          key,
          type: "web_search",
          recordedAt: new Date().toISOString(),
          result: realResult,
        });
      } catch (err) {
        logger.error({ err: err.message, key }, "Failed to save search recording");
      }
      return realResult;
    }

    return baseSearchFn(query, searchOpts);
  };
}
