#!/usr/bin/env node
/**
 * scripts/api-e2e.js
 *
 * Offline End-to-End API Scenario Runner for Layer L6:
 * - Offline, zero network, zero real model calls.
 * - Uses isolated temporary database and upload directory.
 * - Exercises Scenarios A, B, and C (and an image-upload variation) directly through
 *   the Next.js App Router handlers:
 *   1. POST /api/checks (multipart/form-data)
 *   2. GET /api/checks/:id (polling until awaiting_confirmation)
 *   3. POST /api/checks/:id/confirm (JSON confirmed entities)
 *   4. GET /api/checks/:id/stream (SSE progress event stream)
 *   5. GET /api/checks/:id/report (Report retrieval)
 * - Asserts:
 *   - Risk levels: A = high, B = low, C = cannot_verify
 *   - Security headers present on every response
 *   - SSE event order and complete terminal event
 *   - Report conforms strictly to ReportSchema
 *   - Every flag carries evidence
 *   - Uploads directory completely cleaned up afterwards
 *   - Non-zero exit code if assertions fail or when --expect-fail is passed.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";
process.env.UPLOAD_DIR = "./data/test_api_e2e_temp/uploads";

import Database from "better-sqlite3";
import sharp from "sharp";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createJobRunner } from "../lib/api/jobs.js";
import { createEventBus } from "../lib/api/event-bus.js";
import { ReportSchema } from "../lib/contracts/report.js";
import {
  clearScamScenario,
  genuineNoticeScenario,
  ambiguousThinEvidenceScenario,
} from "../lib/contracts/fixtures/scenarios/index.js";

// Route handlers
import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";
import { POST as confirmCheckHandler } from "../app/api/checks/[id]/confirm/route.js";
import { GET as getStreamHandler } from "../app/api/checks/[id]/stream/route.js";
import { GET as getReportHandler } from "../app/api/checks/[id]/report/route.js";

const TEMP_BASE = "./data/test_api_e2e_temp";
const TEMP_DB_PATH = path.join(TEMP_BASE, "api_e2e.db");
const TEMP_UPLOAD_DIR = path.join(TEMP_BASE, "uploads");

function setupEnvironment() {
  if (fs.existsSync(TEMP_BASE)) {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });

  const db = new Database(TEMP_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const rateLimiters = {
    createCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
    confirmCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
    getCheck: createRateLimiter({ windowMs: 60 * 1000, max: 500 }),
    streamCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
    globalDaily: createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 1000 }),
  };

  const jobRunner = createJobRunner({ maxConcurrent: 4 });
  const eventBus = createEventBus();

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  return {
    db,
    rateLimiters,
    jobRunner,
    eventBus,
    logger,
    uploadDir: TEMP_UPLOAD_DIR,
  };
}

function verifySecurityHeaders(res, routeName) {
  const missing = [];
  if (res.headers.get("X-Content-Type-Options") !== "nosniff") missing.push("X-Content-Type-Options");
  if (res.headers.get("X-Frame-Options") !== "DENY") missing.push("X-Frame-Options");
  if (res.headers.get("Referrer-Policy") !== "strict-origin-when-cross-origin") missing.push("Referrer-Policy");
  if (res.headers.get("Content-Security-Policy") !== "default-src 'none'; frame-ancestors 'none'") {
    missing.push("Content-Security-Policy");
  }
  if (missing.length > 0) {
    throw new Error(`Security headers missing on ${routeName}: ${missing.join(", ")}`);
  }
}

async function createTestPng() {
  return await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 4,
      background: { r: 50, g: 150, b: 200, alpha: 1 },
    },
  }).png().toBuffer();
}

function createCoordinatorDeps(scenarioKey, db) {
  const isA = scenarioKey === "A" || scenarioKey === "A-Image";
  const isB = scenarioKey === "B";
  const isC = scenarioKey === "C";

  return {
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    generate: async (params) => {
      if (params.purpose === "report_generation") {
        if (isA) {
          return {
            ok: true,
            data: {
              summary: "High risk: scholarship demands upfront registration fee to an individual UPI handle and uses a lookalike domain.",
              scamTypeGuess: "scholarship",
              flagExplanations: [
                {
                  flagId: "scholarship_fee_demand",
                  text: "Upfront fees are never charged by legitimate government scholarship schemes.",
                },
                {
                  flagId: "individual_upi",
                  text: "Payment directed to an individual UPI handle instead of an institutional account.",
                },
              ],
              extraChecklist: [
                {
                  text: "Verify the official national scholarship portal at scholarships.gov.in directly.",
                  url: "https://scholarships.gov.in",
                },
              ],
            },
          };
        }
        if (isB) {
          return {
            ok: true,
            data: {
              summary: "Low risk: official research fellowship from an established educational institution without any fee demands.",
              scamTypeGuess: "unknown",
              flagExplanations: [],
              extraChecklist: [
                {
                  text: "Confirm interview dates via the official university website.",
                  url: null,
                },
              ],
            },
          };
        }
        return {
          ok: true,
          data: {
            summary: "Cannot verify: insufficient evidence and missing corporate identifiers for this informal rating task offer.",
            scamTypeGuess: "task_job",
            flagExplanations: [
              {
                flagId: "off_platform_contact",
                text: "Prompted to contact an anonymous handle on Telegram.",
              },
            ],
            extraChecklist: [],
          },
        };
      }

      if (params.purpose === "vision_extraction") {
        return {
          ok: true,
          data: {
            transcribedText: "Opportunity details extracted from screenshot",
            organisations: [],
            handles: [],
            urls: [],
            domains: [],
            upiIds: [],
            emails: [],
            phones: [],
            amounts: [],
          },
        };
      }

      // Message analyst
      if (isA) {
        return {
          ok: true,
          data: {
            findings: [
              {
                flagId: "scholarship_fee_demand",
                quote: "pay an upfront verification fee of Rs 750",
                explanation: "Demands fee upfront for scholarship release",
              },
            ],
          },
        };
      }
      if (isB) {
        return {
          ok: true,
          data: {
            findings: [],
          },
        };
      }
      return {
        ok: true,
        data: {
          findings: [
            {
              flagId: "off_platform_contact",
              quote: "Reach out on telegram @remote_work_desk",
              explanation: "Migrates conversation to Telegram",
            },
          ],
        },
      };
    },

    classify: async () => {
      if (isA) return { ok: true, data: { label: "suspicious", probability: 0.95, topTerms: ["fee", "upfront"] } };
      if (isB) return { ok: true, data: { label: "benign", probability: 0.05, topTerms: ["fellowship"] } };
      return { ok: false, error: { code: "ECONNREFUSED", message: "Classifier offline" } };
    },

    search: async (query) => {
      if (isC) return { ok: false, error: { code: "ETIMEDOUT", message: "Search timed out" } };
      return { ok: true, data: { query, total: 0, results: [] } };
    },

    readPage: async (url) => {
      if (isC) return { ok: false, error: { code: "ETIMEDOUT" } };
      return {
        ok: true,
        data: {
          finalUrl: url,
          title: "Opportunity portal",
          metaDescription: "Portal information",
          text: "Official text content",
          links: [],
        },
      };
    },

    rdapLookup: async (domain) => ({
      ok: true,
      data: {
        domain,
        found: true,
        registrationDate: isA ? "2026-10-15T00:00:00.000Z" : "2015-01-01T00:00:00.000Z",
        expirationDate: "2028-01-01T00:00:00.000Z",
        ageDays: isA ? 5 : 3500,
        registrar: "Official Registrar",
        status: ["active"],
        evidenceUrl: `https://rdap.org/domain/${domain}`,
      },
    }),

    dnsRecords: async (domain) => ({
      ok: true,
      data: { domain, a: ["93.184.216.34"], mx: [], txt: [] },
    }),

    sslInfo: async (domain) => ({
      ok: true,
      data: { domain, valid: true, issuer: "Let's Encrypt", daysRemaining: 120 },
    }),

    waybackFirstSeen: async (domain) => ({
      ok: true,
      data: { domain, firstSeen: isA ? null : "2016-01-01T00:00:00.000Z", totalSnapshots: isA ? 0 : 40 },
    }),

    lookalikeCheck: (domain) => {
      if (isA && domain.includes("scholarship")) {
        return {
          domain,
          isLookalike: true,
          targetDomain: "scholarships.gov.in",
          similarityScore: 0.88,
        };
      }
      return { domain, isLookalike: false, targetDomain: null, similarityScore: 0 };
    },

    urlhaus: async () => ({ ok: true, data: { query_status: "no_results", listed: false } }),
    urlscanSearch: async () => ({ ok: true, data: { total: 0, results: [] } }),
    graphLookup: () => {
      if (isC) {
        return {
          ok: false,
          error: { code: "ECONNREFUSED", message: "Graph lookup service unavailable" },
        };
      }
      return { matched: false };
    },
  };
}

async function runScenarioE2E(scenarioKey, scenarioData, runtime, options = {}) {
  const startTime = Date.now();
  const isA = scenarioKey === "A" || scenarioKey === "A-Image";
  const isB = scenarioKey === "B";
  const isC = scenarioKey === "C";
  const fileScenarioKey = scenarioKey.startsWith("A") ? "a" : scenarioKey.toLowerCase();

  console.log(`\n=======================================================`);
  console.log(`  SCENARIO ${scenarioKey}: ${scenarioData.name}`);
  console.log(`  File: lib/contracts/fixtures/scenarios/scenario-${fileScenarioKey}.js`);
  console.log(`=======================================================`);

  // Step 1: Create Check via POST /api/checks (multipart/form-data)
  console.log("\n[Step 1] Creating check via POST /api/checks...");
  const formData = new FormData();
  formData.append("text", scenarioData.submission.text || "");
  formData.append("consent", "true");
  formData.append("language", scenarioData.submission.language || "en");

  if (scenarioData.submission.url) formData.append("url", scenarioData.submission.url);
  if (scenarioData.submission.upiId) formData.append("upiId", scenarioData.submission.upiId);
  if (scenarioData.submission.company) formData.append("company", scenarioData.submission.company);
  if (scenarioData.submission.handle) formData.append("handle", scenarioData.submission.handle);

  if (options.attachImage) {
    const pngBuf = await createTestPng();
    formData.append("images", new Blob([pngBuf], { type: "image/png" }), "screenshot.png");
    console.log("Attached test image: screenshot.png");
  }

  const createReq = new Request("http://localhost/api/checks", {
    method: "POST",
    body: formData,
  });

  const extractDeps = {
    db: runtime.db,
    logger: runtime.logger,
    uploadDir: runtime.uploadDir,
    generate: async () => ({
      ok: true,
      data: {
        transcribedText: "Transcribed visual text",
        organisations: [],
        handles: [],
        urls: [],
        domains: [],
        upiIds: [],
        emails: [],
        phones: [],
        amounts: [],
      },
    }),
  };

  const createRes = await createCheckHandler(createReq, {
    runtime,
    extractDeps,
  });

  verifySecurityHeaders(createRes, "POST /api/checks");
  if (createRes.status !== 201) {
    const err = await createRes.json();
    throw new Error(`Failed to create check: HTTP ${createRes.status} ${JSON.stringify(err)}`);
  }

  const { checkId, status: initialStatus } = await createRes.json();
  console.log(`✓ Check created: ID = ${checkId}, initial status = ${initialStatus}`);

  // Step 2: Poll GET /api/checks/:id until awaiting_confirmation
  console.log("\n[Step 2] Polling GET /api/checks/:id for extraction completion...");
  let checkSummary = null;
  let extractedEntities = [];

  for (let poll = 0; poll < 30; poll++) {
    const pollReq = new Request(`http://localhost/api/checks/${checkId}`);
    const pollRes = await getCheckHandler(pollReq, {
      runtime,
      params: Promise.resolve({ id: checkId }),
    });

    verifySecurityHeaders(pollRes, "GET /api/checks/:id");
    if (pollRes.status !== 200) {
      throw new Error(`Polling failed with status ${pollRes.status}`);
    }

    const body = await pollRes.json();
    checkSummary = body.check;
    extractedEntities = body.entities || [];

    if (checkSummary.status === "awaiting_confirmation") {
      console.log(`✓ Check transitioned to 'awaiting_confirmation' at poll ${poll + 1}`);
      console.log(`  Extracted entities count: ${extractedEntities.length}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!checkSummary || checkSummary.status !== "awaiting_confirmation") {
    throw new Error(`Check failed to reach awaiting_confirmation (current: ${checkSummary?.status})`);
  }

  // Step 3: Open GET /api/checks/:id/stream connection
  console.log("\n[Step 3] Opening SSE progress stream GET /api/checks/:id/stream...");
  const streamReq = new Request(`http://localhost/api/checks/${checkId}/stream`);
  const streamRes = await getStreamHandler(streamReq, {
    runtime,
    params: Promise.resolve({ id: checkId }),
  });

  verifySecurityHeaders(streamRes, "GET /api/checks/:id/stream");
  if (streamRes.status !== 200) {
    throw new Error(`Stream connection failed with HTTP ${streamRes.status}`);
  }

  const streamReader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  const sseEvents = [];
  let streamClosed = false;

  const readStreamPromise = (async () => {
    let buffer = "";
    while (true) {
      const { value, done } = await streamReader.read();
      if (done) {
        streamClosed = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        let id = null;
        let event = "message";
        let dataStr = "";
        let retry = null;

        for (const line of lines) {
          if (line.startsWith("id: ")) id = parseInt(line.slice(4), 10);
          else if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("retry: ")) retry = parseInt(line.slice(7), 10);
          else if (line.startsWith("data: ")) dataStr += (dataStr ? "\n" : "") + line.slice(6);
        }

        try {
          const parsedData = JSON.parse(dataStr);
          sseEvents.push({ id, event, retry, data: parsedData });
        } catch (_e) {
          sseEvents.push({ id, event, retry, rawData: dataStr });
        }
      }
    }
  })();

  // Step 4: Confirm entities via POST /api/checks/:id/confirm
  console.log("\n[Step 4] Confirming entities via POST /api/checks/:id/confirm...");
  const confirmedEntities = extractedEntities.map((e) => ({
    kind: e.kind,
    value: e.value,
  }));

  const confirmReq = new Request(`http://localhost/api/checks/${checkId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [scenarioData.submission.text],
      entities: confirmedEntities,
    }),
  });

  const coordinatorDeps = createCoordinatorDeps(scenarioKey, runtime.db);

  const confirmRes = await confirmCheckHandler(confirmReq, {
    runtime,
    params: Promise.resolve({ id: checkId }),
    coordinatorDeps,
  });

  verifySecurityHeaders(confirmRes, "POST /api/checks/:id/confirm");
  if (confirmRes.status !== 200) {
    const err = await confirmRes.json();
    throw new Error(`Confirm failed: HTTP ${confirmRes.status} ${JSON.stringify(err)}`);
  }
  console.log("✓ Confirmation accepted; background investigation running");

  // Await stream reader completion (coordinator job finishes and emits terminal event)
  await readStreamPromise;
  console.log(`✓ Stream terminated cleanly. Collected ${sseEvents.length} SSE frames.`);

  // Step 5: Fetch report via GET /api/checks/:id/report
  console.log("\n[Step 5] Fetching final report via GET /api/checks/:id/report...");
  const reportReq = new Request(`http://localhost/api/checks/${checkId}/report`);
  const reportRes = await getReportHandler(reportReq, {
    runtime,
    params: Promise.resolve({ id: checkId }),
  });

  verifySecurityHeaders(reportRes, "GET /api/checks/:id/report");
  if (reportRes.status !== 200) {
    const err = await reportRes.json();
    throw new Error(`Report retrieval failed: HTTP ${reportRes.status} ${JSON.stringify(err)}`);
  }

  const reportData = await reportRes.json();
  const durationMs = Date.now() - startTime;

  // Validate Report strictly against ReportSchema
  const validatedReport = ReportSchema.parse(reportData.report || reportData);

  // Print Timeline & Results
  console.log("\n--- SSE Event Timeline ---");
  for (const ev of sseEvents) {
    const evType = ev.data?.type || ev.event || "unknown";
    const detail = ev.data?.stage || ev.data?.agent || ev.data?.status || ev.data?.riskLevel || "";
    console.log(`  [id: ${ev.id ?? "-"}] ${evType} ${detail ? `-> ${detail}` : ""}`);
  }

  console.log("\n--- Scenario Results ---");
  console.log(`  Risk Level:   ${validatedReport.riskLevel}`);
  console.log(`  Score:        ${validatedReport.score}`);
  console.log(`  Confidence:   ${validatedReport.confidence}`);
  console.log(`  Summary:      ${validatedReport.summary.slice(0, 200)}...`);
  console.log(`  Flags Count:  ${validatedReport.flags.length}`);
  console.log(`  Checklist:    ${validatedReport.checklist.length} items`);
  console.log(`  Duration:     ${durationMs}ms`);

  // Assertions
  const expectedLevel = isA ? "high" : isB ? "low" : "cannot_verify";
  if (options.expectFail) {
    // Deliberately fail assertion for --expect-fail proof
    if (validatedReport.riskLevel === expectedLevel) {
      throw new Error(`[EXPECT-FAIL] Deliberately asserting wrong level: expected not ${expectedLevel}`);
    }
  } else {
    if (validatedReport.riskLevel !== expectedLevel) {
      throw new Error(`Risk level mismatch: expected '${expectedLevel}', got '${validatedReport.riskLevel}'`);
    }
  }

  // Verify all flags carry evidence
  for (const flag of validatedReport.flags) {
    if (!flag.evidence || !Array.isArray(flag.evidence) || flag.evidence.length === 0) {
      throw new Error(`Flag '${flag.id}' is missing evidence`);
    }
  }

  // Verify SSE event ordering and terminal frame
  const eventIds = sseEvents.map((e) => e.id).filter((id) => id !== null && id !== undefined);
  for (let i = 1; i < eventIds.length; i++) {
    if (eventIds[i] <= eventIds[i - 1]) {
      throw new Error(`SSE frame IDs are out of order or duplicated: ${eventIds[i - 1]} >= ${eventIds[i]}`);
    }
  }

  const lastEvent = sseEvents[sseEvents.length - 1];
  if (!lastEvent || (lastEvent.data?.type !== "complete" && lastEvent.data?.type !== "error")) {
    throw new Error(`SSE stream did not terminate with complete or error frame (last: ${JSON.stringify(lastEvent)})`);
  }

  console.log(`✓ Scenario ${scenarioKey} passed all validations.`);
  return {
    scenarioKey,
    level: validatedReport.level,
    score: validatedReport.score,
    confidence: validatedReport.confidence,
    durationMs,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const expectFail = args.includes("--expect-fail");

  console.log("=== Starting Offline End-to-End API Runner (L6-F) ===");
  if (expectFail) {
    console.log("Mode: --expect-fail active (verifying non-zero exit on assertion error)");
  }

  const runtime = setupEnvironment();

  try {
    // 1. Scenario A: Clear Scam
    await runScenarioE2E("A", clearScamScenario, runtime, { expectFail });

    // 2. Scenario B: Genuine Notice (with company, url)
    await runScenarioE2E("B", genuineNoticeScenario, runtime);

    // 3. Scenario C: Ambiguous Thin Evidence (with handle)
    await runScenarioE2E("C", ambiguousThinEvidenceScenario, runtime);

    // 4. Scenario A variation with an image upload (PNG)
    await runScenarioE2E("A-Image", clearScamScenario, runtime, { attachImage: true });

    // Check that uploads directory is completely cleaned up
    const remainingFiles = fs.readdirSync(TEMP_UPLOAD_DIR);
    if (remainingFiles.length > 0) {
      throw new Error(`Upload directory is not empty after execution: ${remainingFiles.join(", ")}`);
    }
    console.log("\n✓ Upload directory is clean: 0 orphan files remain.");

    console.log("\n=======================================================");
    console.log("  ALL SCENARIOS PASSED OFFLINE E2E API VALIDATION");
    console.log("=======================================================");
  } finally {
    if (fs.existsSync(TEMP_BASE)) {
      try {
        fs.rmSync(TEMP_BASE, { recursive: true, force: true });
      } catch (_e) {}
    }
  }
}

main().catch((err) => {
  console.error("\n❌ E2E API Runner Failed:", err.message);
  process.exit(1);
});
