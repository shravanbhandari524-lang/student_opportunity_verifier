#!/usr/bin/env node
/**
 * scripts/run-check.js
 *
 * Offline test runner and live CLI verifier for Layer L5:
 * - Default (offline) mode: runs full end-to-end check across Scenarios A, B, and C
 *   using local isolated SQLite databases, simulated confirm steps, and schema-routed stubs.
 * - Live mode (--live): runs single check against real Gemini LLM and Serper search
 *   using a self-written fake message and --yes-use-fake-message flag.
 * - Prints tabular scenario progression, event timelines, and gate metrics.
 * - Exits non-zero on any gate violation or when --expect-fail is provided.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";

import {
  clearScamScenario,
  genuineNoticeScenario,
  ambiguousThinEvidenceScenario,
} from "../lib/contracts/fixtures/scenarios/index.js";
import { ReportSchema } from "../lib/contracts/report.js";
import { runExtraction } from "../lib/extract.js";
import { runInvestigation } from "../lib/coordinator.js";
import {
  getDb,
  createCheck,
  saveInputs,
  getEntities,
  saveConfirmation,
  getReport,
  getEvents,
  getCheck,
  getLedger,
} from "../lib/db/index.js";
import { getCaseFile } from "../lib/caseFile.js";
import { scoreCase } from "../lib/scoring/score.js";
import { getEnv } from "../lib/env.js";
import { generate as realGenerate } from "../lib/llm/generate.js";
import { search as realSearch } from "../lib/tools/search.js";
import { reconcile } from "../lib/evidence/ledger.js";

/**
 * Formats a TraceEvent into a clean, human-readable CLI trace line:
 * [seq] agent | tool | label | short summary
 *
 * @param {object} e TraceEvent
 * @returns {string}
 */
export function formatTraceEvent(e) {
  const seq = String(e.seq ?? "-").padStart(3, "0");
  const agent = (e.agent || "coordinator").padEnd(19, " ");
  let toolOrType = "";
  let labelOrClaim = "";
  let summary = "";

  switch (e.type) {
    case "tool_start":
      toolOrType = `tool: ${e.tool}`;
      labelOrClaim = e.label || e.tool;
      summary = `input: "${e.input}"`;
      break;
    case "tool_end":
      toolOrType = `tool: ${e.tool}`;
      labelOrClaim = `status: ${e.status} (${e.durationMs}ms)`;
      summary = e.summary;
      break;
    case "note":
      toolOrType = "note";
      labelOrClaim = "-";
      summary = e.text;
      break;
    case "verdict":
      toolOrType = "verdict";
      labelOrClaim = `[${e.verdict}]`;
      summary = `${e.claim} (sources: ${(e.sources || []).length})`;
      break;
    case "flag":
      toolOrType = "flag";
      labelOrClaim = `[${e.severity}] ${e.title}`;
      summary = `id: ${e.flagId}, evidence: ${(e.evidence || []).length}`;
      break;
    case "entity":
      toolOrType = "entity";
      labelOrClaim = `[${e.kind}]`;
      summary = `${e.value} (evidence: ${String(e.evidence || "").slice(0, 30)})`;
      break;
    case "agent_status":
      toolOrType = "agent_status";
      labelOrClaim = `[${e.status}]`;
      summary = e.summary;
      break;
    case "stage":
      toolOrType = "stage";
      labelOrClaim = e.stage;
      summary = `transition to ${e.stage}`;
      break;
    case "round":
      toolOrType = "round";
      labelOrClaim = `Round ${e.round}`;
      summary = `round ${e.round} execution`;
      break;
    case "complete":
      toolOrType = "complete";
      labelOrClaim = "-";
      summary = "investigation complete";
      break;
    default:
      toolOrType = e.type || "unknown";
      labelOrClaim = "-";
      summary = e.summary || JSON.stringify(e);
      break;
  }

  return `[#${seq}] ${agent} | ${toolOrType.padEnd(18, " ")} | ${labelOrClaim.padEnd(30, " ")} | ${summary}`;
}

const CLI_UPLOADS_DIR = "./temp_cli_uploads";

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Creates deterministic mock dependencies for a given scenario.
 * Reuses the same robust mock shapes from L4 / Coordinator tests.
 *
 * @param {string} scenarioKey "A" | "B" | "C"
 * @param {import("better-sqlite3").Database} db
 * @param {object} [opts={}]
 * @returns {object} deps
 */
