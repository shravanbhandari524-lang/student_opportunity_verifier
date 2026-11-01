/**
 * lib/scoring/config.js
 *
 * Scoring configuration for the opportunity verifier decision engine.
 * Pure code: zod-validated at load, deeply frozen, containing exact starting weights.
 */

import { z } from "zod";
import {
  FLAG_REGISTRY,
  FLAG_GROUPS,
  FLAG_GROUP_CAPS,
  SOFT_FLAG_CAP,
  NO_HIGH_EVIDENCE_CAP,
} from "../contracts/index.js";
import { AGENT_NAMES } from "../contracts/enums.js";

function deepFreeze(obj) {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

export const ScoringConfigSchema = z
  .object({
    flagWeights: z.record(z.string(), z.number().int().nonnegative()),
    severityWeights: z
      .object({
        high: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        low: z.number().int().nonnegative(),
      })
      .strict(),
    thresholds: z
      .object({
        medium: z.number().int().nonnegative(),
        high: z.number().int().nonnegative(),
      })
      .strict(),
    cannotVerifyRatio: z.number().min(0).max(1),
    classifier: z
      .object({
        maxPoints: z.number().int().nonnegative(),
        zeroAt: z.number().min(0).max(1),
        fullAt: z.number().min(0).max(1),
      })
      .strict(),
    confidence: z
      .object({
        high: z.number().min(0).max(1),
        medium: z.number().min(0).max(1),
      })
      .strict(),
    flagGroups: z.record(z.string(), z.array(z.string())),
    groupCaps: z.record(z.string(), z.number().int().nonnegative()).optional(),
    softFlagCap: z.number().int().nonnegative().optional(),
    noHighEvidenceCap: z.number().int().nonnegative().optional(),
    hardRules: z.array(z.string()),
    externalEvidenceAgents: z.array(z.string()),
    criticalAgents: z.array(z.string()),
  })
  .strict()
  .superRefine((data, ctx) => {
    const registryKeys = Object.keys(FLAG_REGISTRY);
    const weightKeys = Object.keys(data.flagWeights);

    // Exactly the 36 registry ids: no more, no fewer
    if (weightKeys.length !== registryKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `flagWeights has ${weightKeys.length} keys; expected exactly ${registryKeys.length}`,
        path: ["flagWeights"],
      });
    }

    for (const key of registryKeys) {
      if (!Object.prototype.hasOwnProperty.call(data.flagWeights, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing flagWeights entry for registry flag: ${key}`,
          path: ["flagWeights", key],
        });
      }
    }

    for (const key of weightKeys) {
      if (!Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `flagWeights contains unknown flag ID: ${key}`,
          path: ["flagWeights", key],
        });
      }
    }

    // Group members must exist in registry
    for (const [groupName, members] of Object.entries(data.flagGroups)) {
      for (let i = 0; i < members.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, members[i])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `flagGroups.${groupName}[${i}] contains unknown flag ID: ${members[i]}`,
            path: ["flagGroups", groupName, i],
          });
        }
      }
    }

    // Hard rule ids must exist in registry
    for (let i = 0; i < data.hardRules.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, data.hardRules[i])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `hardRules[${i}] contains unknown flag ID: ${data.hardRules[i]}`,
          path: ["hardRules", i],
        });
      }
    }

    // Critical agents must exist in registered AGENT_NAMES
    for (let i = 0; i < data.criticalAgents.length; i++) {
      if (!AGENT_NAMES.includes(data.criticalAgents[i])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `criticalAgents[${i}] contains unknown agent name: ${data.criticalAgents[i]}`,
          path: ["criticalAgents", i],
        });
      }
    }
  });

const rawConfig = {
  flagWeights: {
    // high (17)
    scholarship_fee_demand: 30,
    fee_demand: 30,
    equipment_advance: 25,
    mule_account_request: 40,
    bank_details_request: 25,
    otp_or_id_request: 30,
    authority_impersonation: 25,
    task_deposit_script: 30,
    crypto_payment_request: 30,
    paid_placement_guarantee: 25,
    apk_download_prompt: 30,
    qr_code_payment_request: 20,
    lookalike_domain: 20,
    non_gov_domain_claiming_gov: 25,
    personal_payment_id: 25,
    official_warning_found: 40,
    scam_reports_found: 25,
    graph_match: 40,
    url_in_threat_feed: 40,
    domain_company_mismatch: 25,

    // medium (12)
    no_interview_selection: 15,
    unsolicited_award: 15,
    chat_only_interview: 15,
    pay_too_high: 15,
    data_harvest_redirects: 15,
    guaranteed_income: 15,
    free_email_recruiter: 15,
    domain_new: 20,
    raw_ip_opportunity_link: 20,
    not_on_official_portal: 20,
    review_burst: 10,
    copied_content: 10,
    unpaid_trial_work: 15,
    referral_recruitment: 15,
    classifier_high: 0,

    // low (7)
    candidate_picks_hours: 10,
    unusual_pay_schedule: 10,
    urgency_pressure: 10,
    off_platform_contact: 10,
    domain_no_history: 5,
    ssl_anomaly: 5,
    foreign_or_voip_number: 5,
  },
  severityWeights: {
    high: 25,
    medium: 15,
    low: 5,
  },
  thresholds: {
    medium: 25,
    high: 60,
  },
  cannotVerifyRatio: 0.40,
  classifier: {
    maxPoints: 25,
    zeroAt: 0.5,
    fullAt: 1.0,
  },
  confidence: {
    high: 0.80,
    medium: 0.50,
  },
  flagGroups: FLAG_GROUPS,
  groupCaps: FLAG_GROUP_CAPS,
  softFlagCap: SOFT_FLAG_CAP,
  noHighEvidenceCap: NO_HIGH_EVIDENCE_CAP,
  hardRules: ["scholarship_fee_demand", "mule_account_request", "graph_match"],
  externalEvidenceAgents: [
    "website_forensics",
    "official_verifier",
    "reputation_osint",
    "payment_entity",
  ],
  criticalAgents: ["message_analyst"],
};

// Validate config at load time
ScoringConfigSchema.parse(rawConfig);

export const config = deepFreeze(rawConfig);
export const defaultConfig = config;
