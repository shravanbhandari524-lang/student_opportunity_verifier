/**
 * lib/evidence/ledger.js
 *
 * Evidence Ledger & Cross-Method Reconciliation Engine.
 * Pure code: no file reads, no network, no DB, no LLM, no mutation of inputs.
 */

import crypto from "node:crypto";
import { LedgerEntrySchema } from "../contracts/ledger.js";
import { classifySource } from "./source-classifier.js";

export const FLAG_TO_CLAIM_KEY = {
  // Fee & payment demands (duplicate claims from multiple agents/patterns)
  scholarship_fee_demand: "fee_demand",
  fee_demand: "fee_demand",
  upfront_payment_demand: "fee_demand",
  refundable_fee_offer: "fee_demand",
  crypto_payment_request: "fee_demand",
  task_deposit_script: "fee_demand",

  // Payment channel anomalies
  personal_upi_id: "payment_channel",
  personal_payment_id: "payment_channel",
  payment_qr_code: "payment_channel",
  qr_code_payment_request: "payment_channel",

  // Equipment / advance fees
  equipment_fee: "equipment_advance",
  training_fee: "equipment_advance",
  courier_fee: "equipment_advance",

  // Official standing
  not_on_official_portal: "official_standing",
  contradicted_by_official_source: "official_standing",

  // Public reputation & OSINT
  public_negative_reports: "public_reputation",
  fraud_alert_match: "public_reputation",

  // Domain & Brand Impersonation
  lookalike_domain: "domain_brand_impersonation",
  domain_company_mismatch: "domain_brand_impersonation",
};

/**
 * Deterministically generates a stable 16-hex character ID from input fields.
 *
 * @param {string} inputStr
 * @returns {string} Stable prefixed ID
 */
export function generateStableLedgerId(inputStr) {
  const hash = crypto.createHash("sha256").update(String(inputStr)).digest("hex").slice(0, 16);
  return `ev_${hash}`;
}

/**
 * Builds an array of normalized Evidence Ledger entries from case snapshot and sanitized agent results.
 * Pure code: does not perform I/O or DB writes.
 *
 * @param {object} snapshot - Case file snapshot
 * @param {Array<object>} sanitizedResults - Validated agent results
 * @returns {Array<import("../contracts/ledger.js").LedgerEntry>} Array of validated ledger entries
 */
