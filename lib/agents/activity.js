/**
 * lib/agents/activity.js
 *
 * Activity Recorder helper for specialist agents and coordinator.
 * Captures chronological step-by-step actions, tool calls, findings,
 * verified items, and limitations. Enforces strict length caps, plain-text
 * sanitization, and immediately emits live SSE activity events.
 */

import {
  ACTIVITY_TYPES,
  ACTIVITY_STATUSES,
  ACTIVITY_TOOLS,
  ActivityEntrySchema,
} from "../contracts/agent-result.js";

const MAX_ACTIVITY_ENTRIES = 40;
const MAX_TITLE_CHARS = 120;
const MAX_DETAIL_CHARS = 400;
const MAX_SUMMARY_CHARS = 160;
const MAX_SOURCES = 5;

/**
 * Sanitizes untrusted strings to clean plain text:
 * - strips HTML tags
 * - collapses whitespace
 * - limits length
 *
 * @param {unknown} val
 * @param {number} maxLen
 * @returns {string}
 */
export function sanitizePlainText(val, maxLen) {
  if (val === null || val === undefined) return "";
  let s = String(val);
  // Strip HTML tags if present
  s = s.replace(/<[^>]*>/g, " ");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) {
    s = s.slice(0, maxLen).trim();
  }
  return s;
}

/**
 * Sanitizes source attribution links (max 5, valid HTTP/HTTPS only).
 *
 * @param {unknown} sources
 * @returns {Array<{ label: string, url: string }>}
 */
export function sanitizeSources(sources) {
  if (!Array.isArray(sources)) return [];
  const valid = [];
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const url = typeof src.url === "string" ? src.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) continue;
    const label = sanitizePlainText(src.label || "Source", 120) || "Source";
    valid.push({ label, url });
    if (valid.length >= MAX_SOURCES) break;
  }
  return valid;
}

/**
 * Creates an activity recorder bound to an agent and event dispatcher.
 *
 * @param {object} options
 * @param {string} options.agent Agent identifier
 * @param {Function} [options.onEvent] Optional callback for live event forwarding
 * @param {Function} [options.nowFn] Optional timestamp provider (returns epoch ms)
 * @param {number} [options.round=1] Run round
 * @returns {object} ActivityRecorder instance
 */
export function createActivityRecorder(options = {}) {
  const agent = options.agent || "unknown_agent";
  const onEvent = typeof options.onEvent === "function" ? options.onEvent : null;
  const nowFn = typeof options.nowFn === "function"
    ? options.nowFn
    : (typeof options.now === "function" ? options.now : () => new Date().getTime());
  const round = typeof options.round === "number" ? options.round : 1;

  const entries = [];
  let summary = "";
  const startMs = nowFn();
  let nextSeq = 0;

  function record(type, status, params = {}) {
    if (entries.length >= MAX_ACTIVITY_ENTRIES) {
      return null;
    }

    const title = sanitizePlainText(params.title, MAX_TITLE_CHARS) || `${type} recorded`;
    const detail = params.detail ? sanitizePlainText(params.detail, MAX_DETAIL_CHARS) : undefined;
    const tool = ACTIVITY_TOOLS.includes(params.tool) ? params.tool : undefined;
    const sources = sanitizeSources(params.sources);
    const flagId = typeof params.flagId === "string" && params.flagId.trim() ? params.flagId.trim() : undefined;
    const safeType = ACTIVITY_TYPES.includes(type) ? type : "step";
    const safeStatus = ACTIVITY_STATUSES.includes(status) ? status : "info";

    const atMs = Math.max(0, nowFn() - startMs);

    const candidate = {
      seq: nextSeq++,
      atMs,
      type: safeType,
      status: safeStatus,
      title,
      ...(detail ? { detail } : {}),
      ...(tool ? { tool } : {}),
      sources,
      ...(flagId ? { flagId } : {}),
    };

    let validated;
    try {
      validated = ActivityEntrySchema.parse(candidate);
    } catch {
      // Fallback guarantees schema conformance
      validated = {
        seq: candidate.seq,
        atMs: candidate.atMs,
        type: "step",
        status: "info",
        title: candidate.title.slice(0, MAX_TITLE_CHARS),
        sources: [],
      };
    }

    entries.push(validated);

    if (onEvent) {
      try {
        onEvent({
          type: "activity",
          agent,
          round,
          entry: validated,
        });
      } catch {}
    }

    return validated;
  }

  return {
    get agent() {
      return agent;
    },
    get round() {
      return round;
    },

    input(params = {}) {
      return record("input", params.status || "info", params);
    },

    step(params = {}) {
      return record("step", params.status || "ok", params);
    },

    finding(params = {}) {
      return record("finding", params.status || "warn", params);
    },

    verified(params = {}) {
      return record("verified", params.status || "ok", params);
    },

    limit(params = {}) {
      return record("limit", params.status || "warn", params);
    },

    manual(params = {}) {
      return record("manual", params.status || "info", params);
    },

    setSummary(text) {
      summary = sanitizePlainText(text, MAX_SUMMARY_CHARS);
    },

    getSummary() {
      return summary;
    },

    getEntries() {
      return [...entries];
    },
  };
}

