/**
 * lib/extract.js
 *
 * Extraction pipeline for Layer L5:
 * - extractEntitiesFromText(text): pure function parsing URLs, domains, UPI, email, phones (E.164), amounts
 * - runExtraction(checkId, deps): orchestrates check extraction, screenshot OCR, LLM entity sweep, entity merging, and cleanup
 *
 * Rules:
 * - Regex must not extract handles or companies, but the LLM entity sweep does, with quote evidence.
 * - UPI vs Email disambiguation: @ without dot = UPI; @ with dot = email (or UPI PSP fallback).
 * - Indian phone parsing via libphonenumber-js with default region 'IN'.
 * - Vision extraction: one generate() call per image with wrapUntrusted, strict schema.
 * - LLM entity sweep: one generate() call (with 1 retry) with wrapUntrusted, strict schema, and grounded quote verification.
 * - Grounding check: quotes compared after normalizing whitespace, case, and OCR punctuation; ungrounded entities are dropped.
 * - Handle platform resolution order: explicit handlePlatform, then URL host, then LLM inference from text, else null.
 * - Organisation names pruned unless appearing in transcribed text / input text.
 * - Non-fatal vision & sweep failures: fallback to deterministic regex extraction and log a check event.
 * - Images deleted and file_path cleared in a finally block.
 * - No message text, entity values, or image content in logs or events.
 * - Maximum entity cap per check (30).
 */

import fs from "node:fs";
import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import {
  getCheck,
  getInputs,
  updateStatus,
  updateCheckResult,
  replaceEntities,
  replaceTextInputs,
  clearInputFile,
  appendEvent,
} from "./db/index.js";
import { validateImageBuffer } from "./uploads.js";
import { generate as defaultGenerate, wrapUntrusted } from "./llm/generate.js";
import {
  normalizeDomain,
  normalizeUpi,
  normalizeEmail,
  normalizeAmount,
  normalizeCompany,
  normalizeHandle,
  isValidE164,
  classifyAtString,
} from "./contracts/normalize.js";
import { HANDLE_PLATFORMS } from "./contracts/enums.js";
import { upiFacts } from "./tools/payments.js";
import { quoteInText } from "./agents/base.js";
import { logger as defaultLogger } from "./logger.js";
import upiHandlesData from "./data/upi-handles.json" with { type: "json" };
import freeEmailDomainsData from "./data/free-email-domains.json" with { type: "json" };
import knownDomainsData from "./data/known-domains.json" with { type: "json" };

export const SWEEP_TIMEOUT_MS = 15000;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KNOWN_ORGANISATIONS = Array.from(
  new Set([
    ...knownDomainsData.map((d) => d.name).filter(Boolean),
    "Google",
    "Tata",
    "TCS",
    "Infosys",
    "Wipro",
    "Microsoft",
    "Amazon",
    "Apple",
    "State Bank of India",
    "SBI",
    "UGC",
    "AICTE",
    "NTA",
  ])
);

const KNOWN_UPI_HANDLES = new Set(
  upiHandlesData.map((h) => h.handle.toLowerCase().trim())
);

const FREE_EMAIL_DOMAINS = new Set(
  freeEmailDomainsData.map((d) => d.toLowerCase().trim())
);

const CHANNEL_NAMES = new Set([
  "telegram",
  "whatsapp",
  "instagram",
  "youtube",
  "reddit",
  "x",
  "twitter",
  "email",
  "sms",
  "phone",
  "call",
]);

export const MAX_ENTITIES_PER_CHECK = 30;

// Strict Vision Extraction Output Schema
export const VisionExtractionSchema = z
  .object({
    transcribedText: z.string().default(""),
    senderLabel: z.string().nullable().optional(),
    urls: z.array(z.string()).default([]),
    amounts: z.array(z.string()).default([]),
    paymentIds: z.array(z.string()).default([]),
    organisationNames: z.array(z.string()).max(5).default([]),
  })
  .strict();

// Preprocessed item schemas accepting aliases
const CompanyItemSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return { name: val, quote: val };
    if (val && typeof val === "object") {
      const name =
        val.name ||
        val.company ||
        val.companyName ||
        val.company_name ||
        val.organization ||
        val.organizationName ||
        val.organization_name ||
        val.org;
      const quote = val.quote || val.evidence || val.evidence_quote || (typeof name === "string" ? name : "");
      return { name, quote };
    }
    return val;
  },
  z.object({
    name: z.string().min(1).max(200),
    quote: z.string().min(1).max(300),
  })
);

const SchemeItemSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return { name: val, quote: val };
    if (val && typeof val === "object") {
      const name =
        val.name ||
        val.scheme ||
        val.schemeName ||
        val.scheme_name ||
        val.scholarship ||
        val.scholarshipName ||
        val.scholarship_name ||
        val.program;
      const quote = val.quote || val.evidence || val.evidence_quote || (typeof name === "string" ? name : "");
      return { name, quote };
    }
    return val;
  },
  z.object({
    name: z.string().min(1).max(200),
    quote: z.string().min(1).max(300),
  })
);

const HandleItemSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return { handle: val, quote: val };
    if (val && typeof val === "object") {
      const handle = val.handle || val.username || val.user || val.account || val.name;
      const platform = val.platform || val.network || val.channel || null;
      const quote = val.quote || val.evidence || val.evidence_quote || (typeof handle === "string" ? handle : "");
      return { handle, platform, quote };
    }
    return val;
  },
  z.object({
    handle: z.string().min(1).max(100),
    platform: z.enum(HANDLE_PLATFORMS).nullable().optional(),
    quote: z.string().min(1).max(300),
  })
);

const AmountItemSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return { amount: val, quote: val };
    if (val && typeof val === "object") {
      const amount = val.amount || val.value || val.fee || val.deposit || val.price;
      const quote = val.quote || val.evidence || val.evidence_quote || (typeof amount === "string" ? amount : "");
      return { amount: String(amount ?? ""), quote };
    }
    return val;
  },
  z.object({
    amount: z.string().min(1).max(20),
    quote: z.string().min(1).max(300),
  })
);

const PaymentItemSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") return { id: val, quote: val };
    if (val && typeof val === "object") {
      const id = val.id || val.upiId || val.upi || val.paymentId || val.payment_id || val.vpa;
      const quote = val.quote || val.evidence || val.evidence_quote || (typeof id === "string" ? id : "");
      return { id, quote };
    }
    return val;
  },
  z.object({
    id: z.string().min(1).max(256),
    quote: z.string().min(1).max(300),
  })
);

// Robust LLM Entity Sweep Output Schema accepting aliases
export const EntitySweepSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    return {
      companies: raw.companies || raw.company || raw.organizations || raw.organisations || raw.organisationNames || [],
      schemes: raw.schemes || raw.scheme || raw.scholarships || raw.scholarship || [],
      handles: raw.handles || raw.handle || raw.usernames || [],
      amounts: raw.amounts || raw.amount || raw.fees || [],
      paymentIds: raw.paymentIds || raw.payment_ids || raw.paymentId || raw.upiIds || raw.upis || raw.upi || [],
    };
  },
  z.object({
    companies: z.array(CompanyItemSchema).max(5).default([]),
    schemes: z.array(SchemeItemSchema).max(5).default([]),
    handles: z.array(HandleItemSchema).max(5).default([]),
    amounts: z.array(AmountItemSchema).max(5).default([]),
    paymentIds: z.array(PaymentItemSchema).max(5).default([]),
  })
);

/**
 * Normalizes text for evidence quote comparison:
 * - Lowercases
 * - Replaces typographic quotes, dashes, and punctuation with spaces
 * - Collapses consecutive whitespace
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeForGrounding(text) {
  if (typeof text !== "string") return "";
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Checks whether an evidence quote is grounded in the source text.
 * Tolerates whitespace, case, and OCR punctuation differences.
 *
 * @param {string} quote
 * @param {string} sourceText
 * @returns {boolean}
 */
export function isQuoteGrounded(quote, sourceText) {
  if (!quote || typeof quote !== "string") return false;
  if (!sourceText || typeof sourceText !== "string") return false;

  const normQuote = normalizeForGrounding(quote);
  if (!normQuote) return false;

  const normSource = normalizeForGrounding(sourceText);
  return normSource.includes(normQuote);
}

/**
 * Resolves platform in priority order:
 * 1. Explicit handlePlatform (if valid)
 * 2. URL host (if matches known platform)
 * 3. Text inference (if LLM or text mentions platform)
 * 4. null
 *
 * @param {string|null} [explicitPlatform]
 * @param {string[]} [urls=[]]
 * @param {string|null} [inferredPlatform=null]
 * @returns {string|null}
 */
export function resolvePlatform(explicitPlatform, urls = [], inferredPlatform = null) {
  if (explicitPlatform && HANDLE_PLATFORMS.includes(explicitPlatform)) {
    return explicitPlatform;
  }
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      const host = parsed.hostname.toLowerCase();
      if (host.includes("instagram.com")) return "instagram";
      if (host.includes("t.me") || host.includes("telegram.me")) return "telegram";
      if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
      if (host.includes("reddit.com")) return "reddit";
      if (host.includes("x.com") || host.includes("twitter.com")) return "x";
    } catch {
      // ignore invalid URLs
    }
  }
  if (inferredPlatform && HANDLE_PLATFORMS.includes(inferredPlatform)) {
    return inferredPlatform;
  }
  return null;
}

