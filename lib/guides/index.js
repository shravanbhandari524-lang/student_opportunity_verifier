/**
 * lib/guides/index.js
 *
 * Loader, validator, and type-mapping module for educational guides.
 *
 * Guaranteed invariants:
 * - Pure code: no side-effects on import, no database access, no network calls.
 * - Validates all content with GuideSchema and GuideSummarySchema.
 * - Provides bidirectional mapping between Guide types, Report ScamTypeGuess, and SCAM_TYPES.
 */

import { GuideSchema, GuideSummarySchema } from "../contracts/guides.js";
import { GUIDES_CONTENT } from "./content.js";

/**
 * Bidirectional mapping between Guide types and related domain enums.
 *
 * MAPPING NOTE (Enum alignment & resolution):
 * 1. Exactly 6 unique guide types exist in GUIDE_TYPES and GUIDE_TYPE_MAPPINGS.
 * 2. Every scamTypeGuess in the table is an exact valid member of SCAM_TYPE_GUESSES.
 * 3. Domain SCAM_TYPES (used in classification and graph nodes) differs from ScamTypeGuess:
 *    - overseas_agent maps to domain scamType "generic_suspicious" because SCAM_TYPES lacks a dedicated overseas_agent enum.
 *    - internship_scam maps to domain scamType "recruitment_fraud" reflecting the broader recruitment category.
 * 4. Resolving a guide for a check report (via getGuideForScamTypeGuess) matches against
 *    report.scamTypeGuess directly (1-to-1 exact string match), guaranteeing that an overseas_agent
 *    or internship check always returns its dedicated educational guide without depending on domain scamType.
 */
export const GUIDE_TYPE_MAPPINGS = Object.freeze({
  scholarship_scam: {
    guideType: "scholarship_scam",
    scamTypeGuess: "scholarship",
    scamType: "scholarship_scam",
    label: "Fake Scholarship",
  },
  internship_scam: {
    guideType: "internship_scam",
    scamTypeGuess: "internship",
    scamType: "recruitment_fraud",
    label: "Fake Internship or Job",
  },
  task_scam: {
    guideType: "task_scam",
    scamTypeGuess: "task_job",
    scamType: "task_scam",
    label: "Task or Part-Time Job",
  },
  mule_account: {
    guideType: "mule_account",
    scamTypeGuess: "mule_offer",
    scamType: "mule_solicitation",
    label: "Money Mule Offer",
  },
  contest_fraud: {
    guideType: "contest_fraud",
    scamTypeGuess: "competition",
    scamType: "contest_fraud",
    label: "Fake Competition or Certificate",
  },
  overseas_agent: {
    guideType: "overseas_agent",
    scamTypeGuess: "overseas_agent",
    scamType: "generic_suspicious",
    label: "Overseas Study or Visa Agent",
  },
});

// Pre-validate all guides content to ensure schema conformity
const VALIDATED_GUIDES_MAP = new Map();
const VALIDATED_SUMMARIES = [];

for (const guide of GUIDES_CONTENT) {
  const parsed = GuideSchema.parse(guide);
  VALIDATED_GUIDES_MAP.set(parsed.type, parsed);
  VALIDATED_SUMMARIES.push(
    GuideSummarySchema.parse({
      type: parsed.type,
      title: parsed.title,
      summary: parsed.summary,
    })
  );
}

/**
 * Retrieves the list of all guide summaries.
 *
 * @returns {Array<import("../contracts/guides.js").GuideSummary>}
 */
export function listGuides() {
  return VALIDATED_SUMMARIES;
}

/**
 * Retrieves the full guide document for a specific guide type.
 *
 * @param {string} type
 * @returns {import("../contracts/guides.js").Guide | null}
 */
export function getGuideByType(type) {
  if (!type || typeof type !== "string") return null;
  return VALIDATED_GUIDES_MAP.get(type) || null;
}

/**
 * Finds a guide matching a report's scamTypeGuess.
 *
 * @param {string} scamTypeGuess
 * @returns {import("../contracts/guides.js").Guide | null}
 */
export function getGuideForScamTypeGuess(scamTypeGuess) {
  if (!scamTypeGuess) return null;
  for (const mapping of Object.values(GUIDE_TYPE_MAPPINGS)) {
    if (mapping.scamTypeGuess === scamTypeGuess) {
      return getGuideByType(mapping.guideType);
    }
  }
  return null;
}
