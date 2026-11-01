/**
 * tests/helpers/mock-generate.js
 *
 * Shared mock LLM generator helper for coordinator and API route tests.
 * Validates message_analyst return data against AnalystResponseSchema from lib/agents/message-analyst.js
 * so that schema drift or malformed mock shapes fail immediately at setup time.
 */

import { AnalystResponseSchema } from "../../lib/agents/message-analyst.js";

/**
 * Returns validated message_analyst finding data for scenario A, B, or C.
 *
 * @param {"A" | "B" | "C"} scenarioKey
 * @returns {import("../../lib/agents/message-analyst.js").AnalystResponse}
 */
export function getAnalystFindingsForScenario(scenarioKey) {
  let raw;
  if (scenarioKey === "A") {
    raw = {
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
    };
  } else if (scenarioKey === "B") {
    raw = {
      findings: [],
    };
  } else if (scenarioKey === "C") {
    raw = {
      findings: [
        {
          flagId: "off_platform_contact",
          quote: "Reach out on telegram @remote_work_desk",
          explanation: "Directs communication to external Telegram handle",
        },
      ],
    };
  } else {
    throw new Error(`Unknown scenarioKey: ${scenarioKey}`);
  }

  // Strictly parse and validate against real AnalystResponseSchema upfront
  return AnalystResponseSchema.parse(raw);
}

/**
 * Creates a standard mock generate function for a scenario.
 *
 * @param {"A" | "B" | "C"} scenarioKey
 * @param {object} [customReportData]
 * @returns {Function}
 */
export function createScenarioGenerate(scenarioKey, customReportData = {}) {
  const isA = scenarioKey === "A";
  const isB = scenarioKey === "B";
  const analystData = getAnalystFindingsForScenario(scenarioKey);

  return async (params = {}) => {
    if (params.purpose === "report_generation") {
      return {
        ok: true,
        data: {
          summary: isA
            ? "High risk: scholarship demands upfront registration fee to an individual UPI handle and uses a lookalike domain."
            : isB
            ? "No immediate suspicious indicators were detected during preliminary public record checks. Low risk is not a guarantee of safety or endorsement. Always stay alert and verify official channels."
            : "Assessment inconclusive: insufficient evidence to verify this opportunity.",
          scamTypeGuess: isA ? "scholarship" : isB ? "unknown" : "task_job",
          flagExplanations: isA
            ? [
                {
                  flagId: "scholarship_fee_demand",
                  text: "Upfront fee demand required before scholarship disbursement",
                },
              ]
            : [],
          extraChecklist: [],
          ...customReportData,
        },
      };
    }

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

    // Default to validated message analyst response
    return {
      ok: true,
      data: analystData,
    };
  };
}
