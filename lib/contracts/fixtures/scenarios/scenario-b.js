/**
 * Scenario B: Genuine Official Notice
 * - Legitimate scholarship notification from an established institute
 * - No upfront fee demanded
 * - Official domain (.edu.example / verifiable history)
 *
 * Full round 1 set conforming to ARCHITECTURE section 3.5.
 */

export const genuineNoticeScenario = {
  name: "scenario-b-genuine-notice",
  description: "Official merit fellowship announcement with no upfront fees and verifiable institutional domain",
  submission: {
    text: "Applications are invited for the 2026 Academic Research Fellowship. Shortlisted candidates will be invited for an in-person panel interview. No application fee or processing charge is applicable.",
    url: "https://research-portal.institute.edu.example/fellowships",
    company: "National Research Institute",
    language: "en",
    consent: true,
  },
  entities: [
    {
      id: 1,
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "url",
      value: "https://research-portal.institute.edu.example/fellowships",
      source: "user",
      round: 0,
      confirmed: true,
    },
    {
      id: 2,
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "domain",
      value: "research-portal.institute.edu.example",
      source: "user",
      round: 0,
      confirmed: true,
    },
    {
      id: 3,
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "company",
      value: "National Research Institute",
      source: "user",
      round: 0,
      confirmed: true,
    },
  ],
  results: [
    // Round 1: Message Analyst (eligible: message text exists)
    {
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      agent: "message_analyst",
      kind: "agent",
      round: 1,
      status: "ok",
      flags: [],
      verified: [
        "No upfront fee demand detected",
        "Clear interview process stated",
        "No artificial countdown urgency",
      ],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Clean announcement text with zero suspicious trigger words",
      durationMs: 290,
    },

    // Round 1: Classifier client (eligible: message text exists)
    {
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      agent: "classifier_client",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [],
      verified: ["ML classification completed: benign pattern"],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Classifier scored 0.03 probability",
      durationMs: 140,
    },

    // Round 1: Website Forensics (eligible: domain and url exist)
    {
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      agent: "website_forensics",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [],
      verified: [
        "Domain registered over 8 years ago",
        "Valid SSL/TLS certificate issued by trusted CA",
        "Over 120 historical snapshots found in Wayback Machine",
      ],
      newEntities: [],
      processedEntities: ["domain:research-portal.institute.edu.example"],
      unchecked: [],
      manualChecks: [
        {
          label: "View Wayback Machine history",
          url: "https://web.archive.org.example/web/*/institute.edu.example",
        },
      ],
      trace: [],
      notes: "Established academic domain with long tenure",
      durationMs: 410,
    },

    // Round 1: Official Verifier (eligible: company and domain exist)
    {
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      agent: "official_verifier",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [],
      verified: [
        "Organization verified against higher education council directory",
        "Fellowship listed on official academic announcements page",
      ],
      newEntities: [],
      processedEntities: [
        "domain:research-portal.institute.edu.example",
        "company:National Research Institute",
      ],
      unchecked: [],
      manualChecks: [
        {
          label: "Official Institute Fellowship Directory",
          url: "https://institute.edu.example/announcements",
        },
      ],
      trace: [],
      notes: "Program confirmed active and publicly listed",
      durationMs: 350,
    },

    // Round 1: Payment & Entity (eligible: domain exists)
    {
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      agent: "payment_entity",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [],
      verified: ["Checked domain against scam intelligence graph"],
      newEntities: [],
      processedEntities: ["domain:research-portal.institute.edu.example"],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "No scam graph match found for domain",
      durationMs: 120,
    },

    // Round 1: Reputation OSINT (eligible: company and domain exist)
    {
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      agent: "reputation_osint",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [],
      verified: [
        "No negative scam or fraud complaints found across forums",
        "Active verified social presence",
      ],
      newEntities: [],
      processedEntities: [
        "domain:research-portal.institute.edu.example",
        "company:National Research Institute",
      ],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Clean public reputation profile",
      durationMs: 320,
    },
  ],
  events: [
    {
      id: 1,
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      round: 1,
      type: "round",
      status: "started",
      summary: "Round 1 started",
      createdAt: "2026-10-20T00:00:05.000Z",
    },
    {
      id: 2,
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      round: 1,
      type: "agent",
      agent: "official_verifier",
      status: "completed",
      summary: "Official Verifier verified institute accreditation",
      createdAt: "2026-10-20T00:00:15.000Z",
    },
    {
      id: 3,
      checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      round: 1,
      type: "complete",
      status: "completed",
      summary: "Investigation completed with 0 flags",
      createdAt: "2026-10-20T00:01:00.000Z",
    },
  ],
  expectedRiskLevel: "low",
  expectedConfidence: "high",
  confidenceProvisional: true,
};

/**
 * Builds the fully assembled CaseFile for Scenario B.
 */
export function buildGenuineNoticeCaseFile() {
  const processedByAgent = {};
  for (const r of genuineNoticeScenario.results) {
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
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "report_ready",
      currentRound: 1,
      language: "en",
      riskLevel: "low",
      score: 0,
      confidence: "high",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:01:45.000Z",
      expiresAt: "2026-10-21T00:00:00.000Z",
    },
    inputs: [
      {
        id: 1,
        checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "text",
        value: genuineNoticeScenario.submission.text,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
      {
        id: 2,
        checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "url",
        value: genuineNoticeScenario.submission.url,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
      {
        id: 3,
        checkId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        type: "company",
        value: genuineNoticeScenario.submission.company,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
    ],
    entities: genuineNoticeScenario.entities,
    findings: genuineNoticeScenario.results,
    events: genuineNoticeScenario.events,
    control: {
      processedEntitiesByAgent: processedByAgent,
    },
  };
}
