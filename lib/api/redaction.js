/**
 * lib/api/redaction.js
 *
 * PII and identifier redaction helper for user feedback comments and untrusted free text.
 * Sanitizes phone numbers (international, national, spaced/dashed), emails, UPI IDs,
 * URLs, long digit sequences (>= 7 digits), and Devanagari digit equivalents.
 *
 * Guaranteed properties:
 * - Deterministic pure function (no I/O, no network, no side effects).
 * - Idempotent: redactComment(redactComment(text)) === redactComment(text).
 * - Safe fallback: non-string inputs return empty string or null matching input type.
 */

// Mapping of Devanagari numerals (०-९) to ASCII digits (0-9)
const DEVANAGARI_DIGITS = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

/**
 * Converts Devanagari digits to standard ASCII digits.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeDevanagariDigits(text) {
  if (typeof text !== "string") return "";
  return text.replace(/[०-९]/g, (ch) => DEVANAGARI_DIGITS[ch] || ch);
}

/**
 * Redacts personal identifiers, contact details, payment handles and URLs from a comment.
 *
 * @param {string | null | undefined} input
 * @returns {string | null} Redacted string or null if input was null/undefined
 */
export function redactComment(input) {
  if (input === null || input === undefined) {
    return null;
  }
  if (typeof input !== "string") {
    return "";
  }

  let text = input;

  // 1. Redact full URLs (http, https, ftp, or naked domain URLs like www.xyz.com)
  text = text.replace(/https?:\/\/[^\s<>"]+/gi, "[REDACTED_URL]");
  text = text.replace(/\bwww\.[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"]*)?/gi, "[REDACTED_URL]");

  // 2. Redact Email addresses
  // e.g. user.name+tag@domain.co.in
  text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]");

  // 3. Redact UPI IDs
  // e.g. recipient@okhdfcbank, payment.desk@paytm
  text = text.replace(/[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}/g, "[REDACTED_UPI]");

  // 4. Redact Phone numbers and long digit sequences (handling Devanagari numerals, +91, dashes, spaces)
  // We perform replacement on text with both Devanagari and ASCII digit patterns.
  // First, convert Devanagari numerals to ASCII for phone detection
  const normalizedForDigits = normalizeDevanagariDigits(text);

  // Pattern matching:
  // - International or national phone numbers: +91 98765 43210, +91-98765-43210, 09876543210, 9876543210, etc.
  // - Formatted phone numbers with parentheses: (022) 1234 5678, (123) 456-7890
  // - Runs of 7 or more digits with optional spaces/hyphens
  const phonePattern = /(?:\+?\d{1,4}[-.\s]?)?(?:\(?\d{2,5}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,5}\b/g;

  // Replace phone numbers and digit sequences >= 7 digits in normalized text, preserving other tokens
  text = normalizedForDigits.replace(phonePattern, (match) => {
    // Strip all non-digits to count length
    const digitsOnly = match.replace(/\D/g, "");
    if (digitsOnly.length >= 7 && digitsOnly.length <= 16) {
      return "[REDACTED_PHONE]";
    }
    // Also catch consecutive 10-digit or 12-digit numbers
    if (digitsOnly.length >= 10) {
      return "[REDACTED_PHONE]";
    }
    return match;
  });

  // Catch any remaining long digit runs (e.g. 7 or more consecutive digits like account numbers)
  text = text.replace(/\b\d{7,}\b/g, "[REDACTED_PHONE]");

  // Clean up any double redactions or adjacent spaces if produced
  text = text.replace(/\[REDACTED_PHONE\](?:\s*\[REDACTED_PHONE\])+/g, "[REDACTED_PHONE]");
  text = text.replace(/\[REDACTED_URL\](?:\s*\[REDACTED_URL\])+/g, "[REDACTED_URL]");

  return text;
}
