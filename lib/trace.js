/**
 * lib/trace.js
 *
 * L2/L4 boundary: Tool instrumentation wrapper for real-time agent trace events.
 * Wraps every tool function in a tools dictionary:
 * - Emits tool_start before execution with callId, tool, label, and redacted input
 * - Executes the tool function (safe error capture; tools never throw)
 * - Measures execution duration in milliseconds
 * - Identifies cache hits and marks status as "cached"
 * - Constructs structured detail matching ToolEndDetailSchema discriminated union
 * - Redacts secrets, auth headers, and truncates long text
 * - Emits tool_end after execution
 * - Returns the original tool result to preserve agent decision logic and shape
 */

import crypto from "node:crypto";
import { ToolEndDetailSchema } from "./contracts/trace.js";

/**
 * Redacts secrets, API keys, tokens, or authorization headers from text.
 *
 * @param {string} text
 * @returns {string} Redacted text
 */
export function redactSecretText(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/(?:api[_-]?key|bearer|token|secret|password|auth)[=:\s]+([A-Za-z0-9_\-.]{8,})/gi, "$1=[REDACTED]")
    .replace(/[A-Za-z0-9_\-.]{32,}/g, (match) => {
      // Redact high-entropy token-like strings (32+ chars)
      return match.slice(0, 4) + "..." + match.slice(-4);
    });
}

/**
 * Normalizes tool names to canonical ToolEndDetailSchema variants.
 *
 * @param {string} toolName
 * @returns {string}
 */
export function canonicalizeToolName(toolName) {
  switch (toolName) {
    case "search":
      return "search";
    case "fetchPage":
    case "readPage":
      return "fetchPage";
    case "rdapLookup":
      return "rdapLookup";
    case "dnsRecords":
      return "dnsRecords";
    case "sslInfo":
      return "sslInfo";
    case "waybackFirstSeen":
      return "waybackFirstSeen";
    case "lookalikeCheck":
      return "lookalikeCheck";
    case "classify":
    case "classifier":
      return "classifier";
    case "payments":
    case "upiFacts":
    case "phoneFacts":
    case "emailFacts":
      return "payments";
    case "graphLookup":
      return "graphLookup";
    case "youtubeComments":
      return "youtubeComments";
    case "safeBrowsing":
    case "urlhaus":
      return "safeBrowsing";
    case "urlscan":
    case "urlscanSearch":
      return "urlscan";
    default:
      return toolName;
  }
}

/**
 * Formats a short human-readable input summary for tool_start.
 *
 * @param {string} tool
 * @param {Array<any>} args
 * @returns {string}
 */
function formatInputSummary(tool, args) {
  if (tool === "classifier") {
    const text = typeof args[0] === "string" ? args[0] : (args[0]?.text || "");
    return `${text.length} chars`;
  }
  if (tool === "graphLookup") {
    const val = args[1] !== undefined ? args[1] : args[0];
    return redactSecretText(String(val || "").trim()).slice(0, 100);
  }
  const first = args[0];
  if (typeof first === "string") {
    return redactSecretText(first.trim()).slice(0, 100);
  }
  if (first && typeof first === "object") {
    if (typeof first.url === "string") return redactSecretText(first.url).slice(0, 100);
    if (typeof first.domain === "string") return redactSecretText(first.domain).slice(0, 100);
    if (typeof first.query === "string") return redactSecretText(first.query).slice(0, 100);
    try {
      return redactSecretText(JSON.stringify(first)).slice(0, 100);
    } catch {
      return "[object]";
    }
  }
  return "";
}

/**
 * Builds a structured detail object for a given tool result conforming to ToolEndDetailSchema.
 *
 * @param {string} canonicalTool
 * @param {string} inputStr
 * @param {object} result
 * @returns {object} Detail matching ToolEndDetailSchema
 */
