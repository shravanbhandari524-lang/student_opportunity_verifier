/**
 * Single source of truth for all domain enums.
 * Strictly mirrors docs/contracts.md section 2.
 */

export const CHECK_STATUSES = [
  "created",
  "extracting",
  "awaiting_confirmation",
  "investigating",
  "scoring",
  "report_ready",
  "failed",
];

export const ENTITY_KINDS = [
  "domain",
  "url",
  "upi",
  "email",
  "phone",
  "company",
  "handle",
  "amount",
  "youtube_url",
  "scheme",
];

export const ENTITY_SOURCES = [
  "extracted",
  "user",
  "discovered",
];

export const ORG_TYPES = [
  "government",
  "education",
  "bank",
  "company",
  "unknown",
];

export const INPUT_TYPES = [
  "text",
  "image",
  "url",
  "upi",
  "company",
  "handle",
  "phone",
  "youtube_url",
  "user_notes",
];

export const HANDLE_PLATFORMS = [
  "instagram",
  "telegram",
  "youtube",
  "reddit",
  "x",
  "other",
];

export const AGENT_NAMES = [
  "message_analyst",
  "website_forensics",
  "official_verifier",
  "reputation_osint",
  "payment_entity",
  "classifier_client",
];

export const AGENT_KINDS = [
  "check",
  "llm_call",
  "agent",
];

export const AGENT_STATUSES = [
  "ok",
  "skipped",
  "could_not_check",
];

export const SEVERITIES = [
  "low",
  "medium",
  "high",
];

export const RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "cannot_verify",
];

export const CONFIDENCE_LEVELS = [
  "low",
  "medium",
  "high",
];

export const SCAM_TYPES = [
  "scholarship_scam",
  "recruitment_fraud",
  "task_scam",
  "mule_solicitation",
  "contest_fraud",
  "loan_scam",
  "generic_suspicious",
  "unknown",
];

export const LANGUAGES = [
  "en",
  "hi",
];

export const FAILURE_REASON_CODES = [
  "extraction_error",
  "coordinator_pipeline_error",
  "server_restart",
  "unknown_error",
];

export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "NOT_FOUND",
  "RATE_LIMITED",
  "CHECK_EXPIRED",
  "CHECK_FAILED",
  "INTERNAL_ERROR",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "STATE_CONFLICT",
  "SERVICE_UNAVAILABLE",
  "CRAWLER_UNAVAILABLE",
  "CRAWL_NOT_ALLOWED",
];

export const CRAWL_ERROR_CODES = [
  "TIMEOUT",
  "DNS_FAILED",
  "BLOCKED_HOST",
  "BYTE_LIMIT",
  "TOO_MANY_PAGES",
  "ROBOTS_DENIED",
  "UPSTREAM_ERROR",
];

export const EVENT_TYPES = [
  "stage",
  "round",
  "agent",
  "complete",
  "error",
  "agent_status",
  "tool_start",
  "tool_end",
  "note",
  "flag",
  "verdict",
  "entity",
  "activity",
  "evidence_transfer",
];

export const FEEDBACK_VERDICTS = [
  "right",
  "wrong",
];

export const FEEDBACK_OUTCOMES = [
  "confirmed_scam",
  "confirmed_genuine",
  "lost_money",
  "not_sure",
];

export const TOOL_ERROR_CODES = [
  "TIMEOUT",
  "NETWORK",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "INVALID_INPUT",
  "BLOCKED",
  "NO_KEY",
  "AUTH",
  "BUDGET_EXCEEDED",
  "PARSE_ERROR",
];

export const RECIPIENT_TYPES = [
  "placement_cell",
  "dean_student_welfare",
  "department_head",
  "grievance_officer",
];

export const PAYMENT_METHODS = [
  "upi",
  "netbanking",
  "card",
  "wallet",
  "cash",
  "other",
];

export const GUIDE_TYPES = [
  "scholarship_scam",
  "internship_scam",
  "task_scam",
  "mule_account",
  "contest_fraud",
  "overseas_agent",
];

export const GUIDE_REVIEW_STATUSES = [
  "human_reviewed",
  "draft_needs_review",
];

export const OFFICIAL_VERDICTS = [
  "verified",
  "contradicted",
  "not_found",
  "unverified",
  "partial",
];

export const ENTITY_STATUSES = [
  "verified",
  "not_found",
  "unverified",
  "contradicted",
  "partial",
  "checked_no_issue",
  "skipped",
  "could_not_check",
  "test_domain",
];

export const AMOUNT_DIRECTIONS = [
  "to_candidate",
  "from_candidate",
  "unclear",
];

export const AMOUNT_PURPOSES = [
  "stipend/salary",
  "refundable deposit",
  "application fee",
  "registration charge",
  "registration fee",
  "security deposit",
  "document verification",
  "processing charge",
  "training kit",
  "advance payment",
  "other",
];

export const OSINT_RESULT_STATES = [
  "no_relevant_results",
  "no_negative_reports_found",
  "supporting_evidence_found",
  "search_unavailable",
  "search_timed_out",
];


