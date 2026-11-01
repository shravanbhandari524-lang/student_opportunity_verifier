/**
 * lib/evidence/source-classifier.js
 *
 * Source classification engine for web intelligence and evidence links.
 * Pure code: no network, no DB, no LLM, no external dependencies.
 */

export const SOURCE_TYPES = [
  "authoritative",
  "complaint",
  "forum",
  "aggregator",
  "unrelated",
];

export const SOURCE_TYPE_LABELS = {
  authoritative: "Official / Authoritative",
  complaint: "Complaint Platform",
  forum: "Forum / Q&A",
  aggregator: "Caller-ID Aggregator",
  unrelated: "External Source",
};

const ESTABLISHED_NEWS_DOMAINS = new Set([
  "thehindu.com",
  "www.thehindu.com",
  "indianexpress.com",
  "www.indianexpress.com",
  "timesofindia.indiatimes.com",
  "economictimes.indiatimes.com",
  "ndtv.com",
  "www.ndtv.com",
  "hindustantimes.com",
  "www.hindustantimes.com",
  "livemint.com",
  "www.livemint.com",
  "theprint.in",
  "www.theprint.in",
  "reuters.com",
  "www.reuters.com",
  "bbc.com",
  "www.bbc.com",
  "bbc.co.uk",
  "www.bbc.co.uk",
  "deccanherald.com",
  "www.deccanherald.com",
  "telegraphindia.com",
  "www.telegraphindia.com",
  "scroll.in",
  "thewire.in",
]);

const COMPLAINT_PLATFORM_DOMAINS = new Set([
  "consumercomplaints.in",
  "www.consumercomplaints.in",
  "complaintboard.in",
  "www.complaintboard.in",
  "scamvoid.net",
  "www.scamvoid.net",
  "trustpilot.com",
  "www.trustpilot.com",
  "mouthshut.com",
  "www.mouthshut.com",
  "complaintsboard.com",
  "www.complaintsboard.com",
  "sitejabber.com",
  "www.sitejabber.com",
  "complaintwire.org",
  "www.complaintwire.org",
]);

const FORUM_DOMAINS = new Set([
  "quora.com",
  "www.quora.com",
  "reddit.com",
  "www.reddit.com",
  "facebook.com",
  "www.facebook.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "instagram.com",
  "www.instagram.com",
  "linkedin.com",
  "www.linkedin.com",
  "t.me",
  "telegram.org",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "medium.com",
  "www.medium.com",
]);

const AGGREGATOR_DOMAINS = new Set([
  "truecaller.com",
  "www.truecaller.com",
  "tellows.in",
  "www.tellows.in",
  "tellows.com",
  "www.tellows.com",
  "who-called.co.uk",
  "www.who-called.co.uk",
  "spamcalls.net",
  "www.spamcalls.net",
  "sync.me",
  "www.sync.me",
  "callfilter.app",
  "phonedetective.com",
]);

/**
 * Extracts and normalizes the hostname from a URL string.
 *
 * @param {string} urlStr
 * @returns {string} Hostname in lowercase, without leading 'www.' if not needed
 */
export function extractHostname(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return "";
  try {
    const parsed = new URL(urlStr.startsWith("http://") || urlStr.startsWith("https://") ? urlStr : `https://${urlStr}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Checks if a given hostname belongs to an official government or public authority.
 *
 * @param {string} host
 * @returns {boolean}
 */
export function isGovernmentHost(host) {
  if (!host || typeof host !== "string") return false;
  const h = host.toLowerCase().trim();
  return (
    h.endsWith(".gov.in") ||
    h.endsWith(".nic.in") ||
    h.endsWith(".gov") ||
    h.endsWith(".mil") ||
    h === "pib.gov.in" ||
    h.endsWith(".pib.gov.in") ||
    h === "cbi.gov.in" ||
    h.endsWith(".cbi.gov.in") ||
    h === "cert-in.org.in" ||
    h.endsWith(".cert-in.org.in") ||
    h === "cybercrime.gov.in" ||
    h.endsWith(".cybercrime.gov.in")
  );
}

/**
 * Classifies a URL or web source.
 *
 * @param {string} urlStr - Target URL
 * @param {string} [title=""] - Optional page title
 * @param {string} [snippet=""] - Optional search snippet
 * @returns {{
 *   type: "authoritative" | "complaint" | "forum" | "aggregator" | "unrelated",
 *   label: string,
 *   hostname: string,
 *   isAuthoritative: boolean,
 *   isComplaint: boolean,
 *   isForumOrAggregator: boolean
 * }}
 */
export function classifySource(urlStr, title = "", snippet = "") {
  const host = extractHostname(urlStr);

  if (isGovernmentHost(host) || ESTABLISHED_NEWS_DOMAINS.has(host)) {
    return {
      type: "authoritative",
      label: SOURCE_TYPE_LABELS.authoritative,
      hostname: host,
      isAuthoritative: true,
      isComplaint: false,
      isForumOrAggregator: false,
    };
  }

  if (COMPLAINT_PLATFORM_DOMAINS.has(host)) {
    return {
      type: "complaint",
      label: SOURCE_TYPE_LABELS.complaint,
      hostname: host,
      isAuthoritative: false,
      isComplaint: true,
      isForumOrAggregator: false,
    };
  }

  if (FORUM_DOMAINS.has(host)) {
    return {
      type: "forum",
      label: SOURCE_TYPE_LABELS.forum,
      hostname: host,
      isAuthoritative: false,
      isComplaint: false,
      isForumOrAggregator: true,
    };
  }

  if (AGGREGATOR_DOMAINS.has(host)) {
    return {
      type: "aggregator",
      label: SOURCE_TYPE_LABELS.aggregator,
      hostname: host,
      isAuthoritative: false,
      isComplaint: false,
      isForumOrAggregator: true,
    };
  }

  return {
    type: "unrelated",
    label: SOURCE_TYPE_LABELS.unrelated,
    hostname: host,
    isAuthoritative: false,
    isComplaint: false,
    isForumOrAggregator: false,
  };
}