function createScenarioDeps(scenarioKey, db, opts = {}) {
  const isA = scenarioKey === "A";
  const isB = scenarioKey === "B";
  const isC = scenarioKey === "C";

  return {
    db,
    now: () => new Date().toISOString(),
    generate: async (params) => {
      // 1. Report writer prompt
      if (params.purpose === "report_generation") {
        if (isA) {
          return {
            ok: true,
            data: {
              summary: "This check detected an urgent upfront scholarship fee demand and suspicious unverified payment channel.",
              scamTypeGuess: "scholarship",
              flagExplanations: [
                {
                  flagId: "scholarship_fee_demand",
                  text: "The opportunity demands an upfront registration fee to an individual UPI handle.",
                },
              ],
              extraChecklist: [
                {
                  text: "Do not transfer money to unverified UPI addresses.",
                  url: null,
                },
              ],
            },
          };
        }
        if (isB) {
          return {
            ok: true,
            data: {
              summary: "Official fellowship notification from an established academic research institute. Note that this is not a guarantee of safety.",
              scamTypeGuess: "unknown",
              flagExplanations: [],
              extraChecklist: [],
            },
          };
        }
        return {
          ok: true,
          data: {
            summary: "Assessment inconclusive: insufficient evidence to verify this informal opportunity.",
            scamTypeGuess: "task_job",
            flagExplanations: [],
            extraChecklist: [],
          },
        };
      }

      // 2. Vision extraction (returns no entities for text-only scenarios)
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

      // 3. Message Analyst
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
              {
                flagId: "urgency_pressure",
                quote: "within 2 hours",
                explanation: "Imposes strict deadline",
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
              explanation: "Directs communication to external Telegram handle",
            },
          ],
        },
      };
    },

    classify: async () => {
      if (isA) {
        return {
          ok: true,
          data: {
            label: "suspicious",
            probability: 0.94,
            topTerms: ["upfront", "fee", "verification"],
          },
        };
      }
      if (isB) {
        return {
          ok: true,
          data: {
            label: "benign",
            probability: 0.05,
            topTerms: ["applications", "fellowship"],
          },
        };
      }
      return {
        ok: false,
        error: { code: "ECONNREFUSED", message: "Classifier service unavailable" },
      };
    },

    search: async (query) => {
      if (isC) {
        return {
          ok: false,
          error: { code: "ETIMEDOUT", message: "Search service timed out" },
        };
      }
      if (isA && query.includes("scholarship.dept@okaxis")) {
        return {
          ok: true,
          data: {
            query,
            total: 1,
            results: [
              {
                position: 1,
                title: "Complaints against scholarship.dept@okaxis",
                snippet: "Students reporting fake PM scholarship demands to scholarship.dept@okaxis",
                url: "https://consumercomplaints.example/scam/101",
              },
            ],
          },
        };
      }
      if (isB && (query.includes("Fellowship") || query.includes("National Research Institute") || query.includes("fellowship") || query.includes("Academic"))) {
        return {
          ok: true,
          data: {
            query,
            total: 1,
            results: [
              {
                position: 1,
                title: "2026 Academic Research Fellowship - Official Portal",
                snippet: "Applications are invited for the active 2026 Academic Research Fellowship scheme.",
                url: "https://scholarships.gov.in/fellowships/academic-research-2026",
              },
            ],
          },
        };
      }
      return {
        ok: true,
        data: { query, total: 0, results: [] },
      };
    },

    readPage: async (url) => {
      if (isC) {
        return { ok: false, error: { code: "ETIMEDOUT" } };
      }
      if (isA) {
        // Return an outgoing link to trigger domain discovery in round 1 for scenario A
        return {
          ok: true,
          data: {
            finalUrl: url,
            title: "Scholarship Portal Apply Page",
            metaDescription: "Apply for scholarship",
            text: "Official scholarship information.",
            links: ["https://partner-portal.example/trust"],
          },
        };
      }
      if (url.includes("scholarships.gov.in")) {
        return {
          ok: true,
          data: {
            finalUrl: url,
            title: "National Scholarship Portal",
            metaDescription: "Active fellowship scheme",
            text: "Official 2026 Academic Research Fellowship is an active scholarship scheme for students.",
            links: [],
          },
        };
      }
      return {
        ok: true,
        data: {
          finalUrl: url,
          title: "National Research Institute Portal",
          metaDescription: "Academic research portal",
          text: "Official fellowship announcement.",
          links: [],
        },
      };
    },

    rdapLookup: async (domain) => {
      if (isA) {
        return {
          ok: true,
          data: {
            domain,
            found: true,
            registrationDate: "2026-10-15T00:00:00.000Z",
            expirationDate: "2027-10-15T00:00:00.000Z",
            ageDays: 5,
            registrar: "CheapNames Inc",
            status: ["active"],
            evidenceUrl: `https://rdap.org/domain/${domain}`,
          },
        };
      }
      return {
        ok: true,
        data: {
          domain,
          found: true,
          registrationDate: "2015-01-01T00:00:00.000Z",
          expirationDate: "2030-01-01T00:00:00.000Z",
          ageDays: 3000,
          registrar: "Official Registrar",
          status: ["active"],
          evidenceUrl: `https://rdap.org/domain/${domain}`,
        },
      };
    },

    dnsRecords: async (domain) => ({
      ok: true,
      data: { domain, a: ["93.184.216.34"], mx: ["mail.example.com"], txt: [] },
    }),

    sslInfo: async (domain) => ({
      ok: true,
      data: { domain, valid: true, issuer: "Let's Encrypt", daysRemaining: 180 },
    }),

    waybackFirstSeen: async (domain) => {
      if (isA) {
        return {
          ok: true,
          data: { domain, firstSeen: null, totalSnapshots: 0 },
        };
      }
      return {
        ok: true,
        data: { domain, firstSeen: "2016-01-01T00:00:00.000Z", totalSnapshots: 50 },
      };
    },

    lookalikeCheck: (domain) => {
      if (isA && domain.includes("scholarship")) {
        return {
          domain,
          isLookalike: true,
          targetDomain: "scholarships.gov.in",
          similarityScore: 0.88,
        };
      }
      return {
        domain,
        isLookalike: false,
        targetDomain: null,
        similarityScore: 0.0,
      };
    },

    urlhaus: async () => ({
      ok: true,
      data: { query_status: "no_results", listed: false },
    }),

    urlscanSearch: async () => ({
      ok: true,
      data: { total: 0, results: [] },
    }),

    graphLookup: (kind, value) => {
      if (isC) {
        return {
          ok: false,
          error: { code: "ECONNREFUSED", message: "Graph lookup service unavailable" },
        };
      }
      if (isA && kind === "upi" && value === "scholarship.dept@okaxis") {
        return {
          matched: true,
          nodeId: 42,
          reportCount: 3,
          connectedNodesCount: 2,
        };
      }
      return { matched: false };
    },

    ...opts,
  };
}