function buildToolDetail(canonicalTool, inputStr, result) {
  const data = result?.data || result || {};

  switch (canonicalTool) {
    case "search": {
      const rawResults = Array.isArray(data.results) ? data.results : [];
      const results = rawResults.slice(0, 10).map((r) => ({
        title: String(r.title || "").slice(0, 150),
        url: String(r.url || ""),
        snippet: String(r.snippet || "").slice(0, 200),
        read: Boolean(r.read),
      }));
      return {
        tool: "search",
        query: inputStr.slice(0, 100),
        resultCount: Number(data.total ?? rawResults.length),
        results,
      };
    }

    case "fetchPage": {
      const excerpt = String(data.text || data.textSnippet || data.excerpt || "").slice(0, 300);
      const isBlocked = Boolean(
        data.blocked ||
        result?.error?.code === "FORBIDDEN_IP" ||
        result?.error?.code === "BLOCKED"
      );
      return {
        tool: "fetchPage",
        url: inputStr,
        httpStatus: Number(data.status || data.httpStatus || (result.ok ? 200 : 500)),
        title: String(data.title || "").slice(0, 150),
        excerpt,
        blocked: isBlocked,
      };
    }

    case "rdapLookup": {
      return {
        tool: "rdapLookup",
        domain: inputStr,
        registeredAt: data.registrationDate || data.registeredAt || null,
        ageDays: typeof data.ageDays === "number" ? data.ageDays : null,
        registrar: data.registrar || null,
      };
    }

    case "dnsRecords": {
      const mx = Array.isArray(data.mx) ? data.mx : [];
      const a = Array.isArray(data.a) ? data.a : [];
      return {
        tool: "dnsRecords",
        domain: inputStr,
        hasMx: mx.length > 0,
        hasA: a.length > 0,
      };
    }

    case "sslInfo": {
      return {
        tool: "sslInfo",
        issuer: data.issuer || null,
        validTo: data.validTo || null,
      };
    }

    case "waybackFirstSeen": {
      return {
        tool: "waybackFirstSeen",
        firstSeen: data.firstSeen || null,
      };
    }

    case "lookalikeCheck": {
      return {
        tool: "lookalikeCheck",
        closestDomain: data.targetDomain || data.closestDomain || null,
        distance: typeof data.distance === "number"
          ? data.distance
          : (typeof data.similarityScore === "number" ? Math.round((1 - data.similarityScore) * 10) : null),
      };
    }

    case "classifier": {
      const rawProb = typeof data.probability === "number" ? data.probability : 0;
      const probability = Math.min(1, Math.max(0, rawProb));
      const topTerms = Array.isArray(data.topTerms) ? data.topTerms.map(String).slice(0, 10) : [];
      return {
        tool: "classifier",
        probability,
        topTerms,
      };
    }

    case "payments": {
      return {
        tool: "payments",
        identifier: inputStr,
        formatValid: Boolean(data.valid ?? result.valid ?? true),
      };
    }

    case "graphLookup": {
      const matchCount = Number(data.reportCount ?? (data.matched ? 1 : 0));
      const linked = Array.isArray(data.linkedIdentifiers)
        ? data.linkedIdentifiers.map(String)
        : (Array.isArray(data.linked) ? data.linked.map(String) : []);
      return {
        tool: "graphLookup",
        identifier: inputStr,
        matchCount,
        linked,
      };
    }

    case "youtubeComments": {
      const sampled = Number(data.commentsSampled ?? data.sampled ?? 0);
      const rawRatio = typeof data.burstRatio === "number"
        ? data.burstRatio
        : (typeof data.duplicateRatio === "number" ? data.duplicateRatio : 0);
      return {
        tool: "youtubeComments",
        sampled,
        duplicateRatio: Math.min(1, Math.max(0, rawRatio)),
      };
    }

    case "safeBrowsing": {
      const isListed = Boolean(data.listed);
      return {
        tool: "safeBrowsing",
        verdict: isListed ? "malicious" : (result.ok ? "clean" : "unknown"),
      };
    }

    case "urlscan": {
      const total = Number(data.total ?? (Array.isArray(data.results) ? data.results.length : 0));
      return {
        tool: "urlscan",
        verdict: total > 0 ? "scanned" : "unseen",
      };
    }

    default:
      return {
        tool: "safeBrowsing",
        verdict: result.ok ? "clean" : "unknown",
      };
  }
}

/**
 * Builds a brief, human-readable summary string of the tool execution.
 *
 * @param {string} tool
 * @param {string} status
 * @param {number} durationMs
 * @param {object} detail
 * @returns {string}
 */
