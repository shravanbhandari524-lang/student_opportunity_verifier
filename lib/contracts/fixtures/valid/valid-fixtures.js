import { EvidenceSchema } from "../../evidence.js";
import { FlagSchema } from "../../flag.js";
import { EntitySchema } from "../../entity.js";
import { AgentResultSchema } from "../../agent-result.js";
import { CheckSchema } from "../../check.js";
import { CheckSubmissionSchema, CheckInputRowSchema } from "../../submission.js";
import { ClassifierResultSchema } from "../../classifier-result.js";
import { ScoreResultSchema } from "../../score-result.js";
import { ReportSchema } from "../../report.js";
import { ProgressEventSchema, CheckEventRowSchema } from "../../events.js";
import { ApiErrorSchema } from "../../api-error.js";
import { FeedbackSchema, FeedbackRequestSchema } from "../../feedback.js";
import { GraphNodeSchema, GraphEdgeSchema, GraphMatchSchema, SaveToGraphRequestSchema, SaveToGraphResponseSchema } from "../../graph.js";
import { CaseFileSchema } from "../../case-file.js";
import { ToolResultSchema } from "../../tool-result.js";
import {
  CollegeEmailRequestSchema,
  CollegeEmailResponseSchema,
  FraudSummaryRequestSchema,
  FraudSummaryResponseSchema,
} from "../../actions.js";
import {
  GuideSchema,
  GuideSummarySchema,
} from "../../guides.js";