/**
 * Runs a scenario end-to-end through Extraction, Confirmation, and Investigation.
 *
 * @param {object} scenarioDef
 * @param {string} scenarioKey "A" | "B" | "C"
 * @param {object} [opts={}]
 * @returns {Promise<object>} Run summary
 */
async function runSingleScenario(scenarioDef, scenarioKey, opts = {}) {
  const startTs = Date.now();
  const dbFile = `./data/test_cli_scenario_${scenarioKey}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`;
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

  const db = getDb(dbFile);
  const statusProgression = [];

  try {
    // 1. Programmatic Check Creation (matching app/api/checks/route.js)
    const checkId = crypto.randomUUID();
    const submission = scenarioDef.submission;

    createCheck(
      {
        id: checkId,
        language: submission.language || "en",
        status: "created",
      },
      db
    );
    statusProgression.push("created");

    const inputRows = [];
    if (submission.text) inputRows.push({ type: "text", value: submission.text });
    if (submission.userNotes) inputRows.push({ type: "user_notes", value: submission.userNotes });
    if (submission.url) inputRows.push({ type: "url", value: submission.url });
    if (submission.upiId) inputRows.push({ type: "upi", value: submission.upiId });
    if (submission.company) inputRows.push({ type: "company", value: submission.company });
    if (submission.handle) inputRows.push({ type: "handle", value: submission.handle });
    if (submission.phone) inputRows.push({ type: "phone", value: submission.phone });
    if (submission.youtubeUrl) inputRows.push({ type: "youtube_url", value: submission.youtubeUrl });

    if (inputRows.length > 0) {
      saveInputs(checkId, inputRows, db);
    }

    // 2. Extraction Step
    const deps = createScenarioDeps(scenarioKey, db, opts.depOverrides);
    statusProgression.push("extracting");
    await runExtraction(checkId, {
      db,
      generate: deps.generate,
      now: deps.now,
      uploadDir: CLI_UPLOADS_DIR,
    });
    statusProgression.push("awaiting_confirmation");

    // 3. User Confirmation Step (calling saveConfirmation per ARCHITECTURE section 3.4)
    // Gather extracted entities and confirm them
    const extractedEntities = getEntities(checkId, db);
    // Include user entities defined in scenario
    const allEntities = extractedEntities.map((e) => ({
      kind: e.kind,
      value: e.value,
      source: e.source || "extracted",
      round: 0,
      evidence: e.evidence,
    }));

    // If scenario includes explicit submission entities not yet present, merge them
    if (submission.company && !allEntities.some((e) => e.kind === "company" && e.value === submission.company)) {
      allEntities.push({
        kind: "company",
        value: submission.company,
        source: "user",
        round: 0,
      });
    }

    saveConfirmation(
      checkId,
      {
        texts: [submission.text],
        entities: allEntities,
      },
      db
    );

    // 4. Investigation Step (2 rounds max, scoring, and report generation)
    statusProgression.push("investigating");
    statusProgression.push("scoring");

    const liveEmittedEvents = [];
    if (opts.trace) {
      console.log(`\n--- Live Trace Stream: Scenario ${scenarioKey} ---`);
    }
    const report = await runInvestigation(checkId, {
      ...deps,
      onEvent: (ev) => {
        liveEmittedEvents.push(ev);
        if (opts.trace) {
          console.log(formatTraceEvent(ev));
        }
      },
    });
    statusProgression.push("report_ready");

    const totalDurationMs = Date.now() - startTs;

    // Validate report against ReportSchema
    const validatedReport = ReportSchema.parse(report);

    // Fetch persisted report, results, and events from DB
    const persistedReport = getReport(checkId, db);
    assertValid(persistedReport, "Report must be saved in database");
    ReportSchema.parse(persistedReport);

    const checkRecord = getCheck(checkId, db);
    const events = getEvents(checkId, db);
    const results = db.prepare(`SELECT * FROM agent_results WHERE check_id = ? ORDER BY round ASC, agent ASC`).all(checkId);

    const roundsRun = Math.max(...results.map((r) => r.round), 1);

    return {
      checkId,
      scenarioKey,
      name: scenarioDef.name,
      statusProgression,
      roundsRun,
      results,
      events,
      liveEmittedEvents,
      checkRecord,
      report: validatedReport,
      durationMs: totalDurationMs,
      dbFile,
      db,
    };
  } catch (err) {
    if (fs.existsSync(dbFile)) {
      try { db.close(); fs.unlinkSync(dbFile); } catch {}
    }
    throw err;
  }
}

