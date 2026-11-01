import { z } from "zod";
import { AGENT_NAMES, AGENT_KINDS, AGENT_STATUSES, ENTITY_KINDS } from "./enums.js";
import { FlagSchema } from "./flag.js";
import { EvidenceSchema, isHttpOrHttps } from "./evidence.js";
import { canEmit } from "./flags.js";
import { validateEntityValue } from "./entity.js";
import { ClassifierResultSchema } from "./classifier-result.js";

const ManualCheckItemSchema = z
  .object({
    label: z.string().min(1),
    url: z.string().refine(isHttpOrHttps, {
      message: "Manual check URL must be a valid HTTP or HTTPS URL",
    }),
  })
  .strict();

const DiscoveredEntitySchema = z
  .object({
    kind: z.enum(["domain", "handle", "company"]),
    value: z.string().min(1),
    evidence: EvidenceSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    validateEntityValue(data.kind, data.value, ctx, ["value"]);
  });

export const ACTIVITY_TYPES = Object.freeze([
  "input",
  "step",
  "finding",
  "verified",
  "limit",
  "manual",
]);

export const ACTIVITY_STATUSES = Object.freeze([
  "ok",
  "warn",
  "failed",
  "skipped",
  "info",
]);

export const ACTIVITY_TOOLS = Object.freeze([
  "rdap",
  "dns",
  "ssl",
  "wayback",
  "search",
  "llm",
  "graph",
  "classifier",
  "fetch",
  "rules",
]);

export const ActivitySourceSchema = z
  .object({
    label: z.string().min(1).max(120),
    url: z.string().refine(isHttpOrHttps, {
      message: "Source URL must be a valid HTTP or HTTPS URL",
    }),
  })
  .strict();

export const ActivityEntrySchema = z
  .object({
    seq: z.number().int().nonnegative(),
    atMs: z.number().int().nonnegative(),
    type: z.enum(ACTIVITY_TYPES),
    status: z.enum(ACTIVITY_STATUSES),
    title: z.string().min(1).max(120),
    detail: z.string().max(400).optional(),
    tool: z.enum(ACTIVITY_TOOLS).optional(),
    sources: z.array(ActivitySourceSchema).max(5).default([]),
    flagId: z.string().optional(),
  })
  .strict();

export const AgentResultSchema = z
  .object({
    id: z.number().int().positive().optional(),
    checkId: z.string().uuid(),
    agent: z.enum(AGENT_NAMES),
    kind: z.enum(AGENT_KINDS),
    round: z.number().int().min(1).max(2),
    status: z.enum(AGENT_STATUSES),
    reason: z.string().nullable().optional(),
    summary: z.string().max(160).default(""),
    activity: z.array(ActivityEntrySchema).max(40).default([]),
    flags: z.array(FlagSchema).max(20),
    verified: z.array(z.string()),
    newEntities: z.array(DiscoveredEntitySchema).max(5),
    processedEntities: z.array(z.string()),
    unchecked: z.array(z.string()),
    manualChecks: z.array(ManualCheckItemSchema),
    trace: z.array(z.any()).default([]),
    notes: z.string().default(""),
    durationMs: z.number().int().nonnegative(),
    classifierResult: ClassifierResultSchema.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // 0. Check classifierResult restrictions (D3)
    if (data.classifierResult !== undefined) {
      if (data.agent !== "classifier_client") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult classifierResult is allowed ONLY when agent is 'classifier_client' (got '${data.agent}').`,
          path: ["classifierResult"],
        });
      }
      if (data.status !== "ok") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult classifierResult is allowed ONLY when status is 'ok' (got '${data.status}').`,
          path: ["classifierResult"],
        });
      }
    }

    // 1. Check flag emission authorization and uniqueness
    const seenFlagIds = new Set();
    for (let i = 0; i < data.flags.length; i++) {
      const flag = data.flags[i];
      if (!canEmit(flag.id, data.agent)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Agent '${data.agent}' is not authorized to emit flag '${flag.id}'. Authorized emitters: ${flag.id in flag ? "" : "see FLAG_REGISTRY"}.`,
          path: ["flags", i, "id"],
        });
      }
      if (seenFlagIds.has(flag.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate flag id '${flag.id}' found in AgentResult. Flag IDs must be unique within one result.`,
          path: ["flags", i, "id"],
        });
      }
      seenFlagIds.add(flag.id);
    }

    // 2. Validate processedEntities format: "<entity kind>:<value>" with a valid kind
    for (let i = 0; i < data.processedEntities.length; i++) {
      const item = data.processedEntities[i];
      const colonIdx = item.indexOf(":");
      if (colonIdx === -1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid processedEntities entry '${item}'. Must match '<entity kind>:<value>'.`,
          path: ["processedEntities", i],
        });
      } else {
        const kind = item.slice(0, colonIdx);
        if (!ENTITY_KINDS.includes(kind)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid entity kind '${kind}' in processedEntities entry '${item}'.`,
            path: ["processedEntities", i],
          });
        }
      }
    }

    // 3. Non-ok status rules:
    // When status is "skipped" or "could_not_check":
    // - reason is required (non-empty string)
    // - flags, verified, newEntities, processedEntities, unchecked, manualChecks must all be empty
    if (data.status !== "ok") {
      if (!data.reason || data.reason.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult with status '${data.status}' requires a non-empty reason.`,
          path: ["reason"],
        });
      }
      if (data.flags.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult with status '${data.status}' must have empty flags array.`,
          path: ["flags"],
        });
      }
      if (data.verified.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult with status '${data.status}' must have empty verified array.`,
          path: ["verified"],
        });
      }
      if (data.newEntities.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult with status '${data.status}' must have empty newEntities array.`,
          path: ["newEntities"],
        });
      }
      if (data.processedEntities.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult with status '${data.status}' must have empty processedEntities array.`,
          path: ["processedEntities"],
        });
      }
      if (data.unchecked.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult with status '${data.status}' must have empty unchecked array.`,
          path: ["unchecked"],
        });
      }
      if (data.manualChecks.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AgentResult with status '${data.status}' must have empty manualChecks array.`,
          path: ["manualChecks"],
        });
      }
    }
  });