/**
 * Returns plain-language guidance on what input would enable a skipped agent.
 *
 * @param {string} agent
 * @param {string} [reason]
 * @returns {string}
 */
export function getSkippedGuidance(agent, reason = "") {
  if (agent === "website_forensics") {
    return "No link or domain was found. Add a link or website to run this check.";
  }
  if (agent === "official_verifier") {
    return "No organization name, scheme, or domain was found. Add a company, college, or official link to run this check.";
  }
  if (agent === "payment_entity") {
    return "No payment details, UPI ID, or phone number found. Add a UPI ID or phone to run this check.";
  }
  if (agent === "reputation_osint") {
    return "No company, brand, domain, or handle found. Add a company, link, or handle to run this check.";
  }
  if (agent === "message_analyst" || agent === "classifier_client") {
    return "No message text was found. Add message or email text to run this check.";
  }
  return reason ? `Check skipped (${reason}). Provide relevant input to run this check.` : "No applicable input was found for this check. Provide relevant input to run this check.";
}

/**
 * Ensures that an AgentResult has both `summary` and `activity` populated with
 * valid, schema-conforming items. Synthesizes minimal structured entries for
 * skipped, failed, or uninstrumented agents so that no UI card is ever blank.
 *
 * @param {object} result Raw or sanitized AgentResult
 * @returns {object} AgentResult with valid summary and activity
 */
