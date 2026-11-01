import { domainToASCII } from "node:url";

/**
 * Normalizes a domain name:
 * Order of operations:
 * 1. Protocol: strip http://, https://, or protocol-relative //
 * 2. Cut at the first of / ? #
 * 3. Userinfo: text before the last @ in the authority
 * 4. Port: host:port -> host
 * 5. Lowercase, strip leading www., strip trailing dot
 * 6. domainToASCII via node:url
 * 7. Return "" for empty, unparseable, or IP-literal input
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizeDomain(input) {
  if (typeof input !== "string") return "";
  let s = input.trim();
  if (!s) return "";

  // 1. Strip protocol: http://, https://, or protocol-relative //
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  s = s.replace(/^\/\//, "");

  // 2. Cut at first of / ? #
  const cutIdx = s.search(/[/?#]/);
  if (cutIdx !== -1) {
    s = s.slice(0, cutIdx);
  }

  // 3. Userinfo: text before the last @ in the authority
  const atIdx = s.lastIndexOf("@");
  if (atIdx !== -1) {
    s = s.slice(atIdx + 1);
  }

  // 4. Port: host:port -> host
  const colonIdx = s.indexOf(":");
  if (colonIdx !== -1) {
    s = s.slice(0, colonIdx);
  }

  // 5. Lowercase, strip leading www., strip trailing dot
  s = s.toLowerCase();
  s = s.replace(/^www\./, "");
  s = s.replace(/\.+$/, "");

  if (!s) return "";

  // Reject IPv4 or IPv6 literals (e.g. 1.2.3.4, [::1])
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return "";
  if (s.includes("[") || s.includes("]")) return "";

  // 6. domainToASCII
  try {
    const ascii = domainToASCII(s);
    if (!ascii || !ascii.includes(".")) return "";
    return ascii.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Normalizes a UPI ID:
 * - trimmed, lowercase
 * @param {string} input
 * @returns {string}
 */
export function normalizeUpi(input) {
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

/**
 * Normalizes an email address:
 * - trimmed, lowercase
 * @param {string} input
 * @returns {string}
 */
export function normalizeEmail(input) {
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

/**
 * Normalizes a social / messaging handle:
 * - trimmed, lowercase, strips leading '@'
 * @param {string} input
 * @returns {string}
 */
export function normalizeHandle(input) {
  if (typeof input !== "string") return "";
  return input.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Normalizes a company / organization name:
 * - trimmed, consecutive whitespace collapsed to single space
 * - does not truncate silently; schemas reject values over 200 characters
 * @param {string} input
 * @returns {string}
 */
export function normalizeCompany(input) {
  if (typeof input !== "string") return "";
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Normalizes a parsed monetary amount:
 * - returns digits-only integer string (strips currency words/symbols, commas, spaces)
 * - rejects decimals other than .00
 * - returns "" if no digits or invalid
 * @param {string | number} input
 * @returns {string}
 */
export function normalizeAmount(input) {
  if (input === null || input === undefined) return "";
  let s = String(input).trim();
  if (!s) return "";

  // Strip currency words (case-insensitive) and common currency symbols
  // e.g. "Rs", "INR", "Rs.", "₹", "$", "€", "£"
  s = s.replace(/\b(rs\.?|inr)\b/gi, "");
  s = s.replace(/[₹$€£]/g, "");

  // Strip commas and spaces
  s = s.replace(/[,\s]/g, "");

  // Check for decimal part
  if (s.includes(".")) {
    const dotIdx = s.indexOf(".");
    // If multiple dots, invalid
    if (s.indexOf(".", dotIdx + 1) !== -1) {
      return "";
    }
    const intPart = s.slice(0, dotIdx);
    const decPart = s.slice(dotIdx + 1);

    // Accept an optional trailing ".00" (or ".0", ".000") and drop it.
    // Any other decimal part gives "".
    if (!/^0+$/.test(decPart)) {
      return "";
    }
    s = intPart;
  }

  // The result must be digits only
  if (!/^\d+$/.test(s)) {
    return "";
  }

  // Without leading zeros, and non-zero; otherwise return ""
  s = s.replace(/^0+/, "");
  if (!s) {
    return "";
  }

  return s;
}

/**
 * Classifies a string containing '@' as either 'email' or 'upi':
 * Rule from docs/contracts.md:
 * If the part after '@' contains a dot (e.g. 'gmail.com', 'ac.in'), it is an email;
 * otherwise it is a UPI handle (e.g. 'okaxis', 'okhdfcbank', 'paytm').
 * @param {string} input
 * @returns {"email" | "upi" | null}
 */
export function classifyAtString(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();
  const atIdx = s.indexOf("@");
  if (atIdx <= 0 || atIdx !== s.lastIndexOf("@")) {
    return null; // missing '@' or multiple '@'
  }
  const afterAt = s.slice(atIdx + 1);
  if (!afterAt) return null;
  return afterAt.includes(".") ? "email" : "upi";
}

/**
 * E.164 phone number format regex from docs/contracts.md:
 * ^\+[1-9]\d{6,14}$
 * Validates leading +, 1-9 country code, total 7 to 15 digits (6 to 14 after first digit).
 * @param {string} input
 * @returns {boolean}
 */
export function isValidE164(input) {
  if (typeof input !== "string") return false;
  return /^\+[1-9]\d{6,14}$/.test(input.trim());
}
