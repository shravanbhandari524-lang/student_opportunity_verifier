/**
 * lib/contracts/trace.js
 *
 * Contract and Zod schemas for real-time agent trace events.
 * Common fields on every event: { seq, checkId, ts, round, agent }.
 * Enforces a strict 4 KB serialization limit with truncation helper.
 */

import { z } from "zod";
import { AGENT_NAMES } from "./enums.js";
import { ActivityEntrySchema } from "./agent-result.js";

export const MAX_EVENT_BYTES = 4096;

export const TRACE_EVENT_TYPES = [
  "agent_status",
  "tool_start",
  "tool_end",
  "note",
  "flag",
  "verdict",
  "entity",
  "round",
  "stage",
  "complete",
  "activity",
];

// Common metadata fields present on all trace events
const CommonFields = {
  seq: z.number().int().nonnegative(),
  checkId: z.string().min(1),
  ts: z.string().min(1),
  round: z.number().int().min(0).max(2),
  agent: z.string().nullable(),
};

// ---------------------------------------------------------------------------
// Tool End Details (Discriminated union on `tool`)
// ---------------------------------------------------------------------------

export const SearchToolDetailSchema = z
  .object({
    tool: z.literal("search"),
    query: z.string(),
    resultCount: z.number().int().nonnegative(),
    results: z
      .array(
        z
          .object({
            title: z.string(),
            url: z.string(),
            snippet: z.string().max(200),
            read: z.boolean(),
          })
          .strict()
      )
      .max(10),
  })
  .strict();

export const FetchPageToolDetailSchema = z
  .object({
    tool: z.literal("fetchPage"),
    url: z.string(),
    httpStatus: z.number().int().nonnegative(),
    title: z.string(),
    excerpt: z.string().max(300),
    blocked: z.boolean(),
  })
  .strict();

export const RdapLookupToolDetailSchema = z
  .object({
    tool: z.literal("rdapLookup"),
    domain: z.string(),
    registeredAt: z.string().nullable(),
    ageDays: z.number().int().nullable(),
    registrar: z.string().nullable(),
  })
  .strict();

export const DnsRecordsToolDetailSchema = z
  .object({
    tool: z.literal("dnsRecords"),
    domain: z.string(),
    hasMx: z.boolean(),
    hasA: z.boolean(),
  })
  .strict();

export const SslInfoToolDetailSchema = z
  .object({
    tool: z.literal("sslInfo"),
    issuer: z.string().nullable(),
    validTo: z.string().nullable(),
  })
  .strict();

export const WaybackFirstSeenToolDetailSchema = z
  .object({
    tool: z.literal("waybackFirstSeen"),
    firstSeen: z.string().nullable(),
  })
  .strict();

export const LookalikeCheckToolDetailSchema = z
  .object({
    tool: z.literal("lookalikeCheck"),
    closestDomain: z.string().nullable(),
    distance: z.number().int().nullable(),
  })
  .strict();

export const ClassifierToolDetailSchema = z
  .object({
    tool: z.literal("classifier"),
    probability: z.number().min(0).max(1),
    topTerms: z.array(z.string()),
  })
  .strict();

export const PaymentsToolDetailSchema = z
  .object({
    tool: z.literal("payments"),
    identifier: z.string(),
    formatValid: z.boolean(),
  })
  .strict();

export const GraphLookupToolDetailSchema = z
  .object({
    tool: z.literal("graphLookup"),
    identifier: z.string(),
    matchCount: z.number().int().nonnegative(),
    linked: z.array(z.string()),
  })
  .strict();

export const YoutubeCommentsToolDetailSchema = z
  .object({
    tool: z.literal("youtubeComments"),
    sampled: z.number().int().nonnegative(),
    duplicateRatio: z.number().min(0).max(1),
  })
  .strict();

export const SafeBrowsingToolDetailSchema = z
  .object({
    tool: z.literal("safeBrowsing"),
    verdict: z.string(),
  })
  .strict();

export const UrlscanToolDetailSchema = z
  .object({
    tool: z.literal("urlscan"),
    verdict: z.string(),
  })
  .strict();

