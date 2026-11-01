#!/usr/bin/env node
/**
 * scripts/run-agents.js
 *
 * Runs all eligible specialist agents across the standard scenarios (A, B, C)
 * in an offline test harness using deterministic, schema-validated mock implementations
 * of external tools and LLMs.
 *
 * Requirements (Step H5):
 * 1. All tool stubs routed through routeMock / validateToolResult from tests/helpers/tool-result-schemas.js.
 * 2. canRun expected values computed dynamically from scenario entities and inputs.
 * 3. Scenario C tool failures (ECONNREFUSED, ETIMEDOUT) derived from scenario conditions.
 * 4. Per-scenario table formatting with required columns:
 *    - scenario (file name + letter)
 *    - agent
 *    - canRunActual and canRunExpected
 *    - status (ok, skipped, could_not_check)
 *    - flagsCount
 *    - evidenceComplete (yes / no)
 *    - durationMs
 * 5. Runtime assertion checks that exit non-zero:
 *    - Any canRun mismatch
 *    - Any flag without non-empty evidence
 *    - Any validation failure against AgentResultSchema
 *    - Any skipped or could_not_check carrying flags
 *    - Any scenario score level differing from fixture expectedRiskLevel
 * 6. Scenario C score and confidence verified with and without skipped results (assert identical).
 * 7. When --expect-fail is passed, flips exactly one expectation in memory, reports the mismatch,
 *    and exits with a non-zero code.
 */

import process from "node:process";
import { agents } from "../lib/agents/index.js";
import { AgentResultSchema } from "../lib/contracts/agent-result.js";
import {
  buildSkippedResult,
  getCheckId,
  getRound,
} from "../lib/agents/base.js";
import { scoreCase } from "../lib/scoring/score.js";
import { defaultConfig } from "../lib/scoring/config.js";
import {
  clearScamScenario,
  genuineNoticeScenario,
  ambiguousThinEvidenceScenario,
} from "../lib/contracts/fixtures/scenarios/index.js";
import {
  routeMock,
  validateToolResult,
} from "../tests/helpers/tool-result-schemas.js";

/**
 * Computes the expected canRun eligibility dynamically from the scenario's
 * actual inputs and entities according to each agent's documented criteria.
 *
 * @param {string} agentName
 * @param {object} snapshot
 * @returns {boolean}
 */
function computeExpectedCanRun(agentName, snapshot) {
  const hasText = Boolean(
    (Array.isArray(snapshot?.inputs) &&
      snapshot.inputs.some(
        (i) =>
          i.type === "text" &&
          typeof i.value === "string" &&
          i.value.trim().length > 0
      )) ||
      (typeof snapshot?.submission?.text === "string" &&
        snapshot.submission.text.trim().length > 0)
  );

  const entities = Array.isArray(snapshot?.entities) ? snapshot.entities : [];

  switch (agentName) {
    case "message_analyst":
    case "classifier_client":
      return hasText;

    case "payment_entity":
      return entities.some((e) =>
        ["upi", "phone", "handle", "email", "domain"].includes(e.kind)
      );

    case "website_forensics":
      return entities.some((e) => ["domain", "url"].includes(e.kind));

    case "official_verifier":
      return entities.some((e) =>
        ["domain", "url", "company"].includes(e.kind)
      );

    case "reputation_osint":
      return entities.some((e) =>
        ["domain", "company", "handle", "upi"].includes(e.kind)
      );

    default:
      throw new Error(`Unknown agent: ${agentName}`);
  }
}

/**
 * Creates deterministic, schema-validated stubs for all external tools and LLM dependencies.
 * Tool results are routed through routeMock to strictly ensure conformance with L2 schemas.
 *
 * @param {object} scenarioContext
 * @returns {object}
 */
