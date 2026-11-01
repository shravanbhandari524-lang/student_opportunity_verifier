/**
 * scripts/diagnose-urlhaus.js
 *
 * Sends a single test lookup to the URLhaus API using a harmless test host (e.g., example.com).
 * Prints only:
 * - HTTP status
 * - Whether Auth-Key was present (yes/no, NEVER prints key)
 * - Safe response fields (keys redacted)
 *
 * Official doc: https://urlhaus-api.abuse.ch/
 */

import fs from "node:fs";
import { getEnv } from "../lib/env.js";

// Load .env.local if present
if (fs.existsSync(".env.local") && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Ignore if not accessible
  }
}

async function run() {
  const env = getEnv(process.env);
  const authKey = env.URLHAUS_AUTH_KEY;

  console.log("=== URLhaus Diagnostics ===");
  console.log("Auth-Key present:", Boolean(authKey) ? "yes" : "no");

  if (!authKey) {
    console.log("Status: Skipped (no URLHAUS_AUTH_KEY in environment)");
    return;
  }

  const endpoint = "https://urlhaus-api.abuse.ch/v1/host/";
  const body = new URLSearchParams({ host: "example.com" }).toString();

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Auth-Key": authKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    console.log("HTTP status:", res.status);

    const json = await res.json();
    console.log("Query status:", json?.query_status);
    console.log("Response keys:", Object.keys(json || {}));
  } catch (err) {
    console.log("Error contacting URLhaus:", err.message);
  }
}

run();