export const ToolEndDetailSchema = z.discriminatedUnion("tool", [
  SearchToolDetailSchema,
  FetchPageToolDetailSchema,
  RdapLookupToolDetailSchema,
  DnsRecordsToolDetailSchema,
  SslInfoToolDetailSchema,
  WaybackFirstSeenToolDetailSchema,
  LookalikeCheckToolDetailSchema,
  ClassifierToolDetailSchema,
  PaymentsToolDetailSchema,
  GraphLookupToolDetailSchema,
  YoutubeCommentsToolDetailSchema,
  SafeBrowsingToolDetailSchema,
  UrlscanToolDetailSchema,
]);

// ---------------------------------------------------------------------------
// Trace Events (Discriminated union on `type`)
// ---------------------------------------------------------------------------

export const AgentStatusTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("agent_status"),
    status: z.enum(["started", "done", "skipped", "could_not_check"]),
    summary: z.string(),
  })
  .strict();

export const ToolStartTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("tool_start"),
    callId: z.string().min(1),
    tool: z.string().min(1),
    label: z.string().min(1),
    input: z.string(),
  })
  .strict();

export const ToolEndTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("tool_end"),
    callId: z.string().min(1),
    tool: z.string().min(1),
    status: z.enum(["ok", "error", "cached"]),
    durationMs: z.number().int().nonnegative(),
    summary: z.string(),
    detail: ToolEndDetailSchema,
  })
  .strict();

export const NoteTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("note"),
    text: z.string().max(80),
  })
  .strict();

export const FlagTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("flag"),
    flagId: z.string().min(1),
    title: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]),
    evidence: z.array(
      z
        .object({
          type: z.enum(["quote", "url"]),
          value: z.string(),
        })
        .strict()
    ),
  })
  .strict();

export const VerdictTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("verdict"),
    claim: z.string().min(1),
    verdict: z.enum(["verified", "unverified", "contradicted"]),
    sources: z.array(z.string()),
  })
  .strict();

export const EntityTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("entity"),
    kind: z.string().min(1),
    value: z.string().min(1),
    evidence: z.string().min(1),
  })
  .strict();

export const RoundTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("round"),
    round: z.number().int().min(1).max(2),
  })
  .strict();

export const StageTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("stage"),
    stage: z.string().min(1),
  })
  .strict();

export const CompleteTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("complete"),
  })
  .strict();

export const ActivityTraceEventSchema = z
  .object({
    ...CommonFields,
    type: z.literal("activity"),
    entry: ActivityEntrySchema,
  })
  .strict();

export const TraceEventSchema = z.discriminatedUnion("type", [
  AgentStatusTraceEventSchema,
  ToolStartTraceEventSchema,
  ToolEndTraceEventSchema,
  NoteTraceEventSchema,
  FlagTraceEventSchema,
  VerdictTraceEventSchema,
  EntityTraceEventSchema,
  RoundTraceEventSchema,
  StageTraceEventSchema,
  CompleteTraceEventSchema,
  ActivityTraceEventSchema,
]);

// ---------------------------------------------------------------------------
// Candidate Schema (seq is optional or non-negative for initial emit)
// ---------------------------------------------------------------------------

export const CandidateTraceEventSchema = z.discriminatedUnion("type", [
  AgentStatusTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  ToolStartTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  ToolEndTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  NoteTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  FlagTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  VerdictTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  EntityTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  RoundTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  StageTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  CompleteTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
  ActivityTraceEventSchema.extend({ seq: z.number().int().nonnegative().optional() }),
]);

// ---------------------------------------------------------------------------
// 4 KB Serialization Limit & Truncation Helper
// ---------------------------------------------------------------------------

/**
 * Truncates string/excerpt fields of a trace event so its serialized JSON
 * representation does not exceed maxBytes (default 4096 bytes).
 * Never drops the event; preserves structure.
 *
 * @param {object} event
 * @param {number} [maxBytes=MAX_EVENT_BYTES]
 * @returns {object} Truncated event
 */