/**
 * Pure regex-based entity extraction from text.
 * No regex extraction of handles or companies.
 *
 * @param {string} text
 * @returns {Array<{ kind: string, value: string, source: "extracted", evidence: { type: "quote", value: string } }>}
 */
export function extractEntitiesFromText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return [];
  }

  // Guard against extreme adversarial inputs
  const safeText = text.length > 50000 ? text.slice(0, 50000) : text;

  const foundEntities = [];
  const seenKeys = new Set();

  function record(kind, value, rawEvidence) {
    if (!kind || !value) return;
    const key = `${kind}:${value}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      const ent = {
        kind,
        value,
        source: "extracted",
      };
      if (rawEvidence && typeof rawEvidence === "string") {
        ent.evidence = { type: "quote", value: rawEvidence };
      }
      foundEntities.push(ent);
    }
  }

  // 1. URLs (HTTP/HTTPS)
  const urlRegex = /\bhttps?:\/\/[^\s<>"'{}|\\^`]+[^\s<>"'{}|\\^`,.;:()]/gi;
  const urls = safeText.match(urlRegex) || [];
  for (const rawUrl of urls) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        record("url", parsed.href, rawUrl);
        const normDom = normalizeDomain(parsed.hostname);
        if (normDom) {
          record("domain", normDom, parsed.hostname);
        }
      }
    } catch {
      // ignore malformed URLs
    }
  }

  // 2. Bare Domains (e.g. portal.gov.in, scheme-portal.org, www.example.com)
  const domainRegex = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:gov\.in|nic\.in|edu\.in|ac\.in|org\.in|co\.in|org|net|com|in|io|app|dev|biz|info|site|online|live)\b/gi;
  let domMatch;
  while ((domMatch = domainRegex.exec(safeText)) !== null) {
    const rawDom = domMatch[0];
    const matchIndex = domMatch.index;
    const charBefore = matchIndex > 0 ? safeText[matchIndex - 1] : "";

    const lastDot = rawDom.lastIndexOf(".");
    const tld = rawDom.slice(lastDot + 1);
    const charBeforeDot = lastDot > 0 ? rawDom[lastDot - 1] : "";
    const isTitleCaseTld = /^[A-Z][a-z]+$/.test(tld);
    const isCharBeforeDotLower = /^[a-z]$/.test(charBeforeDot);
    const prevLabel = rawDom.slice(0, lastDot).split(".").pop();
    const isPrevLabelTitleCase = /^[A-Z]/.test(prevLabel);

    if (isTitleCaseTld && isCharBeforeDotLower && !isPrevLabelTitleCase) {
      continue;
    }
    const norm = normalizeDomain(rawDom);
    if (!norm) continue;

    if (charBefore === "@" && FREE_EMAIL_DOMAINS.has(norm)) {
      continue;
    }

    record("domain", norm, rawDom);
  }

  // 3. Email and UPI Candidates
  // Disambiguation:
  // - Suffix after @ has NO dot => UPI candidate (e.g. rahul.hr@oksbi)
  // - Suffix after @ HAS dot => Check KNOWN_UPI_HANDLES first; if known UPI handle => UPI; else Email candidate
  const atPattern = /\b([a-zA-Z0-9._%+-]{2,256})@([a-zA-Z0-9.-]{2,64})\b/g;
  let atMatch;
  while ((atMatch = atPattern.exec(safeText)) !== null) {
    const fullMatch = atMatch[0];
    const afterAt = atMatch[2].toLowerCase();

    if (!afterAt.includes(".")) {
      const normUpi = normalizeUpi(fullMatch);
      const facts = upiFacts(normUpi);
      if (facts.valid) {
        record("upi", normUpi, fullMatch);
      }
    } else {
      if (KNOWN_UPI_HANDLES.has(afterAt)) {
        const normUpi = normalizeUpi(fullMatch);
        const facts = upiFacts(normUpi);
        if (facts.valid) {
          record("upi", normUpi, fullMatch);
          continue;
        }
      }
      const normEmail = normalizeEmail(fullMatch);
      if (normEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) {
        record("email", normEmail, fullMatch);
        const emailDomain = normalizeDomain(afterAt);
        if (emailDomain && !FREE_EMAIL_DOMAINS.has(emailDomain)) {
          record("domain", emailDomain, afterAt);
        }
      }
    }
  }

  // 4. Phone Numbers (Default region 'IN')
  // Normalization approach: find candidate digit runs allowing single spaces or hyphens between digits,
  // strip separators, handle +91, 91, 0, and 0091 prefixes, validate with libphonenumber (region IN).
  // 10-digit order numbers starting with 1 must not be extracted.
  const phonePattern = /(?:(?:\+|00)?91[\s-]*)?(?:\b|(?<=\s))(?:[0-9][\s-]?){7,14}[0-9]\b/g;
  let phoneMatch;
  while ((phoneMatch = phonePattern.exec(safeText)) !== null) {
    const rawMatch = phoneMatch[0];
    const stripped = rawMatch.replace(/[\s-]/g, "");
    let core = stripped;
    if (core.startsWith("+91")) {
      core = core.slice(3);
    } else if (core.startsWith("0091")) {
      core = core.slice(4);
    } else if (core.startsWith("91") && core.length === 12) {
      core = core.slice(2);
    } else if (core.startsWith("0") && core.length === 11) {
      core = core.slice(1);
    }

    // Indian mobile phone number: 10 digits starting with 6-9
    if (/^[6-9]\d{9}$/.test(core)) {
      try {
        const parsed = parsePhoneNumberFromString("+91" + core, "IN");
        if (parsed && parsed.isValid() && isValidE164(parsed.number)) {
          record("phone", parsed.number, rawMatch);
        }
      } catch {
        // ignore parsing failure
      }
    } else if (stripped.startsWith("+") && !stripped.startsWith("+91")) {
      // International number with explicit +
      try {
        const parsed = parsePhoneNumberFromString(stripped);
        if (parsed && parsed.isValid() && isValidE164(parsed.number)) {
          record("phone", parsed.number, rawMatch);
        }
      } catch {
        // ignore parsing failure
      }
    }
  }

  // 5. Amounts (e.g. ₹500, Rs. 1500, INR 2000, Rs 5000)
  const amountRegex = /(?:₹|rs\.?|inr)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/gi;
  let amtMatch;
  while ((amtMatch = amountRegex.exec(safeText)) !== null) {
    const rawDigits = amtMatch[1].replace(/,/g, "");
    const normAmt = normalizeAmount(rawDigits);
    if (normAmt) {
      record("amount", normAmt, amtMatch[0]);
    }
  }

  return foundEntities;
}

