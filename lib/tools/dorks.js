/**
 * lib/tools/dorks.js
 *
 * Search dork query builders for Layer L2 reputation/OSINT checks.
 *
 * Rules:
 * - Pure functions returning search query strings.
 * - Input sanitization: strips double quotes, parentheses, newlines, and search operators (site:, inurl:, etc.),
 *   trims whitespace, and caps length at 100 characters.
 * - If input is empty after sanitization, throws or returns null/empty. To keep functions safe, returns empty string.
 */

const OPERATOR_REGEX = /\b(site|inurl|intitle|filetype|cache|related):/gi;
const STRIP_PUNCT_REGEX = /["'()\[\]{}<>\\\/^~*+]/g;

/**
 * Sanitizes input text for search dork query building.
 *
 * @param {string} text
 * @param {number} [maxLen=100]
 * @returns {string}
 */
export function sanitizeQueryText(text, maxLen = 100) {
  if (typeof text !== "string") return "";
  let clean = text
    .replace(OPERATOR_REGEX, "")
    .replace(STRIP_PUNCT_REGEX, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length > maxLen) {
    clean = clean.slice(0, maxLen).trim();
  }
  return clean;
}

/**
 * Builds query for scam reports on a brand or company.
 * Example: 'scam OR fraud OR fake "BrandName"'
 *
 * @param {string} brand
 * @returns {string}
 */
export function buildScamQuery(brand) {
  const clean = sanitizeQueryText(brand);
  if (!clean) return "";
  // Free-tier search providers reject quoted domain patterns like `"domain.com" scam`
  // If the identifier contains dots (e.g. domain name), do not enclose in quotes.
  const target = clean.includes(".") ? clean : `"${clean}"`;
  return `${target} scam OR fraud OR fake OR "not paying"`;
}

/**
 * Builds query for Reddit discussions about an entity or brand.
 * Example: 'site:reddit.com "BrandName" scam OR legit'
 *
 * @param {string} brand
 * @returns {string}
 */
export function buildRedditQuery(brand) {
  const clean = sanitizeQueryText(brand);
  if (!clean) return "";
  return `site:reddit.com "${clean}" scam OR legit OR review`;
}

/**
 * Builds query for Trustpilot reviews.
 * Example: 'site:trustpilot.com/review "BrandName"'
 *
 * @param {string} brand
 * @returns {string}
 */
export function buildTrustpilotQuery(brand) {
  const clean = sanitizeQueryText(brand);
  if (!clean) return "";
  return `site:trustpilot.com/review "${clean}"`;
}

/**
 * Builds query across consumer complaint platforms (ConsumerComplaints.in, MouthShut, CyberComplaints).
 *
 * @param {string} brand
 * @returns {string}
 */
export function buildComplaintSitesQuery(brand) {
  const clean = sanitizeQueryText(brand);
  if (!clean) return "";
  return `(site:consumercomplaints.in OR site:mouthshut.com) "${clean}"`;
}

/**
 * Builds a query to find external reviews/complaints about an entity.
 * Free-tier search providers (e.g. Serper free tier) reject the '-site:' operator with HTTP 400.
 * Host exclusion is performed in code by the calling agent.
 *
 * @param {string} brand
 * @param {string} [targetDomain]
 * @returns {string}
 */
export function buildMinusSiteQuery(brand, targetDomain) {
  const cleanBrand = sanitizeQueryText(brand);
  if (!cleanBrand) return "";
  const target = cleanBrand.includes(".") ? cleanBrand : `"${cleanBrand}"`;
  return `${target} scam OR review OR complaint`;
}

/**
 * Builds query for quoted distinctive phrases (e.g. from offer letters or message text).
 *
 * @param {string} phrase
 * @returns {string}
 */
export function buildQuotedPhraseQuery(phrase) {
  const clean = sanitizeQueryText(phrase, 80);
  if (!clean) return "";
  return `"${clean}"`;
}

/**
 * Builds query for UPI fraud / scam complaints.
 * Example: '"user@upi" scam OR fraud OR "cyber crime"'
 *
 * @param {string} upiId
 * @returns {string}
 */
export function buildUpiQuery(upiId) {
  const clean = sanitizeQueryText(upiId, 60);
  if (!clean) return "";
  return `"${clean}" scam OR fraud OR cybercrime OR complaint`;
}

/**
 * Builds query to check official Indian government schemes or mentions.
 * Example: 'site:gov.in "Scheme Name"'
 *
 * @param {string} schemeOrOrg
 * @returns {string}
 */
export function buildGovSchemeQuery(schemeOrOrg) {
  const clean = sanitizeQueryText(schemeOrOrg);
  if (!clean) return "";
  return `site:gov.in "${clean}"`;
}

/**
 * Builds query for Press Information Bureau (PIB) fact checks.
 * Example: 'site:pib.gov.in/factcheck OR "PIB Fact Check" "ClaimOrOrg"'
 *
 * @param {string} claimOrOrg
 * @returns {string}
 */
export function buildPibFactCheckQuery(claimOrOrg) {
  const clean = sanitizeQueryText(claimOrOrg);
  if (!clean) return "";
  return `("PIB Fact Check" OR site:factcheck.pib.gov.in) "${clean}"`;
}