export function truncateEventPayload(event, maxBytes = MAX_EVENT_BYTES) {
  if (!event || typeof event !== "object") return event;

  // Clone deeply to avoid mutating caller object
  let clone = JSON.parse(JSON.stringify(event));

  // 1. First clamp fields that have strict schema maximums
  if (clone.type === "note" && typeof clone.text === "string" && clone.text.length > 80) {
    clone.text = clone.text.slice(0, 80);
  }
  if (clone.type === "stage" && typeof clone.stage === "string" && clone.stage.length > 64) {
    clone.stage = clone.stage.slice(0, 64);
  }
  if (clone.type === "tool_end" && clone.detail) {
    if (clone.detail.tool === "fetchPage" && typeof clone.detail.excerpt === "string" && clone.detail.excerpt.length > 300) {
      clone.detail.excerpt = clone.detail.excerpt.slice(0, 300);
    }
    if (clone.detail.tool === "search" && Array.isArray(clone.detail.results)) {
      for (const res of clone.detail.results) {
        if (typeof res.snippet === "string" && res.snippet.length > 200) {
          res.snippet = res.snippet.slice(0, 200);
        }
      }
    }
  }

  const getByteLen = (obj) => Buffer.byteLength(JSON.stringify(obj), "utf8");

  if (getByteLen(clone) <= maxBytes) {
    return clone;
  }

  // 2. If still over maxBytes (4 KB), aggressively truncate string/excerpt fields
  if (clone.type === "tool_start" && typeof clone.input === "string" && clone.input.length > 100) {
    clone.input = clone.input.slice(0, 100);
  }

  if (clone.type === "tool_end" && clone.detail) {
    if (clone.detail.tool === "fetchPage" && typeof clone.detail.excerpt === "string" && clone.detail.excerpt.length > 200) {
      clone.detail.excerpt = clone.detail.excerpt.slice(0, 200);
    }
    if (clone.detail.tool === "search" && Array.isArray(clone.detail.results)) {
      for (const res of clone.detail.results) {
        if (typeof res.snippet === "string" && res.snippet.length > 100) {
          res.snippet = res.snippet.slice(0, 100);
        }
      }
    }
    if (typeof clone.summary === "string" && clone.summary.length > 120) {
      clone.summary = clone.summary.slice(0, 120);
    }
  }

  if (clone.type === "note" && typeof clone.text === "string" && clone.text.length > 80) {
    clone.text = clone.text.slice(0, 80);
  }

  if (clone.type === "agent_status" && typeof clone.summary === "string" && clone.summary.length > 120) {
    clone.summary = clone.summary.slice(0, 120);
  }

  if (clone.type === "verdict" && typeof clone.claim === "string" && clone.claim.length > 150) {
    clone.claim = clone.claim.slice(0, 150);
  }

  if (clone.type === "entity" && typeof clone.evidence === "string" && clone.evidence.length > 150) {
    clone.evidence = clone.evidence.slice(0, 150);
  }

  if (clone.type === "flag" && Array.isArray(clone.evidence)) {
    for (const ev of clone.evidence) {
      if (typeof ev.value === "string" && ev.value.length > 150) {
        ev.value = ev.value.slice(0, 150);
      }
    }
  }

  if (clone.type === "activity" && clone.entry) {
    if (typeof clone.entry.detail === "string" && clone.entry.detail.length > 200) {
      clone.entry.detail = clone.entry.detail.slice(0, 200);
    }
    if (typeof clone.entry.title === "string" && clone.entry.title.length > 80) {
      clone.entry.title = clone.entry.title.slice(0, 80);
    }
  }

  if (getByteLen(clone) <= maxBytes) {
    return clone;
  }

  // 2. If still oversized, aggressively truncate results list or string fields
  if (clone.type === "tool_end" && clone.detail && clone.detail.tool === "search" && Array.isArray(clone.detail.results)) {
    while (clone.detail.results.length > 2 && getByteLen(clone) > maxBytes) {
      clone.detail.results.pop();
    }
    for (const res of clone.detail.results) {
      if (typeof res.snippet === "string" && res.snippet.length > 40) {
        res.snippet = res.snippet.slice(0, 40);
      }
    }
  }

  if (clone.type === "tool_end" && clone.detail && clone.detail.tool === "fetchPage" && typeof clone.detail.excerpt === "string") {
    clone.detail.excerpt = clone.detail.excerpt.slice(0, 50);
  }

  // 3. Fallback: recursively truncate any string longer than 40 chars until within budget
  function truncateStrings(obj, maxStrLen) {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (key === "type" || key === "tool" || key === "checkId" || key === "callId") continue;
      if (typeof obj[key] === "string" && obj[key].length > maxStrLen) {
        obj[key] = obj[key].slice(0, maxStrLen);
      } else if (typeof obj[key] === "object") {
        truncateStrings(obj[key], maxStrLen);
      }
    }
  }

  let limit = 40;
  while (getByteLen(clone) > maxBytes && limit >= 10) {
    truncateStrings(clone, limit);
    limit -= 10;
  }

  return clone;
}
