/**
 * lib/tools/lookalike.js
 *
 * Deterministic domain lookalike and spoofing detection.
 *
 * Checks:
 * - Edit distance (Levenshtein distance <= 2) against known target domains.
 * - Homoglyph and visual skeleton substitution:
 *     ASCII: rn <-> m, 0 <-> o, 1 <-> l <-> i, vv <-> w, cl <-> d, 5 <-> s, 8 <-> b
 *     Cyrillic confusables: а, с, е, о, р, х, у, і, ј, ѕ, ԁ, ԝ
 *     Greek confusables: α, β, ε, ι, κ, ο, ρ, υ, ν, τ, χ, ω
 * - Punycode (IDN) representation check using domainToUnicode.
 * - Brand or institution name combined with extra authority/opportunity tokens across hyphens and subdomain labels:
 *     e.g. "tcs-careers-india.in", "infosys-careers-portal-india.com", "iitb-gov.in", "ugc-portal.com"
 * - Same brand label under a different, suspicious TLD (e.g. "infosys.xyz" instead of "infosys.com").
 * - Exclusion of generic dictionary words (scholarships, education, careers, jobs, portal) from brand label spoofing.
 *
 * Non-match rules:
 * - Exact match of known domain is NOT a lookalike match.
 * - Legitimate subdomains of known domain (e.g. "internship.aicte-india.org" of "aicte-india.org") are NOT lookalike matches.
 * - Generic dictionary words under alternative TLDs (e.g. "scholarships.com") are NOT lookalike matches.
 *
 * Pure function: no I/O, no network, no LLM.
 */

import { domainToASCII, domainToUnicode } from "node:url";
import { normalizeDomain } from "../contracts/normalize.js";
import knownDomainsData from "../data/known-domains.json" with { type: "json" };

/**
 * Generic dictionary words that must NOT be treated as exclusive brand names for TLD spoofing.
 */
export const GENERIC_DICTIONARY_WORDS = new Set([
  "scholarship",
  "scholarships",
  "education",
  "career",
  "careers",
  "job",
  "jobs",
  "portal",
  "internship",
  "internships",
  "training",
  "employment",
  "fellowship",
  "fellowships",
  "grant",
  "grants",
  "student",
  "students",
  "exam",
  "exams",
  "test",
  "testing",
  "admission",
  "admissions",
  "recruitment",
  "recruiter",
  "recruiters",
  "hire",
  "hiring",
]);

/**
 * Common homoglyph and character-confusion map across Cyrillic, Greek, and ASCII.
 */
const SKELETON_REPLACEMENTS = [
  // Cyrillic confusables
  [/\u0430/g, "a"], // Cyrillic а -> a
  [/\u0441/g, "c"], // Cyrillic с -> c
  [/\u0435/g, "e"], // Cyrillic е -> e
  [/\u043E/g, "o"], // Cyrillic о -> o
  [/\u0440/g, "p"], // Cyrillic р -> p
  [/\u0445/g, "x"], // Cyrillic х -> x
  [/\u0443/g, "y"], // Cyrillic у -> y
  [/\u0456/g, "l"], // Cyrillic і -> l
  [/\u0458/g, "j"], // Cyrillic ј -> j
  [/\u0455/g, "s"], // Cyrillic ѕ -> s
  [/\u0501/g, "d"], // Cyrillic ԁ -> d
  [/\u051B/g, "q"], // Cyrillic ԛ -> q
  [/\u051D/g, "w"], // Cyrillic ԝ -> w
  [/\u0406/g, "l"], // Cyrillic І -> l
  [/\u0410/g, "a"], // Cyrillic А -> a
  [/\u0412/g, "b"], // Cyrillic В -> b
  [/\u0421/g, "c"], // Cyrillic С -> c
  [/\u0415/g, "e"], // Cyrillic Е -> e
  [/\u041E/g, "o"], // Cyrillic О -> o
  [/\u0420/g, "p"], // Cyrillic Р -> p
  [/\u0425/g, "x"], // Cyrillic Х -> x

  // Greek confusables
  [/\u03B1/g, "a"], // Greek α -> a
  [/\u03B2/g, "b"], // Greek β -> b
  [/\u03B5/g, "e"], // Greek ε -> e
  [/\u03B9/g, "l"], // Greek ι -> l
  [/\u03BA/g, "k"], // Greek κ -> k
  [/\u03BF/g, "o"], // Greek ο -> o
  [/\u03C1/g, "p"], // Greek ρ -> p
  [/\u03C5/g, "y"], // Greek υ -> y
  [/\u03BD/g, "v"], // Greek ν -> v
  [/\u03C4/g, "t"], // Greek τ -> t
  [/\u03C7/g, "x"], // Greek χ -> x
  [/\u03C9/g, "w"], // Greek ω -> w

  // ASCII visual confusables
  [/rn/g, "m"],
  [/vv/g, "w"],
  [/cl/g, "d"],
  [/0/g, "o"],
  [/1/g, "l"],
  [/i/g, "l"],
  [/5/g, "s"],
  [/8/g, "b"],
  [/-/g, ""],
  [/_/g, ""],
];