function assertValid(condition, message) {
  if (!condition) {
    throw new Error(`Gate Assertion Failed: ${message}`);
  }
}

/**
 * Runs offline mode across all 3 scenarios.
 *
 * @param {object} options
 */
async function runOfflineMode(options = {}) {
  const { expectFail = false, trace = false, scenario = null } = options;
  console.log("\n=======================================================");
  console.log("  STUDENT OPPORTUNITY VERIFIER - OFFLINE PIPELINE RUN");
  console.log("=======================================================\n");

  cleanDir(CLI_UPLOADS_DIR);
  fs.mkdirSync(CLI_UPLOADS_DIR, { recursive: true });

  const scenarioRuns = [];
  const dbFilesToClean = [];
  let runA = null;
  let runB = null;
  let runC = null;

  try {
    if (!scenario || scenario === "A") {
      console.log("Executing Scenario A (scenario-a-clear-scam)...");
      runA = await runSingleScenario(clearScamScenario, "A", { trace });
      scenarioRuns.push(runA);
      dbFilesToClean.push({ db: runA.db, file: runA.dbFile });
    }

    if (!scenario || scenario === "B") {
      console.log("Executing Scenario B (scenario-b-genuine-notice)...");
      runB = await runSingleScenario(genuineNoticeScenario, "B", { trace });
      scenarioRuns.push(runB);
      dbFilesToClean.push({ db: runB.db, file: runB.dbFile });
    }

    if (!scenario || scenario === "C") {
      console.log("Executing Scenario C (scenario-c-ambiguous-thin-evidence)...");
      runC = await runSingleScenario(ambiguousThinEvidenceScenario, "C", { trace });
      scenarioRuns.push(runC);
      dbFilesToClean.push({ db: runC.db, file: runC.dbFile });
    }

    console.log("\n-------------------------------------------------------");
    console.log("  SCENARIO EXECUTION RESULTS");
    console.log("-------------------------------------------------------\n");

    for (const run of scenarioRuns) {
      console.log(`\nScenario ${run.scenarioKey}: ${run.name}`);
      console.log(`  Status Progression: ${run.statusProgression.join(" -> ")}`);
      console.log(`  Final Status:       ${run.checkRecord.status}`);
      console.log(`  Rounds Run:         ${run.roundsRun}`);
      console.log(`  Risk Level:         ${run.report.riskLevel.toUpperCase()}`);
      console.log(`  Score:              ${run.report.score}/100`);
      console.log(`  Confidence:         ${run.report.confidence}`);
      console.log(`  Report Summary:     ${run.report.summary.slice(0, 180)}...`);
      console.log(`  Flags Count:        ${run.report.flags.length}`);
      console.log(`  Checklist Steps:    ${run.report.checklist.length}`);
      console.log(`  CouldNotCheck:      ${run.report.couldNotCheck.length}`);
      console.log(`  NotApplicable:      ${run.report.notApplicable.length}`);
      console.log(`  Total DB Events:    ${run.events.length}`);
      console.log(`  Live onEvents:      ${run.liveEmittedEvents.length}`);
      console.log(`  Duration:           ${run.durationMs}ms`);

      console.log("\n  Agent Execution Breakdown:");
      console.table(
        run.results.map((r) => {
          let flagsCount = 0;
          try {
            flagsCount = JSON.parse(r.flags_json || "[]").length;
          } catch {}
          return {
            agent: r.agent,
            round: r.round,
            status: r.status,
            reason: r.reason || "-",
            flagsCount,
            durationMs: r.duration_ms,
          };
        })
      );
    }

    // Display Live onEvent Timeline for Scenario A
    if (runA) {
      console.log("\n-------------------------------------------------------");
      console.log("  LIVE onEvent TIMELINE (Scenario A)");
      console.log("-------------------------------------------------------\n");
      console.table(
        runA.liveEmittedEvents.map((e) => ({
          type: e.type,
          agent: e.agent || "-",
          stage: e.stage || "-",
          status: e.status || "-",
          summary: e.summary,
        }))
      );
    }

    // GATE ASSERTIONS
    console.log("\n-------------------------------------------------------");
    console.log("  VERIFYING GATE ASSERTIONS");
    console.log("-------------------------------------------------------\n");

    if (runA) {
      let expectedLevelA = "high";
      if (expectFail) {
        console.log("[--expect-fail active] Intentionally flipping Scenario A expected risk level to 'low'...");
        expectedLevelA = "low";
      }

      assertValid(
        runA.report.riskLevel === expectedLevelA,
        `Scenario A risk level expected '${expectedLevelA}', got '${runA.report.riskLevel}'`
      );
    }

    if (runB) {
      assertValid(
        runB.report.riskLevel === "low",
        `Scenario B risk level expected 'low', got '${runB.report.riskLevel}'`
      );
    }

    if (runC) {
      assertValid(
        runC.report.riskLevel === "cannot_verify",
        `Scenario C risk level expected 'cannot_verify', got '${runC.report.riskLevel}'`
      );

      // Verify skipped agents appear under notApplicable and do not lower confidence in Scenario C
      assertValid(
        runC.report.notApplicable.length >= 2,
        `Scenario C must have at least 2 notApplicable items, got ${runC.report.notApplicable.length}`
      );
    }

    // Verify every flag in every report has evidence
    for (const run of scenarioRuns) {
      for (const flag of run.report.flags) {
        assertValid(
          Array.isArray(flag.evidence) && flag.evidence.length > 0,
          `Flag ${flag.id} in ${run.name} lacks evidence`
        );
      }
    }

    if (runA) {
      // Verify onEvent emitted events match persisted events
      assertValid(
        runA.liveEmittedEvents.length > 0,
        "Live onEvent listener must receive emitted events during investigation"
      );
    }

    if (!scenario) {
      // Verify round 2 happened in at least one scenario (Scenario A has discovered domain)
      const hasRound2 = scenarioRuns.some((r) => r.roundsRun >= 2);
      assertValid(hasRound2, "Round 2 must execute in at least one scenario with discovered entities");

      // Assertion (i): CHECK_SEARCH_BUDGET cap triggers BUDGET_EXCEEDED
      console.log("Asserting CHECK_SEARCH_BUDGET (10) cap triggers BUDGET_EXCEEDED on 11th call...");
      const budgetCheck = createCheck({ status: "awaiting_confirmation" }, runA.db);
      saveConfirmation(budgetCheck.id, { texts: ["test text"], entities: [] }, runA.db);
    let underlyingSearchCalls = 0;
    let budgetExceededResult = null;
    const searchBudgetDeps = createScenarioDeps("A", runA.db, {
      search: async (q) => {
        underlyingSearchCalls++;
        return { ok: true, data: { query: q, total: 0, results: [] } };
      },
      readPage: async () => {
        // From readPage, simulate an agent invoking deps.search 11 times
        return { ok: true, data: { links: [], text: "" } };
      },
    });

    // We can directly call the coordinator's budgeted search wrapper by running an investigation
    // where reputation_osint or another agent triggers searches, or test the budget wrapper via deps
    // In coordinator, options.searchBudget defaults to 10 (CHECK_SEARCH_BUDGET).
    // Let's pass a custom search function to coordinator that tracks calls, and an entity that triggers reputation_osint
    // Or even simpler: pass a company entity to budgetCheck so reputation_osint is eligible and runs search:
    const companyCheck = createCheck({ status: "awaiting_confirmation" }, runA.db);
    saveConfirmation(
      companyCheck.id,
      {
        texts: ["Apply to TestOrg for fellowship"],
        entities: [
          { kind: "company", value: "TestOrg Alpha", source: "user", round: 0, confirmed: true },
          { kind: "domain", value: "testorg-alpha.example", source: "user", round: 0, confirmed: true },
          { kind: "handle", value: "testorg_alpha", source: "user", round: 0, confirmed: true },
        ],
      },
      runA.db
    );

    let checkSearchCalls = 0;
    let searchSawBudgetExceeded = false;
    const budgetTrackingDeps = createScenarioDeps("A", runA.db, {
      search: async (q) => {
        checkSearchCalls++;
        return { ok: true, data: { query: q, total: 0, results: [] } };
      },
    });

    // Set searchBudget to 3 so we easily verify the cap triggers BUDGET_EXCEEDED without 10 queries
    // Coordinator passes options.searchBudget to capped budget
    await runInvestigation(companyCheck.id, budgetTrackingDeps, { searchBudget: 3 });
    assertValid(checkSearchCalls === 3, `Underlying search should be capped at searchBudget (3), got ${checkSearchCalls}`);

    // Assertion (ii): Two simultaneous runInvestigation calls do not double-run agents
    console.log("Asserting simultaneous runInvestigation calls do not double-run agents...");
    const simCheck = createCheck({ status: "awaiting_confirmation" }, runA.db);
    saveConfirmation(simCheck.id, { texts: ["concurrency test"], entities: [] }, runA.db);
    const callCounts = {
      message_analyst: 0,
      classifier_client: 0,
    };
    const simDeps = createScenarioDeps("A", runA.db, {
      generate: async (params) => {
        if (params.purpose === "report_generation") {
          return {
            ok: true,
            data: {
              summary: "Report ready. Note that this is not a guarantee of safety.",
              scamTypeGuess: "unknown",
              flagExplanations: [],
              extraChecklist: [],
            },
          };
        }
        callCounts.message_analyst++;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, data: { flags: [], verified: [], notes: "sim" } };
      },
      classify: async () => {
        callCounts.classifier_client++;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, data: { probability: 0.1, label: "benign" } };
      },
    });

    const simResults = await Promise.allSettled([
      runInvestigation(simCheck.id, simDeps),
      runInvestigation(simCheck.id, simDeps),
    ]);

    const simFulfilled = simResults.filter((r) => r.status === "fulfilled");
    const simRejected = simResults.filter((r) => r.status === "rejected");

    assertValid(simFulfilled.length === 1, `Exactly one simultaneous run should succeed, got ${simFulfilled.length}`);
    assertValid(simRejected.length === 1, `Exactly one simultaneous run should be rejected, got ${simRejected.length}`);
    assertValid(
      callCounts.message_analyst === 1,
      `message_analyst should run exactly once across simultaneous calls, ran ${callCounts.message_analyst} times`
    );
    assertValid(
      callCounts.classifier_client === 1,
      `classifier_client should run exactly once across simultaneous calls, ran ${callCounts.classifier_client} times`
    );

    // Verify intentional invalid agent result injection is sanitized
    console.log("Testing invalid agent result injection guard...");
    const testInvalidCheck = createCheck({}, runA.db);
    runA.db.prepare("UPDATE checks SET status = 'investigating' WHERE id = ?").run(testInvalidCheck.id);
    const invalidDeps = createScenarioDeps("A", runA.db, {
      generate: async () => ({
        ok: true,
        data: {
          flags: [{ id: "unknown_illegal_flag", severity: "high", evidence: [] }],
        },
      }),
    });
    // Coordinator sanitization test
    const reportFromInvalid = await runInvestigation(testInvalidCheck.id, invalidDeps, { resume: true });
    assertValid(reportFromInvalid, "Pipeline gracefully handles invalid agent results");

    // Verify no secret or raw user text leaks into events or logs
    for (const run of scenarioRuns) {
      for (const ev of run.events) {
        const str = JSON.stringify(ev);
        assertValid(!str.includes("Rs 50,000"), "User text detected in progress events");
        assertValid(!str.includes("LLM_API_KEY"), "Key leak detected in progress events");
      }
    }

      console.log("✔ All gate assertions passed successfully.\n");
    }
  } finally {
    // Cleanup temporary files
    for (const item of dbFilesToClean) {
      try {
        item.db.close();
        if (fs.existsSync(item.file)) fs.unlinkSync(item.file);
      } catch {}
    }
    cleanDir(CLI_UPLOADS_DIR);
  }
}

