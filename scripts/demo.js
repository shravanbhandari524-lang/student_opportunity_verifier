#!/usr/bin/env node
/**
 * scripts/demo.js
 *
 * Runnable Companion CLI for Demonstrating Opportunity Verifier:
 * - Executes Scenario A (High Risk Scam), Scenario B (Low Risk Genuine), or Scenario C (Ambiguous Thin Evidence).
 * - Offline-first: Runs cleanly using offline fixtures and coordinator mocks, or recorded replay sessions.
 * - Prints colored or formatted terminal output with:
 *   - Submission summary
 *   - Extracted and confirmed entities
 *   - Live pipeline progress
 *   - Deterministic risk assessment (Level, Score, Confidence)
 *   - Evidence quotes and actionable checklist
 *
 * Usage:
 *   node scripts/demo.js
 *   node scripts/demo.js --scenario A
 *   node scripts/demo.js --scenario B
 *   node scripts/demo.js --scenario C
 *   node scripts/demo.js --all
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
process.env.LLM_API_KEY = process.env.LLM_API_KEY || "mock-key";
process.env.LLM_MODEL = process.env.LLM_MODEL || "mock-model";

import { runMigrations } from "../lib/db/migrations/index.js";
import { createRateLimiter } from "../lib/api/rate-limit.js";
import { createJobRunner } from "../lib/api/jobs.js";
import { createEventBus } from "../lib/api/event-bus.js";
import {
  clearScamScenario,
  genuineNoticeScenario,
  ambiguousThinEvidenceScenario,
} from "../lib/contracts/fixtures/scenarios/index.js";

import { POST as createCheckHandler } from "../app/api/checks/route.js";
import { GET as getCheckHandler } from "../app/api/checks/[id]/route.js";
import { POST as confirmCheckHandler } from "../app/api/checks/[id]/confirm/route.js";
import { GET as getReportHandler } from "../app/api/checks/[id]/report/route.js";

const SCENARIOS = {
  A: {
    key: "A",
    title: "Scenario A: High-Risk Upfront Fee Scam",
    data: clearScamScenario,
    expected: "high",
  },
  B: {
    key: "B",
    title: "Scenario B: Low-Risk Genuine Fellowship Notice",
    data: genuineNoticeScenario,
    expected: "low",
  },
  C: {
    key: "C",
    title: "Scenario C: Ambiguous Thin Evidence Fallback",
    data: ambiguousThinEvidenceScenario,
    expected: "cannot_verify",
  },
};

function setupDemoRuntime(dbPath) {
  const db = new Database(dbPath || ":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  return {
    db,
    rateLimiters: {
      createCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      confirmCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      getCheck: createRateLimiter({ windowMs: 60 * 1000, max: 500 }),
      streamCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      actionCheck: createRateLimiter({ windowMs: 60 * 1000, max: 100 }),
      globalDaily: createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 1000 }),
    },
    jobRunner: createJobRunner({ maxConcurrent: 4 }),
    eventBus: createEventBus(),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    uploadDir: "./uploads",
  };
}

function createScenarioDeps(scenarioKey, db) {
  const isA = scenarioKey === "A";
  const isB = scenarioKey === "B";
  const isC = scenarioKey === "C";

  return {
    db,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    generate: async (params) => {
      if (params.purpose === "vision_extraction") {
        return {
          ok: true,
          data: {
            transcribedText: "",
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
              ],
              extraChecklist: [
                {
                  text: "Check official scholarships.gov.in portal directly.",
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
              summary: "Low risk: official postgraduate fellowship notice from verified federal domain.",
              scamTypeGuess: "scholarship",
              flagExplanations: [],
              extraChecklist: [
                {
                  text: "Verify application deadline on nsf.gov.",
                  url: "https://www.nsf.gov/fellowships",
                },
              ],
            },
          };
        }
        return {
          ok: true,
          data: {
            summary: "Cannot verify: offer provides only a Telegram handle with insufficient verifiable entity details.",
            scamTypeGuess: "task_job",
            flagExplanations: [
              {
                flagId: "off_platform_contact",
                text: "Directing applicants immediately to messaging apps without an official domain is common in task fraud.",
              },
            ],
            extraChecklist: [
              {
                text: "Ask for an official company email address and registration details.",
                url: null,
              },
            ],
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
        return { ok: true, data: { findings: [] } };
      }
      return {
        ok: true,
        data: {
          findings: [
            {
              flagId: "off_platform_contact",
              quote: "Reach out on telegram @remote_work_desk",
              explanation: "Directs applicant to Telegram",
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
      if (isC) return { ok: false, error: { code: "ECONNREFUSED" } };
      return { matched: false };
    },
  };
}

export async function runDemoScenario(scenarioKey) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    console.error(`Unknown scenario: ${scenarioKey}. Available: A, B, C`);
    return false;
  }

  const runtime = setupDemoRuntime();
  const coordinatorDeps = createScenarioDeps(scenarioKey, runtime.db);

  console.log("\n=======================================================");
  console.log(`  DEMO: ${scenario.title}`);
  console.log("=======================================================");
  console.log("\n[1] User Submitted Offer Text:");
  console.log(`    "${scenario.data.submission.text.trim()}"`);

  // 1. POST /api/checks
  const fd = new FormData();
  fd.append("text", scenario.data.submission.text);
  fd.append("consent", "true");
  fd.append("language", scenario.data.submission.language || "en");
  if (scenario.data.submission.url) fd.append("url", scenario.data.submission.url);
  if (scenario.data.submission.upiId) fd.append("upiId", scenario.data.submission.upiId);
  if (scenario.data.submission.company) fd.append("company", scenario.data.submission.company);
  if (scenario.data.submission.handle) fd.append("handle", scenario.data.submission.handle);

  const createReq = new Request("http://localhost/api/checks", { method: "POST", body: fd });
  const extractDeps = {
    db: runtime.db,
    logger: runtime.logger,
    uploadDir: runtime.uploadDir,
    generate: coordinatorDeps.generate,
  };

  const createRes = await createCheckHandler(createReq, { runtime, extractDeps });
  const { checkId } = await createRes.json();
  console.log(`\n[2] Check created successfully (ID: ${checkId})`);

  // 2. Poll until awaiting_confirmation
  let extractedEntities = [];
  while (true) {
    const getReq = new Request(`http://localhost/api/checks/${checkId}`);
    const getRes = await getCheckHandler(getReq, {
      runtime,
      params: Promise.resolve({ id: checkId }),
    });
    const body = await getRes.json();
    if (body.check?.status === "awaiting_confirmation") {
      extractedEntities = body.entities || [];
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }

  console.log(`[3] Entities Extracted for Review (${extractedEntities.length}):`);
  for (const ent of extractedEntities) {
    console.log(`    - [${ent.kind.toUpperCase()}] ${ent.value}`);
  }

  // 3. Confirm
  const confirmReq = new Request(`http://localhost/api/checks/${checkId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: [scenario.data.submission.text],
      entities: extractedEntities.map((e) => ({ kind: e.kind, value: e.value })),
    }),
  });

  await confirmCheckHandler(confirmReq, {
    runtime,
    params: Promise.resolve({ id: checkId }),
    coordinatorDeps,
  });

  console.log("[4] Investigation dispatched to specialist agents...");

  // 4. Poll until report_ready
  while (true) {
    const getReq = new Request(`http://localhost/api/checks/${checkId}`);
    const getRes = await getCheckHandler(getReq, {
      runtime,
      params: Promise.resolve({ id: checkId }),
    });
    const body = await getRes.json();
    if (body.check?.status === "report_ready") {
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }

  // 5. Fetch report
  const reportReq = new Request(`http://localhost/api/checks/${checkId}/report`);
  const reportRes = await getReportHandler(reportReq, {
    runtime,
    params: Promise.resolve({ id: checkId }),
  });
  const { report } = await reportRes.json();

  console.log("\n=======================================================");
  console.log("                FINAL RISK ASSESSMENT                  ");
  console.log("=======================================================");
  console.log(`  Risk Level:   ${report.riskLevel.toUpperCase()}`);
  console.log(`  Score:        ${report.score} / 100`);
  console.log(`  Confidence:   ${report.confidence}`);
  console.log(`  Summary:      ${report.summary}`);

  console.log(`\n  Detected Flags (${report.flags.length}):`);
  if (report.flags.length === 0) {
    console.log("    (None - Clean evidence record)");
  } else {
    for (const flag of report.flags) {
      console.log(`    ✖ [${flag.severity.toUpperCase()}] ${flag.id}: ${flag.title}`);
      for (const ev of flag.evidence) {
        if (ev.quote) console.log(`        Evidence quote: "${ev.quote}"`);
        if (ev.url) console.log(`        Evidence source: ${ev.url}`);
      }
    }
  }

  console.log(`\n  Next Steps Checklist (${report.checklist.length}):`);
  for (const item of report.checklist) {
    console.log(`    - ${item.text}${item.url ? ` (${item.url})` : ""}`);
  }
  console.log("=======================================================\n");

  const passed = report.riskLevel === scenario.expected;
  if (!passed) {
    console.error(`Mismatch: Expected level '${scenario.expected}', got '${report.riskLevel}'`);
  }
  return passed;
}

if (process.argv[1] && process.argv[1].endsWith("demo.js")) {
  const args = process.argv.slice(2);
  let scenariosToRun = ["A", "B", "C"];

  if (args.includes("--scenario") || args.includes("-s")) {
    const idx = args.indexOf("--scenario") !== -1 ? args.indexOf("--scenario") : args.indexOf("-s");
    const chosen = args[idx + 1]?.toUpperCase();
    if (chosen && SCENARIOS[chosen]) {
      scenariosToRun = [chosen];
    }
  } else if (args.includes("A")) {
    scenariosToRun = ["A"];
  } else if (args.includes("B")) {
    scenariosToRun = ["B"];
  } else if (args.includes("C")) {
    scenariosToRun = ["C"];
  }

  (async () => {
    let allPassed = true;
    for (const s of scenariosToRun) {
      const ok = await runDemoScenario(s);
      if (!ok) allPassed = false;
    }
    process.exit(allPassed ? 0 : 1);
  })();
}