/**
 * Tokens commonly used in student / opportunity impersonation schemes.
 */
export const SUSPICIOUS_AFFIX_TOKENS = [
  "gov",
  "nic",
  "portal",
  "online",
  "apply",
  "scholarship",
  "scholarships",
  "edu",
  "verify",
  "official",
  "india",
  "national",
  "dept",
  "careers",
  "career",
  "jobs",
  "job",
  "hr",
  "hiring",
  "recruitment",
  "recruiter",
  "placement",
  "internship",
  "internships",
  "support",
  "team",
  "desk",
];

/**
 * Computes standard Levenshtein distance between two strings.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      let val;
      if (a[i - 1] === b[j - 1]) {
        val = row[j - 1];
      } else {
        val = Math.min(row[j - 1] + 1, prev + 1, row[j] + 1);
      }
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length];
}

/**
 * Computes a visual skeleton string for homoglyph detection.
 *
 * @param {string} str
 * @returns {string}
 */
export function visualSkeleton(str) {
  let s = String(str || "").toLowerCase();
  for (const [pattern, replacement] of SKELETON_REPLACEMENTS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

/**
 * Extracts the primary second-level domain (SLD) or brand label from a domain.
 * e.g. "scholarships.gov.in" -> "scholarships"
 * e.g. "internshala.com" -> "internshala"
 *
 * @param {string} domain
 * @returns {string}
 */
export function extractBrandLabel(domain) {
  const parts = domain.split(".");
  if (parts.length >= 3 && (parts[parts.length - 2] === "gov" || parts[parts.length - 2] === "ac" || parts[parts.length - 2] === "co")) {
    return parts[parts.length - 3] || parts[0];
  }
  return parts[parts.length - 2] || parts[0];
}

/**
 * Extracts non-TLD parts of a domain.
 *
 * @param {string} domain
 * @returns {string[]}
 */
function extractNonTldParts(domain) {
  const parts = domain.split(".");
  if (parts.length >= 3 && (parts[parts.length - 2] === "gov" || parts[parts.length - 2] === "ac" || parts[parts.length - 2] === "co")) {
    return parts.slice(0, -2);
  }
  if (parts.length >= 2) {
    return parts.slice(0, -1);
  }
  return parts;
}

/**
 * Detects whether a candidate domain is a lookalike or impersonator of known legitimate opportunity domains.
 *
 * @param {string} candidateDomain
 * @param {Array<{ domain: string, name: string, category?: string }>} [customKnownList]
 * @returns {{
 *   isMatch: boolean,
 *   targetDomain: string | null,
 *   targetName: string | null,
 *   reason: string | null,
 *   confidence: "high" | "medium" | "low" | null,
 *   method: "edit_distance" | "homoglyph_skeleton" | "punycode_idn" | "brand_token_affix" | "tld_spoofing" | null
 * }}
 */
export function checkDomainLookalike(candidateDomain, customKnownList) {
  const normalizedCandidate = normalizeDomain(candidateDomain);
  if (!normalizedCandidate) {
    return {
      isMatch: false,
      targetDomain: null,
      targetName: null,
      reason: null,
      confidence: null,
      method: null,
    };
  }

  const knownList = customKnownList || knownDomainsData;

  // 1. Check exact match or legitimate subdomain
  for (const target of knownList) {
    const targetNorm = normalizeDomain(target.domain);
    if (!targetNorm) continue;

    // Exact match: genuine, NOT a lookalike
    if (normalizedCandidate === targetNorm) {
      return { isMatch: false, targetDomain: null, targetName: null, reason: null, confidence: null, method: null };
    }

    // Legitimate subdomain: e.g. "internship.aicte-india.org" of "aicte-india.org"
    if (normalizedCandidate.endsWith(`.${targetNorm}`)) {
      return { isMatch: false, targetDomain: null, targetName: null, reason: null, confidence: null, method: null };
    }
  }

  // Punycode & Unicode resolution
  const candidateAscii = domainToASCII(normalizedCandidate);
  const unicodeDomain = domainToUnicode(normalizedCandidate).toLowerCase();
  const isIdn = candidateAscii.startsWith("xn--") || normalizedCandidate.includes("xn--") || unicodeDomain !== candidateAscii;

  const candidateLabel = extractBrandLabel(normalizedCandidate);
  const unicodeCandidateLabel = extractBrandLabel(unicodeDomain);

  // Compute visual skeletons for both ASCII and decoded Unicode representations
  const candidateSkeleton = visualSkeleton(unicodeCandidateLabel);

  // Tokenize domain on dots and hyphens across non-TLD labels
  const nonTldLabels = extractNonTldParts(unicodeDomain);
  const domainTokens = nonTldLabels.flatMap((lbl) => lbl.split("-")).filter(Boolean);
  const domainTokenSkeletons = domainTokens.map((t) => visualSkeleton(t));

  for (const target of knownList) {
    const targetNorm = normalizeDomain(target.domain);
    if (!targetNorm) continue;

    const targetLabel = extractBrandLabel(targetNorm);
    const targetSkeleton = visualSkeleton(targetLabel);
    const isGenericTarget = GENERIC_DICTIONARY_WORDS.has(targetLabel);

    // 2. Homoglyph / Skeleton matching (e.g. Cyrillic gооgle, inte-rnshala)
    if (candidateLabel !== targetLabel && candidateSkeleton === targetSkeleton && candidateSkeleton.length >= 3) {
      return {
        isMatch: true,
        targetDomain: targetNorm,
        targetName: target.name,
        reason: `Homoglyph / visual skeleton substitution detected matching brand '${targetLabel}'`,
        confidence: "high",
        method: "homoglyph_skeleton",
      };
    }

    // 3. IDN Punycode homoglyph
    if (isIdn && candidateAscii !== targetNorm) {
      if (
        candidateSkeleton === targetSkeleton ||
        candidateSkeleton.includes(targetSkeleton) ||
        unicodeDomain.includes(targetLabel)
      ) {
        return {
          isMatch: true,
          targetDomain: targetNorm,
          targetName: target.name,
          reason: `Punycode / IDN spoofing targeting brand '${target.name}'`,
          confidence: "high",
          method: "punycode_idn",
        };
      }
    }

    // Skip brand-token and TLD-spoofing checks if target label is a generic dictionary word
    if (isGenericTarget) {
      continue;
    }

    // 4. Same brand label under a different TLD (TLD spoofing)
    if (candidateLabel === targetLabel && !normalizedCandidate.endsWith(targetNorm)) {
      return {
        isMatch: true,
        targetDomain: targetNorm,
        targetName: target.name,
        reason: `Target brand '${targetLabel}' used with alternative TLD/domain structure`,
        confidence: "high",
        method: "tld_spoofing",
      };
    }

    // 5. Tokenized brand token alongside extra suspicious words (e.g. tcs-careers-india.in, infosys-careers-portal-india.com)
    const brandTokenIndex = domainTokens.findIndex(
      (tok, idx) => tok === targetLabel || domainTokenSkeletons[idx] === targetSkeleton
    );
    if (brandTokenIndex !== -1 && targetLabel.length >= 3) {
      const extraTokens = domainTokens.filter((_, idx) => idx !== brandTokenIndex);
      const matchingAffixes = extraTokens.filter((tok) => SUSPICIOUS_AFFIX_TOKENS.includes(tok));
      if (matchingAffixes.length > 0) {
        return {
          isMatch: true,
          targetDomain: targetNorm,
          targetName: target.name,
          reason: `Protected brand token '${targetLabel}' combined with extra terms (${matchingAffixes.join(", ")}) on unauthorized domain`,
          confidence: "high",
          method: "brand_token_affix",
        };
      }
    }

    // 6. Direct hyphen/affix pattern matching (fallback for single-label affixes)
    for (const affix of SUSPICIOUS_AFFIX_TOKENS) {
      if (
        candidateLabel === `${targetLabel}-${affix}` ||
        candidateLabel === `${affix}-${targetLabel}` ||
        candidateLabel === `${targetLabel}${affix}` ||
        candidateLabel === `${affix}${targetLabel}`
      ) {
        return {
          isMatch: true,
          targetDomain: targetNorm,
          targetName: target.name,
          reason: `Brand '${targetLabel}' combined with authority/opportunity keyword '${affix}'`,
          confidence: "high",
          method: "brand_token_affix",
        };
      }
    }

    // 7. Levenshtein edit distance on brand labels
    if (targetLabel.length >= 6 && candidateLabel.length >= 5) {
      const dist = levenshteinDistance(candidateLabel, targetLabel);
      if (dist === 1) {
        return {
          isMatch: true,
          targetDomain: targetNorm,
          targetName: target.name,
          reason: `Single-character edit distance typo matching brand '${targetLabel}'`,
          confidence: "high",
          method: "edit_distance",
        };
      }
      if (dist === 2 && candidateLabel.length >= 7) {
        return {
          isMatch: true,
          targetDomain: targetNorm,
          targetName: target.name,
          reason: `Two-character edit distance typo matching brand '${targetLabel}'`,
          confidence: "medium",
          method: "edit_distance",
        };
      }
    }
  }

  return {
    isMatch: false,
    targetDomain: null,
    targetName: null,
    reason: null,
    confidence: null,
    method: null,
  };
}
