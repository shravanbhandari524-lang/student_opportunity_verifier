/**
 * Flag Registry: 36 fixed flags.
 * Strictly mirrors docs/contracts.md section 4.
 */

const RAW_FLAG_REGISTRY = {
  // --- High Severity (17 flags) ---
  scholarship_fee_demand: {
    id: "scholarship_fee_demand",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Upfront fee demanded for a scholarship offer (Hard rule)",
    groups: ["fee"],
  },
  fee_demand: {
    id: "fee_demand",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Registration, training, certificate, or security deposit fee demanded before or after selection",
    groups: ["fee", "fee_equipment"],
  },
  equipment_advance: {
    id: "equipment_advance",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Fake check or direct demand for home-office/laptop equipment purchase advance",
    groups: ["fee_equipment"],
  },
  mule_account_request: {
    id: "mule_account_request",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Soliciting bank account rental, SIM card handover, or ATM card forwarding (Hard rule)",
    groups: [],
  },
  bank_details_request: {
    id: "bank_details_request",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Requesting bank password, net banking credentials, ATM PIN, or card details",
    groups: [],
  },
  otp_or_id_request: {
    id: "otp_or_id_request",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Soliciting OTP, Aadhaar, PAN, or personal credentials for verification",
    groups: [],
  },
  authority_impersonation: {
    id: "authority_impersonation",
    severity: "high",
    emitters: ["message_analyst", "official_verifier"],
    description: "Posing as an official ministry, government authority, or reputable institution",
    groups: [],
  },
  task_deposit_script: {
    id: "task_deposit_script",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Small payout followed by mandatory deposit for VIP/premium tasks",
    groups: [],
  },
  crypto_payment_request: {
    id: "crypto_payment_request",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Payment, deposit, or task recharge demanded in cryptocurrency or stablecoins",
    groups: ["fee"],
  },
  paid_placement_guarantee: {
    id: "paid_placement_guarantee",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Upfront fee or paid training course promising 100% guaranteed job placement",
    groups: ["fee"],
  },
  apk_download_prompt: {
    id: "apk_download_prompt",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Prompting user to download or install an out-of-store Android APK",
    groups: [],
  },
  url_in_threat_feed: {
    id: "url_in_threat_feed",
    severity: "high",
    emitters: ["website_forensics", "reputation_osint"],
    description: "URL or host confirmed in a threat feed (URLhaus, urlscan). A miss is not a flag",
    groups: [],
  },
  qr_code_payment_request: {
    id: "qr_code_payment_request",
    severity: "high",
    emitters: ["message_analyst"],
    description: "Sending a QR code to receive funds (reverse UPI collection fraud)",
    groups: [],
  },
  lookalike_domain: {
    id: "lookalike_domain",
    severity: "high",
    emitters: ["website_forensics"],
    description: "Domain visually or phonetically impersonating a legitimate institution",
    groups: [],
  },
  non_gov_domain_claiming_gov: {
    id: "non_gov_domain_claiming_gov",
    severity: "high",
    emitters: ["official_verifier", "website_forensics"],
    description: "Claiming to be an official Indian government scheme on a non-.gov.in domain",
    groups: [],
  },
  personal_payment_id: {
    id: "personal_payment_id",
    severity: "high",
    emitters: ["payment_entity", "message_analyst"],
    description: "Payment requested to a personal UPI handle or individual bank account",
    groups: [],
  },
  official_warning_found: {
    id: "official_warning_found",
    severity: "high",
    emitters: ["official_verifier", "reputation_osint"],
    description: "PIB Fact Check or institution advisory warning against this specific offer",
    groups: [],
  },
  scam_reports_found: {
    id: "scam_reports_found",
    severity: "high",
    emitters: ["reputation_osint", "payment_entity"],
    description: "Multiple corroborated public scam complaints on forums, Reddit, or consumer sites",
    groups: [],
  },
  graph_match: {
    id: "graph_match",
    severity: "high",
    emitters: ["payment_entity"],
    description: "Identifier matches known scam entity in the scam intelligence graph (Hard rule)",
    groups: [],
  },
  domain_company_mismatch: {
    id: "domain_company_mismatch",
    severity: "high",
    emitters: ["official_verifier"],
    description: "Domain contains claimed company brand but is not the company's verified official domain",
    groups: [],
  },

  // --- Medium Severity (12 flags) ---
  no_interview_selection: {
    id: "no_interview_selection",
    severity: "medium",
    emitters: ["message_analyst"],
    description: "Direct selection or job offer letter issued without interview or application",
    groups: ["hiring_process"],
  },
  unsolicited_award: {
    id: "unsolicited_award",
    severity: "medium",
    emitters: ["message_analyst"],
    description: "Winning a competition or scholarship never entered, requiring claiming fee or details",
    groups: [],
  },
  chat_only_interview: {
    id: "chat_only_interview",
    severity: "medium",
    emitters: ["message_analyst"],
    description: "Hiring interview conducted entirely via Telegram, WhatsApp, or text chat",
    groups: ["hiring_process"],
  },
  pay_too_high: {
    id: "pay_too_high",
    severity: "medium",
    emitters: ["message_analyst"],
    description: "Compensation disproportionately high relative to unskilled or basic task complexity",
    groups: ["pay"],
  },
  guaranteed_income: {
    id: "guaranteed_income",
    severity: "medium",
    emitters: ["message_analyst"],
    description: "Unrealistic promises of guaranteed daily/weekly earnings for minimal effort",
    groups: [],
  },
  free_email_recruiter: {
    id: "free_email_recruiter",
    severity: "medium",
    emitters: ["payment_entity", "message_analyst"],
    description: "Recruiter contacting from free webmail claiming enterprise identity",
    groups: [],
  },
  domain_new: {
    id: "domain_new",
    severity: "medium",
    emitters: ["website_forensics"],
    description: "Website domain registered fewer than 30 days ago",
    groups: [],
  },
  raw_ip_opportunity_link: {
    id: "raw_ip_opportunity_link",
    severity: "medium",
    emitters: ["website_forensics"],
    description: "Opportunity, application, or portal link uses a raw IP address instead of a registered domain",
    groups: [],
  },
  not_on_official_portal: {
    id: "not_on_official_portal",
    severity: "medium",
    emitters: ["official_verifier"],
    description: "Claimed scholarship or program absent from official portal",
    groups: [],
  },
  review_burst: {
    id: "review_burst",
    severity: "medium",
    emitters: ["reputation_osint"],
    description: "Suspicious temporal cluster of identical 5-star reviews on Trustpilot/YouTube",
    groups: [],
  },
  copied_content: {
    id: "copied_content",
    severity: "medium",
    emitters: ["website_forensics", "reputation_osint"],
    description: "Verbatim about-us or policy text copied from another established organization",
    groups: [],
  },
  data_harvest_redirects: {
    id: "data_harvest_redirects",
    severity: "medium",
    emitters: ["website_forensics"],
    description: "Excessive redirects to ad networks, affiliate links, or external data collection forms",
    groups: [],
  },
  classifier_high: {
    id: "classifier_high",
    severity: "medium",
    emitters: ["classifier_client"],
    description: "ML classifier scam probability > 0.80 (Weight is 0 in scoring; informational)",
    groups: [],
  },
  unpaid_trial_work: {
    id: "unpaid_trial_work",
    severity: "medium",
    emitters: ["message_analyst"],
    description: "Requiring extensive uncompensated trial labor, multi-day spec work, or production features before hiring",
    groups: ["hiring_process"],
  },
  referral_recruitment: {
    id: "referral_recruitment",
    severity: "medium",
    emitters: ["message_analyst"],
    description: "Mandatory recruitment of friends or downline referrals to qualify for tasks, payouts, or tiers",
    groups: [],
  },
  brand_handle_lookalike: {
    id: "brand_handle_lookalike",
    severity: "medium",
    emitters: ["reputation_osint"],
    description: "Social media or messaging handle mimics an established brand with recruitment keywords",
    groups: [],
  },

  // --- Low Severity (7 flags) ---
  candidate_picks_hours: {
    id: "candidate_picks_hours",
    severity: "low",
    emitters: ["message_analyst"],
    description: "Complete freedom over work hours and workload with guaranteed fixed compensation",
    groups: ["hiring_process"],
  },
  unusual_pay_schedule: {
    id: "unusual_pay_schedule",
    severity: "low",
    emitters: ["message_analyst"],
    description: "Daily, hourly, or instant UPI disbursement offered to lure student commitment",
    groups: ["pay"],
  },
  urgency_pressure: {
    id: "urgency_pressure",
    severity: "low",
    emitters: ["message_analyst"],
    description: "Artificial countdown or deadline pressure to act before verifying",
    groups: [],
  },
  off_platform_contact: {
    id: "off_platform_contact",
    severity: "low",
    emitters: ["message_analyst"],
    description: "Pressure to move communication to personal Telegram or WhatsApp channels",
    groups: [],
  },
  domain_no_history: {
    id: "domain_no_history",
    severity: "low",
    emitters: ["website_forensics"],
    description: "Domain has no prior archived snapshot records in the Wayback Machine",
    groups: [],
  },
  ssl_anomaly: {
    id: "ssl_anomaly",
    severity: "low",
    emitters: ["website_forensics"],
    description: "Missing, self-signed, invalid, or mismatched SSL/TLS certificate",
    groups: [],
  },
  foreign_or_voip_number: {
    id: "foreign_or_voip_number",
    severity: "low",
    emitters: ["payment_entity"],
    description: "Non-Indian country code or a number type reported as VoIP or unknown",
    groups: [],
  },
};