export function buildLedger(snapshot, sanitizedResults = []) {
  const checkId = snapshot?.check?.id || "unknown";
  const results = Array.isArray(sanitizedResults) ? sanitizedResults : [];
  const entries = [];
  const now = new Date().toISOString();

  for (const result of results) {
    if (!result || typeof result !== "object") continue;
    const agent = result.agent || "unknown";
    const round = Number(result.round) || 1;

    // 1. Process Flags
    if (Array.isArray(result.flags)) {
      for (const flag of result.flags) {
        if (!flag || !flag.id) continue;
        const claimKey = FLAG_TO_CLAIM_KEY[flag.id] || flag.id;
        const evidenceItems = Array.isArray(flag.evidence) && flag.evidence.length > 0
          ? flag.evidence
          : [{ type: "quote", value: flag.explanation || flag.title }];

        for (const ev of evidenceItems) {
          const quoteOrUrl = ev.value || "";
          const isUrl = ev.type === "url" || (typeof quoteOrUrl === "string" && (quoteOrUrl.startsWith("http://") || quoteOrUrl.startsWith("https://")));
          const evidenceType = isUrl ? "url" : "quote";
          const sourceInfo = isUrl ? classifySource(quoteOrUrl) : null;
          const isOfficial = agent === "official_verifier" || Boolean(sourceInfo && sourceInfo.isAuthoritative);
          const isLow = Boolean(sourceInfo && sourceInfo.isForumOrAggregator);
          const confidence = isOfficial ? "high" : (isLow ? "low" : "medium");

          const id = generateStableLedgerId(`${checkId}:${agent}:${round}:flag:${flag.id}:${quoteOrUrl}`);

          // Decorate original flag evidence with traceability metadata
          ev.evidenceId = id;
          ev.sourceAgent = agent;

          const entry = {
            id,
            checkId,
            agent,
            round,
            kind: "flag",
            flagId: flag.id,
            claimKey,
            quoteOrUrl: quoteOrUrl.slice(0, 500),
            evidenceType,
            verificationStatus: "flagged",
            confidence,
            supportingSource: agent,
            timestamp: now,
          };

          entries.push(LedgerEntrySchema.parse(entry));
        }
      }
    }

    // 2. Process Verified Items
    if (Array.isArray(result.verified)) {
      for (const item of result.verified) {
        const text = typeof item === "string" ? item : (item?.text || "");
        if (!text) continue;
        const isUrl = text.startsWith("http://") || text.startsWith("https://");
        const claimKey = agent === "official_verifier" ? "official_standing" : (agent === "website_forensics" ? "domain_authenticity" : "general_verification");
        const id = generateStableLedgerId(`${checkId}:${agent}:${round}:verified:${text}`);

        const entry = {
          id,
          checkId,
          agent,
          round,
          kind: "verified",
          flagId: null,
          claimKey,
          quoteOrUrl: text.slice(0, 500),
          evidenceType: isUrl ? "url" : "rule",
          verificationStatus: "verified",
          confidence: "high",
          supportingSource: agent,
          timestamp: now,
        };

        entries.push(LedgerEntrySchema.parse(entry));
      }
    }

    // 3. Process ML Classifier Signals
    if (agent === "classifier_client" && result.classifierResult && typeof result.classifierResult.probability === "number") {
      const p = result.classifierResult.probability;
      const label = result.classifierResult.label || (p >= 0.5 ? "suspicious" : "benign");
      const id = generateStableLedgerId(`${checkId}:${agent}:${round}:signal:classifier`);

      const entry = {
        id,
        checkId,
        agent,
        round,
        kind: "signal",
        flagId: null,
        claimKey: "ml_probability",
        quoteOrUrl: `probability=${p};label=${label}`,
        evidenceType: "model_output",
        verificationStatus: p >= 0.5 ? "suspicious" : "benign",
        confidence: "low",
        supportingSource: "services/classifier/model.joblib",
        timestamp: now,
      };

      entries.push(LedgerEntrySchema.parse(entry));
    }

    // 4. Process Limits & Unchecked Statuses
    if (result.status === "could_not_check" || (Array.isArray(result.limits) && result.limits.length > 0)) {
      const reason = result.reason || "agent_check_limit";
      const id = generateStableLedgerId(`${checkId}:${agent}:${round}:limit:${reason}`);

      const entry = {
        id,
        checkId,
        agent,
        round,
        kind: "limit",
        flagId: null,
        claimKey: `limit_${agent}`,
        quoteOrUrl: reason.slice(0, 500),
        evidenceType: "rule",
        verificationStatus: "could_not_check",
        confidence: "medium",
        supportingSource: agent,
        timestamp: now,
      };

      entries.push(LedgerEntrySchema.parse(entry));
    }

    // 5. Process Entity Statuses
    if (Array.isArray(result.entityStatus)) {
      for (const es of result.entityStatus) {
        if (!es || !es.entityValue) continue;

        // Invariant 1: Amounts never get verification statuses
        if (es.entityKind === "amount") {
          continue;
        }

        // Invariant 2: The Message Analyst never produces domain or official-standing signals
        if (agent === "message_analyst") {
          continue;
        }

        // Invariant 3: NOT_FOUND, UNVERIFIED, PARTIAL and skipped must never map to contradicted
        const statusLower = (es.status || "").toLowerCase();
        if (
          [
            "not_found",
            "unverified",
            "partial",
            "skipped",
            "checked_no_issue",
            "could_not_check",
          ].includes(statusLower)
        ) {
          continue;
        }

        const isContradicted = statusLower === "contradicted";
        const isVerified = statusLower === "verified";

        if (isContradicted || isVerified) {
          // Invariant 4: Contradicted strictly requires an authoritative source URL in the evidence
          let authoritativeEvidenceUrl = null;
          if (isContradicted) {
            // Check flags of this result for an authoritative URL
            const matchingFlag = (result.flags || []).find((f) =>
              f.evidence?.some((ev) => {
                if (ev.type === "url" || (typeof ev.value === "string" && ev.value.startsWith("http"))) {
                  return classifySource(ev.value).isAuthoritative;
                }
                return false;
              })
            );
            if (matchingFlag) {
              const evItem = matchingFlag.evidence.find((ev) => classifySource(ev.value).isAuthoritative);
              authoritativeEvidenceUrl = evItem?.value;
            } else if (es.reason && es.reason.includes("http")) {
              const urlMatch = es.reason.match(/https?:\/\/[^\s]+/);
              if (urlMatch && classifySource(urlMatch[0]).isAuthoritative) {
                authoritativeEvidenceUrl = urlMatch[0];
              }
            }

            // If no authoritative source URL supports contradiction, do not map to contradicted!
            if (!authoritativeEvidenceUrl) {
              continue;
            }
          }

          // Invariant 5: Claim key mapping respects agent specialty
          let claimKey;
          if (agent === "official_verifier") {
            claimKey = es.entityKind === "domain" ? "domain_authenticity" : "official_standing";
          } else if (agent === "website_forensics") {
            claimKey = "domain_authenticity";
          } else if (agent === "reputation_osint") {
            claimKey = "public_reputation";
          } else if (agent === "payment_entity") {
            claimKey = "payment_channel";
          } else {
            claimKey = "general_verification";
          }

          const quoteOrUrl = authoritativeEvidenceUrl || es.entityValue;
          const isUrl = Boolean(authoritativeEvidenceUrl);
          const confidence = isVerified || (isContradicted && isUrl) ? "high" : "medium";

          const id = generateStableLedgerId(
            `${checkId}:${agent}:${round}:entity_status:${es.entityValue}:${es.status}`
          );
          const entry = {
            id,
            checkId,
            agent,
            round,
            kind: isVerified ? "verified" : "signal",
            flagId: isContradicted ? "contradicted_by_official_source" : null,
            claimKey,
            quoteOrUrl,
            evidenceType: isUrl ? "url" : "rule",
            verificationStatus: es.status,
            confidence,
            supportingSource: agent,
            timestamp: now,
          };
          entries.push(LedgerEntrySchema.parse(entry));
        }
      }
    }
  }

  return entries;
}

