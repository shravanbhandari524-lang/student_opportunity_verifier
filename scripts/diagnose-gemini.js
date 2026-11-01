/**
 * scripts/diagnose-gemini.js
 *
 * Sends a single text request using the configured model and prints diagnostic details:
 * - HTTP status
 * - error.status
 * - error.message
 * - error.details (QuotaFailure violations: quotaMetric, quotaId, quotaValue, and RetryInfo retryDelay)
 *
 * Official Gemini API error docs:
 * - Error structure: https://ai.google.dev/gemini-api/docs/troubleshooting#common-errors
 * - Rate limits & quotas: https://ai.google.dev/gemini-api/docs/rate-limits
 * - Standard RPC status details: https://cloud.google.com/apis/design/errors#error_details
 *
 * Invariant: Never prints API keys or credentials.
 */

import fs from "node:fs";

// Load .env.local if present and not already loaded into process.env
if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore if already loaded
  }
}

import { env } from "../lib/env.js";

async function main() {
  console.log("=== Gemini API Diagnostic ===");
  console.log(`Configured Provider: ${env.LLM_PROVIDER}`);
  console.log(`Configured Model:    ${env.LLM_MODEL}`);
  console.log(`API Key set:         ${Boolean(env.LLM_API_KEY)}`);

  if (!env.LLM_API_KEY) {
    console.error("No API key configured in environment.");
    process.exit(1);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.LLM_MODEL)}:generateContent?key=${encodeURIComponent(env.LLM_API_KEY)}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "diagnostic ping" }] }],
      }),
    });

    console.log(`HTTP status: ${res.status}`);

    const body = await res.json().catch(() => null);

    if (res.ok) {
      console.log("Call succeeded!");
      console.log("Response text preview:", body?.candidates?.[0]?.content?.parts?.[0]?.text?.slice(0, 100));
      return;
    }

    const err = body?.error || {};
    console.log(`error.status:  ${err.status || "N/A"}`);

    // Redact any key-like parameters if present in error message
    const sanitizedMsg = (err.message || "").replace(/key=[a-zA-Z0-9_\-]+/gi, "key=[REDACTED]");
    console.log(`error.message: ${sanitizedMsg}`);

    console.log("error.details:");
    if (Array.isArray(err.details)) {
      for (const d of err.details) {
        const type = d["@type"] || "";
        if (type.includes("QuotaFailure")) {
          console.log(`  - QuotaFailure:`);
          if (Array.isArray(d.violations)) {
            for (const v of d.violations) {
              console.log(`      quotaMetric: ${v.quotaMetric}`);
              console.log(`      quotaId:     ${v.quotaId}`);
              console.log(`      quotaValue:  ${v.quotaValue}`);
            }
          }
        } else if (type.includes("RetryInfo")) {
          console.log(`  - RetryInfo:`);
          console.log(`      retryDelay:  ${d.retryDelay}`);
        } else if (type.includes("Help")) {
          console.log(`  - Help links:`);
          for (const l of d.links || []) {
            console.log(`      ${l.description}: ${l.url}`);
          }
        }
      }
    } else {
      console.log("  None provided.");
    }
  } catch (netErr) {
    console.error("Network or fetch exception during diagnostic:", netErr.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Diagnostic script error:", err.message);
  process.exit(1);
});
