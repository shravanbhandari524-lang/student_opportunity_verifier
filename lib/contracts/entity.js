import { z } from "zod";
import { ENTITY_KINDS, ENTITY_SOURCES, ORG_TYPES, AMOUNT_PURPOSES, AMOUNT_DIRECTIONS, AGENT_NAMES } from "./enums.js";
import { EvidenceSchema, isHttpOrHttps } from "./evidence.js";
import {
  normalizeDomain,
  classifyAtString,
  isValidE164,
  normalizeCompany,
  normalizeHandle,
} from "./normalize.js";

const UPI_REGEX = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{2,64}$/;
const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

/**
 * Validates entity value according to its kind:
 * - domain: normalizeDomain(value) === value and non-empty
 * - url: valid HTTP/HTTPS URL
 * - upi: matches regex and classifyAtString is "upi"
 * - email: classifyAtString is "email"
 * - phone: isValidE164
 * - company: normalized (trimmed, collapsed whitespace) and at most 200 chars
 * - handle: normalized (lowercase, no leading @) and non-empty
 * - amount: digits only non-empty string
 * - youtube_url: http/https with host in youtube.com, www.youtube.com, m.youtube.com, youtu.be
 */
export function validateEntityValue(kind, value, ctx, path = ["value"]) {
  if (typeof value !== "string" || value.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Entity value for kind '${kind}' must be a non-empty string`,
      path,
    });
    return;
  }

  switch (kind) {
    case "domain": {
      const normalized = normalizeDomain(value);
      if (!normalized || normalized !== value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid domain entity value: '${value}'. Must be non-empty and equal to normalizeDomain(value).`,
          path,
        });
      }
      break;
    }
    case "url": {
      if (!isHttpOrHttps(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid url entity value: '${value}'. Must be a valid HTTP or HTTPS URL.`,
          path,
        });
      }
      break;
    }
    case "upi": {
      if (!UPI_REGEX.test(value) || classifyAtString(value) !== "upi") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid upi entity value: '${value}'. Must match UPI format and have no dot after '@'.`,
          path,
        });
      }
      break;
    }
    case "email": {
      if (classifyAtString(value) !== "email") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid email entity value: '${value}'. Must be a valid email with a dot after '@'.`,
          path,
        });
      }
      break;
    }
    case "phone": {
      if (!isValidE164(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid phone entity value: '${value}'. Must follow E.164 format (^\\+[1-9]\\d{6,14}$).`,
          path,
        });
      }
      break;
    }
    case "company": {
      const normalized = normalizeCompany(value);
      if (value.length > 200 || normalized !== value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid company entity value. Must be normalized with single spaces and at most 200 characters.`,
          path,
        });
      }
      break;
    }
    case "scheme": {
      const normalized = normalizeCompany(value);
      if (value.length > 200 || normalized !== value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid scheme entity value. Must be normalized with single spaces and at most 200 characters.`,
          path,
        });
      }
      break;
    }
    case "handle": {
      const normalized = normalizeHandle(value);
      if (!normalized || normalized !== value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid handle entity value: '${value}'. Must be lowercase with no leading '@'.`,
          path,
        });
      }
      break;
    }
    case "amount": {
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid amount entity value: '${value}'. Must be digits-only.`,
          path,
        });
      }
      break;
    }
    case "youtube_url": {
      if (!isHttpOrHttps(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid youtube_url entity value: '${value}'. Must be a valid HTTP or HTTPS URL.`,
          path,
        });
        break;
      }
      try {
        const u = new URL(value);
        if (!ALLOWED_YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid youtube_url host: '${u.hostname}'. Must be youtube.com, www.youtube.com, m.youtube.com, or youtu.be.`,
            path,
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Could not parse youtube_url: '${value}'.`,
          path,
        });
      }
      break;
    }
  }
}

/**
 * Entity schema:
 * id: optional positive integer
 * checkId: UUID string
 * kind: domain, url, upi, email, phone, company, handle, amount, youtube_url
 * value: string validated according to kind
 * source: extracted, user, discovered
 * discoveredBy: null or absent unless source === "discovered"; when present, must be in AGENT_NAMES
 * round: integer, 0 for extracted/user; 1 or 2 for discovered
 * confirmed: required boolean (no default)
 * evidence: optional Evidence (required when source === "discovered")
 */
export const EntitySchema = z
  .object({
    id: z.number().int().positive().optional(),
    checkId: z.string().uuid(),
    kind: z.enum(ENTITY_KINDS),
    value: z.string().min(1),
    source: z.enum(ENTITY_SOURCES),
    platform: z.string().max(50).nullable().optional(),
    orgType: z.enum(ORG_TYPES).nullable().optional(),
    purpose: z.enum(AMOUNT_PURPOSES).nullable().optional(),
    direction: z.enum(AMOUNT_DIRECTIONS).nullable().optional(),
    discoveredBy: z.string().nullable().optional(),
    round: z.number().int().min(0).max(2).default(0),
    confirmed: z.boolean(),
    evidence: EvidenceSchema.nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // 1. Validate value per kind
    validateEntityValue(data.kind, data.value, ctx, ["value"]);

    // 2. Validate platform is only set on handle entities
    if (data.platform && data.kind !== "handle") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Platform may only be set for handle entities",
        path: ["platform"],
      });
    }

    // 2b. Validate orgType is only set on company entities
    if (data.orgType && data.kind !== "company") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "orgType may only be set for company entities",
        path: ["orgType"],
      });
    }

    // 2c. Validate purpose is only set on amount entities
    if (data.purpose && data.kind !== "amount") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "purpose may only be set for amount entities",
        path: ["purpose"],
      });
    }

    // 2d. Validate direction is only set on amount entities
    if (data.direction && data.kind !== "amount") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "direction may only be set for amount entities",
        path: ["direction"],
      });
    }

    // 3. Validate source, discoveredBy, round, and discovery kind restrictions
    if (data.source === "discovered") {
      if (!data.discoveredBy || !AGENT_NAMES.includes(data.discoveredBy)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Discovered entities must specify a valid agent name in discoveredBy (${AGENT_NAMES.join(", ")})`,
          path: ["discoveredBy"],
        });
      }
      if (!data.evidence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discovered entities must include source evidence",
          path: ["evidence"],
        });
      }
      if (data.round !== 1 && data.round !== 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Discovered entities must have round 1 or 2",
          path: ["round"],
        });
      }
      if (!["domain", "handle", "company"].includes(data.kind)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Discovered entities may only be of kind 'domain', 'handle', or 'company'. Found '${data.kind}'.`,
          path: ["kind"],
        });
      }
    } else {
      // source is extracted or user
      if (data.discoveredBy !== undefined && data.discoveredBy !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Non-discovered entities must not have discoveredBy set.`,
          path: ["discoveredBy"],
        });
      }
      if (data.round !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Initial entities (extracted, user) must have round 0",
          path: ["round"],
        });
      }
    }
  });
