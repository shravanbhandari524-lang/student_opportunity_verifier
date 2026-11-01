/**
 * lib/contracts/fixtures/trace/fake-scholarship-stream.js
 *
 * Full, realistic, ordered fixture event stream for a fake-scholarship verification check.
 * Covers:
 * - Extraction & start stages
 * - Round 1 start
 * - Message analysis & narrative note
 * - Search query & results
 * - Page fetch & excerpt
 * - Domain RDAP & lookalike lookup
 * - ML Scam Classifier prediction
 * - Official verifier claim contradiction
 * - High-risk flag generation
 * - Discovered domain entity
 * - Round 2 execution on discovered domain
 * - Pipeline completion
 *
 * All events strictly satisfy TraceEventSchema with monotonic sequence numbers (seq: 1..28).
 */

const CHECK_ID = "c0a80101-0000-4000-8000-000000000001";
const BASE_TS = 1793095200000; // Fixed epoch for reproducible tests

function iso(secOffset) {
  return new Date(BASE_TS + secOffset * 1000).toISOString();
}

export const fakeScholarshipStream = [
  // 1. Pipeline stage: extraction started
  {
    seq: 1,
    checkId: CHECK_ID,
    ts: iso(1),
    round: 0,
    agent: null,
    type: "stage",
    stage: "extraction",
  },

  // 2. Pipeline stage: investigation initiated
  {
    seq: 2,
    checkId: CHECK_ID,
    ts: iso(2),
    round: 1,
    agent: null,
    type: "stage",
    stage: "investigating",
  },

  // 3. Round 1 started
  {
    seq: 3,
    checkId: CHECK_ID,
    ts: iso(3),
    round: 1,
    agent: null,
    type: "round",
  },

  // 4. Message Analyst started
  {
    seq: 4,
    checkId: CHECK_ID,
    ts: iso(4),
    round: 1,
    agent: "message_analyst",
    type: "agent_status",
    status: "started",
    summary: "Analyzing scholarship offer message for advance fee demands",
  },

  // 5. Message Analyst progress note
  {
    seq: 5,
    checkId: CHECK_ID,
    ts: iso(5),
    round: 1,
    agent: "message_analyst",
    type: "note",
    text: "Detected demand for refundable verification fee to activate scholarship",
  },

  // 6. Message Analyst completed
  {
    seq: 6,
    checkId: CHECK_ID,
    ts: iso(6),
    round: 1,
    agent: "message_analyst",
    type: "agent_status",
    status: "done",
    summary: "Identified advance-fee pattern in message text",
  },

  // 7. Classifier Client started
  {
    seq: 7,
    checkId: CHECK_ID,
    ts: iso(7),
    round: 1,
    agent: "classifier_client",
    type: "agent_status",
    status: "started",
    summary: "Evaluating message text against trained scam classification model",
  },

  // 8. Classifier tool start
  {
    seq: 8,
    checkId: CHECK_ID,
    ts: iso(8),
    round: 1,
    agent: "classifier_client",
    type: "tool_start",
    callId: "call_cls_01",
    tool: "classifier",
    label: "Logistic Regression Scam Model",
    input: "National Merit Scholarship Alert 2026: You are eligible...",
  },

  // 9. Classifier tool end
  {
    seq: 9,
    checkId: CHECK_ID,
    ts: iso(9),
    round: 1,
    agent: "classifier_client",
    type: "tool_end",
    callId: "call_cls_01",
    tool: "classifier",
    status: "ok",
    durationMs: 82,
    summary: "Scam probability 0.96",
    detail: {
      tool: "classifier",
      probability: 0.96,
      topTerms: ["processing fee", "registration fee", "instant grant"],
    },
  },

  // 10. Classifier Client done
  {
    seq: 10,
    checkId: CHECK_ID,
    ts: iso(10),
    round: 1,
    agent: "classifier_client",
    type: "agent_status",
    status: "done",
    summary: "Classifier returned high scam probability (0.96)",
  },

  // 11. Website Forensics started
  {
    seq: 11,
    checkId: CHECK_ID,
    ts: iso(11),
    round: 1,
    agent: "website_forensics",
    type: "agent_status",
    status: "started",
    summary: "Checking domain registration, RDAP, and SSL validity",
  },

  // 12. RDAP lookup tool start
  {
    seq: 12,
    checkId: CHECK_ID,
    ts: iso(12),
    round: 1,
    agent: "website_forensics",
    type: "tool_start",
    callId: "call_rdap_01",
    tool: "rdapLookup",
    label: "RDAP Domain Registration",
    input: "pm-yuva-scholarship-gov.in-portal.org",
  },

  // 13. RDAP lookup tool end
  {
    seq: 13,
    checkId: CHECK_ID,
    ts: iso(13),
    round: 1,
    agent: "website_forensics",
    type: "tool_end",
    callId: "call_rdap_01",
    tool: "rdapLookup",
    status: "ok",
    durationMs: 140,
    summary: "Domain age: 4 days (newly registered)",
    detail: {
      tool: "rdapLookup",
      domain: "pm-yuva-scholarship-gov.in-portal.org",
      registeredAt: "2026-10-23T00:00:00Z",
      ageDays: 4,
      registrar: "PublicDomainRegistry",
    },
  },

  // 14. Website Forensics note
  {
    seq: 14,
    checkId: CHECK_ID,
    ts: iso(14),
    round: 1,
    agent: "website_forensics",
    type: "note",
    text: "Domain registered 4 days ago; evaluating lookalike distance to .gov.in",
  },

  // 15. Lookalike check tool start
  {
    seq: 15,
    checkId: CHECK_ID,
    ts: iso(15),
    round: 1,
    agent: "website_forensics",
    type: "tool_start",
    callId: "call_lookalike_01",
    tool: "lookalikeCheck",
    label: "Government Portal Lookalike Analyzer",
    input: "pm-yuva-scholarship-gov.in-portal.org",
  },

  // 16. Lookalike check tool end
  {
    seq: 16,
    checkId: CHECK_ID,
    ts: iso(16),
    round: 1,
    agent: "website_forensics",
    type: "tool_end",
    callId: "call_lookalike_01",
    tool: "lookalikeCheck",
    status: "ok",
    durationMs: 25,
    summary: "Lookalike match against scholarships.gov.in (distance 3)",
    detail: {
      tool: "lookalikeCheck",
      closestDomain: "scholarships.gov.in",
      distance: 3,
    },
  },

  // 17. Website Forensics done
  {
    seq: 17,
    checkId: CHECK_ID,
    ts: iso(17),
    round: 1,
    agent: "website_forensics",
    type: "agent_status",
    status: "done",
    summary: "Website forensics detected newly registered typosquat domain",
  },

  // 18. Official Verifier started
  {
    seq: 18,
    checkId: CHECK_ID,
    ts: iso(18),
    round: 1,
    agent: "official_verifier",
    type: "agent_status",
    status: "started",
    summary: "Cross-referencing National Scholarship Portal schemes",
  },

  // 19. Search tool start
  {
    seq: 19,
    checkId: CHECK_ID,
    ts: iso(19),
    round: 1,
    agent: "official_verifier",
    type: "tool_start",
    callId: "call_srch_01",
    tool: "search",
    label: "Search official gov.in portal",
    input: "site:scholarships.gov.in 'PM Yuva Scholarship' guidelines fee",
  },

  // 20. Search tool end
  {
    seq: 20,
    checkId: CHECK_ID,
    ts: iso(20),
    round: 1,
    agent: "official_verifier",
    type: "tool_end",
    callId: "call_srch_01",
    tool: "search",
    status: "ok",
    durationMs: 310,
    summary: "Search returned official guidelines",
    detail: {
      tool: "search",
      query: "site:scholarships.gov.in 'PM Yuva Scholarship' guidelines fee",
      resultCount: 2,
      results: [
        {
          title: "National Scholarship Portal Official Notice",
          url: "https://scholarships.gov.in/notices/pm-yuva-warning",
          snippet: "Beware of fraudulent portals charging fees under PM Yuva name. Government schemes charge no fee.",
          read: true,
        },
      ],
    },
  },

  // 21. Verdict: scheme fee contradicted
  {
    seq: 21,
    checkId: CHECK_ID,
    ts: iso(21),
    round: 1,
    agent: "official_verifier",
    type: "verdict",
    claim: "Government scholarship demands application processing fee",
    verdict: "contradicted",
    sources: ["https://scholarships.gov.in/notices/pm-yuva-warning"],
  },

  // 22. Discovered entity: secondary payment portal domain
  {
    seq: 22,
    checkId: CHECK_ID,
    ts: iso(22),
    round: 1,
    agent: "official_verifier",
    type: "entity",
    kind: "domain",
    value: "yuva-scholarship-payment-gateway.net",
    evidence: "Found embedded in official warning advisory regarding active phishing domains",
  },

  // 23. Official Verifier done
  {
    seq: 23,
    checkId: CHECK_ID,
    ts: iso(23),
    round: 1,
    agent: "official_verifier",
    type: "agent_status",
    status: "done",
    summary: "Claimed fee contradicted by official portal advisory",
  },

  // 24. Coordinator merges flag: advance_fee_demanded
  {
    seq: 24,
    checkId: CHECK_ID,
    ts: iso(24),
    round: 1,
    agent: "coordinator",
    type: "flag",
    flagId: "advance_fee_demanded",
    title: "Upfront Fee Demanded for Scholarship",
    severity: "high",
    evidence: [
      {
        type: "quote",
        value: "submit application processing fee of Rs 499",
      },
    ],
  },

  // 25. Round 2 started (triggered by discovered domain)
  {
    seq: 25,
    checkId: CHECK_ID,
    ts: iso(25),
    round: 2,
    agent: null,
    type: "round",
  },

  // 26. Website Forensics Round 2 on discovered domain
  {
    seq: 26,
    checkId: CHECK_ID,
    ts: iso(26),
    round: 2,
    agent: "website_forensics",
    type: "agent_status",
    status: "done",
    summary: "Discovered domain confirmed newly created (1 day old)",
  },

  // 27. Pipeline stage: report generation
  {
    seq: 27,
    checkId: CHECK_ID,
    ts: iso(27),
    round: 2,
    agent: null,
    type: "stage",
    stage: "report",
  },

  // 28. Pipeline completed
  {
    seq: 28,
    checkId: CHECK_ID,
    ts: iso(28),
    round: 2,
    agent: null,
    type: "complete",
  },
];
