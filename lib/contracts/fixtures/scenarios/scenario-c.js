/**
 * Scenario C: Ambiguous Thin Evidence
 * - Short informal message received via Telegram offering flexible tasks
 * - Only 1 weak signal (off-platform contact / urgency)
 * - Most specialist agents skipped (no domain, no company name, no official portal)
 * - One eligible network tool fails or times out (could_not_check)
 * - Total completed eligible agents is low (< 40%) and score < 60
 *
 * Expected Outcome:
 * - Expected Risk Level: cannot_verify (Invariant: < 40% completed agents & score < 60)
 * - Expected Confidence: low, provisional until L3
 */

export const ambiguousThinEvidenceScenario = {
  name: "scenario-c-ambiguous-thin-evidence",
  description: "Informal short task job message with missing entity details resulting in cannot_verify",
  submission: {
    text: "Work from home part-time opportunity. Earn daily payout for online rating tasks. Reach out on telegram @remote_work_desk to get started right now.",
    handle: "remote_work_desk",
    language: "en",
    consent: true,
  },
  entities: [
    {
      id: 1,
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: "handle",
      value: "remote_work_desk",
      source: "user",
      round: 0,
      confirmed: true,
    },
  ],
  results: [
    // Round 1: Message Analyst (eligible: message text exists)
    {
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      agent: "message_analyst",
      kind: "agent",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "off_platform_contact",
          title: "Off-Platform Contact",
          severity: "low",
          explanation: "Prompted to migrate conversation to Telegram handle.",
          evidence: [
            {
              type: "quote",
              value: "Reach out on telegram @remote_work_desk",
            },
          ],
        },
      ],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Weak signal: off-platform Telegram contact, but insufficient text to confirm advance-fee or mule task scam",
      durationMs: 310,
    },

    // Round 1: Classifier client (eligible: message text exists)
    {
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      agent: "classifier_client",
      kind: "check",
      round: 1,
      status: "could_not_check",
      reason: "Classifier service unavailable",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [{ error: "ECONNREFUSED" }],
      notes: "Classifier service down",
      durationMs: 50,
    },

    // Round 1: Website Forensics (ineligible: no domain or url)
    {
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      agent: "website_forensics",
      kind: "check",
      round: 1,
      status: "skipped",
      reason: "No website URL or domain provided in submission",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Deterministic eligibility check skipped",
      durationMs: 3,
    },

    // Round 1: Official Verifier (ineligible: no company or domain)
    {
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      agent: "official_verifier",
      kind: "check",
      round: 1,
      status: "skipped",
      reason: "No institution or government entity to verify",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Deterministic eligibility check skipped",
      durationMs: 4,
    },

    // Round 1: Reputation OSINT (eligible for handle, but external lookup times out -> could_not_check)
    {
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      agent: "reputation_osint",
      kind: "check",
      round: 1,
      status: "could_not_check",
      reason: "Upstream reputation lookup service timed out after 25s",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [{ error: "ETIMEDOUT" }],
      notes: "Could not complete external reputation verification",
      durationMs: 25000,
    },

    // Round 1: Payment & Entity (eligible for handle, but network error -> could_not_check)
    {
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      agent: "payment_entity",
      kind: "check",
      round: 1,
      status: "could_not_check",
      reason: "Graph lookup service unavailable",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [{ error: "ECONNREFUSED" }],
      notes: "Could not check entity against graph",
      durationMs: 1500,
    },
  ],
  events: [
    {
      id: 1,
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      round: 1,
      type: "round",
      status: "started",
      summary: "Round 1 started",
      createdAt: "2026-10-20T00:00:05.000Z",
    },
    {
      id: 2,
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      round: 1,
      type: "agent",
      agent: "message_analyst",
      status: "completed",
      summary: "Message Analyst found off_platform_contact",
      createdAt: "2026-10-20T00:00:10.000Z",
    },
    {
      id: 3,
      checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      round: 1,
      type: "complete",
      status: "completed",
      summary: "Investigation finished with cannot_verify",
      createdAt: "2026-10-20T00:01:00.000Z",
    },
  ],
  expectedRiskLevel: "cannot_verify",
  expectedConfidence: "low",
  confidenceProvisional: true,
};

/**
 * Builds the fully assembled CaseFile for Scenario C.
 */
export function buildAmbiguousThinEvidenceCaseFile() {
  const processedByAgent = {};
  for (const r of ambiguousThinEvidenceScenario.results) {
    if (!processedByAgent[r.agent]) {
      processedByAgent[r.agent] = [];
    }
    for (const p of r.processedEntities) {
      if (!processedByAgent[r.agent].includes(p)) {
        processedByAgent[r.agent].push(p);
      }
    }
  }

  return {
    check: {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "report_ready",
      currentRound: 1,
      language: "en",
      riskLevel: "cannot_verify",
      score: 10,
      confidence: "low",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:01:00.000Z",
      expiresAt: "2026-10-21T00:00:00.000Z",
    },
    inputs: [
      {
        id: 1,
        checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        type: "text",
        value: ambiguousThinEvidenceScenario.submission.text,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
      {
        id: 2,
        checkId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        type: "handle",
        value: ambiguousThinEvidenceScenario.submission.handle,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
    ],
    entities: ambiguousThinEvidenceScenario.entities,
    findings: ambiguousThinEvidenceScenario.results,
    events: ambiguousThinEvidenceScenario.events,
    control: {
      processedEntitiesByAgent: processedByAgent,
    },
  };
}
