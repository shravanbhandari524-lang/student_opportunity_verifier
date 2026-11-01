/**
 * lib/actions/index.js
 *
 * Pure, deterministic action document builders:
 * - buildCollegeEmail(report, request) -> CollegeEmailResponse
 * - buildFraudSummary(report, request) -> FraudSummaryResponse
 *
 * Invariants:
 * - Pure functions: no I/O, no DB access, no network, zero LLM calls.
 * - Input is strictly validated Report (never raw user message text) plus validated request.
 * - Safe subject line: single-line string with all \r and \n characters stripped.
 * - Neutral phrasing: never uses accusatory patterns (reusing banned patterns in lib/report/constants.js).
 * - Quotes truncated to max 150 characters, wrapped in quotes, and sanitized of control characters.
 * - No HTML rendering (plain text only).
 * - Reporting channels output verified URLs only if listed in MANUAL_LINKS; otherwise strictly unverified advisory text ("verify on the official site").
 * - English and Hindi templates supported. Hindi outputs carry notes: ["needs native review"].
 */

import {
  CollegeEmailResponseSchema,
  FraudSummaryResponseSchema,
} from "../contracts/actions.js";
import { FLAG_REGISTRY } from "../contracts/flags.js";
import {
  BANNED_SCAMMER_PATTERNS,
  BANNED_SAFETY_PHRASES,
  DISCLAIMER_EN,
  DISCLAIMER_HI,
  REPORTING_CHANNELS,
} from "../report/constants.js";
import { MANUAL_LINKS } from "../agents/manual-links.js";

const RECIPIENT_ROLES = {
  en: {
    placement_cell: "Training & Placement Officer / Placement Cell",
    dean_student_welfare: "Dean of Student Welfare (DSW)",
    department_head: "Head of Department (HoD)",
    grievance_officer: "Student Grievance Redressal Officer",
  },
  hi: {
    placement_cell: "प्रशिक्षण एवं प्लेसमेंट अधिकारी / प्लेसमेंट सेल (Placement Cell)",
    dean_student_welfare: "अधिष्ठाता, छात्र कल्याण (Dean of Student Welfare)",
    department_head: "विभागाध्यक्ष (Head of Department)",
    grievance_officer: "छात्र शिकायत निवारण अधिकारी (Student Grievance Officer)",
  },
};

const PAYMENT_METHOD_LABELS = {
  en: {
    upi: "UPI (Unified Payments Interface)",
    netbanking: "Net Banking / IMPS / NEFT",
    card: "Debit / Credit Card",
    wallet: "Prepaid Wallet",
    cash: "Cash / Deposit",
    other: "Other Electronic Transfer",
  },
  hi: {
    upi: "यूपीआई (UPI)",
    netbanking: "नेट बैंकिंग / बैंक ट्रांसफर",
    card: "डेबिट / क्रेडिट कार्ड",
    wallet: "मोबाइल वॉलेट",
    cash: "नकद (Cash)",
    other: "अन्य इलेक्ट्रॉनिक माध्यम",
  },
};

/**
 * Truncates and sanitizes evidence quote for safe inclusion in plain text reports.
 * Strips HTML tags, trims, and truncates to max 150 characters.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanQuote(text) {
  if (!text || typeof text !== "string") return "";
  // Strip simple HTML tags if any
  let s = text.replace(/<[^>]*>/g, " ");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > 150) {
    s = s.slice(0, 147).trim() + "...";
  }
  return s;
}

/**
 * Asserts that generated text does not contain banned safety or scammer phrases.
 *
 * @param {string} text
 */
function assertNoBannedPhrases(text) {
  for (const pat of BANNED_SCAMMER_PATTERNS) {
    if (pat.test(text)) {
      throw new Error(`Generated action text violated banned scammer pattern: ${pat}`);
    }
  }
  for (const phrase of BANNED_SAFETY_PHRASES) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      throw new Error(`Generated action text violated banned safety phrase: '${phrase}'`);
    }
  }
}

