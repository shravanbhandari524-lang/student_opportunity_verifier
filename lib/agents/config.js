/**
 * Configuration constants for L4 Specialist Agents.
 * Frozen at load.
 */

export const AGENT_TIMEOUT_MS = 25000;
export const MAX_FLAGS_PER_AGENT = 20;
export const MAX_NEW_ENTITIES = 5;
export const ALLOWED_DISCOVERY_KINDS = Object.freeze(["domain", "handle", "company"]);
export const CLASSIFIER_HIGH_THRESHOLD = 0.80;
export const PAYMENT_SEARCH_BUDGET = 4;
export const DOMAIN_NEW_DAYS = 30;
export const WEBSITE_MAX_DOMAINS_PER_RUN = 3;
export const WEBSITE_FETCH_BUDGET = 2;
export const OFFICIAL_SEARCH_BUDGET = 4;
export const OFFICIAL_FETCH_BUDGET = 2;
export const OFFICIAL_CLAIM_TERMS = Object.freeze([
  "government of india",
  "ministry of",
  "national scholarship",
  "pib",
  "dbt",
]);
export const REPUTATION_SEARCH_BUDGET = 6;
export const REPUTATION_SCAM_WORDS = Object.freeze([
  "scam",
  "fraud",
  "fake",
  "cheated",
  "complaint",
  "not paid",
  "not paying",
]);
export const REPUTATION_PROXIMITY_CHARS = 120;
export const YOUTUBE_BURST_THRESHOLD = 0.60;
export const RECRUITMENT_CONTEXT_TERMS = Object.freeze([
  "internship",
  "job offer",
  "recruiter",
  "recruitment",
  "hiring",
  "selected",
]);

/**
 * Big, highly-targeted enterprise brands that frequently attract generic job/internship impersonation warnings.
 * For these brands, a scam_reports_found flag requires that the search result mentions a specific identifier
 * from the check (domain, handle, UPI ID, phone, etc.), rather than just the generic brand name.
 */
export const BIG_BRANDS = Object.freeze(new Set([
  "google",
  "microsoft",
  "amazon",
  "apple",
  "meta",
  "tcs",
  "tata consultancy services",
  "infosys",
  "wipro",
  "flipkart",
  "reliance",
  "jio",
  "accenture",
  "cognizant",
  "hcl",
  "ibm",
  "capgemini",
  "tech mahindra",
]));

/**
 * Official government bodies, statutory education regulators, official scholarship/internship portals,
 * major public/private banks, and large enterprise brands.
 *
 * For an entity on this list, or verified official (curated domain list or .gov.in), scam-report
 * search results about the brand or portal are context only and never raise scam_reports_found;
 * only identifier-specific matches (the exact suspicious domain, UPI ID, phone or handle) can.
 * Advisories about impersonators must not count against the real portal.
 */
export const OFFICIAL_BODIES_AND_PORTALS = Object.freeze(new Set([
  // Regulators and Portals
  "nsp",
  "national scholarship portal",
  "scholarships.gov.in",
  "ugc",
  "ugc.ac.in",
  "ugc.gov.in",
  "university grants commission",
  "aicte",
  "aicte-india.org",
  "internship.aicte-india.org",
  "all india council for technical education",
  "pib",
  "pib.gov.in",
  "factcheck.pib.gov.in",
  "press information bureau",
  "nta",
  "nta.ac.in",
  "national testing agency",
  "buddy4study",
  "buddy4study.com",
  "internshala",
  "internshala.com",
  "naukri",
  "naukri.com",
  "unstop",
  "unstop.com",

  // Government & Ministries
  "government of india",
  "ministry of education",
  "mhrd",
  "department of higher education",
  "ministry of electronics and information technology",
  "meity",
  "ministry of finance",
  "ministry of labour and employment",
  "department of science and technology",
  "dst",
  "department of biotechnology",
  "dbt",
  "csir",
  "drdo",
  "isro",

  // Major Banks
  "state bank of india",
  "sbi",
  "sbi.co.in",
  "onlinesbi.sbi",
  "hdfc",
  "hdfc bank",
  "hdfcbank.com",
  "icici",
  "icici bank",
  "icicibank.com",
  "axis bank",
  "axisbank.com",
  "punjab national bank",
  "pnb",
  "pnbindia.in",
  "canara bank",
  "canarabank.com",
  "bank of baroda",
  "bankofbaroda.in",
  "reserve bank of india",
  "rbi",
  "rbi.org.in",

  // All BIG_BRANDS
  ...BIG_BRANDS,
]));