function createDeterministicDeps(scenarioContext = {}) {
  const { key, networkConditions = {} } = scenarioContext;
  const isScenarioA = key === "A";
  const isScenarioB = key === "B";
  const isScenarioC = key === "C";

  const classifierHealthy = networkConditions.classifierHealthy ?? true;
  const searchHealthy = networkConditions.searchHealthy ?? true;
  const graphHealthy = networkConditions.graphHealthy ?? true;

  return {
    // LLM generator mock (untyped LLM output is parsed by agent schemas)
    generate: async ({ prompt, schema, system }) => {
      if (schema && typeof schema.parse === "function") {
        if (isScenarioA) {
          return {
            ok: true,
            data: {
              findings: [
                {
                  flagId: "scholarship_fee_demand",
                  quote:
                    "pay an upfront verification fee of Rs 750 to scholarship.dept@okaxis",
                  explanation:
                    "Demands an upfront fee before scholarship release.",
                },
                {
                  flagId: "urgency_pressure",
                  quote: "within 2 hours.",
                  explanation: "Artificial urgency pressure to act quickly.",
                },
              ],
            },
          };
        }

        if (isScenarioB) {
          return {
            ok: true,
            data: {
              findings: [],
            },
          };
        }

        if (isScenarioC) {
          return {
            ok: true,
            data: {
              findings: [
                {
                  flagId: "off_platform_contact",
                  quote: "Reach out on telegram @remote_work_desk",
                  explanation:
                    "Prompted to migrate conversation to Telegram handle.",
                },
              ],
            },
          };
        }
      }

      return { ok: true, data: {} };
    },

    // Classifier client mock - derived from scenario network conditions
    classify: async (text) => {
      if (!classifierHealthy) {
        return {
          ok: false,
          error: {
            code: "ECONNREFUSED",
            message: "Classifier service unavailable",
          },
        };
      }
      if (isScenarioA) {
        return {
          ok: true,
          data: {
            label: "suspicious",
            probability: 0.94,
            topTerms: ["upfront", "fee", "verification"],
          },
        };
      }
      if (isScenarioB) {
        return {
          ok: true,
          data: {
            label: "benign",
            probability: 0.05,
            topTerms: ["applications", "shortlisted"],
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "ECONNREFUSED",
          message: "Classifier service unavailable",
        },
      };
    },

    // Graph lookup mock - routed through GraphMatchSchema
    graphLookup: routeMock("graphLookup", (kind, value) => {
      if (!graphHealthy) {
        throw new Error("Graph service unavailable: ECONNREFUSED");
      }
      if (isScenarioA && kind === "upi" && value === "scholarship.dept@okaxis") {
        return {
          matched: true,
          nodeId: 42,
          reportCount: 3,
          connectedNodesCount: 2,
        };
      }
      return { matched: false };
    }),

    // Domain & network tools - routed through authoritative schemas
    rdapLookup: routeMock("rdapLookup", async (domain) => {
      if (isScenarioA) {
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
          registrationDate: "2020-01-01T00:00:00.000Z",
          expirationDate: "2030-01-01T00:00:00.000Z",
          ageDays: 2000,
          registrar: "Reputable Registrar",
          status: ["active"],
          evidenceUrl: `https://rdap.org/domain/${domain}`,
        },
      };
    }),

    dnsRecords: routeMock("dnsRecords", async (domain) => ({
      ok: true,
      data: {
        domain,
        a: ["93.184.216.34"],
        mx: ["mail.example.com"],
        txt: ["v=spf1 -all"],
      },
    })),

    sslInfo: routeMock("sslInfo", async (domain) => ({
      ok: true,
      data: {
        domain,
        valid: true,
        issuer: "Let's Encrypt",
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: "2026-12-31T00:00:00.000Z",
        daysRemaining: 180,
      },
    })),

    waybackFirstSeen: routeMock("waybackFirstSeen", async (domain) => {
      if (isScenarioA) {
        return {
          ok: true,
          data: {
            domain,
            firstSeen: null,
            totalSnapshots: 0,
          },
        };
      }
      return {
        ok: true,
        data: {
          domain,
          firstSeen: "2020-05-01T00:00:00.000Z",
          totalSnapshots: 42,
        },
      };
    }),

    lookalikeCheck: routeMock("lookalikeCheck", (domain) => {
      if (isScenarioA && domain.includes("scholarship")) {
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
    }),

    urlhaus: routeMock("urlhaus", async () => ({
      ok: true,
      data: {
        query_status: "no_results",
        listed: false,
      },
    })),

    urlscanSearch: routeMock("urlscanSearch", async () => ({
      ok: true,
      data: {
        total: 0,
        results: [],
      },
    })),

    // Page reader mock - routed through FetchPageResultSchema
    readPage: routeMock("readPage", async (url) => ({
      ok: true,
      data: {
        finalUrl: url,
        title: "Official Portal",
        metaDescription: "Welcome to the portal",
        text: "Official scholarship information.",
        links: [],
      },
    })),

    // Search mock - routed through SearchResultSchema; derived from scenario network conditions
    search: routeMock("search", async (query) => {
      if (!searchHealthy) {
        return {
          ok: false,
          error: { code: "ETIMEDOUT", message: "Search service timed out" },
        };
      }
      if (isScenarioA && query.includes("scholarship.dept@okaxis")) {
        return {
          ok: true,
          data: {
            query,
            total: 1,
            results: [
              {
                position: 1,
                title: "Alert: UPI Scam with scholarship.dept@okaxis",
                snippet:
                  "Complaints filed regarding fraudulent payment demands to scholarship.dept@okaxis",
                url: "https://consumercomplaints.example/scam/42",
              },
            ],
          },
        };
      }
      return {
        ok: true,
        data: {
          query,
          total: 0,
          results: [],
        },
      };
    }),

    now: () => Date.now(),
  };
}

/**
 * Checks if all flags in a result have complete, non-empty evidence.
 *
 * @param {object} result
 * @returns {boolean}
 */
function hasCompleteEvidence(result) {
  if (!Array.isArray(result.flags) || result.flags.length === 0) {
    return true;
  }
  return result.flags.every(
    (f) =>
      Array.isArray(f.evidence) &&
      f.evidence.length > 0 &&
      f.evidence.every(
        (e) =>
          e &&
          typeof e === "object" &&
          typeof e.type === "string" &&
          typeof e.value === "string" &&
          e.value.length > 0
      )
  );
}

/**
 * Runs all agents across a single scenario and executes all strict assertions.
 *
 * @param {object} scenarioObj
 * @param {object} options
 * @returns {Promise<object>}
 */
async function runScenario(scenarioObj, options = {}) {
  const { expectFail = false } = options;
  const deps = createDeterministicDeps(scenarioObj);
  const snapshot = scenarioObj.caseFile;
  const executionRows = [];
  const findings = [];

  for (const agent of agents) {
    const canRunActual = agent.canRun(snapshot);
    let canRunExpected = computeExpectedCanRun(agent.name, snapshot);

    // If --expect-fail is requested, flip exactly one expectation in memory
    // (specifically message_analyst in Scenario A)
    if (expectFail && scenarioObj.key === "A" && agent.name === "message_analyst") {
      canRunExpected = !canRunExpected;
    }

    if (!canRunActual) {
      const skippedResult = buildSkippedResult({
        checkId: getCheckId(snapshot),
        agent: agent.name,
        round: getRound(snapshot),
        reason: "Deterministic eligibility check skipped",
      });

      findings.push(skippedResult);
      executionRows.push({
        scenario: `${scenarioObj.file} (${scenarioObj.key})`,
        agent: agent.name,
        canRunActual,
        canRunExpected,
        status: "skipped",
        flagsCount: 0,
        evidenceComplete: "yes",
        durationMs: 0,
      });

      // Assertion: canRun actual must match expected
      if (canRunActual !== canRunExpected) {
        if (expectFail) {
          console.log(
            `\n[--expect-fail]: Injected intentional expectation mismatch for agent '${agent.name}' on ${scenarioObj.name}:`
          );
          console.log(
            `  canRunActual (${canRunActual}) !== canRunExpected (${canRunExpected})`
          );
          console.log(
            "[--expect-fail]: Mismatch reported successfully. Exiting with non-zero code as required.\n"
          );
          process.exit(1);
        }
        console.error(
          `\nAssertion Failure: canRun mismatch for agent '${agent.name}' on ${scenarioObj.name} (actual=${canRunActual}, expected=${canRunExpected})`
        );
        process.exit(1);
      }
      continue;
    }

    const startTime = Date.now();
    const result = await agent.run(snapshot, deps);
    const durationMs = Date.now() - startTime;

    // 1. Assertion: validate result against strict AgentResultSchema
    try {
      AgentResultSchema.parse(result);
    } catch (valErr) {
      console.error(
        `\nAssertion Failure: AgentResultSchema validation failed for agent '${agent.name}':`,
        valErr
      );
      process.exit(1);
    }

    // 2. Assertion: canRun actual must match expected
    if (canRunActual !== canRunExpected) {
      if (expectFail) {
        console.log(
          `\n[--expect-fail]: Injected intentional expectation mismatch for agent '${agent.name}' on ${scenarioObj.name}:`
        );
        console.log(
          `  canRunActual (${canRunActual}) !== canRunExpected (${canRunExpected})`
        );
        console.log(
          "[--expect-fail]: Mismatch reported successfully. Exiting with non-zero code as required.\n"
        );
        process.exit(1);
      }
      console.error(
        `\nAssertion Failure: canRun mismatch for agent '${agent.name}' on ${scenarioObj.name} (actual=${canRunActual}, expected=${canRunExpected})`
      );
      process.exit(1);
    }

    // 3. Assertion: non-ok status must not carry flags
    if (result.status !== "ok" && Array.isArray(result.flags) && result.flags.length > 0) {
      console.error(
        `\nAssertion Failure: Agent '${agent.name}' has non-ok status '${result.status}' but carried ${result.flags.length} flags!`
      );
      process.exit(1);
    }

    // 4. Assertion: all flags must have complete, non-empty evidence
    const evidenceOk = hasCompleteEvidence(result);
    if (!evidenceOk) {
      console.error(
        `\nAssertion Failure: Agent '${agent.name}' produced flags without non-empty evidence!`
      );
      process.exit(1);
    }

    findings.push(result);
    executionRows.push({
      scenario: `${scenarioObj.file} (${scenarioObj.key})`,
      agent: agent.name,
      canRunActual,
      canRunExpected,
      status: result.status,
      flagsCount: result.flags?.length || 0,
      evidenceComplete: evidenceOk ? "yes" : "no",
      durationMs,
    });
  }

  // Construct evaluated snapshot
  const evaluatedSnapshot = {
    ...snapshot,
    findings,
  };

  const scoreResult = scoreCase(evaluatedSnapshot, defaultConfig);

  // 5. Assertion: scenario score level must match expected risk level
  if (scoreResult.level !== scenarioObj.expectedLevel) {
    console.error(
      `\nAssertion Failure: Score level mismatch for ${scenarioObj.name}! Expected '${scenarioObj.expectedLevel}', got '${scoreResult.level}'`
    );
    process.exit(1);
  }

  // Invariant verification for Scenario C:
  // Score and confidence with and without skipped results must be strictly identical
  if (scenarioObj.key === "C") {
    const findingsWithSkipped = findings;
    const findingsWithoutSkipped = findings.filter((f) => f.status !== "skipped");

    const scoreWithSkipped = scoreCase(
      { ...snapshot, findings: findingsWithSkipped },
      defaultConfig
    );
    const scoreWithoutSkipped = scoreCase(
      { ...snapshot, findings: findingsWithoutSkipped },
      defaultConfig
    );

    console.log(
      "\n[Scenario C Invariant Check: Skipped results do not alter score or confidence]"
    );
    console.log(
      `  With skipped (${findingsWithSkipped.length} results):    level=${scoreWithSkipped.level}, score=${scoreWithSkipped.score}, confidence=${scoreWithSkipped.confidence}`
    );
    console.log(
      `  Without skipped (${findingsWithoutSkipped.length} results): level=${scoreWithoutSkipped.level}, score=${scoreWithoutSkipped.score}, confidence=${scoreWithoutSkipped.confidence}`
    );

    if (
      scoreWithSkipped.score !== scoreWithoutSkipped.score ||
      scoreWithSkipped.level !== scoreWithoutSkipped.level ||
      scoreWithSkipped.confidence !== scoreWithoutSkipped.confidence
    ) {
      console.error(
        "\nAssertion Failure: Scenario C score/confidence changed when skipped results were excluded!"
      );
      process.exit(1);
    }
  }

  return {
    scenario: scenarioObj.name,
    file: scenarioObj.file,
    key: scenarioObj.key,
    expectedLevel: scenarioObj.expectedLevel,
    actualLevel: scoreResult.level,
    score: scoreResult.score,
    confidence: scoreResult.confidence,
    executionRows,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const expectFail = args.includes("--expect-fail");

  const scenarios = [
    {
      key: "A",
      file: "scenario-a.js",
      name: "Scenario A (Clear Scam)",
      expectedLevel: clearScamScenario.expectedRiskLevel || "high",
      caseFile: clearScamScenario,
      networkConditions: {
        classifierHealthy: true,
        searchHealthy: true,
        graphHealthy: true,
      },
    },
    {
      key: "B",
      file: "scenario-b.js",
      name: "Scenario B (Genuine Notice)",
      expectedLevel: genuineNoticeScenario.expectedRiskLevel || "low",
      caseFile: genuineNoticeScenario,
      networkConditions: {
        classifierHealthy: true,
        searchHealthy: true,
        graphHealthy: true,
      },
    },
    {
      key: "C",
      file: "scenario-c.js",
      name: "Scenario C (Ambiguous Thin Evidence)",
      expectedLevel: ambiguousThinEvidenceScenario.expectedRiskLevel || "cannot_verify",
      caseFile: ambiguousThinEvidenceScenario,
      networkConditions: {
        classifierHealthy: false, // classifier service down
        searchHealthy: false, // search timeout
        graphHealthy: false, // graph service unavailable
      },
    },
  ];

  console.log("==========================================================");
  console.log("       L4 Specialist Agents Offline Execution Runner      ");
  console.log("==========================================================\n");

  if (expectFail) {
    console.log(
      "[--expect-fail mode active]: Flipping expectation for message_analyst in Scenario A.\n"
    );
  }

  const summaryRows = [];

  for (const sc of scenarios) {
    console.log(`\n--- Running Agents on ${sc.name} (${sc.file}) ---`);
    const runResult = await runScenario(sc, { expectFail });
    console.table(runResult.executionRows);

    summaryRows.push({
      scenario: sc.name,
      file: sc.file,
      expectedLevel: sc.expectedLevel,
      actualLevel: runResult.actualLevel,
      score: runResult.score,
      confidence: runResult.confidence,
      matched: runResult.actualLevel === sc.expectedLevel ? "PASS" : "FAIL",
    });
  }

  console.log("\n--- Overall Scenario Evaluation Summary ---");
  console.table(summaryRows);

  if (expectFail) {
    // If we reached here in expectFail mode, the expected mismatch was not triggered
    console.error(
      "\n[--expect-fail]: Expected failure did not occur. All scenarios passed."
    );
    process.exit(1);
  }

  console.log(
    "\nAll agent runs completed and matched expected risk levels successfully."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Runner encountered fatal error:", err);
  process.exit(1);
});
