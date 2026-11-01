/**
 * scripts/eval/runner.js
 *
 * Evaluation runner executing cases through the coordinator pipeline across:
 * - fixtures mode (using deterministic scenario stubs)
 * - replay mode (using .recordings/ with RECORD_REPLAY_MODE=replay)
 * - live mode (with real keys and safety limits)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { runMigrations } from "../../lib/db/migrations/index.js";
import { createCheck, saveInputs, saveConfirmation } from "../../lib/db/index.js";
import { runExtraction } from "../../lib/extract.js";
import { runInvestigation } from "../../lib/coordinator.js";
import { createRecordedGenerate, createRecordedSearch } from "../../lib/record-replay.js";
import { generate as rawDefaultGenerate } from "../../lib/llm/generate.js";
import { search as rawDefaultSearch } from "../../lib/tools/search.js";
import { fetchPage as defaultFetchPage } from "../../lib/tools/fetchPage.js";
import { classifyText as defaultClassify } from "../../lib/classifier.js";
import { lookup as defaultLookup } from "../../lib/graph.js";


/**
 * Creates temporary SQLite database for an eval check run.
 *
 * @param {string} tempDir
 * @returns {import("better-sqlite3").Database}
 */
export function createEvalDb(tempDir) {
  const dbPath = path.join(tempDir, `eval-${crypto.randomUUID()}.db`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

/**
 * Pre-calibrated mock stubs for evaluation dataset synthetic cases.
 * Used by fixtures/sample-smoke mode so that deterministic quotes exactly match case texts.
 */
export const SAMPLE_CASE_STUBS = {
  "SYN-SCHOL-001": {
    findings: [
      {
        flagId: "scholarship_fee_demand",
        quote: "Forward Rs 1200 verification fee to fellowship@okaxis",
        explanation: "Upfront scholarship fee demand",
      },
      {
        flagId: "urgency_pressure",
        quote: "within 24 hours",
        explanation: "Urgency deadline",
      },
    ],
    terms: ["verification", "fee"],
  },
  "SYN-SCHOL-002": {
    findings: [
      {
        flagId: "scholarship_fee_demand",
        quote: "Deposit Rs 750 gate pass charges to activate your merit fund",
        explanation: "Upfront scholarship fee demand",
      },
    ],
    terms: ["deposit", "charges"],
  },
  "SYN-INTERN-001": {
    findings: [
      {
        flagId: "fee_demand",
        quote: "Deposit Rs 2,500 equipment insurance refundable on completion",
        explanation: "Upfront equipment fee required before internship",
      },
    ],
    terms: ["deposit", "insurance"],
  },
  "SYN-TASK-001": {
    findings: [
      {
        flagId: "task_deposit_script",
        quote: "Like Google Maps locations and earn Rs 3,000 per day",
        explanation: "Classic paid task script",
      },
      {
        flagId: "off_platform_contact",
        quote: "Join Telegram @hotel_tasks",
        explanation: "Off platform Telegram contact",
      },
    ],
    terms: ["earn", "rating"],
  },
  "SYN-MULE-001": {
    findings: [
      {
        flagId: "mule_account_request",
        quote: "process overseas transactions through your savings account",
        explanation: "Bank account rental for routing transactions",
      },
    ],
    terms: ["transactions", "account"],
  },
  "SYN-COMP-001": {
    findings: [
      {
        flagId: "fee_demand",
        quote: "Pay non-refundable entry fee of Rs 1,000 to personal gpay account to register",
        explanation: "Registration fee for competition",
      },
    ],
    terms: ["fee", "register"],
  },
  "SYN-OVERSEAS-001": {
    findings: [
      {
        flagId: "fee_demand",
        quote: "Deposit Rs 50,000 visa processing advance",
        explanation: "Advance fee for overseas placement",
      },
      {
        flagId: "guaranteed_income",
        quote: "Guaranteed 100% student visa",
        explanation: "Unrealistic guarantee",
      },
    ],
    terms: ["deposit", "advance"],
  },
  "SYN-GENUINE-001": {
    findings: [],
    terms: ["fellowship"],
  },
  "SYN-GENUINE-002": {
    findings: [],
    terms: ["internship"],
  },
  "SYN-MEDIUM-001": {
    findings: [
      {
        flagId: "off_platform_contact",
        quote: "Apply on our portal",
        explanation: "Informal portal",
      },
      {
        flagId: "urgency_pressure",
        quote: "Free t-shirt and certificates provided",
        explanation: "Promotional incentive",
      },
    ],
    terms: ["ambassador", "portal"],
  },
  "SYN-MEDIUM-002": {
    findings: [
      {
        flagId: "urgency_pressure",
        quote: "Nominal evaluation fee of Rs 100 to cover external judge certification expenses",
        explanation: "Evaluation fee",
      },
      {
        flagId: "off_platform_contact",
        quote: "cover external judge certification expenses",
        explanation: "Informal expense",
      },
    ],
    terms: ["contest", "fee"],
  },
  "SYN-CANNOTVERIFY-001": {
    findings: [],
    terms: [],
  },
  "SYN-CANNOTVERIFY-002": {
    findings: [],
    terms: [],
  },
  "SYN-HINDI-001": {
    findings: [
      {
        flagId: "scholarship_fee_demand",
        quote: "₹900 पंजीकरण शुल्क का भुगतान करें",
        explanation: "Upfront fee demand",
      },
      {
        flagId: "urgency_pressure",
        quote: "तुरंत ₹900 पंजीकरण शुल्क का भुगतान करें",
        explanation: "Urgency pressure",
      },
    ],
    terms: ["पंजीकरण", "शुल्क"],
  },
};

/**
 * Builds mock dependencies for fixtures mode based on eval case expected level and scam type.
 *
 * @param {object} evalCase
 * @param {import("better-sqlite3").Database} db
 * @returns {object}
 */
export function buildFixturesDeps(evalCase, db) {
  const caseStub = SAMPLE_CASE_STUBS[evalCase.id];
  const scenarioKey =
    evalCase.id === "SCENARIO-A"
      ? "A"
      : evalCase.id === "SCENARIO-B"
        ? "B"
        : evalCase.id === "SCENARIO-C"
          ? "C"
          : null;
  const isA = scenarioKey === "A" || evalCase.expectedLevel === "high";
  const isB = scenarioKey === "B" || evalCase.expectedLevel === "low";
  const isC = scenarioKey === "C" || evalCase.expectedLevel === "cannot_verify";
  const isMed = evalCase.expectedLevel === "medium";

  return {
    db,
    now: () => Date.now(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    generate: async (params) => {
      // 1. Report writer prompt
      if (params.purpose === "report_generation") {
        if (caseStub) {
          return {
            ok: true,
            data: {
              summary: `Automated assessment summary for ${evalCase.id}.`,
              scamTypeGuess: evalCase.scamType || "unknown",
              flagExplanations: (caseStub.findings || []).map((f) => ({
                flagId: f.flagId,
                text: f.explanation,
              })),
              extraChecklist: [],
            },
          };
        }
        if (isMed) {
          return {
            ok: true,
            data: {
              summary: "Moderate caution: informal student promotion with unaccredited credentials.",
              scamTypeGuess: evalCase.scamType || "internship",
              flagExplanations: [
                {
                  flagId: "off_platform_contact",
                  text: "Informal contact channels.",
                },
              ],
              extraChecklist: [
                {
                  text: "Verify legitimacy of credentials.",
                  url: null,
                },
              ],
            },
          };
        }
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

      // 2. Vision extraction
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
      if (caseStub) {
        return {
          ok: true,
          data: {
            findings: caseStub.findings || [],
          },
        };
      }

      if (isMed) {
        return {
          ok: true,
          data: {
            findings: [
              {
                flagId: "off_platform_contact",
                quote: "Apply on our portal",
                explanation: "Unverified informal promotional recruitment",
              },
              {
                flagId: "urgency_pressure",
                quote: "Free t-shirt and certificates provided",
                explanation: "Promotional campus incentive",
              },
            ],
          },
        };
      }

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
      if (isC) {
        return {
          ok: false,
          error: { code: "ECONNREFUSED", message: "Classifier service unavailable" },
        };
      }
      if (caseStub) {
        if (isA) {
          return {
            ok: true,
            data: {
              label: "suspicious",
              probability: 0.94,
              topTerms: caseStub.terms || ["fee", "deposit"],
            },
          };
        }
        if (isMed) {
          return {
            ok: true,
            data: {
              label: "suspicious",
              probability: 0.65,
              topTerms: caseStub.terms || ["portal", "student"],
            },
          };
        }
        return {
          ok: true,
          data: {
            label: "benign",
            probability: 0.05,
            topTerms: caseStub.terms || ["fellowship"],
          },
        };
      }
      if (isMed) {
        return {
          ok: true,
          data: {
            label: "suspicious",
            probability: 0.65,
            topTerms: ["campus", "ambassador"],
          },
        };
      }
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
      if ((isB || (evalCase && evalCase.expected_level === "low")) && (query.includes("Fellowship") || query.includes("fellowship") || query.includes("Research") || query.includes("Institute") || query.includes("Internship"))) {
        return {
          ok: true,
          data: {
            query,
            total: 1,
            results: [
              {
                position: 1,
                title: "Official Announcement - Research Scheme",
                snippet: "Applications are invited for the active academic research fellowship scheme.",
                url: "https://scholarships.gov.in/fellowships/active-scheme",
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
            text: `Official ${evalCase?.text || "Academic Research Fellowship"} is an active scholarship fellowship research scheme for students.`,
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
      if (isC) {
        return { ok: false, error: { code: "ETIMEDOUT", message: "RDAP lookup timed out" } };
      }
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

    dnsRecords: async (domain) => {
      if (isC) {
        return { ok: false, error: { code: "ETIMEDOUT", message: "DNS resolution timed out" } };
      }
      return {
        ok: true,
        data: { domain, a: ["93.184.216.34"], mx: ["mail.example.com"], txt: [] },
      };
    },

    sslInfo: async (domain) => {
      if (isC) {
        return { ok: false, error: { code: "ETIMEDOUT", message: "SSL lookup timed out" } };
      }
      return {
        ok: true,
        data: { domain, valid: true, issuer: "Let's Encrypt", daysRemaining: 180 },
      };
    },

    waybackFirstSeen: async (domain) => {
      if (isC) {
        return { ok: false, error: { code: "ETIMEDOUT", message: "Wayback search timed out" } };
      }
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
      if (isC) {
        return null;
      }
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

    urlhaus: async () => {
      if (isC) {
        return { ok: false, error: { code: "ETIMEDOUT", message: "URLhaus lookup timed out" } };
      }
      return {
        ok: true,
        data: { query_status: "no_results", listed: false },
      };
    },

    urlscanSearch: async () => {
      if (isC) {
        return { ok: false, error: { code: "ETIMEDOUT", message: "URLscan search timed out" } };
      }
      return {
        ok: true,
        data: { total: 0, results: [] },
      };
    },

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
  };
}


/**
 * Builds dependencies for replay or live mode.
 *
 * @param {object} options
 * @param {string} options.mode "replay" | "live"
 * @param {import("better-sqlite3").Database} options.db
 * @param {string} [options.recordingsDir]
 * @param {object} counters Mutable call counters { llmCalls, searchCalls, replayMisses }
 * @param {object} [limits] { maxLlmCalls, maxSearches }
 * @returns {object}
 */
export function buildExecutionDeps(options, counters, limits = {}) {
  const { mode, db, recordingsDir } = options;
  const isReplay = mode === "replay";

  const rawGenerate = async (params) => {
    if (limits.maxLlmCalls !== undefined && counters.llmCalls >= limits.maxLlmCalls) {
      counters.stoppedByBudget = true;
      const err = new Error("BUDGET_EXCEEDED");
      err.code = "BUDGET_EXCEEDED";
      throw err;
    }
    counters.llmCalls++;

    if (isReplay) {
      throw new Error("Provider should not be called on replay miss");
    }
    return rawDefaultGenerate(params);
  };

  const rawSearch = async (query, opts) => {
    if (limits.maxSearches && counters.searchCalls >= limits.maxSearches) {
      return {
        ok: false,
        error: { code: "BUDGET_EXCEEDED", message: "Search budget exceeded" },
      };
    }
    counters.searchCalls++;
    if (isReplay) {
      return {
        ok: false,
        error: { code: "RECORDING_MISSING", message: "Recorded search not found" },
      };
    }
    return rawDefaultSearch(query, { ...opts, db });
  };

  const wrappedGenerate = isReplay
    ? createRecordedGenerate(rawGenerate, {
        mode: "replay",
        dir: recordingsDir,
        nodeEnv: "development",
      })
    : rawGenerate;

  const wrappedSearch = isReplay
    ? createRecordedSearch(rawSearch, {
        mode: "replay",
        dir: recordingsDir,
        nodeEnv: "development",
      })
    : rawSearch;

  // Intercept generate to track replay misses separately
  const trackingGenerate = async (params) => {
    const res = await wrappedGenerate(params);
    if (!res.ok && res.error?.code === "RECORDING_MISSING") {
      counters.replayMisses++;
    }
    return res;
  };

  return {
    db,
    now: () => Date.now(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    generate: trackingGenerate,
    search: wrappedSearch,
    readPage: defaultFetchPage,
    classify: (text, opts) => defaultClassify(text, { ...opts, db }),
    graphLookup: (kind, value) => defaultLookup(kind, value, { db }),
  };
}

/**
 * Runs a single evaluation case through extraction and investigation coordinator.
 *
 * @param {object} evalCase
 * @param {object} runnerOpts
 * @param {string} runnerOpts.mode "fixtures" | "replay" | "live"
 * @param {string} runnerOpts.tempDir
 * @param {string} [runnerOpts.recordingsDir]
 * @param {object} [runnerOpts.limits]
 * @returns {Promise<{
 *   id: string,
 *   expected: string,
 *   predicted: string,
 *   scamType: string,
 *   confidence: string,
 *   score: number,
 *   flags: string[],
 *   agentResults: Array<{ agent: string, status: string }>,
 *   durationMs: number,
 *   llmCalls: number,
 *   searchCalls: number,
 *   replayMiss: boolean,
 *   reasons: string[],
 *   stoppedByBudget?: boolean
 * }>}
 */
export async function runEvalCase(evalCase, runnerOpts) {
  const { mode, tempDir, recordingsDir, limits } = runnerOpts;
  const db = createEvalDb(tempDir);

  const counters = { llmCalls: 0, searchCalls: 0, replayMisses: 0 };
  let deps;

  if (mode === "fixtures" || mode === "sample-smoke") {
    deps = buildFixturesDeps(evalCase, db);
  } else {
    deps = buildExecutionDeps({ mode, db, recordingsDir }, counters, limits);
  }

  const checkId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    // 1. Create check
    createCheck(
      {
        id: checkId,
        language: evalCase.language || "en",
        status: "created",
      },
      db
    );

    // 2. Save user inputs
    const inputRows = [];
    if (evalCase.text) inputRows.push({ type: "text", value: evalCase.text });
    if (evalCase.link) inputRows.push({ type: "url", value: evalCase.link });
    if (evalCase.upiId) inputRows.push({ type: "upi", value: evalCase.upiId });
    if (evalCase.company) inputRows.push({ type: "company", value: evalCase.company });
    if (evalCase.handle) inputRows.push({ type: "handle", value: evalCase.handle });
    if (evalCase.phone) inputRows.push({ type: "phone", value: evalCase.phone });

    saveInputs(checkId, inputRows, db);

    // 3. Extraction step
    await runExtraction(checkId, {
      db,
      generate: deps.generate,
      logger: deps.logger,
      now: () => new Date().toISOString(),
    });

    // 4. In fixtures mode for synthetic cases, simulate confirmation of all inputs as entities
    const entitiesToConfirm = [];
    if (evalCase.link) entitiesToConfirm.push({ kind: "url", value: evalCase.link });
    if (evalCase.upiId) entitiesToConfirm.push({ kind: "upi", value: evalCase.upiId });
    if (evalCase.company) entitiesToConfirm.push({ kind: "company", value: evalCase.company });
    if (evalCase.handle) entitiesToConfirm.push({ kind: "handle", value: evalCase.handle });
    if (evalCase.phone) entitiesToConfirm.push({ kind: "phone", value: evalCase.phone });

    saveConfirmation(
      checkId,
      {
        texts: evalCase.text ? [evalCase.text] : [],
        entities: entitiesToConfirm,
      },
      db
    );

    // 5. Investigation coordinator step
    const report = await runInvestigation(checkId, deps);
    const durationMs = Date.now() - startTime;

    const flags = (report.flags || []).map((f) => (typeof f === "string" ? f : f.id));
    const reasons = (report.flags || []).map((f) => (typeof f === "object" ? f.title : f));

    return {
      id: evalCase.id,
      expected: evalCase.expectedLevel,
      predicted: report.riskLevel,
      scamType: evalCase.scamType,
      confidence: report.confidence || "low",
      score: report.score ?? 0,
      flags,
      agentResults: [], // agent statuses logged in casefile
      durationMs,
      llmCalls: counters.llmCalls,
      searchCalls: counters.searchCalls,
      replayMiss: counters.replayMisses > 0,
      reasons,
      stoppedByBudget: Boolean(counters.stoppedByBudget),
    };

  } catch (err) {
    const durationMs = Date.now() - startTime;
    const isBudget =
      Boolean(counters.stoppedByBudget) ||
      err.message === "BUDGET_EXCEEDED" ||
      err.code === "BUDGET_EXCEEDED";


    return {
      id: evalCase.id,
      expected: evalCase.expectedLevel,
      predicted: "cannot_verify",
      scamType: evalCase.scamType,
      confidence: "low",
      score: 0,
      flags: [],
      agentResults: [],
      durationMs,
      llmCalls: counters.llmCalls,
      searchCalls: counters.searchCalls,
      replayMiss: counters.replayMisses > 0,
      reasons: [err.message],
      stoppedByBudget: isBudget,
    };
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}