/**
 * Fee-type flag IDs eligible for false-positive negation protection in message_analyst.
 */
export const FEE_FLAG_IDS = Object.freeze([
  "scholarship_fee_demand",
  "fee_demand",
  "task_deposit_script",
  "crypto_payment_request",
  "paid_placement_guarantee",
]);

/**
 * Negation phrases and patterns indicating absence of fee or exemption.
 * Matches phrases like "no application fee", "never required", "free of charge", "is not required", etc.
 */
export const FEE_NEGATION_PATTERNS = Object.freeze([
  /\bno\s+(?:application\s+|registration\s+|processing\s+|upfront\s+|verification\s+)?(?:fee|deposit|charge|cost|payment)\b/i,
  /\b(?:fee|deposit|charge|cost|payment)\s+(?:is\s+|are\s+)?(?:not\s+|never\s+)?(?:required|needed|mandatory|applicable)\b/i,
  /\bnot\s+require(?:d)?\b/i,
  /\bnever\s+require(?:d)?\b/i,
  /\bfree\s+of\s+charge\b/i,
  /\bwithout\s+(?:any\s+)?(?:fee|charge|deposit|cost|payment)\b/i,
  /\b(?:zero|nil)\s+(?:application\s+|registration\s+|processing\s+|upfront\s+|verification\s+)?(?:fee|cost|charge|deposit)\b/i,
  /\b(?:fee|charge|deposit)\s+(?:is\s+)?waived\b/i,
  /\bexempt(?:ed)?\s+from\s+(?:any\s+)?(?:fee|payment|charge)\b/i,
  /\b(?:do|does|did)\s+not\s+charge\b/i,
  /\bno\s+fee\b/i,
]);

/**
 * Contrast words that introduce an exception or pivot after a negation.
 */
export const CONTRAST_WORDS = Object.freeze([
  "but",
  "however",
  "only",
  "except",
  "though",
  "although",
  "yet",
]);

/**
 * Payment request signals that forbid fee negation suppression.
 * A fee-type flag is NEVER dropped if any of these signals appear in the quote or its clause.
 */
export const PAYMENT_REQUEST_SIGNALS = Object.freeze([
  // Currency amounts: Rs, INR, rupees, ₹ followed or preceded by numbers
  /(?:\b(?:rs\.?|inr|rupees?)|₹)\s*\d+/i,
  /\d+\s*(?:(?:rs\.?|inr|rupees?)\b|₹)/i,
  // Bare numbers next to fee/deposit terms
  /\b\d+\s*(?:fee|deposit|charge|cost|payment)\b/i,
  /\b(?:fee|deposit|charge|cost|payment)\s*(?:of\s*)?\d+\b/i,
  // Payment action verbs
  /\b(?:pay|send|transfer|submit|remit|deposit\s+to|must\s+be\s+paid|is\s+payable)\b/i,
  // UPI identifiers (username@handle)
  /[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}/i,
  // Specific payment demand phrases
  /\b(?:refundable|advance|processing\s+charge|security\s+deposit|token\s+amount)\b/i,
]);

export const agentConfig = Object.freeze({
  AGENT_TIMEOUT_MS,
  MAX_FLAGS_PER_AGENT,
  MAX_NEW_ENTITIES,
  ALLOWED_DISCOVERY_KINDS,
  CLASSIFIER_HIGH_THRESHOLD,
  PAYMENT_SEARCH_BUDGET,
  DOMAIN_NEW_DAYS,
  WEBSITE_MAX_DOMAINS_PER_RUN,
  WEBSITE_FETCH_BUDGET,
  OFFICIAL_SEARCH_BUDGET,
  OFFICIAL_FETCH_BUDGET,
  OFFICIAL_CLAIM_TERMS,
  REPUTATION_SEARCH_BUDGET,
  REPUTATION_SCAM_WORDS,
  REPUTATION_PROXIMITY_CHARS,
  YOUTUBE_BURST_THRESHOLD,
  RECRUITMENT_CONTEXT_TERMS,
  FEE_FLAG_IDS,
  FEE_NEGATION_PATTERNS,
  CONTRAST_WORDS,
  PAYMENT_REQUEST_SIGNALS,
});