/**
 * Runs the extraction pipeline for a check.
 *
 * @param {string} checkId
 * @param {object} [deps]
 * @param {Function} [deps.generate]
 * @param {Function} [deps.now]
 * @param {typeof fs.promises.readFile} [deps.readFile]
 * @param {typeof fs.promises.unlink} [deps.unlink]
 * @param {object} [deps.logger]
 * @param {object} [deps.db]
 * @param {string} [deps.handlePlatform]
 * @returns {Promise<{
 *   checkId: string,
 *   status: string,
 *   extractedCount: number,
 *   textTranscribed: boolean
 * }>}
 */
export async function runExtraction(checkId, deps = {}) {
  const generateFn = deps.generate || defaultGenerate;
  const nowFn = deps.now || (() => new Date().toISOString());
  const readFileFn = deps.readFile || fs.promises.readFile;
  const unlinkFn = deps.unlink || fs.promises.unlink;
  const logger = deps.logger || defaultLogger;
  const db = deps.db;
  const explicitHandlePlatform = deps.handlePlatform || null;

  const check = getCheck(checkId, db);
  if (!check) {
    throw new Error(`Check not found: ${checkId}`);
  }

  // State Transition 1: created -> extracting
  try {
    updateStatus(checkId, "extracting", db);
  } catch (err) {
    throw new Error(`Failed to transition check to extracting: ${err.message}`);
  }

  appendEvent(
    checkId,
    {
      type: "stage",
      round: 0,
      summary: "Extraction started",
      createdAt: nowFn(),
    },
    db
  );

  const inputs = getInputs(checkId, db);
  const imageInputs = inputs.filter((i) => i.type === "image" && i.filePath);

  const userEntities = [];
  const textSnippets = [];
  const notesSnippets = [];
  const userUrls = [];
  let combinedTranscribedText = "";

  // Collect initial form fields as source "user"
  for (const input of inputs) {
    if (input.type === "text" && input.value) {
      textSnippets.push(input.value);
    } else if (input.type === "user_notes" && input.value) {
      notesSnippets.push(input.value);
    } else if (input.type === "url" && input.value) {
      userUrls.push(input.value);
      userEntities.push({
        kind: "url",
        value: input.value,
        source: "user",
        round: 0,
        confirmed: true,
        evidence: { type: "quote", value: input.value },
      });
      const normDom = normalizeDomain(input.value);
      if (normDom) {
        userEntities.push({
          kind: "domain",
          value: normDom,
          source: "user",
          round: 0,
          confirmed: true,
          evidence: { type: "quote", value: input.value },
        });
      }
    } else if (input.type === "upi" && input.value) {
      const norm = normalizeUpi(input.value);
      if (norm) {
        userEntities.push({
          kind: "upi",
          value: norm,
          source: "user",
          round: 0,
          confirmed: true,
          evidence: { type: "quote", value: input.value },
        });
      }
    } else if (input.type === "company" && input.value) {
      const norm = normalizeCompany(input.value);
      if (norm) {
        logger.info({ checkId, event: "company_extracted", method: "user_input" });
        userEntities.push({
          kind: "company",
          value: norm,
          source: "user",
          round: 0,
          confirmed: true,
          evidence: { type: "quote", value: input.value },
        });
      }
    } else if (input.type === "handle" && input.value) {
      const norm = normalizeHandle(input.value);
      if (norm) {
        const plat = resolvePlatform(explicitHandlePlatform, userUrls);
        userEntities.push({
          kind: "handle",
          value: norm,
          platform: plat,
          source: "user",
          round: 0,
          confirmed: true,
          evidence: { type: "quote", value: input.value },
        });
      }
    } else if (input.type === "phone" && input.value) {
      const parsed = parsePhoneNumberFromString(input.value, "IN");
      if (parsed && parsed.isValid() && isValidE164(parsed.number)) {
        userEntities.push({
          kind: "phone",
          value: parsed.number,
          source: "user",
          round: 0,
          confirmed: true,
          evidence: { type: "quote", value: input.value },
        });
      }
    } else if (input.type === "youtube_url" && input.value) {
      userUrls.push(input.value);
      userEntities.push({
        kind: "youtube_url",
        value: input.value,
        source: "user",
        round: 0,
        confirmed: true,
        evidence: { type: "quote", value: input.value },
      });
    }
  }

  const visionEntities = [];
  const filesToCleanup = imageInputs.map((img) => ({ id: img.id, path: img.filePath }));

  try {
    // Process screenshots (up to 5)
    for (let i = 0; i < imageInputs.length; i++) {
      const imgInput = imageInputs[i];

      if (i >= 5) {
        logger.warn({ checkId, event: "excess_image_rejected", inputId: imgInput.id });
        appendEvent(
          checkId,
          {
            type: "stage",
            round: 0,
            status: "could_not_check",
            summary: "Image rejected: maximum 5 screenshots allowed per check",
            createdAt: nowFn(),
          },
          db
        );
        continue;
      }

      let fileBuffer;
      try {
        fileBuffer = await readFileFn(imgInput.filePath);
      } catch (err) {
        logger.warn({ checkId, event: "file_read_error", inputId: imgInput.id });
        appendEvent(
          checkId,
          {
            type: "stage",
            round: 0,
            status: "could_not_check",
            summary: "Image file could not be read",
            createdAt: nowFn(),
          },
          db
        );
        continue;
      }

      const valRes = await validateImageBuffer(fileBuffer);
      if (!valRes.ok) {
        logger.warn({ checkId, event: "invalid_image", code: valRes.error.code });
        appendEvent(
          checkId,
          {
            type: "stage",
            round: 0,
            status: "could_not_check",
            summary: "Uploaded image failed format validation",
            createdAt: nowFn(),
          },
          db
        );
        continue;
      }

      // Call Vision LLM
      const systemPrompt = [
        "You are an expert OCR and opportunity verification extraction engine.",
        "Your task is to transcribe all readable text from the screenshot and extract key entity candidates.",
        "Follow these rules strictly:",
        "1. Transcribe visible text accurately into 'transcribedText'.",
        "2. Extract any URLs into 'urls'.",
        "3. Extract any fee or deposit amounts into 'amounts'.",
        "4. Extract any UPI IDs or payment handles into 'paymentIds'.",
        "5. Extract claimed organization or company names into 'organisationNames' (max 5).",
        "6. Return strictly raw JSON conforming to the schema.",
      ].join("\n");

      const prompt = wrapUntrusted(
        "SCREENSHOT_INSTRUCTION",
        "Transcribe the screenshot image and extract entity candidates matching the schema."
      );

      const base64Data = valRes.buffer.toString("base64");
      let llmRes;
      try {
        llmRes = await generateFn({
          system: systemPrompt,
          prompt,
          images: [{ inlineData: { mimeType: valRes.mimeType, data: base64Data } }],
          schema: VisionExtractionSchema,
          timeoutMs: 25000,
          purpose: "vision_extraction",
        });
      } catch (genErr) {
        llmRes = {
          ok: false,
          error: { code: "ERROR", message: genErr.message },
        };
      }

      if (!llmRes.ok) {
        logger.warn({ checkId, event: "vision_llm_failed", code: llmRes.error?.code });
        appendEvent(
          checkId,
          {
            type: "stage",
            round: 0,
            status: "could_not_check",
            summary: "OCR unavailable: vision extraction failed or timed out",
            createdAt: nowFn(),
          },
          db
        );
        continue;
      }

      const data = llmRes.data;
      if (data.transcribedText && typeof data.transcribedText === "string") {
        combinedTranscribedText += (combinedTranscribedText ? "\n\n" : "") + data.transcribedText.trim();
      }

      // Validate URLs from vision
      if (Array.isArray(data.urls)) {
        for (const u of data.urls) {
          try {
            const parsed = new URL(u);
            if (parsed.protocol === "http:" || parsed.protocol === "https:") {
              visionEntities.push({
                kind: "url",
                value: parsed.href,
                source: "extracted",
                evidence: { type: "quote", value: String(u) },
              });
              const normD = normalizeDomain(parsed.hostname);
              if (normD) {
                visionEntities.push({
                  kind: "domain",
                  value: normD,
                  source: "extracted",
                  evidence: { type: "quote", value: String(parsed.hostname) },
                });
              }
            }
          } catch {
            // invalid url dropped
          }
        }
      }

      // Validate payment IDs from vision
      if (Array.isArray(data.paymentIds)) {
        for (const pid of data.paymentIds) {
          const normUpi = normalizeUpi(pid);
          if (normUpi && upiFacts(normUpi).valid && classifyAtString(normUpi) === "upi") {
            visionEntities.push({
              kind: "upi",
              value: normUpi,
              source: "extracted",
              evidence: { type: "quote", value: String(pid) },
            });
          }
        }
      }

      // Validate amounts from vision
      if (Array.isArray(data.amounts)) {
        for (const amt of data.amounts) {
          const normAmt = normalizeAmount(amt);
          if (normAmt) {
            visionEntities.push({
              kind: "amount",
              value: normAmt,
              source: "extracted",
              evidence: { type: "quote", value: String(amt) },
            });
          }
        }
      }

      // Validate organisation names: keep ONLY if appearing in transcribedText
      if (Array.isArray(data.organisationNames)) {
        const capped = data.organisationNames.slice(0, 5);
        for (const org of capped) {
          const normOrg = normalizeCompany(org);
          if (normOrg && quoteInText(org, data.transcribedText)) {
            logger.info({ checkId, event: "company_extracted", method: "vision_ocr" });
            visionEntities.push({
              kind: "company",
              value: normOrg,
              source: "extracted",
              evidence: { type: "quote", value: String(org) },
            });
          }
        }
      }
    }

    // Merge transcribed text into check inputs if OCR found text
    if (combinedTranscribedText) {
      textSnippets.push(combinedTranscribedText);
      replaceTextInputs(checkId, textSnippets, db);
    }

    // Run text extraction on all text (original + OCR + user notes)
    const hasUserText = inputs.some((i) => (i.type === "text" || i.type === "user_notes") && i.value?.trim());
    const allCombinedText = [...textSnippets, ...notesSnippets].join("\n\n");
    const textExtractedEntities = extractEntitiesFromText(allCombinedText);

    // Run LLM Entity Sweep over combined input text when user provided text in an input box
    const llmEntities = [];
    if (hasUserText && allCombinedText.trim().length > 0) {
      const sweepSystemPrompt = [
        "You are an expert entity extraction engine for opportunity verification.",
        "Your task is to identify key entity candidates from student opportunity notices and communication notes.",
        "Follow these rules strictly:",
        "1. Extract claimed hiring, scholarship, or contest organizations/companies into 'companies' (e.g. Google, Tata, SBI).",
        "2. Extract named government scholarship, fellowship, or grant schemes into 'schemes' (e.g. PM Vidyalaxmi scholarship, National Means-cum-Merit Scholarship).",
        "3. Extract account usernames or social handles into 'handles' (e.g. @google_hr_careers). Do NOT extract communications channels (such as Telegram, WhatsApp) or person first/last names (such as Priya) as handles.",
        "4. Infer the platform for each handle if mentioned (instagram, telegram, youtube, reddit, x, other).",
        "5. Extract fee or deposit amounts into 'amounts'.",
        "6. Extract UPI payment IDs into 'paymentIds'.",
        "7. For EVERY entity, provide an exact quote substring from the text as 'quote'.",
        "8. Return strictly JSON matching the schema.",
      ].join("\n");

      let sweepRes = null;
      let promptText = wrapUntrusted("USER_INPUT_TEXT", allCombinedText);
      const sweepTimeout = deps.sweepTimeoutMs || SWEEP_TIMEOUT_MS;

      // 1 initial call + 1 retry with validation error = up to 2 attempts
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          sweepRes = await generateFn({
            system: sweepSystemPrompt,
            prompt: promptText,
            schema: EntitySweepSchema,
            timeoutMs: sweepTimeout,
            purpose: "entity_sweep",
          });
          if (sweepRes && sweepRes.ok) {
            break;
          }
          if (attempt === 0) {
            const errMsg = sweepRes?.error?.message || "Output failed schema validation";
            promptText = `${promptText}\n\n[ATTENTION: Previous attempt failed: ${errMsg}. Correct all field errors and return strictly valid JSON conforming to the schema.]`;
          }
        } catch (genErr) {
          sweepRes = {
            ok: false,
            error: { code: "ERROR", message: genErr.message },
          };
          if (attempt === 0) {
            promptText = `${promptText}\n\n[ATTENTION: Previous attempt failed: ${genErr.message}. Ensure your output strictly adheres to the requested JSON schema.]`;
          }
        }
      }

      if (!sweepRes || !sweepRes.ok) {
        logger.warn({ checkId, event: "entity_sweep_failed", code: sweepRes?.error?.code });
        appendEvent(
          checkId,
          {
            type: "stage",
            round: 0,
            status: "could_not_check",
            summary: "LLM entity sweep unavailable: falling back to deterministic extraction",
            payload: {
              extractionNotes: "entity sweep unavailable; companies and handles may be incomplete",
            },
            createdAt: nowFn(),
          },
          db
        );

        // Deterministic known-organisation fallback:
        // Match text against known organization brand names (word-boundary, case-insensitive)
        for (const orgName of KNOWN_ORGANISATIONS) {
          const orgRegex = new RegExp(`\\b${escapeRegex(orgName)}\\b`, "i");
          const m = allCombinedText.match(orgRegex);
          if (m) {
            const normCompany = normalizeCompany(orgName);
            if (normCompany) {
              logger.info({
                checkId,
                event: "company_extracted",
                method: "deterministic_known_org_fallback",
              });
              llmEntities.push({
                kind: "company",
                value: normCompany,
                source: "extracted",
                evidence: { type: "quote", value: m[0] },
              });
            }
          }
        }
      } else {
        const sweepData = sweepRes.data;

        // Process Companies
        if (Array.isArray(sweepData.companies)) {
          for (const item of sweepData.companies) {
            if (!item?.name || !item?.quote) continue;
            // Grounding check: quote must be in text
            if (!isQuoteGrounded(item.quote, allCombinedText)) {
              continue;
            }
            const normCompany = normalizeCompany(item.name);
            if (normCompany) {
              logger.info({
                checkId,
                event: "company_extracted",
                method: "llm_sweep",
              });
              llmEntities.push({
                kind: "company",
                value: normCompany,
                source: "extracted",
                evidence: { type: "quote", value: item.quote.trim() },
              });
            }
          }
        }

        // Process Schemes
        if (Array.isArray(sweepData.schemes)) {
          for (const item of sweepData.schemes) {
            if (!item?.name || !item?.quote) continue;
            // Grounding check: quote must be in text
            if (!isQuoteGrounded(item.quote, allCombinedText)) {
              continue;
            }
            const normScheme = normalizeCompany(item.name);
            if (normScheme) {
              logger.info({
                checkId,
                event: "scheme_extracted",
                method: "llm_sweep",
              });
              llmEntities.push({
                kind: "scheme",
                value: normScheme,
                source: "extracted",
                evidence: { type: "quote", value: item.quote.trim() },
              });
            }
          }
        }

        // Process Handles
        if (Array.isArray(sweepData.handles)) {
          for (const item of sweepData.handles) {
            if (!item?.handle || !item?.quote) continue;
            // Grounding check
            if (!isQuoteGrounded(item.quote, allCombinedText)) {
              continue;
            }
            const cleanHandle = item.handle.toLowerCase().replace(/^@/, "").trim();
            // Disallow communication channel names
            if (CHANNEL_NAMES.has(cleanHandle)) {
              continue;
            }
            const normHandle = normalizeHandle(item.handle);
            if (normHandle) {
              const plat = resolvePlatform(explicitHandlePlatform, userUrls, item.platform);
              llmEntities.push({
                kind: "handle",
                value: normHandle,
                platform: plat,
                source: "extracted",
                evidence: { type: "quote", value: item.quote.trim() },
              });
            }
          }
        }

        // Process UPI Payment IDs
        if (Array.isArray(sweepData.paymentIds)) {
          for (const item of sweepData.paymentIds) {
            if (!item?.id || !item?.quote) continue;
            if (!isQuoteGrounded(item.quote, allCombinedText)) {
              continue;
            }
            const normUpi = normalizeUpi(item.id);
            if (normUpi && upiFacts(normUpi).valid && classifyAtString(normUpi) === "upi") {
              llmEntities.push({
                kind: "upi",
                value: normUpi,
                source: "extracted",
                evidence: { type: "quote", value: item.quote.trim() },
              });
            }
          }
        }

        // Process Amounts
        if (Array.isArray(sweepData.amounts)) {
          for (const item of sweepData.amounts) {
            if (!item?.amount || !item?.quote) continue;
            if (!isQuoteGrounded(item.quote, allCombinedText)) {
              continue;
            }
            const normAmt = normalizeAmount(item.amount);
            if (normAmt) {
              llmEntities.push({
                kind: "amount",
                value: normAmt,
                source: "extracted",
                evidence: { type: "quote", value: item.quote.trim() },
              });
            }
          }
        }
      }
    }

    // Merge and Deduplicate Entities
    const mergedEntitiesMap = new Map();

    function addCandidate(ent) {
      if (!ent?.kind || !ent?.value) return;
      const key = ent.kind === "company" ? `${ent.kind}:${ent.value.toLowerCase()}` : `${ent.kind}:${ent.value}`;
      const existing = mergedEntitiesMap.get(key);

      if (!existing) {
        const record = {
          checkId,
          kind: ent.kind,
          value: ent.value,
          source: ent.source,
          round: ent.round ?? 0,
          confirmed: ent.confirmed ?? false,
        };
        if (ent.platform) record.platform = ent.platform;
        if (ent.evidence) record.evidence = ent.evidence;
        mergedEntitiesMap.set(key, record);
      } else {
        // Enrich existing entity with platform or evidence if missing
        if (!existing.platform && ent.platform) {
          existing.platform = ent.platform;
        }
        if (!existing.evidence && ent.evidence) {
          existing.evidence = ent.evidence;
        }
        // User entities take precedence
        if (ent.source === "user") {
          existing.source = "user";
          existing.confirmed = true;
        }
      }
    }

    // Merging order: User entities take priority
    for (const ue of userEntities) addCandidate(ue);
    for (const te of textExtractedEntities) addCandidate(te);
    for (const le of llmEntities) addCandidate(le);
    for (const ve of visionEntities) addCandidate(ve);

    // Enforce Entity Cap
    const finalEntities = Array.from(mergedEntitiesMap.values()).slice(0, MAX_ENTITIES_PER_CHECK);

    // Save entities atomically
    replaceEntities(checkId, finalEntities, db);

    // Move state to awaiting_confirmation
    updateStatus(checkId, "awaiting_confirmation", db);

    appendEvent(
      checkId,
      {
        type: "stage",
        round: 0,
        summary: `Extraction complete: ${finalEntities.length} entities identified`,
        createdAt: nowFn(),
      },
      db
    );

    return {
      checkId,
      status: "awaiting_confirmation",
      extractedCount: finalEntities.length,
      textTranscribed: Boolean(combinedTranscribedText),
    };
  } catch (err) {
    logger.error({ checkId, stage: "extraction", error: err.message });
    // Transition to failed only on unrecoverable fatal errors (e.g. database error)
    try {
      updateCheckResult(
        checkId,
        {
          status: "failed",
          failureReason: "extraction_error",
        },
        db
      );
    } catch {
      // ignore secondary failure
    }
    throw err;
  } finally {
    // Deterministic Unlink and Clear File Path on ALL paths
    for (const f of filesToCleanup) {
      try {
        if (fs.existsSync(f.path)) {
          await unlinkFn(f.path);
        }
      } catch (unlinkErr) {
        logger.warn({ checkId, event: "file_unlink_error", error: unlinkErr.message });
      }
      try {
        clearInputFile(f.id, db);
      } catch (clearErr) {
        logger.warn({ checkId, event: "clear_input_file_error", error: clearErr.message });
      }
    }
  }
}