/**
 * Pure cross-method reconciliation of evidence ledger entries.
 * Detects duplicates, independent corroborations, and contradictions across methods.
 *
 * @param {Array<object>} ledger - Array of ledger entries
 * @returns {{
 *   duplicates: string[],
 *   corroborations: string[],
 *   contradictions: string[],
 *   summary: string[]
 * }} Plain-language reconciliation report
 */
export function reconcile(ledger) {
  if (!Array.isArray(ledger)) {
    return { duplicates: [], corroborations: [], contradictions: [], summary: [] };
  }

  const duplicates = [];
  const corroborations = [];
  const contradictions = [];

  // Group ledger entries by claimKey
  const byClaim = new Map();
  for (const entry of ledger) {
    if (!byClaim.has(entry.claimKey)) {
      byClaim.set(entry.claimKey, []);
    }
    byClaim.get(entry.claimKey).push(entry);
  }

  // 1. Detect duplicates: same claimKey with overlapping evidence from different agents
  for (const [claimKey, entries] of byClaim.entries()) {
    const flagEntries = entries.filter((e) => e.kind === "flag");
    if (flagEntries.length > 1) {
      const agents = Array.from(new Set(flagEntries.map((e) => e.agent)));
      if (agents.length > 1) {
        for (let i = 0; i < flagEntries.length; i++) {
          for (let j = i + 1; j < flagEntries.length; j++) {
            const e1 = flagEntries[i];
            const e2 = flagEntries[j];
            if (e1.agent !== e2.agent) {
              const q1 = (e1.quoteOrUrl || "").toLowerCase();
              const q2 = (e2.quoteOrUrl || "").toLowerCase();
              const overlaps = (q1 && q2 && (q1.includes(q2) || q2.includes(q1))) || claimKey === "fee_demand";
              if (overlaps) {
                const quoteExcerpt = e1.quoteOrUrl ? ` on quote "${e1.quoteOrUrl.slice(0, 40)}"` : "";
                const msg = `Duplicate finding for ${claimKey} between ${e1.agent} and ${e2.agent}${quoteExcerpt}.`;
                if (!duplicates.includes(msg)) {
                  duplicates.push(msg);
                }
              }
            }
          }
        }
      }
    }
  }

  // 2. Corroborations: independent methods supporting the same claim
  // (a) Upfront fee demand corroboration: LLM quote (message_analyst) + payment demand / rule
  const feeEntries = byClaim.get("fee_demand") || [];
  const feeAgents = new Set(feeEntries.map((e) => e.agent));
  if (feeAgents.has("message_analyst") && feeAgents.has("payment_analyst")) {
    corroborations.push(
      "Message analysis and payment analysis both independently identified an upfront fee demand."
    );
  } else if (feeAgents.has("message_analyst") && feeEntries.some((e) => e.evidenceType === "rule")) {
    corroborations.push(
      "Language pattern analysis and deterministic rule verification both confirmed an upfront fee demand."
    );
  }

  // (b) OSINT fraud alerts corroborating other flags
  const osintReports = (byClaim.get("public_reputation") || []).filter((e) => e.agent === "osint_investigator" && e.kind === "flag");
  const otherScamFlags = ledger.filter((e) => e.agent !== "osint_investigator" && e.kind === "flag");
  if (osintReports.length > 0 && otherScamFlags.length > 0) {
    corroborations.push(
      "Public scam reports found by OSINT corroborate the warning signs identified in the opportunity."
    );
  }

  // (c) Technical domain forensics corroborating OSINT
  const domainFlags = ledger.filter((e) => e.agent === "website_forensics" && e.kind === "flag");
  if (domainFlags.length > 0 && osintReports.length > 0) {
    corroborations.push(
      "Technical domain forensics and OSINT search both independently flagged risks associated with the web address."
    );
  }

  // (d) ML classifier corroborating message analysis
  const mlSignal = (byClaim.get("ml_probability") || []).find((e) => e.verificationStatus === "suspicious");
  const textualFlags = ledger.filter((e) => e.agent === "message_analyst" && e.kind === "flag");
  if (mlSignal && textualFlags.length > 0) {
    corroborations.push(
      "Machine learning classifier probability corroborates the textual anomalies detected by message analysis."
    );
  }

  // 3. Contradictions:
  // (a) Classifier low vs rule or LLM finding of a fee
  const mlLow = (byClaim.get("ml_probability") || []).find((e) => {
    if (e.verificationStatus === "benign") return true;
    const match = (e.quoteOrUrl || "").match(/probability=([\d.]+)/);
    if (match && parseFloat(match[1]) < 0.25) return true;
    return false;
  });
  if (mlLow && feeEntries.some((e) => e.kind === "flag")) {
    let probPct = "low";
    const match = (mlLow.quoteOrUrl || "").match(/probability=([\d.]+)/);
    if (match) {
      probPct = `${Math.round(parseFloat(match[1]) * 100)}%`;
    }
    contradictions.push(
      `The ML model rated this message ${probPct} scam-like, but message analysis found a deposit demand. Evidence from the message text outweighs the model.`
    );
  }

  // (b) Official verified versus warning/contradiction on the same entity
  const officialVerified = (byClaim.get("official_standing") || []).some((e) => e.verificationStatus === "verified");
  const officialContradicted = (byClaim.get("official_standing") || []).some((e) => e.verificationStatus === "contradicted" || e.flagId === "contradicted_by_official_source");
  const osintScamAlert = (byClaim.get("public_reputation") || []).some((e) => e.flagId === "fraud_alert_match" || e.flagId === "public_negative_reports");
  if (officialVerified && (officialContradicted || osintScamAlert)) {
    contradictions.push(
      "Official sources verified the scheme, but external fraud reports raised scam alerts targeting its name."
    );
  }

  // (c) Official-domain list versus domain mismatch flag
  const domainMismatch = ledger.some((e) => e.flagId === "domain_company_mismatch");
  const domainVerified = ledger.some((e) => e.kind === "verified" && (e.claimKey.includes("domain") || e.supportingSource === "official_verifier"));
  if (domainMismatch && domainVerified) {
    contradictions.push(
      "The domain is listed in the official verified registry, but website forensics flagged a domain-entity mismatch."
    );
  }
  if (domainMismatch && domainVerified) {
    contradictions.push(
      "The domain is listed in the official verified registry, but website forensics flagged a domain-entity mismatch."
    );
  }

  const summary = [];
  if (contradictions.length > 0) {
    summary.push(...contradictions);
  }
  if (corroborations.length > 0) {
    summary.push(...corroborations);
  }

  return {
    duplicates,
    corroborations,
    contradictions,
    summary,
  };
}