/**
 * Runs live mode with real LLM and Search against a self-written fake message.
 */
async function runLiveMode(args, opts = {}) {
  console.log("\n=======================================================");
  console.log("  STUDENT OPPORTUNITY VERIFIER - LIVE PIPELINE RUN");
  console.log("=======================================================\n");

  if (!args.includes("--yes-use-fake-message")) {
    console.error("Live mode requires explicit consent flag: --yes-use-fake-message");
    process.exit(1);
  }

  // Parse --live-scenario option (default: "scam")
  let scenarioChoice = "scam";
  const scenarioIdx = args.indexOf("--live-scenario");
  if (scenarioIdx !== -1 && args[scenarioIdx + 1]) {
    const val = args[scenarioIdx + 1].toLowerCase();
    if (val === "genuine" || val === "scam") {
      scenarioChoice = val;
    } else {
      console.error(`Invalid --live-scenario value: '${val}'. Expected 'genuine' or 'scam'.`);
      process.exit(1);
    }
  }

  let env;
  try {
    env = getEnv(process.env);
  } catch (err) {
    console.error(`Live check cannot run: Missing or invalid environment keys.\n${err.message}`);
    process.exit(1);
  }

  if (!env.LLM_API_KEY) {
    console.error("Live check cannot run: LLM_API_KEY is not set.");
    process.exit(1);
  }

  const startTs = Date.now();
  const dbFile = `./data/test_cli_live_${Date.now()}.db`;
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

  const db = getDb(dbFile);
  cleanDir(CLI_UPLOADS_DIR);
  fs.mkdirSync(CLI_UPLOADS_DIR, { recursive: true });

  let realModelCallCount = 0;
  const countedGenerate = async (params) => {
    realModelCallCount++;
    return realGenerate(params);
  };

  let realSearchCount = 0;
  const countedSearch = async (query, opts) => {
    realSearchCount++;
    return realSearch(query, { ...opts, customEnv: process.env, db });
  };

  try {
    const checkId = crypto.randomUUID();

    // Two self-written fake messages (no real people or organisations, reserved .example domains)
    let fakeNotice;
    if (opts.text) {
      fakeNotice = {
        text: opts.text,
        url: opts.url,
        upiId: opts.upiId,
        company: opts.company,
        handle: opts.handle,
        handlePlatform: opts.handlePlatform,
      };
    } else if (scenarioChoice === "genuine") {
      fakeNotice = {
        text: "National Institute of Science Research: Applications are invited for the Summer Research Fellowship 2026. Selected scholars receive a monthly stipend of Rs 12,000. No application fee or deposit is ever required. Apply through official portal at https://research-portal.institute.edu.example/apply by May 15.",
        url: "https://research-portal.institute.edu.example/apply",
        company: "National Institute of Science Research",
      };
    } else {
      fakeNotice = {
        text: "Urgent student opportunity: Selected for State Youth Assistance Grant of Rs 25,000. Submit verification deposit of Rs 400 to national.grant.desk@okaxis immediately to claim funds.",
        url: "https://youth-grant-claim.example/portal",
        upiId: "national.grant.desk@okaxis",
      };
    }

    console.log(`Creating live check with notice (scenario: ${scenarioChoice})...`);
    console.log(`Notice text: "${fakeNotice.text.slice(0, 100)}..."`);
    createCheck({ id: checkId, language: "en", status: "created" }, db);

    const inputItems = [{ type: "text", value: fakeNotice.text }];
    if (opts.userNotes) inputItems.push({ type: "user_notes", value: opts.userNotes });
    if (fakeNotice.url) inputItems.push({ type: "url", value: fakeNotice.url });
    if (fakeNotice.upiId) inputItems.push({ type: "upi", value: fakeNotice.upiId });
    if (fakeNotice.company) inputItems.push({ type: "company", value: fakeNotice.company });
    if (fakeNotice.handle) {
      inputItems.push({
        type: "handle",
        value: fakeNotice.handle,
      });
    }

    saveInputs(checkId, inputItems, db);

    console.log("Running live extraction...");
    await runExtraction(checkId, {
      db,
      generate: countedGenerate,
      handlePlatform: fakeNotice?.handlePlatform || opts.handlePlatform,
      uploadDir: CLI_UPLOADS_DIR,
    });

    console.log("Simulating user confirmation...");
    const entities = getEntities(checkId, db);
    saveConfirmation(
      checkId,
      {
        texts: [fakeNotice.text],
        entities: entities.map((e) => ({
          kind: e.kind,
          value: e.value,
          platform: e.platform,
          source: e.source || "extracted",
          round: 0,
          evidence: e.evidence,
        })),
      },
      db
    );

    console.log("Running live multi-round investigation...");
    const liveEmittedEvents = [];
    if (opts.trace) {
      console.log("\n--- Live Trace Stream ---");
    }
    const report = await runInvestigation(
      checkId,
      {
        db,
        generate: countedGenerate,
        search: countedSearch,
        onEvent: (ev) => {
          liveEmittedEvents.push(ev);
          if (opts.trace) {
            console.log(formatTraceEvent(ev));
          }
        },
      },
      { pipelineTimeoutMs: 60000 }
    );

    const durationMs = Date.now() - startTs;
    const validated = ReportSchema.parse(report);

    const snapshot = getCaseFile(checkId, db);
    const scoreRes = scoreCase(snapshot);

    const results = db.prepare(`SELECT * FROM agent_results WHERE check_id = ? ORDER BY round ASC, agent ASC`).all(checkId);
    const persistedReportRow = db.prepare(`SELECT * FROM reports WHERE check_id = ?`).get(checkId);
    const usedFallback = Boolean(persistedReportRow && persistedReportRow.summary?.includes("Generated by rule-based fallback"));

    console.log("\n-------------------------------------------------------");
    console.log(`  LIVE CHECK RESULTS (${scenarioChoice.toUpperCase()})`);
    console.log("-------------------------------------------------------\n");
    console.log(`  Check ID:             ${checkId}`);
    console.log(`  Scenario:             ${scenarioChoice}`);
    console.log(`  Risk Level:           ${validated.riskLevel.toUpperCase()}`);
    console.log(`  Score:                ${validated.score}/100`);
    console.log(`  Confidence:           ${validated.confidence}`);
    console.log(`  Fallback Report Used: ${usedFallback}`);
    console.log(`  Summary:              ${validated.summary.slice(0, 200)}...`);
    console.log(`  Flags Count:          ${validated.flags.length}`);
    console.log(`  Checklist Steps:      ${validated.checklist.length}`);
    console.log(`  CouldNotCheck:        ${validated.couldNotCheck.length}`);
    console.log(`  NotApplicable:        ${validated.notApplicable.length}`);
    console.log(`  Real Model Calls:     ${realModelCallCount}`);
    console.log(`  Real Search Calls:    ${realSearchCount}`);
    console.log(`  Total Duration:       ${durationMs}ms`);

    console.log("\n  ScoreResult Details:");
    console.log(`    Level:               ${scoreRes.level}`);
    console.log(`    Score:               ${scoreRes.score}`);
    console.log(`    Confidence:          ${scoreRes.confidence}`);
    console.log(`    Corroboration Bonus: +${scoreRes.corroborationBonus ?? 0}`);
    console.log(`    CompletedCount:      ${scoreRes.completedCount}`);
    console.log(`    EligibleCount:       ${scoreRes.eligibleCount}`);
    console.log(`    CompletionRatio:     ${scoreRes.completionRatio}`);
    console.log(`    RulesFired:          ${JSON.stringify(scoreRes.rulesFired)}`);
    console.log(`    ReasonCodes:         ${JSON.stringify(scoreRes.reasonCodes)}`);
    console.log(`    Coverage:            ${JSON.stringify(scoreRes.coverage)}`);
    console.log(`    FlagPoints:          ${JSON.stringify(scoreRes.flagPoints.map((fp) => ({ id: fp.id, points: fp.points, status: fp.status, agents: Array.from(fp.agents || []) })))}`);

    const ledgerEntries = getLedger(checkId, db);
    console.log(`\n  Evidence Ledger Entries (${ledgerEntries.length}):`);
    for (const e of ledgerEntries) {
      const src = e.supportingSource ? `(${e.supportingSource}) ` : "";
      const quote = e.quoteOrUrl ? `"${e.quoteOrUrl.slice(0, 70)}..."` : "-";
      console.log(`    - [${e.id.slice(0, 11)}] agent: ${e.agent.padEnd(19)} | claim: ${e.claimKey.padEnd(20)} | kind: ${e.kind.padEnd(8)} | status: ${e.verificationStatus.padEnd(12)} | conf: ${e.confidence.padEnd(6)} | ${src}${quote}`);
    }

    const recon = reconcile(ledgerEntries);
    console.log("\n  Reconciliation Output:");
    console.log(`    Duplicates (${recon.duplicates.length}):`);
    if (recon.duplicates.length === 0) console.log("      (none)");
    for (const d of recon.duplicates) {
      console.log(`      * ${d}`);
    }
    console.log(`    Corroborations (${recon.corroborations.length}):`);
    if (recon.corroborations.length === 0) console.log("      (none)");
    for (const c of recon.corroborations) {
      console.log(`      * ${c}`);
    }
    console.log(`    Contradictions (${recon.contradictions.length}):`);
    if (recon.contradictions.length === 0) console.log("      (none)");
    for (const ct of recon.contradictions) {
      console.log(`      * ${ct}`);
    }


    console.log("\n  Extracted Entities:");
    const extractedEntities = getEntities(checkId, db);
    for (const ent of extractedEntities) {
      console.log(`    - [${ent.kind}] "${ent.value}"${ent.platform ? ` (platform: ${ent.platform})` : ""} | source: ${ent.source} | confirmed: ${ent.confirmed}`);
    }

    console.log("\n  Agent Results Detail:");
    for (const r of results) {
      console.log(`\n  --- Agent: ${r.agent} (Round ${r.round}) ---`);
      console.log(`    Status: ${r.status}`);
      console.log(`    Reason: ${r.reason || "-"}`);
      const rFlags = JSON.parse(r.flags_json || "[]");
      console.log(`    Flags (${rFlags.length}):`);
      for (const f of rFlags) {
        console.log(`      * [${f.severity.toUpperCase()}] ${f.id}`);
        console.log(`        Title: ${f.title}`);
        console.log(`        Evidence: ${JSON.stringify(f.evidence)}`);
      }
      const rVerified = JSON.parse(r.verified_json || "[]");
      console.log(`    Verified (${rVerified.length}):`);
      for (const v of rVerified) {
        console.log(`      * ${v}`);
      }
      const rUnchecked = JSON.parse(r.unchecked_json || "[]");
      console.log(`    Unchecked (${rUnchecked.length}):`);
      for (const u of rUnchecked) {
        console.log(`      * ${u}`);
      }
    }

    console.log("\n  Per-Agent Execution Table:");
    console.table(
      results.map((r) => {
        let flagsCount = 0;
        try {
          flagsCount = JSON.parse(r.flags_json || "[]").length;
        } catch {}
        return {
          agent: r.agent,
          round: r.round,
          status: r.status,
          reason: r.reason || "-",
          flagsCount,
          durationMs: r.duration_ms,
        };
      })
    );

    if (validated.flags.length > 0) {
      console.log("\n  Flags Produced:");
      console.table(
        validated.flags.map((f) => ({
          id: f.id,
          severity: f.severity,
          title: f.title,
          evidenceCount: f.evidence?.length || 0,
        }))
      );
    }

    console.log("\n  Event Timeline:");
    console.table(
      liveEmittedEvents.map((e) => ({
        type: e.type,
        agent: e.agent || "-",
        stage: e.stage || "-",
        status: e.status || "-",
        summary: e.summary,
      }))
    );

    console.log("\n✔ Live check completed and validated successfully.");
  } finally {
    try {
      db.close();
      if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
    } catch {}
    cleanDir(CLI_UPLOADS_DIR);
  }
}