/**
 * Builds a deterministic college notice email template.
 *
 * @param {import("../contracts/report.js").Report} report
 * @param {import("../contracts/actions.js").CollegeEmailRequest} request
 * @returns {import("../contracts/actions.js").CollegeEmailResponse}
 */
export function buildCollegeEmail(report, request = {}) {
  const lang = request.language === "hi" ? "hi" : "en";
  const recipientType = request.recipientType || "placement_cell";
  const recipientRole = RECIPIENT_ROLES[lang][recipientType] || RECIPIENT_ROLES[lang].placement_cell;

  const refId = (report.checkId || "").slice(0, 8);
  const risk = report.riskLevel;

  // Single-line subject without \r or \n
  let subject = "";
  if (lang === "hi") {
    subject = `सत्यापन अनुरोध: संदिग्ध अवसर मूल्यांकन (संदर्भ: ${refId})`;
  } else {
    subject = `Verification Request: Suspicious Offer Assessment (Ref: ${refId})`;
  }
  // Sanitize subject strictly
  subject = subject.replace(/[\r\n]+/g, " ").trim().slice(0, 200);

  // Formulate flags summary with truncated quotes
  const flagLines = [];
  if (Array.isArray(report.flags) && report.flags.length > 0) {
    for (const f of report.flags) {
      const reg = FLAG_REGISTRY[f.id];
      const title = f.title || (reg ? reg.description : f.id);
      const quotes = (f.evidence || [])
        .filter((e) => e.type === "quote" && e.value)
        .map((e) => `"${cleanQuote(e.value)}"`);
      
      let line = `- ${title} [${f.severity || "medium"}]`;
      if (quotes.length > 0) {
        line += `\n  Quoted evidence: ${quotes.slice(0, 2).join(", ")}`;
      }
      flagLines.push(line);
    }
  }

  const flagsSection = flagLines.length > 0
    ? flagLines.join("\n")
    : (lang === "hi" ? "कोई गंभीर जोखिम संकेत नहीं मिला।" : "No critical risk flags detected.");

  let body = "";
  if (lang === "hi") {
    body = [
      `प्रति: ${recipientRole}`,
      ``,
      `विषय: ${subject}`,
      ``,
      `महोदय/महोदया,`,
      ``,
      `मैं सत्यापन के लिए एक संदिग्ध अवसर/प्रस्ताव का विवरण प्रस्तुत कर रहा हूँ। सार्वजनिक रूप से उपलब्ध जानकारी के आधार पर एक स्वचालित जोखिम मूल्यांकन किया गया था:`,
      ``,
      `[मूल्यांकन सारांश]`,
      `- संदर्भ आईडी: ${report.checkId}`,
      `- मूल्यांकित जोखिम स्तर: ${risk}`,
      `- मूल्यांकन स्कोर: ${report.score}/100`,
      `- संभावित प्रकार: ${report.scamTypeGuess || "अज्ञात"}`,
      `- सारांश: ${report.summary}`,
      ``,
      `[चिह्नित संकेत एवं साक्ष्य]`,
      flagsSection,
      ``,
      `कृपया पुष्टि करें कि क्या यह अवसर आपके कार्यालय द्वारा अनुमोदित या संबद्ध है। जब तक आधिकारिक पुष्टि नहीं हो जाती, छात्रों को कोई भी राशि भुगतान न करने की सलाह दी जाती है।`,
      ``,
      `धन्यवाद,`,
      `संबद्ध छात्र`,
      ``,
      `---`,
      `अस्वीकरण: ${DISCLAIMER_HI}`,
    ].join("\n");
  } else {
    body = [
      `To: ${recipientRole}`,
      ``,
      `Subject: ${subject}`,
      ``,
      `Dear Sir/Madam,`,
      ``,
      `I am forwarding the details of an opportunity notice received recently for institutional verification. Based on publicly available data, an automated risk assessment was performed with the following findings:`,
      ``,
      `[Assessment Overview]`,
      `- Reference ID: ${report.checkId}`,
      `- Assessed Risk Level: ${risk}`,
      `- Risk Score: ${report.score}/100`,
      `- Opportunity Type: ${report.scamTypeGuess || "unknown"}`,
      `- Summary: ${report.summary}`,
      ``,
      `[Detected Observations & Evidence]`,
      flagsSection,
      ``,
      `Could you please verify whether this company, internship, or scholarship program is registered with or recognized by our institution? Students are advised not to make any financial payments until official verification is provided.`,
      ``,
      `Sincerely,`,
      `Student`,
      ``,
      `---`,
      `Disclaimer: ${DISCLAIMER_EN}`,
    ].join("\n");
  }

  assertNoBannedPhrases(subject);
  assertNoBannedPhrases(body);

  const notes = [];
  if (lang === "hi") {
    notes.push("needs native review");
  }

  return CollegeEmailResponseSchema.parse({
    subject,
    body,
    recipientRole,
    notes: notes.length > 0 ? notes : undefined,
  });
}

