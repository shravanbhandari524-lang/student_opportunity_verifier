/**
 * lib/contracts/ledger.js
 *
 * Contract and Zod schema for Evidence Ledger entries.
 * Pure data contract.
 */

import { z } from "zod";
import { CONFIDENCE_LEVELS } from "./enums.js";

export const LEDGER_KINDS = ["flag", "verified", "limit", "signal"];
export const EVIDENCE_TYPES = ["quote", "url", "rule", "model_output"];

export const LedgerEntrySchema = z
  .object({
    id: z.string().min(1),
    checkId: z.string().min(1).optional(),
    agent: z.string().min(1),
    round: z.number().int().min(0).max(2),
    kind: z.enum(LEDGER_KINDS),
    flagId: z.string().nullable().optional(),
    claimKey: z.string().min(1),
    quoteOrUrl: z.string().nullable().optional(),
    evidenceType: z.enum(EVIDENCE_TYPES),
    verificationStatus: z.string().min(1),
    confidence: z.enum(CONFIDENCE_LEVELS),
    supportingSource: z.string().nullable().optional(),
    timestamp: z.string().min(1),
  })
  .strict();