export function ensureAgentActivityAndSummary(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const agent = result.agent || "unknown_agent";
  const durationMs = typeof result.durationMs === "number" ? result.durationMs : 0;
  let summary = typeof result.summary === "string" ? sanitizePlainText(result.summary, MAX_SUMMARY_CHARS) : "";
  const existingActivity = Array.isArray(result.activity) ? result.activity : [];

  // If activity is already populated and valid, keep it and ensure summary
  if (existingActivity.length > 0) {
    if (!summary) {
      const flagsCount = Array.isArray(result.flags) ? result.flags.length : 0;
      const verCount = Array.isArray(result.verified) ? result.verified.length : 0;
      if (flagsCount > 0) {
        summary = `Identified ${flagsCount} red flag${flagsCount > 1 ? "s" : ""}; ${verCount} item${verCount !== 1 ? "s" : ""} verified.`;
      } else if (verCount > 0) {
        summary = `No red flags found; ${verCount} item${verCount > 1 ? "s" : ""} verified (not a safety guarantee).`;
      } else {
        summary = "Check completed; no red flags detected (not a safety guarantee).";
      }
    }
    return {
      ...result,
      summary: sanitizePlainText(summary, MAX_SUMMARY_CHARS),
      activity: existingActivity.slice(0, MAX_ACTIVITY_ENTRIES),
    };
  }

  // Generate fallback activity
  const fallbackEntries = [];
  let nextSeq = 0;

  if (result.status === "skipped") {
    const guidance = getSkippedGuidance(agent, result.reason);
    if (!summary) {
      summary = `Check skipped: ${guidance}`;
    }
    fallbackEntries.push({
      seq: nextSeq++,
      atMs: 0,
      type: "limit",
      status: "skipped",
      title: "Check skipped",
      detail: sanitizePlainText(guidance, MAX_DETAIL_CHARS),
      sources: [],
    });
  } else if (result.status === "could_not_check") {
    const plainReason = result.reason === "pipeline_timeout"
      ? "Execution timed out before verification completed"
      : result.reason === "timeout"
        ? "Agent checks timed out"
        : (result.reason || "Check could not be completed");
    if (!summary) {
      summary = `Could not complete check: ${plainReason}`;
    }
    fallbackEntries.push({
      seq: nextSeq++,
      atMs: durationMs,
      type: "limit",
      status: "failed",
      title: "Could not complete check",
      detail: sanitizePlainText(plainReason, MAX_DETAIL_CHARS),
      sources: [],
    });
  } else {
    // status === "ok" for uninstrumented agent
    const flags = Array.isArray(result.flags) ? result.flags : [];
    const verified = Array.isArray(result.verified) ? result.verified : [];
    const unchecked = Array.isArray(result.unchecked) ? result.unchecked : [];
    const manualChecks = Array.isArray(result.manualChecks) ? result.manualChecks : [];
    const processed = Array.isArray(result.processedEntities) ? result.processedEntities : [];

    if (processed.length > 0) {
      fallbackEntries.push({
        seq: nextSeq++,
        atMs: 0,
        type: "input",
        status: "info",
        title: `Ingested ${processed.length} item(s)`,
        detail: sanitizePlainText(`Inspected: ${processed.join(", ")}`, MAX_DETAIL_CHARS),
        sources: [],
      });
    }

    for (const f of flags) {
      if (fallbackEntries.length >= MAX_ACTIVITY_ENTRIES) break;
      const srcUrl = f.evidence?.find?.((e) => e.type === "url")?.value;
      fallbackEntries.push({
        seq: nextSeq++,
        atMs: Math.round(durationMs * 0.5),
        type: "finding",
        status: "warn",
        title: sanitizePlainText(f.title || `Flag: ${f.id}`, MAX_TITLE_CHARS),
        detail: sanitizePlainText(f.explanation || "Detected risk factor", MAX_DETAIL_CHARS),
        flagId: f.id,
        sources: srcUrl ? [{ label: "Evidence", url: srcUrl }] : [],
      });
    }

    for (const v of verified) {
      if (fallbackEntries.length >= MAX_ACTIVITY_ENTRIES) break;
      fallbackEntries.push({
        seq: nextSeq++,
        atMs: Math.round(durationMs * 0.7),
        type: "verified",
        status: "ok",
        title: sanitizePlainText(v, MAX_TITLE_CHARS),
        detail: "Verified deterministic property or authentic record",
        sources: [],
      });
    }

    for (const u of unchecked) {
      if (fallbackEntries.length >= MAX_ACTIVITY_ENTRIES) break;
      fallbackEntries.push({
        seq: nextSeq++,
        atMs: durationMs,
        type: "limit",
        status: "warn",
        title: sanitizePlainText(`Left unchecked: ${u}`, MAX_TITLE_CHARS),
        detail: "Check could not complete for this item",
        sources: [],
      });
    }

    for (const m of manualChecks) {
      if (fallbackEntries.length >= MAX_ACTIVITY_ENTRIES) break;
      fallbackEntries.push({
        seq: nextSeq++,
        atMs: durationMs,
        type: "manual",
        status: "info",
        title: sanitizePlainText(`Manual check: ${m.label}`, MAX_TITLE_CHARS),
        detail: sanitizePlainText(`Verify manually at ${m.url}`, MAX_DETAIL_CHARS),
        sources: [{ label: m.label, url: m.url }],
      });
    }

    if (fallbackEntries.length === 0) {
      fallbackEntries.push({
        seq: nextSeq++,
        atMs: durationMs,
        type: "step",
        status: "ok",
        title: "Analysis completed",
        detail: "Checked provided opportunity data with no red flags found.",
        sources: [],
      });
    }

    if (!summary) {
      if (flags.length > 0) {
        summary = `Identified ${flags.length} red flag${flags.length > 1 ? "s" : ""}; ${verified.length} item${verified.length !== 1 ? "s" : ""} verified.`;
      } else if (verified.length > 0) {
        summary = `No red flags found; ${verified.length} item${verified.length > 1 ? "s" : ""} verified (not a safety guarantee).`;
      } else {
        summary = "Check completed; no red flags detected (not a safety guarantee).";
      }
    }
  }

  return {
    ...result,
    summary: sanitizePlainText(summary, MAX_SUMMARY_CHARS),
    activity: fallbackEntries.slice(0, MAX_ACTIVITY_ENTRIES),
  };
}

