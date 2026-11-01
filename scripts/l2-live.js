/**
 * scripts/l2-live.js
 *
 * Unified live verification script for Layer L2 Services.
 * Runs one check for each external service or lookup tool:
 * 1. RDAP (rdapLookup)
 * 2. DNS (dnsRecords)
 * 3. SSL (sslInfo)
 * 4. Wayback CDX (waybackFirstSeen)
 * 5. Serper Search (search) [if SEARCH_API_KEY is configured]
 * 6. URLhaus (lookupHost / lookupUrl) [if URLHAUS_AUTH_KEY is configured]
 * 7. urlscan.io (urlscanSearch)
 * 8. Classifier microservice (health + classify) [if running]
 * 9. Gemini LLM (generate text) [if LLM_API_KEY is configured, exactly one minimal call]
 *
 * INVARIANTS:
 * - NEVER prints or logs secrets, API keys, or raw prompt content.
 * - Always uses fake or standard public test domains/text (e.g., example.com).
 * - Exits 0 and prints a clear markdown/summary table of statuses.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../lib/db/index.js";
import { env } from "../lib/env.js";
import { rdapLookup, dnsRecords, sslInfo, waybackFirstSeen } from "../lib/tools/domain.js";
import { search } from "../lib/tools/search.js";
import { urlhausLookup } from "../lib/tools/urlhaus.js";
import { urlscanSearch } from "../lib/tools/urlscan.js";
import { classifierHealth, classifyText } from "../lib/classifier.js";
import { generate } from "../lib/llm/generate.js";
import { z } from "zod";

async function main() {
  console.log("=== Layer L2 Services Live Verification ===");

  const tempDbPath = path.join(os.tmpdir(), `l2-live-${Date.now()}.db`);
  const db = getDb(tempDbPath);

  const results = [];

  // Helper to record result
  function record(service, status, durationMs, details) {
    results.push({ service, status, durationMs, details });
    console.log(`[${status}] ${service} (${durationMs}ms) - ${details}`);
  }

  // 1. RDAP
  try {
    const t0 = Date.now();
    const res = await rdapLookup("example.com", { db });
    const dur = Date.now() - t0;
    if (res.ok) {
      record("RDAP (rdapLookup)", "PASS", dur, `registrar: "${res.data?.registrar}", ageDays: ${res.data?.ageDays}`);
    } else {
      record("RDAP (rdapLookup)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
    }
  } catch (err) {
    record("RDAP (rdapLookup)", "ERROR", 0, err.message);
  }

  // 2. DNS
  let pinnedIp = null;
  try {
    const t0 = Date.now();
    const res = await dnsRecords("example.com", { db });
    const dur = Date.now() - t0;
    if (res.ok) {
      pinnedIp = res.data?.a?.[0] || null;
      record("DNS (dnsRecords)", "PASS", dur, `A records: ${res.data?.a?.length || 0}`);
    } else {
      record("DNS (dnsRecords)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
    }
  } catch (err) {
    record("DNS (dnsRecords)", "ERROR", 0, err.message);
  }

  // 3. SSL
  try {
    const t0 = Date.now();
    const res = await sslInfo("example.com", { pinnedIp, db });
    const dur = Date.now() - t0;
    if (res.ok) {
      record("SSL (sslInfo)", "PASS", dur, `authorized: ${res.data?.authorized}, issuer: "${res.data?.issuer}"`);
    } else {
      record("SSL (sslInfo)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
    }
  } catch (err) {
    record("SSL (sslInfo)", "ERROR", 0, err.message);
  }

  // 4. Wayback CDX
  try {
    const t0 = Date.now();
    const res = await waybackFirstSeen("example.com", { db });
    const dur = Date.now() - t0;
    if (res.ok) {
      record("Wayback (waybackFirstSeen)", "PASS", dur, `found: ${res.data?.found}, firstSeen: ${res.data?.firstSeen || "N/A"}`);
    } else {
      record("Wayback (waybackFirstSeen)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
    }
  } catch (err) {
    record("Wayback (waybackFirstSeen)", "ERROR", 0, err.message);
  }

  // 5. Serper Search
  if (env.SEARCH_API_KEY) {
    try {
      const t0 = Date.now();
      const res = await search("site:example.com", { remainingBudget: 1, db });
      const dur = Date.now() - t0;
      if (res.ok) {
        record("Search (Serper)", "PASS", dur, `results: ${res.data?.results?.length || 0}`);
      } else {
        record("Search (Serper)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
      }
    } catch (err) {
      record("Search (Serper)", "ERROR", 0, err.message);
    }
  } else {
    record("Search (Serper)", "SKIPPED", 0, "SEARCH_API_KEY not set");
  }

  // 6. URLhaus
  if (env.URLHAUS_AUTH_KEY) {
    try {
      const t0 = Date.now();
      const res = await urlhausLookup({ host: "example.com" }, { db });
      const dur = Date.now() - t0;
      if (res.ok) {
        record("URLhaus (urlhausLookup)", "PASS", dur, `listed: ${res.data?.listed}`);
      } else {
        record("URLhaus (urlhausLookup)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
      }
    } catch (err) {
      record("URLhaus (urlhausLookup)", "ERROR", 0, err.message);
    }
  } else {
    record("URLhaus (urlhausLookup)", "SKIPPED", 0, "URLHAUS_AUTH_KEY not set");
  }

  // 7. urlscan.io
  try {
    const t0 = Date.now();
    const res = await urlscanSearch({ domain: "example.com", db });
    const dur = Date.now() - t0;
    if (res.ok) {
      record("urlscan (urlscanSearch)", "PASS", dur, `total: ${res.data?.total || 0}`);
    } else {
      record("urlscan (urlscanSearch)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
    }
  } catch (err) {
    record("urlscan (urlscanSearch)", "ERROR", 0, err.message);
  }

  // 8. Classifier microservice
  try {
    const t0 = Date.now();
    const health = await classifierHealth();
    if (health.ok) {
      const classRes = await classifyText("Test opportunity message");
      const dur = Date.now() - t0;
      if (classRes.ok) {
        record("Classifier Service", "PASS", dur, `label: ${classRes.data?.label}, prob: ${classRes.data?.probability}`);
      } else {
        record("Classifier Service", "FAIL", dur, `Classify failed: ${classRes.error.message}`);
      }
    } else {
      record("Classifier Service", "SKIPPED", Date.now() - t0, `Offline (${health.error.message})`);
    }
  } catch (err) {
    record("Classifier Service", "SKIPPED", 0, err.message);
  }

  // 9. Gemini LLM (one minimal structured call)
  if (env.LLM_API_KEY) {
    try {
      const t0 = Date.now();
      const res = await generate({
        prompt: "Respond with ok: true",
        schema: z.object({ ok: z.boolean() }),
      });
      const dur = Date.now() - t0;
      if (res.ok) {
        record("LLM (generate)", "PASS", dur, `ok: ${res.data?.ok}`);
      } else {
        record("LLM (generate)", "FAIL", dur, `${res.error.code}: ${res.error.message}`);
      }
    } catch (err) {
      record("LLM (generate)", "ERROR", 0, err.message);
    }
  } else {
    record("LLM (generate)", "SKIPPED", 0, "LLM_API_KEY not set");
  }

  // Cleanup temp DB
  try {
    fs.unlinkSync(tempDbPath);
  } catch {
    // Ignore
  }

  console.log("\n=== Live Services Summary Table ===");
  console.table(results);

  // If any service whose key was configured failed, exit non-zero
  const failures = results.filter((r) => r.status === "FAIL" || r.status === "ERROR");
  if (failures.length > 0) {
    console.error(`\nL2 Live Check FAILED: ${failures.length} configured service(s) failed.`);
    for (const f of failures) {
      console.error(` - ${f.service}: ${f.details}`);
    }
    process.exit(1);
  } else {
    console.log("\nAll tested services passed successfully.");
  }
}

main().catch((err) => {
  console.error("FATAL in scripts/l2-live.js:", err);
  process.exit(1);
});
