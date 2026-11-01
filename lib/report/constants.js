/**
 * lib/report/constants.js
 *
 * Fixed strings, disclaimers, action templates, reporting channels, and banned phrase lists
 * for English and Hindi opportunity verification reports.
 *
 * NOTE: Hindi translations marked with "needs native review" are starting placeholders
 * pending native speaker verification before production deployment.
 */

export const BANNED_SAFETY_PHRASES = [
  "is safe",
  "are safe",
  "100% safe",
  "guaranteed safe",
  "guaranteed genuine",
  "no risk",
  "completely genuine",
  "verified safe",
  "totally safe",
  // Hindi equivalents (needs native review)
  "सुरक्षित है",
  "पूरी तरह सुरक्षित",
  "कोई जोखिम नहीं",
  "गारंटीकृत वास्तविक",
];

export const BANNED_SCAMMER_PATTERNS = [
  /\bis a scammer\b/i,
  /\bare scammers\b/i,
  /\bis a fraudster\b/i,
  /\bare fraudsters\b/i,
  /\bis a criminal\b/i,
  /\bare criminals\b/i,
  // Hindi equivalents (needs native review)
  /स्कैमर है/,
  /धोखेबाज है/,
  /अपराधी है/,
];

export const INSUFFICIENT_EVIDENCE_PHRASES_EN = [
  "not enough evidence",
  "insufficient details",
  "insufficient evidence",
  "cannot be verified",
  "could not verify",
  "more information is needed",
];

export const INSUFFICIENT_EVIDENCE_PHRASES_HI = [
  // Hindi equivalents (needs native review)
  "पर्याप्त प्रमाण नहीं",
  "अपर्याप्त जानकारी",
  "सत्यापित नहीं किया जा सका",
  "प्रमाण की कमी",
];

export const LOW_RISK_NOTICE_EN =
  "Low risk is not a guarantee of safety or endorsement. Always stay alert and verify official channels.";

export const LOW_RISK_NOTICE_HI =
  // Hindi equivalent (needs native review)
  "कम जोखिम सुरक्षा की कोई गारंटी नहीं है। हमेशा सतर्क रहें और आधिकारिक स्रोतों से पुष्टि करें।";

export const CRITICAL_AGENT_FAILED_NOTICE_EN =
  "The offer message could not be analysed due to a technical verification failure. Do not treat this result as safe; verify the opportunity through official channels.";

export const CRITICAL_AGENT_FAILED_NOTICE_HI =
  // Hindi equivalent (needs native review)
  "तकनीकी सत्यापन विफलता के कारण प्रस्ताव संदेश का विश्लेषण नहीं किया जा सका। इस परिणाम को सुरक्षित न समझें; आधिकारिक चैनलों के माध्यम से अवसर की पुष्टि करें।";

export const DISCLAIMER_EN =
  "This report is an automated risk assessment based on publicly verifiable data and evidence provided. It does not constitute a legal verdict, formal accusation, or guarantee of authenticity.";

export const DISCLAIMER_HI =
  // Hindi equivalent (needs native review)
  "यह रिपोर्ट सार्वजनिक रूप से सत्यापन योग्य डेटा पर आधारित एक स्वचालित जोखिम मूल्यांकन है। यह कोई कानूनी फैसला या प्रामाणिकता की गारंटी नहीं है।";

/**
 * UNKNOWN / unverified external reporting channels:
 * Kept strictly as unverified text recommendations: "verify on the official site".
 * No URL or phone number is presented as confirmed in the report.
 * Chakshu (https://sancharsaathi.gov.in) and Cybercrime (https://cybercrime.gov.in, 1930)
 * are not in lib/agents/manual-links.js and remain only in commented TODOs.
 */
export const REPORTING_CHANNELS = Object.freeze([
  {
    name: "National Cyber Crime Reporting Portal",
    // TODO: Verify https://cybercrime.gov.in and helpline 1930 against official advisories before enabling as confirmed contact
    url: null,
    helpline: null,
    verified: false,
    text: "Report incident to the National Cyber Crime Reporting Portal (verify on the official site)",
    hiText: "राष्ट्रीय साइबर अपराध रिपोर्टिंग पोर्टल पर घटना की रिपोर्ट करें (आधिकारिक साइट पर विवरण सत्यापित करें)",
  },
  {
    name: "Chakshu Portal (Sanchar Saathi)",
    // TODO: Verify https://sancharsaathi.gov.in against DoT advisories before enabling as confirmed contact
    url: null,
    helpline: null,
    verified: false,
    text: "Report suspected fraud communication via Chakshu Portal (verify on the official site)",
    hiText: "चक्षु पोर्टल के माध्यम से संदिग्ध संचार की रिपोर्ट करें (आधिकारिक साइट पर विवरण सत्यापित करें)",
  },
]);

export const ACTIONS_MAP = {
  en: {
    college_email: { id: "college_email", label: "Send template to college authority" },
    fraud_help: { id: "fraud_help", label: "View cybercrime reporting steps" },
    copy_checklist: { id: "copy_checklist", label: "Copy verification checklist" },
  },
  hi: {
    // Hindi action labels (needs native review)
    college_email: { id: "college_email", label: "कॉलेज प्राधिकरण को ईमेल टेम्पलेट भेजें" },
    fraud_help: { id: "fraud_help", label: "साइबर अपराध रिपोर्टिंग चरण देखें" },
    copy_checklist: { id: "copy_checklist", label: "सत्यापन चेकलिस्ट कॉपी करें" },
  },
};