// Deep freeze FLAG_REGISTRY
for (const entry of Object.values(RAW_FLAG_REGISTRY)) {
  Object.freeze(entry.emitters);
  Object.freeze(entry.groups);
  Object.freeze(entry);
}
export const FLAG_REGISTRY = Object.freeze(RAW_FLAG_REGISTRY);

/**
 * Flag Groups: definitions for suppression, mutual exclusion, and correlation caps.
 */
export const FLAG_GROUPS = Object.freeze({
  fee: Object.freeze(["scholarship_fee_demand", "fee_demand"]),
  fee_equipment: Object.freeze(["fee_demand", "equipment_advance"]),
  hiring_process: Object.freeze(["chat_only_interview", "no_interview_selection", "candidate_picks_hours"]),
  pay: Object.freeze(["pay_too_high", "unusual_pay_schedule"]),
});

/**
 * Correlation group caps.
 */
export const FLAG_GROUP_CAPS = Object.freeze({
  hiring_process: 20,
  pay: 20,
});

/**
 * Soft flag cap (maximum total points from low and medium severity flags).
 */
export const SOFT_FLAG_CAP = 45;

/**
 * No-high-evidence cap (maximum final score without high-severity flag, hard rule, or graph match).
 */
export const NO_HIGH_EVIDENCE_CAP = 59;

/**
 * Checks whether an ID is registered in the fixed flag registry.
 * @param {string} id
 * @returns {boolean}
 */
export function isFlagId(id) {
  return Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, id);
}

/**
 * Returns the default severity for a valid flag id, or null if unknown.
 * @param {string} id
 * @returns {"low" | "medium" | "high" | null}
 */
export function defaultSeverity(id) {
  return FLAG_REGISTRY[id]?.severity ?? null;
}

/**
 * Checks whether a given agent is permitted to emit the specified flag.
 * @param {string} flagId
 * @param {string} agent
 * @returns {boolean}
 */
export function canEmit(flagId, agent) {
  const meta = FLAG_REGISTRY[flagId];
  if (!meta) return false;
  return meta.emitters.includes(agent);
}

/**
 * Returns the correlation or suppression groups that a flag belongs to.
 * @param {string} id
 * @returns {readonly string[]}
 */
export function getFlagGroups(id) {
  return FLAG_REGISTRY[id]?.groups ?? [];
}