export const validFixtures = [
  // Evidence
  {
    contract: "Evidence",
    schema: EvidenceSchema,
    name: "valid-quote-evidence",
    data: {
      type: "quote",
      value: "Selected candidates must pay a refundable training security deposit of Rs 2500.",
    },
  },
  {
    contract: "Evidence",
    schema: EvidenceSchema,
    name: "valid-url-evidence",
    data: {
      type: "url",
      value: "https://rdap.org/domain/scholarship-portal.example",
    },
  },

  // Flag
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-fee-flag",
    data: {
      id: "scholarship_fee_demand",
      title: "Scholarship Upfront Fee Demand",
      severity: "high",
      explanation: "A scholarship program demanded an upfront registration fee before release.",
      evidence: [
        {
          type: "quote",
          value: "Pay 500 rupees verification fee to activate scholarship disbursement",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-urgency-flag",
    data: {
      id: "urgency_pressure",
      title: "Urgency Pressure",
      severity: "low",
      explanation: "The offer demands payment within 2 hours or the seat is cancelled.",
      evidence: [
        {
          type: "quote",
          value: "Hurry! Offer valid only for 2 hours.",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-fee-demand-flag",
    data: {
      id: "fee_demand",
      title: "Fee Demand Detected",
      severity: "high",
      explanation: "Security deposit demanded following offer letter issuance.",
      evidence: [
        {
          type: "quote",
          value: "deposit a refundable Security Amount of Rs 3,500",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-equipment-advance-flag",
    data: {
      id: "equipment_advance",
      title: "Equipment Purchase Advance",
      severity: "high",
      explanation: "Candidate instructed to pay vendor for laptop with reimbursement promise.",
      evidence: [
        {
          type: "quote",
          value: "purchase the approved MacBook Pro bundle from our designated vendor",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-unsolicited-award-flag",
    data: {
      id: "unsolicited_award",
      title: "Unsolicited Award Notification",
      severity: "medium",
      explanation: "Award or competition winning notice sent without prior entry.",
      evidence: [
        {
          type: "quote",
          value: "you have won 1st prize in the All-India Young Innovators Technology Championship 2026",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-chat-only-interview-flag",
    data: {
      id: "chat_only_interview",
      title: "Chat-Only Interview Process",
      severity: "medium",
      explanation: "Interview conducted on text chat without live video or in-person verification.",
      evidence: [
        {
          type: "quote",
          value: "interview will be conducted entirely via Telegram text chat today at 3 PM",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-candidate-picks-hours-flag",
    data: {
      id: "candidate_picks_hours",
      title: "Unrestricted Schedule with Guaranteed Pay",
      severity: "low",
      explanation: "Promise of complete schedule freedom with guaranteed high daily compensation.",
      evidence: [
        {
          type: "quote",
          value: "Work 1-2 hours daily, choose your own hours anytime day or night",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-pay-too-high-flag",
    data: {
      id: "pay_too_high",
      title: "Disproportionately High Compensation",
      severity: "medium",
      explanation: "Compensation is excessively high relative to unskilled social media engagement tasks.",
      evidence: [
        {
          type: "quote",
          value: "Earn Rs 4,500 to Rs 8,000 per day from home! Simply subscribe to YouTube channels",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-unusual-pay-schedule-flag",
    data: {
      id: "unusual_pay_schedule",
      title: "Unusual Pay Schedule",
      severity: "low",
      explanation: "Immediate per-task or instant UPI payouts used to entice student engagement.",
      evidence: [
        {
          type: "quote",
          value: "immediate instant UPI payouts after every 10 tasks completed",
        },
      ],
    },
  },
  {
    contract: "Flag",
    schema: FlagSchema,
    name: "valid-data-harvest-redirects-flag",
    data: {
      id: "data_harvest_redirects",
      title: "Data Harvest Redirect Chain",
      severity: "medium",
      explanation: "Site redirects through multi-hop tracking networks to an external personal data collection form.",
      evidence: [
        {
          type: "url",
          value: "https://track.adnetwork.example/click?dest=https://external-harvest.example/form",
        },
      ],
    },
  },

  // Entity
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-user-entity",
    data: {
      id: 1,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "domain",
      value: "opportunity.example",
      source: "user",
      round: 0,
      confirmed: true,
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-discovered-entity",
    data: {
      id: 2,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "company",
      value: "Apex Digital Solutions",
      orgType: "company",
      source: "discovered",
      discoveredBy: "website_forensics",
      round: 1,
      confirmed: true,
      evidence: {
        type: "quote",
        value: "Copyright 2026 Apex Digital Solutions",
      },
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-upi-entity",
    data: {
      id: 3,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "upi",
      value: "merchant.desk@okaxis",
      source: "user",
      round: 0,
      confirmed: true,
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-phone-entity",
    data: {
      id: 4,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "phone",
      value: "+919876543210",
      source: "user",
      round: 0,
      confirmed: true,
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-youtube-url-entity",
    data: {
      id: 5,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "youtube_url",
      value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      source: "user",
      round: 0,
      confirmed: true,
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-handle-with-platform-entity",
    data: {
      id: 6,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "handle",
      value: "google_hr_careers",
      platform: "instagram",
      source: "user",
      round: 0,
      confirmed: true,
      evidence: { type: "quote", value: "@google_hr_careers" },
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-company-with-orgtype-government",
    data: {
      id: 7,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "company",
      value: "Department of Higher Education",
      orgType: "government",
      source: "extracted",
      round: 0,
      confirmed: true,
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-amount-with-direction-to-candidate",
    data: {
      id: 8,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "amount",
      value: "18000",
      purpose: "stipend/salary",
      direction: "to_candidate",
      source: "extracted",
      round: 0,
      confirmed: true,
    },
  },
  {
    contract: "Entity",
    schema: EntitySchema,
    name: "valid-amount-with-direction-from-candidate",
    data: {
      id: 9,
      checkId: "11111111-1111-4111-8111-111111111111",
      kind: "amount",
      value: "500",
      purpose: "application fee",
      direction: "from_candidate",
      source: "extracted",
      round: 0,
      confirmed: true,
    },
  },

  // AgentResult
  {
    contract: "AgentResult",
    schema: AgentResultSchema,
    name: "valid-ok-agent-result",
    data: {
      id: 1,
      checkId: "11111111-1111-4111-8111-111111111111",
      agent: "message_analyst",
      kind: "agent",
      round: 1,
      status: "ok",
      flags: [
        {
          id: "scholarship_fee_demand",
          title: "Fee Demand Detected",
          severity: "high",
          explanation: "Candidate asked to pay 500 upfront.",
          evidence: [{ type: "quote", value: "Pay 500 registration fee" }],
        },
      ],
      verified: ["Message language analyzed"],
      newEntities: [
        {
          kind: "company",
          value: "Apex Digital Solutions",
          evidence: { type: "quote", value: "Apex Digital Solutions hiring team" },
        },
      ],
      processedEntities: ["domain:opportunity.example"],
      unchecked: [],
      manualChecks: [
        {
          label: "Verify scholarship portal",
          url: "https://scholarships.gov.in.example",
        },
      ],
      trace: [{ step: "analyzed text length", length: 150 }],
      notes: "Clear fee demand in first message.",
      summary: "Checked message text; found 1 high-risk fee demand; discovered 1 hiring company.",
      activity: [
        {
          seq: 0,
          atMs: 12,
          type: "input",
          status: "info",
          title: "Received opportunity message text (150 chars)",
          detail: "Ingested initial user submission and extracted entities.",
        },
        {
          seq: 1,
          atMs: 250,
          type: "finding",
          status: "warn",
          title: "Flagged upfront scholarship fee demand",
          detail: "Candidate was asked to pay 500 registration fee upfront.",
          tool: "rules",
          flagId: "scholarship_fee_demand",
          sources: [
            {
              label: "National Scholarship Advisory",
              url: "https://scholarships.gov.in.example/advisory",
            },
          ],
        },
      ],
      durationMs: 420,
    },
  },
  {
    contract: "AgentResult",
    schema: AgentResultSchema,
    name: "valid-classifier-client-ok-agent-result",
    data: {
      id: 3,
      checkId: "11111111-1111-4111-8111-111111111111",
      agent: "classifier_client",
      kind: "check",
      round: 1,
      status: "ok",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Classifier model inference completed",
      durationMs: 45,
      classifierResult: {
        probability: 0.94,
        label: "suspicious",
        topTerms: ["registration fee", "deposit"],
        scamType: "scholarship_scam",
      },
    },
  },
  {
    contract: "AgentResult",
    schema: AgentResultSchema,
    name: "valid-skipped-agent-result",
    data: {
      id: 2,
      checkId: "11111111-1111-4111-8111-111111111111",
      agent: "official_verifier",
      kind: "check",
      round: 1,
      status: "skipped",
      reason: "No government scheme or institutional domain present to verify",
      flags: [],
      verified: [],
      newEntities: [],
      processedEntities: [],
      unchecked: [],
      manualChecks: [],
      trace: [],
      notes: "Deterministic check found no target",
      durationMs: 2,
    },
  },

  // Check
  {
    contract: "Check",
    schema: CheckSchema,
    name: "valid-created-check",
    data: {
      id: "11111111-1111-4111-8111-111111111111",
      status: "created",
      currentRound: 0,
      language: "en",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:00:00.000Z",
      expiresAt: "2026-10-21T00:00:00.000Z",
    },
  },
  {
    contract: "Check",
    schema: CheckSchema,
    name: "valid-scored-check",
    data: {
      id: "22222222-2222-4222-8222-222222222222",
      status: "report_ready",
      currentRound: 1,
      language: "hi",
      riskLevel: "high",
      score: 85,
      confidence: "high",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:05:00.000Z",
      expiresAt: "2026-10-21T00:00:00.000Z",
    },
  },
  {
    contract: "Check",
    schema: CheckSchema,
    name: "valid-failed-check-extraction-error",
    data: {
      id: "33333333-3333-4333-8333-333333333333",
      status: "failed",
      currentRound: 0,
      language: "en",
      failureReason: "extraction_error",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:01:00.000Z",
      expiresAt: "2026-10-21T00:00:00.000Z",
    },
  },
  {
    contract: "Check",
    schema: CheckSchema,
    name: "valid-failed-check-legacy-reason",
    data: {
      id: "44444444-4444-4444-8444-444444444444",
      status: "failed",
      currentRound: 0,
      language: "en",
      failureReason: "Legacy free text failure reason from extraction",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: "2026-10-20T00:01:00.000Z",
      expiresAt: "2026-10-21T00:00:00.000Z",
    },
  },

  // CheckSubmission & CheckInputRow
  {
    contract: "CheckSubmission",
    schema: CheckSubmissionSchema,
    name: "valid-submission-text-only",
    data: {
      text: "You have been selected for government scholarship. Please click link.",
      url: "https://apply-now.example",
      language: "en",
      consent: true,
    },
  },
  {
    contract: "CheckSubmission",
    schema: CheckSubmissionSchema,
    name: "valid-submission-with-images",
    data: {
      images: [
        {
          filename: "offer_letter.png",
          mimeType: "image/png",
          sizeBytes: 1048576,
        },
      ],
      language: "hi",
      consent: true,
    },
  },
  {
    contract: "CheckSubmission",
    schema: CheckSubmissionSchema,
    name: "valid-submission-with-user-notes-and-platform",
    data: {
      text: "You have been selected for government scholarship. Please click link.",
      userNotes: "Candidate contacted via Telegram",
      handle: "recruiter_desk",
      handlePlatform: "telegram",
      language: "en",
      consent: true,
    },
  },
  {
    contract: "CheckInputRow",
    schema: CheckInputRowSchema,
    name: "valid-input-row",
    data: {
      id: 1,
      checkId: "11111111-1111-4111-8111-111111111111",
      type: "text",
      value: "Selected candidate offer",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  },
  {
    contract: "CheckInputRow",
    schema: CheckInputRowSchema,
    name: "valid-image-input-row",
    data: {
      id: 2,
      checkId: "11111111-1111-4111-8111-111111111111",
      type: "image",
      filePath: "/uploads/chk_1/offer.png",
      mimeType: "image/png",
      sizeBytes: 204800,
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  },

  // ClassifierResult
  {
    contract: "ClassifierResult",
    schema: ClassifierResultSchema,
    name: "valid-classifier-suspicious",
    data: {
      probability: 0.94,
      label: "suspicious",
      topTerms: ["registration fee", "refundable deposit", "whatsapp"],
      scamType: "scholarship_scam",
    },
  },
  {
    contract: "ClassifierResult",
    schema: ClassifierResultSchema,
    name: "valid-classifier-benign",
    data: {
      probability: 0.05,
      label: "benign",
      topTerms: ["interview scheduled", "official portal"],
      scamType: "unknown",
    },
  },

  // ScoreResult
  {
    contract: "ScoreResult",
    schema: ScoreResultSchema,
    name: "valid-score-high",
    data: {
      level: "high",
      score: 85,
      confidence: "high",
      completedCount: 4,
      eligibleCount: 4,
      completionRatio: 1.0,
      rulesFired: ["scholarship_fee_demand"],
      flagPoints: [
        {
          id: "scholarship_fee_demand",
          weight: 30,
          points: 30,
          status: "counted",
          agents: ["message_analyst"],
        },
      ],
      classifierPoints: 20,
      confidenceCapped: false,
      reasonCodes: [],
      fallbackWeightFlags: [],
      coverage: {
        checked: ["message", "website", "official", "reputation"],
        notChecked: ["payee"],
      },
    },
  },
  {
    contract: "ScoreResult",
    schema: ScoreResultSchema,
    name: "valid-score-cannot-verify",
    data: {
      level: "cannot_verify",
      score: 15,
      confidence: "low",
      completedCount: 1,
      eligibleCount: 4,
      completionRatio: 0.25,
      rulesFired: [],
      flagPoints: [],
      classifierPoints: 0,
      confidenceCapped: false,
      reasonCodes: [],
      fallbackWeightFlags: [],
      coverage: {
        checked: ["message", "website", "official", "reputation"],
        notChecked: ["payee"],
      },
    },
  },

  // Report
  {
    contract: "Report",
    schema: ReportSchema,
    name: "valid-report",
    data: {
      checkId: "11111111-1111-4111-8111-111111111111",
      riskLevel: "high",
      score: 85,
      confidence: "high",
      scamTypeGuess: "scholarship",
      language: "en",
      summary: "This offer shows major warning signs of an upfront fee scam.",
      flags: [
        {
          id: "scholarship_fee_demand",
          title: "Upfront Fee Demanded",
          severity: "high",
          explanation: "Fee requested before scholarship disbursement.",
          evidence: [{ type: "quote", value: "Pay 500 fee" }],
        },
      ],
      verified: ["Official domain does not exist"],
      couldNotCheck: [],
      notApplicable: ["reputation_osint"],
      checklist: [
        {
          text: "Check National Scholarship Portal at https://scholarships.gov.in",
          url: "https://scholarships.gov.in",
        },
      ],
      actions: [
        { id: "college_email", label: "Send template to college authority" },
        { id: "fraud_help", label: "View cybercrime reporting steps" },
      ],
      coverage: {
        checked: ["message", "website", "official"],
        notChecked: ["payee", "reputation"],
      },
      improveCheck: ["Provide official website URL or recruiter email address."],
      disclaimer: "This report is an automated risk assessment based on public facts and does not constitute a legal verdict.",
      generatedAt: "2026-10-20T00:05:00.000Z",
    },
  },
  {
    contract: "Report",
    schema: ReportSchema,
    name: "valid-report-cannot-verify",
    data: {
      checkId: "22222222-2222-4222-8222-222222222222",
      riskLevel: "cannot_verify",
      score: 15,
      confidence: "low",
      scamTypeGuess: "unknown",
      language: "en",
      summary: "We could not verify this offer due to insufficient details in public records.",
      flags: [],
      verified: [],
      couldNotCheck: ["website_forensics: domain offline"],
      notApplicable: [],
      checklist: [
        {
          text: "Ask the sender to contact you from an official corporate domain",
          url: null,
        },
      ],
      actions: [
        { id: "copy_checklist", label: "Copy verification checklist" },
      ],
      disclaimer: "This report is an automated risk assessment based on public facts and does not constitute a legal verdict.",
      generatedAt: "2026-10-20T00:05:00.000Z",
    },
  },

  // ProgressEvent & CheckEventRow
  {
    contract: "ProgressEvent",
    schema: ProgressEventSchema,
    name: "valid-agent-event",
    data: {
      type: "agent",
      round: 1,
      agent: "message_analyst",
      status: "completed",
    },
  },
  {
    contract: "ProgressEvent",
    schema: ProgressEventSchema,
    name: "valid-error-event",
    data: {
      type: "error",
      code: "BAD_REQUEST",
      message: "At least one input required",
    },
  },
  {
    contract: "CheckEventRow",
    schema: CheckEventRowSchema,
    name: "valid-event-row",
    data: {
      id: 1,
      checkId: "11111111-1111-4111-8111-111111111111",
      round: 1,
      type: "agent",
      agent: "message_analyst",
      status: "completed",
      summary: "Message Analyst completed with 1 flag",
      createdAt: "2026-10-20T00:02:00.000Z",
    },
  },
  {
    contract: "CheckEventRow",
    schema: CheckEventRowSchema,
    name: "valid-stage-event-row",
    data: {
      id: 2,
      checkId: "11111111-1111-4111-8111-111111111111",
      round: 0,
      type: "stage",
      summary: "Extraction started",
      createdAt: "2026-10-20T00:00:05.000Z",
    },
  },
  {
    contract: "CheckEventRow",
    schema: CheckEventRowSchema,
    name: "valid-activity-event-row",
    data: {
      id: 3,
      checkId: "11111111-1111-4111-8111-111111111111",
      seq: 1,
      round: 1,
      type: "activity",
      agent: "website_forensics",
      status: "ok",
      summary: "Looked up domain registration in RDAP",
      payloadJson: JSON.stringify({
        seq: 1,
        checkId: "11111111-1111-4111-8111-111111111111",
        ts: "2026-10-20T00:00:00.000Z",
        round: 1,
        agent: "website_forensics",
        type: "activity",
        entry: {
          seq: 0,
          atMs: 45,
          type: "step",
          status: "ok",
          title: "Looked up domain registration in RDAP",
          detail: "Domain registered 4 days ago",
          tool: "rdap",
          sources: [],
        },
      }),
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  },

  // ApiError
  {
    contract: "ApiError",
    schema: ApiErrorSchema,
    name: "valid-api-error-rate-limit",
    data: {
      code: "RATE_LIMITED",
      message: "Too many checks created from this IP. Please wait before retrying.",
    },
  },
  {
    contract: "ApiError",
    schema: ApiErrorSchema,
    name: "valid-api-error-not-found",
    data: {
      code: "NOT_FOUND",
      message: "Check id not found or has expired.",
      details: { checkId: "11111111-1111-4111-8111-111111111111" },
    },
  },

  // Feedback
  {
    contract: "Feedback",
    schema: FeedbackSchema,
    name: "valid-feedback-right",
    data: {
      id: 1,
      checkId: "11111111-1111-4111-8111-111111111111",
      verdict: "right",
      riskLevelShown: "high",
      comment: "Accurate assessment, they blocked me after asking about registration fees.",
      createdAt: "2026-10-20T00:10:00.000Z",
    },
  },
  {
    contract: "Feedback",
    schema: FeedbackSchema,
    name: "valid-feedback-wrong-anonymous",
    data: {
      verdict: "wrong",
      riskLevelShown: "cannot_verify",
      comment: null,
    },
  },
  {
    contract: "Feedback",
    schema: FeedbackSchema,
    name: "valid-feedback-with-outcome",
    data: {
      id: 2,
      checkId: "22222222-2222-4222-8222-222222222222",
      verdict: "right",
      outcome: "lost_money",
      riskLevelShown: "high",
      comment: "Lost Rs 1500 to registration fee scam.",
      createdAt: "2026-10-24T12:00:00.000Z",
    },
  },
  {
    contract: "FeedbackRequest",
    schema: FeedbackRequestSchema,
    name: "valid-feedback-request",
    data: {
      verdict: "right",
      outcome: "confirmed_scam",
      comment: "Confirmed scam opportunity.",
    },
  },
  {
    contract: "SaveToGraphRequest",
    schema: SaveToGraphRequestSchema,
    name: "valid-save-to-graph-request",
    data: {
      consent: true,
    },
  },
  {
    contract: "SaveToGraphResponse",
    schema: SaveToGraphResponseSchema,
    name: "valid-save-to-graph-response",
    data: {
      saved: 3,
      checkRef: "a1b2c3d4e5f67890a1b2c3d4e5f67890",
    },
  },

  // GraphNode, GraphEdge, GraphMatch
  {
    contract: "GraphNode",
    schema: GraphNodeSchema,
    name: "valid-graph-node",
    data: {
      id: 1,
      kind: "upi",
      value: "scammer@bankhandle",
      firstSeen: "2026-09-01T10:00:00.000Z",
      lastSeen: "2026-10-20T00:00:00.000Z",
      reportCount: 5,
    },
  },
  {
    contract: "GraphEdge",
    schema: GraphEdgeSchema,
    name: "valid-graph-edge",
    data: {
      id: 1,
      nodeA: 1,
      nodeB: 2,
      checkRef: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-10-20T00:00:00.000Z",
    },
  },
  {
    contract: "GraphMatch",
    schema: GraphMatchSchema,
    name: "valid-graph-match",
    data: {
      matched: true,
      nodeId: 1,
      kind: "upi",
      value: "scammer@bankhandle",
      reportCount: 5,
      connectedNodesCount: 2,
    },
  },

  // CaseFile
  {
    contract: "CaseFile",
    schema: CaseFileSchema,
    name: "valid-case-file-minimal",
    data: {
      check: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "created",
        currentRound: 0,
        language: "en",
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
        expiresAt: "2026-10-21T00:00:00.000Z",
      },
      inputs: [],
      entities: [],
      findings: [],
      events: [],
      control: {
        processedEntitiesByAgent: {},
      },
    },
  },
  {
    contract: "CaseFile",
    schema: CaseFileSchema,
    name: "valid-case-file-active",
    data: {
      check: {
        id: "11111111-1111-4111-8111-111111111111",
        status: "investigating",
        currentRound: 1,
        language: "en",
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:02:00.000Z",
        expiresAt: "2026-10-21T00:00:00.000Z",
      },
      inputs: [
        {
          id: 1,
          checkId: "11111111-1111-4111-8111-111111111111",
          type: "text",
          value: "Scholarship notification",
          createdAt: "2026-10-20T00:00:00.000Z",
        },
      ],
      entities: [
        {
          id: 1,
          checkId: "11111111-1111-4111-8111-111111111111",
          kind: "domain",
          value: "pm-scholarship.example",
          source: "user",
          round: 0,
          confirmed: true,
        },
      ],
      findings: [
        {
          id: 1,
          checkId: "11111111-1111-4111-8111-111111111111",
          agent: "website_forensics",
          kind: "check",
          round: 1,
          status: "ok",
          flags: [],
          verified: ["Domain resolved"],
          newEntities: [],
          processedEntities: ["domain:pm-scholarship.example"],
          unchecked: [],
          manualChecks: [],
          trace: [],
          notes: "Checked domain",
          durationMs: 120,
        },
      ],
      events: [
        {
          id: 1,
          checkId: "11111111-1111-4111-8111-111111111111",
          round: 1,
          type: "round",
          status: "started",
          createdAt: "2026-10-20T00:01:00.000Z",
        },
      ],
      control: {
        processedEntitiesByAgent: { website_forensics: ["domain:pm-scholarship.example"] },
      },
    },
  },

  // ToolResult
  {
    contract: "ToolResult",
    schema: ToolResultSchema,
    name: "tool-result-success",
    data: {
      ok: true,
      data: {
        registrationDate: "2024-01-15T00:00:00.000Z",
        registrar: "Example Registrar Ltd",
        ageDays: 1000,
      },
      cached: false,
      fetchedAt: "2026-10-20T12:00:00.000Z",
    },
  },
  {
    contract: "ToolResult",
    schema: ToolResultSchema,
    name: "tool-result-cached-success",
    data: {
      ok: true,
      data: { found: false },
      cached: true,
      fetchedAt: "2026-10-20T12:05:00.000Z",
    },
  },
  {
    contract: "ToolResult",
    schema: ToolResultSchema,
    name: "tool-result-failure-timeout",
    data: {
      ok: false,
      error: {
        code: "TIMEOUT",
        message: "RDAP lookup timed out after 10000ms",
      },
    },
  },
  {
    contract: "ToolResult",
    schema: ToolResultSchema,
    name: "tool-result-failure-no-key",
    data: {
      ok: false,
      error: {
        code: "NO_KEY",
        message: "URLHAUS_AUTH_KEY is not configured",
      },
    },
  },

  // 16. Actions
  {
    contract: "CollegeEmailRequest",
    schema: CollegeEmailRequestSchema,
    name: "valid-college-email-request-en",
    data: {
      recipientType: "placement_cell",
      language: "en",
    },
  },
  {
    contract: "CollegeEmailResponse",
    schema: CollegeEmailResponseSchema,
    name: "valid-college-email-response",
    data: {
      subject: "Verification Request: Suspicious Offer Assessment (Ref: 1234)",
      body: "Dear Placement Cell,\n\nI am forwarding details of an offer for verification.",
      recipientRole: "Training & Placement Officer",
      notes: [],
    },
  },
  {
    contract: "FraudSummaryRequest",
    schema: FraudSummaryRequestSchema,
    name: "valid-fraud-summary-request-full",
    data: {
      amount: 5000,
      date: "2026-10-01",
      paymentMethod: "upi",
      language: "en",
    },
  },
  {
    contract: "FraudSummaryResponse",
    schema: FraudSummaryResponseSchema,
    name: "valid-fraud-summary-response",
    data: {
      title: "Incident Summary for Cybercrime Reporting",
      narrative: "On 2026-10-01, an upfront fee of Rs. 5000 was requested via UPI.",
      victimSteps: [
        "Contact your bank or UPI provider immediately to freeze the transaction.",
        "File a formal complaint on the National Cyber Crime Reporting Portal.",
      ],
      reportingChannels: [
        {
          name: "National Cyber Crime Reporting Portal",
          url: null,
          helpline: null,
          verified: false,
          text: "Report incident to the National Cyber Crime Reporting Portal (verify on the official site)",
        },
      ],
    },
  },
  {
    contract: "Guide",
    schema: GuideSchema,
    name: "valid-scholarship-guide-fixture",
    data: {
      type: "scholarship_scam",
      title: "Recognizing Fake Scholarship Schemes",
      summary: "How to identify fraudulent scholarship notices demanding application and processing fees.",
      howItWorks: [
        "Unsolicited messages claim the recipient has been selected for a government or trust grant.",
        "A registration or processing fee is demanded to release the sanctioned funds.",
      ],
      redFlags: [
        "Upfront registration or disbursement fee demanded.",
        "Official Indian government scheme hosted on a non-.gov.in domain.",
        "Payment requested to a personal UPI ID.",
      ],
      whatToVerify: [
        "Verify the scheme on the National Scholarship Portal (scholarships.gov.in).",
        "Check whether your college administration or welfare department has received an official circular.",
      ],
      whatToDo: [
        "Never transfer money or share bank account credentials to claim a grant or scholarship.",
        "Check official portal directories before sharing personal details.",
      ],
      alreadyPaid: [
        "Contact your bank or UPI provider immediately to request an urgent transaction freeze.",
        "File an incident complaint on the National Cyber Crime Reporting Portal.",
      ],
      claims: [
        {
          claim: "Genuine government scholarships never charge an application or verification fee to disburse sanctioned funds.",
          sourceIds: ["nsp_portal"],
        },
      ],
      sources: [
        {
          id: "nsp_portal",
          title: "National Scholarship Portal (NSP)",
          publisher: "Ministry of Electronics and Information Technology, Government of India",
          url: "https://scholarships.gov.in",
          verified: false,
          retrievalNote: "Root portal URL recorded in repository manual links.",
        },
      ],
      reviewStatus: "draft_needs_review",
      language: "en",
      lastReviewed: "2026-10-25",
    },
  },
  {
    contract: "GuideSummary",
    schema: GuideSummarySchema,
    name: "valid-scholarship-guide-summary-fixture",
    data: {
      type: "scholarship_scam",
      title: "Recognizing Fake Scholarship Schemes",
      summary: "How to identify fraudulent scholarship notices demanding application and processing fees.",
    },
  },
];