/**
 * Builds a deterministic cybercrime / institutional fraud summary complaint document.
 *
 * @param {import("../contracts/report.js").Report} report
 * @param {import("../contracts/actions.js").FraudSummaryRequest} request
 * @returns {import("../contracts/actions.js").FraudSummaryResponse}
 */
export function buildFraudSummary(report, request = {}) {
  const isStandalone = !report || !report.checkId;
  const lang = request.language === "hi" ? "hi" : "en";
  const refId = isStandalone ? (lang === "hi" ? "स्वतंत्र" : "STANDALONE") : (report.checkId || "").slice(0, 8);
  const amount = request.amount ? `INR ${request.amount}` : (lang === "hi" ? "अनिर्दिष्ट" : "Unspecified");
  const dateStr = request.date || (lang === "hi" ? "अनिर्दिष्ट" : "Unspecified");
  const paymentMethodLabel = request.paymentMethod
    ? PAYMENT_METHOD_LABELS[lang][request.paymentMethod]
    : (lang === "hi" ? "अनिर्दिष्ट" : "Unspecified");

  const title = lang === "hi"
    ? `साइबर अपराध शिकायत विवरण (संदर्भ: ${refId})`
    : `Cybercrime Incident Narrative (Ref: ${refId})`;

  // Extract relevant evidence quotes from report
  const quoteLines = [];
  if (report && Array.isArray(report.flags)) {
    for (const f of report.flags) {
      const quotes = (f.evidence || [])
        .filter((e) => e.type === "quote" && e.value)
        .map((e) => `"${cleanQuote(e.value)}"`);
      if (quotes.length > 0) {
        quoteLines.push(`- ${f.title}: ${quotes.slice(0, 2).join(", ")}`);
      }
    }
  }

  const quotesSection = isStandalone
    ? (lang === "hi"
        ? "कोई जांच साक्ष्य या केस निष्कर्ष संलग्न नहीं हैं (स्वतंत्र रिपोर्ट)।"
        : "No check investigation evidence or case file findings attached (standalone report).")
    : (quoteLines.length > 0
        ? quoteLines.join("\n")
        : (lang === "hi" ? "कोई उद्धरण दर्ज नहीं।" : "No specific quoted evidence recorded."));

  let narrative = "";
  if (lang === "hi") {
    narrative = [
      `घटना विवरण (साइबर अपराध एवं बैंक शिकायत हेतु):`,
      ``,
      isStandalone
        ? `- संदर्भ: स्वतंत्र रिपोर्ट (कोई जांच साक्ष्य संलग्न नहीं)`
        : `- संदर्भ पहचानकर्ता: ${report.checkId}`,
      `- घटना दिनांक: ${dateStr}`,
      `- संदिग्ध लेनदेन राशि: ${amount}`,
      `- भुगतान माध्यम: ${paymentMethodLabel}`,
      ...(isStandalone
        ? [
            `- अवसर श्रेणी: स्व-रिपोर्टेड वित्तीय विवाद`,
            `- तकनीकी मूल्यांकन: स्वतंत्र स्व-रिपोर्ट; कोई केस फाइल या जांच साक्ष्य संलग्न नहीं।`,
            `- मूल्यांकन सारांश: उपयोगकर्ता द्वारा प्रस्तुत शिकायत ड्राफ्ट।`,
          ]
        : [
            `- अवसर श्रेणी: ${report.scamTypeGuess || "अज्ञात"}`,
            `- तकनीकी मूल्यांकन: यह प्रस्ताव सार्वजनिक सूचना के आधार पर ${report.riskLevel} जोखिम के रूप में मूल्यांकित किया गया।`,
            `- मूल्यांकन सारांश: ${report.summary}`,
          ]),
      ``,
      `[चिह्नित साक्ष्य एवं संदेश उद्धरण]`,
      quotesSection,
      ``,
      `---`,
      `अस्वीकरण: ${DISCLAIMER_HI}`,
    ].join("\n");
  } else {
    narrative = [
      `INCIDENT SUMMARY (For National Cyber Crime Reporting Portal & Bank Complaint):`,
      ``,
      isStandalone
        ? `- Reference: Standalone report (no check investigation evidence attached)`
        : `- Reference ID: ${report.checkId}`,
      `- Incident Date: ${dateStr}`,
      `- Disputed Amount: ${amount}`,
      `- Payment Method: ${paymentMethodLabel}`,
      ...(isStandalone
        ? [
            `- Category: Self-reported financial dispute`,
            `- Technical Evaluation: Standalone self-report; no case file findings or check evidence attached.`,
            `- Evaluation Summary: User-initiated incident complaint draft.`,
          ]
        : [
            `- Category: ${report.scamTypeGuess || "unknown"}`,
            `- Technical Evaluation: Assessed as ${report.riskLevel} risk based on publicly verifiable indicators.`,
            `- Evaluation Summary: ${report.summary}`,
          ]),
      ``,
      `[Recorded Observations & Verbatim Quotes]`,
      quotesSection,
      ``,
      `---`,
      `Disclaimer: ${DISCLAIMER_EN}`,
    ].join("\n");
  }

  assertNoBannedPhrases(title);
  assertNoBannedPhrases(narrative);

  // Standard fixed victim steps
  const victimSteps = lang === "hi"
    ? [
        "1. तुरंत अपने बैंक या यूपीआई सेवा प्रदाता को कॉल करें और लेनदेन/खाता फ्रीज करने का अनुरोध करें।",
        "2. राष्ट्रीय साइबर अपराध रिपोर्टिंग पोर्टल (cybercrime.gov.in) पर आधिकारिक शिकायत दर्ज करें।",
        "3. सभी एसएमएस, चैट संदेश, भुगतान संदर्भ संख्या (UTR) और स्क्रीनशॉट सुरक्षित रखें।",
      ]
    : [
        "1. Immediately contact your bank or UPI provider helpline to freeze the transaction and account.",
        "2. File a formal complaint on the National Cyber Crime Reporting Portal (cybercrime.gov.in).",
        "3. Preserve all SMS records, transaction reference numbers (UTR), chats, and receipt screenshots.",
      ];

  // Resolve verified reporting channels
  // Channels are verified only if url matches MANUAL_LINKS; otherwise strictly unverified advisory text ("verify on the official site")
  const verifiedUrlsMap = new Map();
  for (const m of MANUAL_LINKS) {
    verifiedUrlsMap.set(m.id, m.url);
  }

  const channels = REPORTING_CHANNELS.map((ch) => {
    const isVerified = Boolean(ch.verified && ch.url && verifiedUrlsMap.has(ch.id));
    return {
      name: ch.name,
      url: isVerified ? ch.url : null,
      helpline: isVerified ? ch.helpline : null,
      verified: isVerified,
      text: lang === "hi" && ch.hiText ? ch.hiText : ch.text,
    };
  });

  const notes = [];
  if (lang === "hi") {
    notes.push("needs native review");
  }

  return FraudSummaryResponseSchema.parse({
    title,
    narrative,
    victimSteps,
    reportingChannels: channels,
    notes: notes.length > 0 ? notes : undefined,
  });
}