function buildToolSummary(tool, status, durationMs, detail) {
  if (status === "error") {
    return `${tool} lookup failed (${durationMs}ms)`;
  }
  if (status === "cached") {
    return `${tool} returned cached result`;
  }
  switch (tool) {
    case "search":
      return `${detail.resultCount} results`;
    case "fetchPage":
      return detail.blocked ? "Blocked access to private address" : `Fetched page (${detail.httpStatus})`;
    case "rdapLookup":
      return detail.ageDays !== null ? `Domain registered ${detail.ageDays} days ago` : "Domain registration checked";
    case "dnsRecords":
      return `DNS verified (A: ${detail.hasA ? "yes" : "no"}, MX: ${detail.hasMx ? "yes" : "no"})`;
    case "sslInfo":
      return detail.issuer ? `SSL certificate from ${detail.issuer}` : "SSL checked";
    case "waybackFirstSeen":
      return detail.firstSeen ? `First seen on Wayback: ${detail.firstSeen.slice(0, 10)}` : "No archive history";
    case "lookalikeCheck":
      return detail.closestDomain ? `Close lookalike to ${detail.closestDomain}` : "No lookalike targets";
    case "classifier":
      return `TF-IDF & Logistic Regression scam probability: ${Math.round(detail.probability * 100)}%`;
    case "payments":
      return detail.formatValid ? "Payment identifier format valid" : "Invalid payment identifier format";
    case "graphLookup":
      return detail.matchCount > 0 ? `Matched ${detail.matchCount} prior scam reports` : "No graph matches found";
    case "youtubeComments":
      return `Sampled ${detail.sampled} comments (duplicate ratio: ${Math.round(detail.duplicateRatio * 100)}%)`;
    case "safeBrowsing":
      return detail.verdict === "malicious" ? "Identified on threat feed" : "Not listed on threat feeds";
    case "urlscan":
      return detail.verdict === "scanned" ? "Public scans found on urlscan" : "No public scans found on urlscan";
    default:
      return `${tool} completed (${durationMs}ms)`;
  }
}

/**
 * Instruments a dictionary of tools to emit tool_start and tool_end TraceEvents.
 *
 * @param {Record<string, Function>} tools
 * @param {(event: object) => void} emit
 * @param {string} agent - Name of the calling agent
 * @param {number} round - Current round (1 or 2)
 * @returns {Record<string, Function>} Instrumented tools
 */
export function instrumentTools(tools, emit, agent, round = 1) {
  if (!tools || typeof tools !== "object") return {};
  if (typeof emit !== "function") return tools;

  const instrumented = {};

  for (const [name, fn] of Object.entries(tools)) {
    if (typeof fn !== "function") {
      instrumented[name] = fn;
      continue;
    }

    const canonicalTool = canonicalizeToolName(name);

    instrumented[name] = (...args) => {
      const callId = crypto.randomUUID();
      const inputStr = formatInputSummary(canonicalTool, args);
      const label =
        canonicalTool === "classifier"
          ? "Scam classifier"
          : `${canonicalTool}: ${inputStr}`.slice(0, 80);

      // 1. Emit tool_start
      try {
        emit({
          type: "tool_start",
          callId,
          tool: canonicalTool,
          label: label || canonicalTool,
          input: inputStr,
          round,
          agent,
        });
      } catch {
        // emit never throws, but guard just in case
      }

      const t0 = Date.now();

      const handleOutcome = (result, isError = false) => {
        const durationMs = Math.max(0, Date.now() - t0);

        // 3. Determine status
        let status = "ok";
        if (result?.cached === true || result?._cached === true || result?.data?._cached === true) {
          status = "cached";
        } else if (isError || !result || result.ok === false || result.error) {
          status = "error";
        }

        // 4. Construct detail
        const detailCandidate = buildToolDetail(canonicalTool, inputStr, result);

        // Validate detail against ToolEndDetailSchema (fall back safely if malformed)
        let detail = detailCandidate;
        const parseDetail = ToolEndDetailSchema.safeParse(detailCandidate);
        if (parseDetail.success) {
          detail = parseDetail.data;
        }

        const summary = buildToolSummary(canonicalTool, status, durationMs, detail).slice(0, 120);

        // 5. Emit tool_end
        try {
          emit({
            type: "tool_end",
            callId,
            tool: canonicalTool,
            status,
            durationMs,
            summary,
            detail,
            round,
            agent,
          });
        } catch {
          // Guard against any emit failure
        }

        return result;
      };

      try {
        const ret = fn(...args);
        if (ret && typeof ret.then === "function") {
          return ret
            .then((asyncResult) => handleOutcome(asyncResult, false))
            .catch((err) =>
              handleOutcome(
                {
                  ok: false,
                  error: {
                    code: "TOOL_ERROR",
                    message: err?.message || "Tool execution failed",
                  },
                },
                true
              )
            );
        }
        return handleOutcome(ret, false);
      } catch (err) {
        return handleOutcome(
          {
            ok: false,
            error: {
              code: "TOOL_ERROR",
              message: err?.message || "Tool execution failed",
            },
          },
          true
        );
      }
    };
  }

  return instrumented;
}