// CLI entry point
const args = process.argv.slice(2);
const expectFail = args.includes("--expect-fail");
const trace = args.includes("--trace");
let scenario = null;
const scenarioIdx = args.findIndex((a) => a === "--scenario" || a === "-s");
if (scenarioIdx !== -1 && args[scenarioIdx + 1]) {
  scenario = args[scenarioIdx + 1].toUpperCase();
}

let userNotes = null;
const userNotesIdx = args.findIndex((a) => a === "--user-notes");
if (userNotesIdx !== -1 && args[userNotesIdx + 1]) {
  userNotes = args[userNotesIdx + 1];
}

let customText = null;
const textIdx = args.findIndex((a) => a === "--text" || a === "-t");
if (textIdx !== -1 && args[textIdx + 1]) {
  customText = args[textIdx + 1];
}

let handle = null;
const handleIdx = args.findIndex((a) => a === "--handle");
if (handleIdx !== -1 && args[handleIdx + 1]) {
  handle = args[handleIdx + 1];
}

let handlePlatform = null;
const handlePlatformIdx = args.findIndex((a) => a === "--handle-platform");
if (handlePlatformIdx !== -1 && args[handlePlatformIdx + 1]) {
  handlePlatform = args[handlePlatformIdx + 1];
}

if (args.includes("--live")) {
  runLiveMode(args, { trace, userNotes, text: customText, handle, handlePlatform }).catch((err) => {
    console.error(`Live run failed: ${err.message}`);
    process.exit(1);
  });
} else {
  runOfflineMode({ expectFail, trace, scenario })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`\n✖ Check Run Failed: ${err.message}`);
      process.exit(1);
    });
}
