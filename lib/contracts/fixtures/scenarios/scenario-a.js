/**
 * Scenario A: Clear Scam
 * - Fake scholarship offering financial assistance but demanding upfront registration fee
 * - Personal UPI ID provided for payment
 * - Lookalike domain mimicking official portal
 * - Discovered company entity in round 1
 *
 * Full round 1 & round 2 sets conforming to ARCHITECTURE section 3.5.
 */

export const clearScamScenario = {
  name: "scenario-a-clear-scam",
  description: "Fake PM scholarship demanding upfront registration fee to a personal UPI handle",
  submission: {
    text: "Congratulations! You have been granted the National Merit Scholarship of Rs 50,000. To release the scholarship funds, pay an upfront verification fee of Rs 750 to scholarship.dept@okaxis on UPI within 2 hours.",
    url: "https://pm-scholarship-gov.example/apply",
    upiId: "scholarship.dept@okaxis",
    language: "en",
    consent: true,
  },
  entities: [
    {
      id: 1,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "url",
      value: "https://pm-scholarship-gov.example/apply",
      source: "user",
      round: 0,
      confirmed: true,
    },
    {
      id: 2,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "domain",
      value: "pm-scholarship-gov.example",
      source: "user",
      round: 0,
      confirmed: true,
    },
    {
      id: 3,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "upi",
      value: "scholarship.dept@okaxis",
      source: "user",
      round: 0,
      confirmed: true,
    },
    // Discovered in round 1 by website_forensics
    {
      id: 4,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "company",
      value: "Prime Grant Trust",
      source: "discovered",
      discoveredBy: "website_forensics",
      round: 1,
      confirmed: true,
      evidence: {
        type: "url",
        value: "https://pm-scholarship-gov.example/about-us",
      },
    },
  ],
  results: [
    // Round 1: Message Analyst (eligible: message text exists)
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "message_analyst",
      kind: "agent",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "scholarship_fee_demand",
          title: "Scholarship Fee Demand",
          severity: "high",
          explanation: "Demanded upfront verification fee of Rs 750 to release scholarship funds.",
          evidence: [
            {
              type: "quote",
              value: "To release the scholarship funds, pay an upfront verification fee of Rs 750 to scholarship.dept@okaxis",
            },
          ],
        },
        {
          id: "urgency_pressure",
          title: "Urgency Pressure",
          severity: "low",
          explanation: "Imposed a 2-hour deadline to induce panic.",
          evidence: [
            {
              type: "quote",
              value: "within 2 hours.",
            },
          ],
        },
      ],
      verified: ["Message analyzed for predatory fee patterns"],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Clear scholarship fee demand detected",
      durationMs: 310,
    },

    // Round 1: Classifier client (eligible: message text exists)
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "classifier_client",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "classifier_high",
          title: "Classifier High Risk Score",
          severity: "medium",
          explanation: "Model probability > 0.80 indicating fraudulent opportunity.",
          evidence: [
            {
              type: "quote",
              value: "upfront verification fee",
            },
          ],
        },
      ],
      verified: ["ML classification completed"],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Classifier scored 0.94 probability",
      durationMs: 150,
    },

    // Round 1: Payment & Entity (eligible: upi and domain exist)
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "payment_entity",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "personal_payment_id",
          title: "Personal Payment Identifier",
          severity: "high",
          explanation: "Payment requested to a personal UPI handle instead of institutional merchant account.",
          evidence: [
            {
              type: "quote",
              value: "scholarship.dept@okaxis",
            },
          ],
        },
      ],
      verified: ["UPI handle syntax valid"],
      newEntities: [],
      processedEntities: [
        "upi:scholarship.dept@okaxis",
        "domain:pm-scholarship-gov.example",
      ],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Consumer UPI handle used for purported government scheme",
      durationMs: 250,
    },

    // Round 1: Website Forensics (eligible: domain and url exist)
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "website_forensics",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "lookalike_domain",
          title: "Lookalike Domain",
          severity: "high",
          explanation: "Domain mimics official government scholarship portal.",
          evidence: [
            {
              type: "quote",
              value: "pm-scholarship-gov.example",
            },
            {
              type: "url",
              value: "https://rdap.org/domain/pm-scholarship-gov.example",
            },
          ],
        },
        {
          id: "domain_new",
          title: "Newly Registered Domain",
          severity: "medium",
          explanation: "Domain registered fewer than 10 days ago.",
          evidence: [
            {
              type: "url",
              value: "https://rdap.org/domain/pm-scholarship-gov.example",
            },
          ],
        },
      ],
      verified: ["Domain resolved to IP"],
      newEntities: [
        {
          kind: "company",
          value: "Prime Grant Trust",
          evidence: {
            type: "url",
            value: "https://pm-scholarship-gov.example/about-us",
          },
        },
      ],
      processedEntities: ["domain:pm-scholarship-gov.example"],
      unchecked: [],
      manualChecks: [
        {
          label: "Check RDAP registration",
          url: "https://rdap.org/domain/pm-scholarship-gov.example",
        },
      ],
      trace: [],
      notes: "Newly created domain mimicking PM scholarship",
      durationMs: 450,
    },

    // Round 1: Official Verifier (eligible: domain exists)
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "official_verifier",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "not_on_official_portal",
          title: "Not Found on Official Portal",
          severity: "medium",
          explanation: "No such scheme or disbursement listed on scholarships.gov.in.",
          evidence: [
            {
              type: "url",
              value: "https://scholarships.gov.in.example/schemes",
            },
          ],
        },
        {
          id: "non_gov_domain_claiming_gov",
          title: "Non-Government Domain Claiming Official Scheme",
          severity: "high",
          explanation: "Purports to be National Merit Scheme on a non-.gov.in domain.",
          evidence: [
            {
              type: "quote",
              value: "pm-scholarship-gov.example",
            },
          ],
        },
      ],
      verified: [],
      newEntities: [],
      processedEntities: ["domain:pm-scholarship-gov.example"],
      unchecked: [],
      manualChecks: [
        {
          label: "National Scholarship Portal",
          url: "https://scholarships.gov.in.example",
        },
      ],
      trace: [],
      notes: "Official government registries disavow this program",
      durationMs: 380,
    },

    // Round 1: Reputation OSINT (eligible: domain exists)
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "reputation_osint",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [],
      verified: ["Searched domain on public scam boards"],
      newEntities: [],
      processedEntities: ["domain:pm-scholarship-gov.example"],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Domain too new to have prior reviews",
      durationMs: 220,
    },

    // Round 2: Official Verifier (newly eligible for discovered company 'Prime Grant Trust')
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "official_verifier",
      kind: "check",
      round: 2,
      status: "ok",
      flags: [],
      verified: ["Checked official NGO/trust registry for Prime Grant Trust"],
      newEntities: [],
      processedEntities: ["company:Prime Grant Trust"],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Not listed in official trust registry",
      durationMs: 180,
    },

    // Round 2: Reputation OSINT (newly eligible for discovered company 'Prime Grant Trust')
    {
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agent: "reputation_osint",
      kind: "check",
      round: 2,
      status: "ok",
      flags: [
        {
          id: "scam_reports_found",
          title: "Corroborated Scam Reports Found",
          severity: "high",
          explanation: "Multiple complaints on consumer grievance forums citing Prime Grant Trust fee fraud.",
          evidence: [
            {
              type: "url",
              value: "https://consumercomplaints.example/reports/prime-grant-trust",
            },
          ],
        },
      ],
      verified: [],
      newEntities: [],
      processedEntities: ["company:Prime Grant Trust"],
      unchecked: [],
      manualChecks: [
        {
          label: "Consumer complaints board",
          url: "https://consumercomplaints.example/reports/prime-grant-trust",
        },
      ],
      trace: [],
      notes: "Discovered company has active consumer fraud warnings",
      durationMs: 520,
    },
  ],
  events: [
    {
      id: 1,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      round: 1,
      type: "round",
      status: "started",
      summary: "Round 1 started",
      createdAt: "2026-10-20T00:00:05.000Z",
    },
    {
      id: 2,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      round: 1,
      type: "agent",
      agent: "message_analyst",
      status: "completed",
      summary: "Message Analyst completed with 2 flags",
      createdAt: "2026-10-20T00:00:10.000Z",
    },
    {
      id: 3,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      round: 2,
      type: "round",
      status: "started",
      summary: "Round 2 started",
      createdAt: "2026-10-20T00:01:00.000Z",
    },
    {
      id: 4,
      checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      round: 2,
      type: "complete",
      status: "completed",
      summary: "Investigation completed",
      createdAt: "2026-10-20T00:02:00.000Z",
    },
  ],
  expectedRiskLevel: "high",
  expectedConfidence: "high",
  confidenceProvisional: true,
};

/**
 * Builds the fully assembled CaseFile for Scenario A.
 */
export function buildClearScamCaseFile() {
  const processedByAgent = {};
  for (const r of clearScamScenario.results) {
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
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "report_ready",
      currentRound: 2,
      language: "en",
      riskLevel: "high",
      score: 95,
      confidence: "high",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:02:30.000Z",
      expiresAt: "2026-10-21T00:00:00.000Z",
    },
    inputs: [
      {
        id: 1,
        checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "text",
        value: clearScamScenario.submission.text,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
      {
        id: 2,
        checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "url",
        value: clearScamScenario.submission.url,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
      {
        id: 3,
        checkId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "upi",
        value: clearScamScenario.submission.upiId,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
    ],
    entities: clearScamScenario.entities,
    findings: clearScamScenario.results,
    events: clearScamScenario.events,
    control: {
      processedEntitiesByAgent: processedByAgent,
    },
  };
}
