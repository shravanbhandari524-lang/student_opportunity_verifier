#!/usr/bin/env node
/**
 * scripts/llm-live.js
 *
 * Runs live calls to the configured LLM provider:
 * (a) a text call on a fake self-written scam message returning a small schema
 * (b) an image call using a tiny built-in PNG created in code (plumbing check only)
 *
 * Prints status, latency, and the parsed result, never the API key.
 */

import fs from "node:fs";
import { z } from "zod";
import { generate, wrapUntrusted } from "../lib/llm/generate.js";
import { getEnv } from "../lib/env.js";

// Load .env.local if present and not already loaded into process.env
if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore if already loaded or not accessible
  }
}

import path from "node:path";
import os from "node:os";
import { getDb } from "../lib/db/index.js";

// Check environment variables without printing secrets
const env = getEnv(process.env);
console.log("=== Live LLM Verification ===");
console.log(`Provider: ${env.LLM_PROVIDER}`);
console.log(`Model:    ${env.LLM_MODEL}`);
console.log("API Key configured:", Boolean(env.LLM_API_KEY));

const tempDbPath = path.join(os.tmpdir(), `test-llm-live-${Date.now()}.db`);
const liveDb = getDb(tempDbPath);
console.log(`Using fresh temp DB: ${tempDbPath}`);

// Schema for text test
const ScamExtractionSchema = z.object({
  detectedScamType: z.string(),
  suspiciousElements: z.array(z.string()),
  demandedFeeAmount: z.string().nullable(),
});

// 1. Text Call Test
console.log("\n[1/2] Executing Live Text Call (Fake scam message)...");
const sampleMessage = wrapUntrusted(
  "user_message",
  "Congratulations! You have been selected for the National Merit Scholarship. To activate your monthly grant of Rs 10,000, kindly deposit a refundable security verification fee of Rs 1,500 to upi@scholarship-merit.fake immediately."
);

const textStart = Date.now();
const textResult = await generate({
  system: "You are an opportunity verification specialist. Analyze the untrusted message strictly and extract key elements into structured JSON.",
  prompt: `Analyze this notice:\n${sampleMessage}`,
  schema: ScamExtractionSchema,
  purpose: "live_text_check",
  timeoutMs: 30000,
});
const textDuration = Date.now() - textStart;

console.log(`Text Call Latency: ${textDuration}ms`);
console.log(`ToolResult ok:     ${textResult.ok}`);
console.log(`ToolResult cached: ${textResult.cached}`);

if (!textResult.ok) {
  console.error("FAIL: Text generation failed:", textResult.error);
  process.exit(1);
} else {
  console.log("Parsed Result:", JSON.stringify(textResult.data, null, 2));
}

// 2. Image Call Test (Tiny 1x1 transparent PNG created directly in code)
console.log("\n[2/2] Executing Live Image Call (Tiny PNG plumbing check)...");
// 1x1 transparent PNG base64
const tiny1x1PngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const ImageInspectionSchema = z.object({
  isImageReceived: z.boolean(),
  description: z.string(),
});

const imageStart = Date.now();
const imageResult = await generate({
  system: "You are a vision-capable inspection model. Return JSON with 'isImageReceived' (boolean) and 'description' (string).",
  prompt: "Inspect this small image file. Does it appear to be a single pixel or placeholder image? Return a JSON object with keys: isImageReceived (boolean) and description (string).",
  images: [
    {
      mimeType: "image/png",
      data: tiny1x1PngBase64,
    },
  ],
  schema: ImageInspectionSchema,
  purpose: "live_image_check",
  timeoutMs: 30000,
});
const imageDuration = Date.now() - imageStart;

console.log(`Image Call Latency: ${imageDuration}ms`);
console.log(`ToolResult ok:      ${imageResult.ok}`);
console.log(`ToolResult cached:  ${imageResult.cached}`);

// Clean up temp DB
try {
  fs.unlinkSync(tempDbPath);
} catch {
  // Ignore
}

if (!imageResult.ok) {
  console.error("FAIL: Image generation failed:", imageResult.error);
  process.exit(1);
} else {
  console.log("Parsed Result:", JSON.stringify(imageResult.data, null, 2));
}

console.log("\nSUCCESS: Both text and vision LLM live calls succeeded cleanly.");
