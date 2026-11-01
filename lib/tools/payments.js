/**
 * lib/tools/payments.js
 *
 * Pure fact extraction for payment-related entities:
 * - upiFacts(upiString)
 * - emailFacts(emailString)
 * - phoneFacts(e164String)
 *
 * Rules:
 * - Pure functions; no I/O, no network, no LLM.
 * - phoneFacts uses libphonenumber-js to parse and validate format, country, and carrier/line type.
 * - upiFacts checks handle against known UPI PSP registry in lib/data/upi-handles.json.
 * - emailFacts checks domain against free consumer providers in lib/data/free-email-domains.json.
 * - Never throw; return deterministic, normalized fact shapes.
 */

import { parsePhoneNumberFromString } from "libphonenumber-js";
import { normalizeUpi, normalizeEmail, isValidE164, classifyAtString } from "../contracts/normalize.js";
import upiHandlesData from "../data/upi-handles.json" with { type: "json" };
import freeEmailDomainsData from "../data/free-email-domains.json" with { type: "json" };

const UPI_REGISTRY = new Map(
  upiHandlesData.map((item) => [item.handle.toLowerCase(), item])
);

const FREE_EMAIL_DOMAINS = new Set(
  freeEmailDomainsData.map((d) => d.toLowerCase().trim())
);

/**
 * Extracts facts from a UPI ID.
 *
 * @param {string} upiString
 * @returns {{
 *   valid: boolean,
 *   raw: string,
 *   normalized: string,
 *   username: string,
 *   handle: string,
 *   isKnownPsp: boolean,
 *   pspName: string | null,
 *   bankName: string | null,
 *   looksLikePhone: boolean
 * }}
 */
export function upiFacts(upiString) {
  const normalized = normalizeUpi(upiString);
  if (!normalized) {
    return {
      valid: false,
      raw: upiString || "",
      normalized: "",
      username: "",
      handle: "",
      isKnownPsp: false,
      pspName: null,
      bankName: null,
      looksLikePhone: false,
    };
  }

  if (!normalized.includes("@")) {
    return {
      valid: false,
      raw: upiString || "",
      normalized: "",
      username: "",
      handle: "",
      isKnownPsp: false,
      pspName: null,
      bankName: null,
      looksLikePhone: false,
    };
  }

  // UPI handle cannot contain a dot; if it contains a dot, it is an email or domain
  if (classifyAtString(normalized) !== "upi") {
    return {
      valid: false,
      raw: upiString || "",
      normalized: "",
      username: "",
      handle: "",
      isKnownPsp: false,
      pspName: null,
      bankName: null,
      looksLikePhone: false,
    };
  }

  const [username, handle] = normalized.split("@");
  if (!username || !handle) {
    return {
      valid: false,
      raw: upiString || "",
      normalized: "",
      username: "",
      handle: "",
      isKnownPsp: false,
      pspName: null,
      bankName: null,
      looksLikePhone: false,
    };
  }
  const pspInfo = UPI_REGISTRY.get(handle.toLowerCase()) || null;

  // Check if username is purely 10 digits (often a personal phone number in India)
  const looksLikePhone = /^\d{10}$/.test(username);

  return {
    valid: true,
    raw: upiString,
    normalized,
    username,
    handle,
    isKnownPsp: Boolean(pspInfo),
    pspName: pspInfo?.psp || null,
    bankName: pspInfo?.bank || null,
    looksLikePhone,
  };
}

/**
 * Extracts facts from an email address.
 *
 * @param {string} emailString
 * @returns {{
 *   valid: boolean,
 *   raw: string,
 *   normalized: string,
 *   localPart: string,
 *   domain: string,
 *   isFreeProvider: boolean,
 *   isEduOrGov: boolean
 * }}
 */
export function emailFacts(emailString) {
  const normalized = normalizeEmail(emailString);
  if (!normalized || !normalized.includes("@")) {
    return {
      valid: false,
      raw: emailString || "",
      normalized: "",
      localPart: "",
      domain: "",
      isFreeProvider: false,
      isEduOrGov: false,
    };
  }

  const [localPart, domain] = normalized.split("@");
  if (!localPart || !domain) {
    return {
      valid: false,
      raw: emailString || "",
      normalized: "",
      localPart: "",
      domain: "",
      isFreeProvider: false,
      isEduOrGov: false,
    };
  }

  const isFree = FREE_EMAIL_DOMAINS.has(domain);
  const isEduOrGov =
    domain.endsWith(".edu") ||
    domain.endsWith(".ac.in") ||
    domain.endsWith(".gov.in") ||
    domain.endsWith(".gov") ||
    domain.endsWith(".edu.in");

  return {
    valid: true,
    raw: emailString,
    normalized,
    localPart,
    domain,
    isFreeProvider: isFree,
    isEduOrGov,
  };
}

/**
 * Extracts facts from a phone number in E.164 format.
 * Non-negotiable product rule: Phone numbers are only validated, searched,
 * and matched against our own graph. NEVER attempt to trace or identify people.
 *
 * @param {string} e164String
 * @returns {{
 *   valid: boolean,
 *   raw: string,
 *   e164: string,
 *   country: string | null,
 *   countryCallingCode: string | null,
 *   nationalNumber: string,
 *   possible: boolean,
 *   type: string | null
 * }}
 */
export function phoneFacts(e164String) {
  const trimmed = String(e164String || "").trim();
  if (!isValidE164(trimmed)) {
    return {
      valid: false,
      raw: trimmed,
      e164: "",
      country: null,
      countryCallingCode: null,
      nationalNumber: "",
      possible: false,
      type: null,
    };
  }

  try {
    const phoneNumber = parsePhoneNumberFromString(trimmed);
    if (!phoneNumber) {
      return {
        valid: false,
        raw: trimmed,
        e164: "",
        country: null,
        countryCallingCode: null,
        nationalNumber: "",
        possible: false,
        type: null,
      };
    }

    const isValid = phoneNumber.isValid();
    const isPossible = phoneNumber.isPossible();

    return {
      valid: isValid,
      raw: trimmed,
      e164: phoneNumber.number || trimmed,
      country: phoneNumber.country || null,
      countryCallingCode: phoneNumber.countryCallingCode || null,
      nationalNumber: phoneNumber.nationalNumber || "",
      possible: isPossible,
      type: phoneNumber.getType() || null,
    };
  } catch {
    return {
      valid: false,
      raw: trimmed,
      e164: "",
      country: null,
      countryCallingCode: null,
      nationalNumber: "",
      possible: false,
      type: null,
    };
  }
}
