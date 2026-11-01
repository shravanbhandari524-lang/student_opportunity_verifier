/**
 * scripts/diagnose-urlscan.js
 *
 * Sends a single test lookup to the urlscan.io Search API using a harmless test domain (example.com).
 * Prints only:
 * - HTTP status
 * - Whether API-Key header was sent (yes/no, NEVER prints key)
 * - Safe response fields / redacted response body
 *
 * Official doc:
 * https://urlscan.io/docs/api/
 * Authentication via "API-Key: <key>" HTTP header.
 */

import fs from "node:fs";
import { getEnv } from "../lib/env.js";

// Load .env.local if present
if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore
  }
}

async function run() {
  const env = getEnv(process.env);
  const apiKey = env.URLSCAN_API_KEY;

  console.log("=== urlscan.io Diagnostics ===");
  console.log("API-Key present:", Boolean(apiKey) ? "yes" : "no");

  const endpoint = "https://urlscan.io/api/v1/search/?q=" + encodeURIComponent("domain:example.com") + "&size=1";

  const headers = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["API-Key"] = apiKey;
  }

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers,
    });

    console.log("HTTP status:", res.status);

    const json = await res.json();
    console.log("Response status field:", json?.status);
    console.log("Response message:", json?.message);
    if (json?.errors) {
      console.log("Errors:", JSON.stringify(json.errors));
    }
    if (typeof json?.total === "number") {
      console.log("Total results found:", json.total);
    }
  } catch (err) {
    console.log("Error contacting urlscan:", err.message);
  }
}

run();
