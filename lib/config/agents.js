/**
 * lib/config/agents.js
 *
 * Single source of truth for specialist agent display names and ordering.
 * Used consistently across API responses, coordinator fallback generation,
 * and frontend UI components.
 */

export const AGENT_ORDER = Object.freeze([
  "message_analyst",
  "classifier_client",
  "website_forensics",
  "payment_entity",
  "official_verifier",
  "reputation_osint",
]);

export const AGENT_DISPLAY_NAMES = Object.freeze({
  message_analyst: "Message & Offer Analyst",
  classifier_client: "ML Scam Classifier",
  website_forensics: "Domain & Web Forensics",
  payment_entity: "Payment & UPI Verifier",
  official_verifier: "Official Registry Verifier",
  reputation_osint: "Community & OSINT Search",
});

/**
 * Returns human-readable display name for an agent identifier.
 *
 * @param {string} agent
 * @returns {string}
 */
export function getAgentDisplayName(agent) {
  return AGENT_DISPLAY_NAMES[agent] || agent;
}
