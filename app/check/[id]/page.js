"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import Link from "next/link";
import { recordClientLog, setLastActiveCheckId } from "../../../lib/client-logger.js";
import AgentCards from "../../../components/AgentCards.js";
import AgentActivityDrawer from "../../../components/AgentActivityDrawer.js";
import { classifySource } from "../../../lib/evidence/source-classifier.js";

const AGENT_LABELS = {
  message_analyst: { name: "Message & Offer Analyst", icon: "📝", desc: "Analyzing predatory patterns, urgency & red flags" },
  classifier_client: { name: "ML Scam Classifier", icon: "🧠", desc: "Trained TF-IDF + Logistic Regression opportunity model" },
  website_forensics: { name: "Domain & Web Forensics", icon: "🌐", desc: "Checking domain age, registration, DNS, SSL & lookalikes" },
  payment_entity: { name: "Payment & UPI Verifier", icon: "💳", desc: "Verifying UPI ID format, payee consistency and known-scam database match" },
  official_verifier: { name: "Official Registry Verifier", icon: "🏛️", desc: "Cross-referencing government & registered career portals" },
  reputation_osint: { name: "Community & OSINT Search", icon: "🔍", desc: "Searching consumer complaints, advisories & cyber alerts" },
};

function formatTimelineEvent(ev) {
  if (ev.type === "tool_start") {
    return {
      icon: "⚙️",
      color: "var(--accent-primary)",
      text: `${ev.agent ? `[${ev.agent}] ` : ""}Started ${ev.tool}${ev.label ? ` (${ev.label})` : ""}${ev.input ? `: "${ev.input}"` : ""}`,
    };
  }
  if (ev.type === "tool_end") {
    const isErr = ev.status === "error" || ev.status === "timeout";
    return {
      icon: isErr ? "⚠️" : "✓",
      color: isErr ? "var(--warning-primary)" : "var(--success-primary, #10b981)",
      text: `${ev.agent ? `[${ev.agent}] ` : ""}${ev.tool} ${ev.status || "done"} (${ev.durationMs || 0}ms)${ev.summary ? ` — ${ev.summary}` : ""}`,
    };
  }
  if (ev.type === "flag") {
    return {
      icon: "🚩",
      color: ev.severity === "high" ? "var(--danger-primary, #ef4444)" : "var(--warning-primary, #f59e0b)",
      text: `[FLAG: ${ev.severity?.toUpperCase() || "FLAG"}] ${ev.title || ev.flagId}${ev.evidence?.[0] ? ` — "${ev.evidence[0]}"` : ""}`,
    };
  }
  if (ev.type === "verdict") {
    const isBad = ev.verdict === "contradicted" || ev.verdict === "unverified";
    return {
      icon: "⚖️",
      color: isBad ? "var(--danger-primary, #ef4444)" : "var(--success-primary, #10b981)",
      text: `[VERDICT] ${ev.claim}: ${ev.verdict?.toUpperCase() || ""}`,
    };
  }
  if (ev.type === "note") {
    return {
      icon: "📝",
      color: "var(--text-secondary)",
      text: `${ev.agent ? `[${ev.agent}] ` : ""}${ev.text}`,
    };
  }
  if (ev.type === "agent_status") {
    return {
      icon: "🤖",
      color: ev.status === "could_not_check" ? "var(--warning-primary)" : "var(--text-secondary)",
      text: `[${ev.agent}] ${ev.status}${ev.summary ? ` — ${ev.summary}` : ""}`,
    };
  }
  if (ev.type === "stage") {
    return {
      icon: "⏱",
      color: "var(--accent-primary)",
      text: `Stage: ${ev.stage || ev.status || "in progress"}`,
    };
  }
  if (ev.type === "round") {
    return {
      icon: "🔄",
      color: "var(--accent-primary)",
      text: `Investigation Round ${ev.round} started`,
    };
  }
  if (ev.type === "complete") {
    return {
      icon: "✅",
      color: "var(--success-primary, #10b981)",
      text: "Investigation complete. Generating report...",
    };
  }
  return {
    icon: "→",
    color: "var(--text-secondary)",
    text: ev.summary || `${ev.agent || "Pipeline"}: ${ev.phase || ev.status || "update"}`,
  };
}

/**
 * Explains why a specific OSINT tool call or trace query failed or threw an error.
 */
function explainToolError(tr) {
  const toolName = tr.tool || tr.check || tr.item || tr.type || "OSINT Query";
  const errorCode = String(
    tr.code || tr.reason || tr.error?.code || (tr.status === "error" ? "ERROR" : "FAILED")
  ).toUpperCase();
  const target = String(tr.entity || tr.domain || tr.query || tr.vpa || tr.value || tr.input || "");
  const rawMsg =
    typeof tr.message === "string"
      ? tr.message
      : typeof tr.error === "string"
      ? tr.error
      : tr.error?.message || (typeof tr.detail === "string" ? tr.detail : "");
  const rawMsgLower = String(rawMsg).toLowerCase();

  let explanation = "";
  let remediation = null;

  if (errorCode.includes("RDAP") || toolName.toLowerCase().includes("rdap")) {
    explanation =
      "Authoritative WHOIS/RDAP registry query failed — the registry server timed out, was unreachable, or does not support public RDAP queries for this top-level domain.";
    remediation = "You can manually check the domain registration and creation date on whois.domaintools.com.";
  } else if (
    errorCode.includes("DNS") ||
    errorCode.includes("ENOTFOUND") ||
    toolName.toLowerCase().includes("dns")
  ) {
    explanation =
      "DNS resolution failed — authoritative nameservers did not return active A or MX records, or domain is unassigned.";
    remediation = "Verify the spelling of the domain or check if the domain was registered recently.";
  } else if (
    errorCode.includes("SSL") ||
    errorCode.includes("CERT") ||
    toolName.toLowerCase().includes("ssl")
  ) {
    explanation =
      "SSL/TLS handshake failed — remote server refused connection on HTTPS port 443, certificate was expired/self-signed, or socket closed prematurely.";
    remediation = "Legitimate companies maintain active TLS certificates from recognized Certificate Authorities.";
  } else if (errorCode.includes("WAYBACK") || toolName.toLowerCase().includes("wayback")) {
    explanation =
      "Internet Archive Wayback Machine API was unreachable or timed out. Archive crawl history could not be verified.";
  } else if (errorCode.includes("URLHAUS") || toolName.toLowerCase().includes("urlhaus")) {
    explanation = "URLhaus malware and threat feed API timed out or refused connection during lookup.";
  } else if (errorCode.includes("URLSCAN") || toolName.toLowerCase().includes("urlscan")) {
    explanation = "urlscan.io threat search failed or query quota was reached.";
  } else if (errorCode.includes("LOOKALIKE")) {
    explanation = "Brand lookalike similarity analysis failed to complete distance computations.";
  } else if (errorCode.includes("ECONNREFUSED") || rawMsgLower.includes("refused")) {
    explanation = "Connection refused — destination server closed or rejected incoming TCP socket connection.";
  } else if (errorCode.includes("ETIMEDOUT") || errorCode.includes("TIMEOUT") || rawMsgLower.includes("timeout")) {
    explanation = "Request timed out — remote host or registry service did not respond within the allocated time window.";
  } else if (errorCode.includes("SSRF") || errorCode.includes("BLOCKED") || rawMsgLower.includes("ssrf") || tr.blocked) {
    explanation =
      "Security Guard (SSRF Protection): Target host resolves to private, loopback (127.0.0.1/localhost), or link-local IP, or uses an unsafe protocol scheme.";
  } else if (errorCode.includes("NO_KEY") || errorCode.includes("AUTH") || errorCode.includes("401") || errorCode.includes("403")) {
    explanation = "Authentication failed or API key missing in .env.local.";
    remediation = "Ensure the corresponding provider API key is configured in .env.local.";
  } else if (errorCode.includes("RATE_LIMITED") || errorCode.includes("429") || rawMsgLower.includes("rate limit")) {
    explanation = "Upstream API rate limit reached (HTTP 429). Provider requested cooldown.";
  } else if (errorCode.includes("BUDGET_EXCEEDED")) {
    explanation = "Search query budget limit reached for this investigation to prevent quota depletion.";
  } else if (errorCode.includes("SERVICE_UNAVAILABLE") || errorCode.includes("503") || rawMsgLower.includes("offline")) {
    explanation = "Local microservice was offline or unreachable.";
  } else if (errorCode.includes("INVALID_INPUT")) {
    explanation = "Target entity was malformed or failed syntax validation before querying.";
  } else if (rawMsg) {
    explanation = `Tool query failed: ${rawMsg}`;
  } else {
    explanation = "Tool execution encountered an unexpected network or upstream service fault.";
  }

  return {
    toolName,
    errorCode,
    target,
    explanation,
    remediation,
    rawMsg: rawMsg && rawMsg !== explanation ? rawMsg : null,
  };
}

/**
 * Explains why an agent has a specific status or reason code.
 */
function explainAgentReason(reason, statusStr) {
  const r = (reason || "").toLowerCase();

  if (
    r === "classifier_service_unavailable" ||
    r.includes("classifier_unavailable") ||
    r.includes("classifier")
  ) {
    return {
      title: "Python ML Classifier Offline",
      explanation:
        "The Python FastAPI machine learning microservice (running on port 8000) was offline or unreachable. The system bypassed local TF-IDF scam probability scoring and safely completed all remaining OSINT agents.",
      remediation: "To enable the ML classifier, run: source .venv/bin/activate && uvicorn main:app --port 8000",
    };
  }
  if (r === "no_company_or_domain_entities") {
    return {
      title: "No Company or Website Domain Provided",
      explanation:
        "Official Verifier requires an explicit organization name or official website domain to cross-reference against government registries (MCA, UGC, NSP, PIB).",
      remediation: "Enter the claimed company name (e.g., Infosys, TCS) in the Claimed Company field to check official registries.",
    };
  }
  if (r === "no_eligible_entities" || r === "not_eligible") {
    return {
      title: "No Matching Identifiers Found",
      explanation:
        "This specialist is designated to check specific identifier types (e.g. website URLs, UPI VPAs, phone numbers, or social handles), but none were present in the submission.",
      remediation: "You can add relevant identifiers in Step 1 (Confirm Extracted Identifiers) to enable this agent.",
    };
  }
  if (r === "no_message_text" || r === "empty_text") {
    return {
      title: "No Text Content Provided",
      explanation: "The submission had no text or readable OCR text to analyze for deceptive patterns.",
      remediation: "Paste the text of the message, email, or offer in the text box.",
    };
  }
  if (r === "timeout") {
    return {
      title: "Agent Execution Timeout Exceeded",
      explanation:
        "This specialist exceeded the 25-second execution limit waiting for remote network responses and was safely aborted to prevent hanging the investigation.",
      remediation: "Check your internet connection or verify upstream OSINT endpoints are reachable.",
    };
  }
  if (r === "all_checks_failed") {
    return {
      title: "All Remote Tool Queries Failed",
      explanation:
        "Every OSINT check attempted by this specialist failed due to unreachable remote servers or network timeouts.",
      remediation: "Inspect individual tool call errors below for specific causes.",
    };
  }
  if (r === "search_failed") {
    return {
      title: "Search Engine API Query Failed",
      explanation: "The Serper Google Search API query failed, timed out, or returned an error.",
      remediation: "Check SERPER_API_KEY in .env.local or check Serper credit balance.",
    };
  }
  if (r === "llm_unavailable" || r === "llm_generation_failed") {
    return {
      title: "LLM Reasoning Provider Offline",
      explanation: "The Gemini LLM service returned an error, timed out, or quota was exceeded.",
      remediation: "Verify GEMINI_API_KEY in .env.local.",
    };
  }
  if (r === "schema_validation_failed" || r === "invalid_result") {
    return {
      title: "Agent Result Schema Invalid",
      explanation: "The agent returned an internal output structure that did not match the strict zod contract.",
      remediation: null,
    };
  }
  if (r === "already_ran") {
    return {
      title: "Completed in Round 1",
      explanation:
        "This specialist completed all its tasks in Round 1. No new entities were discovered that required a Round 2 check.",
      remediation: null,
    };
  }
  if (statusStr === "could_not_check") {
    return {
      title: "Specialist Could Not Check",
      explanation: reason
        ? `Agent could not complete check: ${reason}`
        : "Agent was eligible but encountered an unexpected execution failure or timeout.",
      remediation: "Review the tool execution trace below for individual query failures.",
    };
  }
  if (statusStr === "skipped") {
    return {
      title: "Specialist Skipped",
      explanation: reason
        ? `Agent skipped check: ${reason}`
        : "No targets matching this specialist were present in the submission.",
      remediation: null,
    };
  }
  return null;
}

/**
 * Normalizes a checklist item into text, official URL, portal label, and category tag.
 */
function normalizeChecklistItem(item) {
  let text = "";
  let url = null;

  if (typeof item === "string") {
    const trimmed = item.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        text = parsed.text || parsed.task || parsed.step || parsed.label || trimmed;
        url = parsed.url || null;
      } catch {
        text = item;
      }
    } else {
      text = item;
    }
  } else if (typeof item === "object" && item !== null) {
    text = item.text || item.task || item.step || item.label || "";
    url = item.url || null;
  }

  if (!text && item) {
    text = typeof item === "string" ? item : JSON.stringify(item);
  }

  let portalName = null;
  if (url) {
    try {
      const parsedUrl = new URL(url);
      portalName = parsedUrl.hostname.replace(/^www\./, "");
    } catch {
      portalName = url;
    }
  }

  const lower = text.toLowerCase();
  let tag = "Verification Step";
  let tagClass = "badge-cannot_verify";

  if (
    lower.includes("not pay") ||
    lower.includes("never pay") ||
    lower.includes("upfront") ||
    lower.includes("security deposit") ||
    lower.includes("transfer fee")
  ) {
    tag = "Payment Safety";
    tagClass = "badge-high";
  } else if (
    lower.includes("official portal") ||
    lower.includes("gov.in") ||
    lower.includes("ministry") ||
    lower.includes("nsp") ||
    lower.includes("pib")
  ) {
    tag = "Official Registry";
    tagClass = "badge-low";
  } else if (
    lower.includes("report") ||
    lower.includes("cyber crime") ||
    lower.includes("chakshu")
  ) {
    tag = "Incident Reporting";
    tagClass = "badge-high";
  } else if (lower.includes("could not be completed") || lower.includes("manual")) {
    tag = "Manual Check";
    tagClass = "badge-medium";
  } else if (
    lower.includes("ssl") ||
    lower.includes("archive") ||
    lower.includes("domain") ||
    lower.includes("track record")
  ) {
    tag = "Technical OSINT";
    tagClass = "badge-medium";
  }

  return { text, url, portalName, tag, tagClass };
}

function formatConfidence(conf, fallbackConf) {
  const val = conf !== undefined && conf !== null ? conf : fallbackConf;
  if (val === undefined || val === null) return "--";
  if (typeof val === "number") return `${Math.round(val * 100)}%`;
  if (typeof val === "string") return val.toUpperCase();
  return String(val);
}

function formatEvidenceItem(ev) {
  if (!ev) return null;
  if (typeof ev === "string") return ev;
  if (ev.type === "quote" || ev.quote) {
    return `"${ev.value || ev.quote}"`;
  }
  if (ev.type === "url" || ev.url) {
    const url = ev.value || ev.url;
    const sourceInfo = classifySource(url);
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap" }}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent-primary)", textDecoration: "underline" }}
        >
          {url}
        </a>
        <span
          style={{
            fontSize: "0.7rem",
            padding: "0.1rem 0.4rem",
            borderRadius: "var(--radius-sm, 4px)",
            backgroundColor: sourceInfo.isAuthoritative
              ? "rgba(16, 185, 129, 0.15)"
              : sourceInfo.isComplaint
              ? "rgba(245, 158, 11, 0.15)"
              : "rgba(107, 114, 128, 0.15)",
            color: sourceInfo.isAuthoritative
              ? "var(--risk-low, #059669)"
              : sourceInfo.isComplaint
              ? "var(--risk-medium, #d97706)"
              : "var(--text-muted, #6b7280)",
            fontWeight: 600,
            border: "1px solid currentColor",
          }}
        >
          {sourceInfo.label}
        </span>
      </span>
    );
  }
  return ev.value || JSON.stringify(ev);
}

export default function CheckDetailPage({ params }) {
  const unwrappedParams = use(params);
  const checkId = unwrappedParams.id;

  const [check, setCheck] = useState(null);
  const [entities, setEntities] = useState([]);
  const [extractedText, setExtractedText] = useState("");
  const [report, setReport] = useState(null);
  const [scoreBreakdown, setScoreBreakdown] = useState(null);
  const [status, setStatus] = useState("loading"); // loading, extracting, awaiting_confirmation, investigating, report_ready, failed
  const [error, setError] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // New entity state for manual addition
  const [newKind, setNewKind] = useState("domain");
  const [newValue, setNewValue] = useState("");

  // Live Agent Stream Events
  const [agentStatuses, setAgentStatuses] = useState({
    message_analyst: "pending",
    classifier_client: "pending",
    website_forensics: "pending",
    payment_entity: "pending",
    official_verifier: "pending",
    reputation_osint: "pending",
  });
  const [streamEvents, setStreamEvents] = useState([]);
  const [streamConnected, setStreamConnected] = useState(false);

  // Action states
  const [collegeEmail, setCollegeEmail] = useState(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [graphSaved, setGraphSaved] = useState(false);
  const [showPaidHelp, setShowPaidHelp] = useState(false);

  // Specialist Agent Detailed Responses State
  const [agentResults, setAgentResults] = useState([]);
  const [agentsCards, setAgentsCards] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [expandedAgents, setExpandedAgents] = useState({});
  const [allExpanded, setAllExpanded] = useState(false);

  // View mode switcher: "report" vs "process"
  const [activeTab, setActiveTab] = useState("report");

  // Report loading and retry states
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [isRetryingReport, setIsRetryingReport] = useState(false);

  // Checklist interactive state
  const [checkedChecklist, setCheckedChecklist] = useState({});
  const [copiedChecklist, setCopiedChecklist] = useState(false);
  const fetchingReportRef = useRef(false);

  // Sync latest check ID for top navigation
  useEffect(() => {
    if (checkId) {
      setLastActiveCheckId(checkId);
    }
  }, [checkId]);

  function toggleChecklistItem(idx) {
    setCheckedChecklist((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  }

  function handleCopyChecklist() {
    if (!report?.checklist?.length) return;
    const lines = [
      `# Opportunity Verification Checklist (Check Ref: ${checkId.slice(0, 8)})`,
      `Assessed Risk Level: ${report?.riskLevel?.toUpperCase() || displayRiskLevel?.toUpperCase() || "UNKNOWN"} (Score: ${report?.score ?? displayScore ?? "--"}/100)`,
      "",
      "Follow these concrete checkpoints before proceeding:",
      "",
    ];

    (report?.checklist || []).forEach((item, i) => {
      const parsed = normalizeChecklistItem(item);
      const isDone = Boolean(checkedChecklist[i]);
      lines.push(`[${isDone ? "x" : " "}] Checkpoint #${i + 1} [${parsed.tag}]: ${parsed.text}`);
      if (parsed.url) {
        lines.push(`    Official Portal: ${parsed.url}`);
      }
    });

    lines.push("");
    lines.push("Generated by Opportunity Verifier. Evidence-backed student safety assessment.");

    navigator.clipboard.writeText(lines.join("\n"));
    setCopiedChecklist(true);
    setTimeout(() => setCopiedChecklist(false), 2200);
  }

  // Fetch Specialist Agent Cards and Activity Logs
  const fetchAgentsCards = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks/${checkId}/agents`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.agents)) {
          setAgentsCards(data.agents);
        }
      }
    } catch (_err) {
      // Tolerate transient network errors during live polling
    }
  }, [checkId]);

  // Fetch Specialist Agent Detailed Results
  const fetchAgentResults = useCallback(async () => {
    try {
      const res = await fetch(`/api/checks/${checkId}/agent-results`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.agentResults)) {
          setAgentResults(data.agentResults);
        }
      }
    } catch (_err) {
      // Tolerate transient network errors during live polling
    }
  }, [checkId]);

  // Fetch Final Report when status is report_ready
  const fetchReport = useCallback(async () => {
    if (fetchingReportRef.current) return;
    fetchingReportRef.current = true;
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/checks/${checkId}/report`);
      if (res.ok) {
        const data = await res.json();
        setReport(data.report || data);
        if (data.scoreBreakdown) {
          setScoreBreakdown(data.scoreBreakdown);
        }
        setStatus("report_ready");
        fetchAgentResults();
        fetchAgentsCards();
      } else if (res.status === 429) {
        // Rate limited temporarily; retry after 1.5s rather than marking report permanently failed
        setTimeout(() => {
          fetchingReportRef.current = false;
          fetchReport();
        }, 1500);
        return;
      } else {
        const errJson = await res.json().catch(() => ({}));
        setReportError(errJson.error || `Report not ready or unavailable (HTTP ${res.status})`);
      }
    } catch (err) {
      setReportError(err?.message || "Failed to fetch final report");
    } finally {
      fetchingReportRef.current = false;
      setReportLoading(false);
    }
  }, [checkId, fetchAgentResults, fetchAgentsCards]);

  // Retry or regenerate report when report writer failed
  const handleRetryReport = useCallback(async () => {
    setIsRetryingReport(true);
    setReportError(null);
    try {
      const res = await fetch(`/api/checks/${checkId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        setReport(data.report || data);
        if (data.scoreBreakdown) {
          setScoreBreakdown(data.scoreBreakdown);
        }
        setStatus("report_ready");
        fetchAgentResults();
        fetchAgentsCards();
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Retry failed with HTTP ${res.status}`);
      }
    } catch (err) {
      setReportError(err?.message || "Report retry failed. Please try again.");
    } finally {
      setIsRetryingReport(false);
    }
  }, [checkId, fetchAgentResults, fetchAgentsCards]);

  // Initial Fetch & Polling
  useEffect(() => {
    let timerId = null;
    let isCancelled = false;
    let notFoundRetries = 0;

    async function fetchCheckStatus() {
      try {
        const res = await fetch(`/api/checks/${checkId}`);
        if (!res.ok) {
          if (res.status === 404 && notFoundRetries < 3) {
            notFoundRetries++;
            timerId = setTimeout(fetchCheckStatus, 1000);
            return;
          }
          if (res.status === 404) throw new Error("Check not found or expired.");
          throw new Error("Failed to load check status.");
        }
        const data = await res.json();
        if (isCancelled) return;

        setCheck(data.check);
        if (data.entities) setEntities(data.entities);
        if (data.text !== undefined && data.text !== null) {
          setExtractedText((prev) => (prev ? prev : data.text));
        }

        const currentStatus = data.check.status;
        setStatus(currentStatus);

        if (currentStatus === "extracting" || currentStatus === "investigating" || currentStatus === "scoring") {
          fetchAgentsCards();
          if (currentStatus === "investigating" || currentStatus === "scoring") {
            fetchAgentResults();
          }
          timerId = setTimeout(fetchCheckStatus, currentStatus === "extracting" ? 1500 : 3000);
        } else if (currentStatus === "report_ready") {
          fetchReport();
          fetchAgentResults();
          fetchAgentsCards();
        } else {
          fetchAgentsCards();
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err.message);
          setStatus("failed");
        }
      }
    }

    fetchCheckStatus();

    return () => {
      isCancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [checkId, fetchReport, fetchAgentResults, fetchAgentsCards]);

  // Connect SSE Stream when investigating with polling fallback
  useEffect(() => {
    if (status !== "investigating" && status !== "scoring") return;

    let eventSource = null;
    let isCleanedUp = false;
    let fallbackPollTimer = null;
    let lastSeq = 0;

    function handleEventPayload(payload) {
      if (typeof payload.seq === "number" && payload.seq > lastSeq) {
        lastSeq = payload.seq;
      }

      recordClientLog({
        checkId,
        seq: payload.seq,
        type: payload.type || "event",
        agent: payload.agent || "coordinator",
        status: payload.status,
        summary: payload.summary || payload.text || payload.title || payload.claim || payload.input || payload.stage,
        tool: payload.tool,
        durationMs: payload.durationMs,
        payload,
      });

      setStreamEvents((prev) => {
        if (typeof payload.seq === "number" && prev.some((e) => e.seq === payload.seq)) {
          return prev;
        }
        return [payload, ...prev.slice(0, 29)];
      });

      if (payload.agent) {
        setAgentStatuses((prev) => ({
          ...prev,
          [payload.agent]: payload.status || "running",
        }));
        if (payload.type === "agent_status") {
          fetchAgentResults();
          fetchAgentsCards();
        }
      }

      if (payload.type === "activity" && payload.agent && payload.entry) {
        setAgentsCards((prev) => {
          return prev.map((ag) => {
            if (ag.agent === payload.agent) {
              const currentActivity = Array.isArray(ag.activity) ? ag.activity : [];
              if (currentActivity.some((e) => e.seq === payload.entry.seq)) {
                return ag;
              }
              const isFinding = payload.entry.type === "finding";
              const nextStatus = isFinding
                ? "found_issues"
                : (ag.status === "waiting" ? "running" : ag.status);
              return {
                ...ag,
                status: nextStatus,
                activity: [...currentActivity, payload.entry],
              };
            }
            return ag;
          });
        });
      }

      if (
        payload.type === "complete" ||
        payload.stage === "report_ready" ||
        payload.phase === "investigation_completed" ||
        payload.phase === "report_generated"
      ) {
        setStatus("report_ready");
        fetchReport();
      }
    }

    function startFallbackPolling() {
      if (isCleanedUp || fallbackPollTimer) return;
      setStreamConnected(false);

      async function poll() {
        if (isCleanedUp) return;
        try {
          const res = await fetch(`/api/checks/${checkId}/events?after=${lastSeq}`);
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.events)) {
              for (const ev of data.events) {
                handleEventPayload(ev);
              }
            }
          }
          // Also check check status
          const checkRes = await fetch(`/api/checks/${checkId}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.check?.status === "report_ready") {
              setStatus("report_ready");
              fetchReport();
              return;
            }
          }
        } catch (_e) {
          // Poll retry
        }
        if (!isCleanedUp) {
          fallbackPollTimer = setTimeout(poll, 1500);
        }
      }

      poll();
    }

    try {
      eventSource = new EventSource(`/api/checks/${checkId}/stream`);
      setStreamConnected(true);

      eventSource.onmessage = (event) => {
        if (isCleanedUp) return;
        try {
          const payload = JSON.parse(event.data);
          handleEventPayload(payload);
        } catch (_e) {
          // Keepalive or unparseable event
        }
      };

      eventSource.onerror = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        startFallbackPolling();
      };
    } catch (_e) {
      startFallbackPolling();
    }

    return () => {
      isCleanedUp = true;
      if (eventSource) eventSource.close();
      if (fallbackPollTimer) clearTimeout(fallbackPollTimer);
      setStreamConnected(false);
    };
  }, [status, checkId, fetchReport, fetchAgentResults, fetchAgentsCards]);

  function toggleAgent(agentKey) {
    setExpandedAgents((prev) => ({
      ...prev,
      [agentKey]: !prev[agentKey],
    }));
  }

  function toggleAllAgents() {
    const nextState = !allExpanded;
    setAllExpanded(nextState);
    const updated = {};
    for (const key of Object.keys(AGENT_LABELS)) {
      updated[key] = nextState;
    }
    setExpandedAgents(updated);
  }

  // Handle User Confirming Entities
  async function handleConfirmEntities() {
    if (isConfirming) return;
    if (status !== "awaiting_confirmation" && status !== "ready_to_investigate") return;
    setIsConfirming(true);
    setError(null);
    recordClientLog({
      checkId,
      type: "user_action",
      agent: "user",
      summary: `User confirmed ${entities.length} entities and launched multi-agent investigation`,
    });
    try {
      const textsToSend = extractedText.trim() ? [extractedText.trim()] : [];
      const res = await fetch(`/api/checks/${checkId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texts: textsToSend,
          entities: entities.map((e) => ({
            kind: e.kind,
            value: e.value,
            source: "user",
          })),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (
          res.status === 409 &&
          (data.details?.status === "investigating" ||
            data.details?.status === "scoring" ||
            data.details?.status === "report_ready")
        ) {
          setStatus(data.details.status);
          return;
        }
        throw new Error(data.error?.message || data.message || "Failed to confirm entities.");
      }

      setStatus(data.status || "investigating");
    } catch (err) {
      setError(err.message);
      setIsConfirming(false);
    }
  }

  // Add entity manually
  function handleAddEntity() {
    if (!newValue.trim()) return;
    setEntities((prev) => [
      ...prev,
      { kind: newKind, value: newValue.trim(), source: "user" },
    ]);
    setNewValue("");
  }

  // Remove entity
  function handleRemoveEntity(index) {
    setEntities((prev) => prev.filter((_, i) => i !== index));
  }

  // Action: Generate College Email
  async function handleGenerateCollegeEmail() {
    setEmailLoading(true);
    try {
      const res = await fetch(`/api/checks/${checkId}/college-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientType: "placement_cell" }),
      });
      if (res.ok) {
        const data = await res.json();
        setCollegeEmail(data.draftEmail || data.email || data);
      }
    } catch (_e) {
      // ignore
    } finally {
      setEmailLoading(false);
    }
  }

  // Action: Send Feedback
  async function handleSendFeedback(helpful) {
    const verdict = helpful ? "right" : "wrong";
    const comment = (helpful ? "Helpful assessment" : "Not helpful").slice(0, 500);
    try {
      const res = await fetch(`/api/checks/${checkId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, comment }),
      });
      if (res.ok) {
        setFeedbackSent(true);
      }
    } catch (_e) {
      // ignore
    }
  }

  // Action: Save to Scam Graph
  async function handleSaveToGraph() {
    try {
      await fetch(`/api/checks/${checkId}/save-to-graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      setGraphSaved(true);
    } catch (_e) {
      // ignore
    }
  }

  if (error && !check) {
    return (
      <div className="card" style={{ maxWidth: "600px", margin: "2rem auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.5rem" }}>
          Unable to Load Check
        </h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
          {error}
        </p>
        <Link href="/check" className="btn-primary">
          Start a New Check →
        </Link>
      </div>
    );
  }

  const activeAgent = selectedAgent
    ? {
        ...(agentsCards.find((a) => a.agent === selectedAgent.agent) || selectedAgent),
        evidenceTransfers: streamEvents.filter(
          (e) =>
            e.type === "evidence_transfer" &&
            (e.fromAgent === selectedAgent.agent || e.toAgent === selectedAgent.agent || e.toAgent === "report_writer")
        ),
      }
    : null;

  const displayRiskLevel = report?.riskLevel || check?.riskLevel || "cannot_verify";
  const displayScore = report?.score !== undefined ? report.score : (check?.score !== undefined ? check.score : null);
  const displayConfidence = formatConfidence(report?.confidence, check?.confidence);
  const isAutomaticSummary = Boolean(
    report?.isFallback ||
    (typeof report?.summary === "string" && (
      report?.summary?.startsWith("[Automatic summary]") ||
      report?.summary?.startsWith("[स्वचालित सारांश]")
    ))
  );

  let reportState = "generating";
  if (status === "failed" || (reportError && !report)) {
    reportState = "failed";
  } else if (report) {
    reportState = "ready";
  } else {
    reportState = "generating";
  }

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <span style={{ fontSize: "0.82rem", color: "var(--accent-primary)", fontWeight: 600 }}>
            Investigation Reference: {checkId?.slice(0, 8)}...
          </span>
          <h1 style={{ fontSize: "1.85rem", fontWeight: 700, letterSpacing: "-0.02em", marginTop: "0.2rem" }}>
            Opportunity Risk Assessment
          </h1>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.88rem", color: "var(--text-secondary)" }}>Status:</span>
          <span className={`badge ${status === "report_ready" ? "badge-low" : "badge-medium"}`}>
            {status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Switcher Tab Bar: Final Report vs Investigation Process */}
      {(status === "investigating" || status === "scoring" || status === "report_ready" || status === "failed") && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border-subtle)",
            paddingBottom: "0.75rem",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={() => setActiveTab("report")}
              className={activeTab === "report" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.88rem",
                padding: "0.45rem 1rem",
                fontWeight: 600,
              }}
            >
              <span>📄 Final Risk Report</span>
              {status === "report_ready" && report && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    padding: "0.1rem 0.4rem",
                    borderRadius: "10px",
                    backgroundColor: activeTab === "report" ? "rgba(255,255,255,0.25)" : "var(--bg-card)",
                  }}
                >
                  Ready
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("process")}
              className={activeTab === "process" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.88rem",
                padding: "0.45rem 1rem",
                fontWeight: 600,
              }}
            >
              <span>🔍 Investigation Process</span>
              {streamEvents.length > 0 && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    padding: "0.1rem 0.4rem",
                    borderRadius: "10px",
                    backgroundColor: activeTab === "process" ? "rgba(255,255,255,0.25)" : "var(--bg-card)",
                  }}
                >
                  {streamEvents.length} events
                </span>
              )}
            </button>
          </div>

          <Link
            href="/debug"
            className="btn-secondary btn-sm"
            style={{ fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}
          >
            Full System Logs (/debug) →
          </Link>
        </div>
      )}

      {/* PHASE 1: Extraction & Entity Confirmation */}
      {(status === "extracting" || status === "awaiting_confirmation" || status === "ready_to_investigate") && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>
              Step 1: Confirm Extracted Identifiers
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem", marginTop: "0.25rem" }}>
              Our pipeline identified the following entities from your submission. Confirm or correct them to ensure the specialist agents check the right targets.
            </p>
          </div>

          {status === "extracting" && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1rem", backgroundColor: "var(--bg-card-subtle)", borderRadius: "var(--radius-sm)" }}>
              <span className="spinner" style={{ color: "var(--accent-primary)" }} />
              <span style={{ fontSize: "0.92rem", color: "var(--text-primary)" }}>
                Extracting entities and OCR text from submission...
              </span>
            </div>
          )}

          {/* Extracted Message / Screenshot Text */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                {extractedText ? "Extracted Message / Screenshot Text" : "Opportunity Text"}
              </span>
              {extractedText ? (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {extractedText.length} characters (editable)
                </span>
              ) : null}
            </div>
            <textarea
              className="input-text"
              rows={4}
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: "0.88rem",
                lineHeight: 1.5,
                resize: "vertical",
                backgroundColor: "var(--bg-card-subtle)",
              }}
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              placeholder="Any message or screenshot text extracted from your upload will appear here. You can also paste or edit text here."
            />
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", backgroundColor: "var(--bg-card-subtle)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}>
              <span style={{ fontSize: "0.85rem" }}>💡</span>
              <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", fontWeight: 500 }}>
                Check that the small print was captured; add anything missing.
              </span>
            </div>
          </div>

          {entities.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                Identified Entities ({entities.length}):
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {entities.map((item, idx) => (
                  <div
                    key={`${item.kind}-${item.value}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0.6rem 0.85rem",
                      backgroundColor: "var(--bg-card-subtle)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <span className="badge badge-cannot_verify" style={{ fontSize: "0.75rem" }}>
                        {item.kind}
                      </span>
                      <strong style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem" }}>
                        {item.value}
                      </strong>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleRemoveEntity(idx)}
                      style={{ fontSize: "0.8rem", padding: "0.2rem 0.5rem" }}
                    >
                      ✕ Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
              No specific identifiers extracted yet. You can add domains, UPI IDs, or company handles below.
            </div>
          )}

          {/* Add custom entity */}
          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
              padding: "0.85rem",
              backgroundColor: "var(--bg-card-subtle)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <select
              className="input-select"
              style={{ width: "auto" }}
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
            >
              <option value="domain">Domain / Website</option>
              <option value="upi">UPI ID (VPA)</option>
              <option value="company">Company Name</option>
              <option value="handle">Social Handle</option>
              <option value="phone">Phone Number</option>
              <option value="amount">Amount (₹)</option>
            </select>
            <input
              type="text"
              placeholder="Value (e.g. example.com or recruiter@oksbi)"
              className="input-text"
              style={{ flex: 1, minWidth: "180px" }}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddEntity()}
            />
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleAddEntity}
            >
              + Add Entity
            </button>
          </div>

          {error && status === "awaiting_confirmation" && (
            <div
              style={{
                padding: "0.75rem 1rem",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                border: "1px solid var(--danger-primary, #ef4444)",
                borderRadius: "var(--radius-sm)",
                color: "var(--danger-primary, #ef4444)",
                fontSize: "0.88rem",
              }}
            >
              ⚠️ {error}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirmEntities}
              disabled={isConfirming || (status !== "awaiting_confirmation" && status !== "ready_to_investigate")}
              style={{
                padding: "0.75rem 1.75rem",
                opacity: isConfirming ? 0.7 : 1,
                cursor: isConfirming ? "not-allowed" : "pointer",
              }}
            >
              {isConfirming ? "Starting Multi-Agent Check..." : "Confirm & Start Multi-Agent Check →"}
            </button>
          </div>
        </div>
      )}

      {/* PHASE 2: Live Multi-Agent Investigation */}
      {((status === "investigating" || status === "scoring") ||
        (status === "report_ready" && activeTab === "process")) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span className="status-pulse" />
                <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  Multi-Agent Investigation in Progress
                </h2>
              </div>
              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                {streamConnected ? "Live SSE Feed Connected" : "Polling Active"}
              </span>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem" }}>
              Specialist agents are querying government portals, checking domain records, analyzing payment channels, and evaluating scam patterns in parallel.
            </p>

            {/* Specialist Agents Interactive Cards */}
            <div style={{ marginTop: "0.5rem" }}>
              <AgentCards
                agents={agentsCards}
                onSelectAgent={(ag) => setSelectedAgent(ag)}
                selectedAgentKey={selectedAgent?.agent}
              />
            </div>
          </div>

          {/* Real-time Activity Log */}
          {streamEvents.length > 0 && (
            <div className="card-subtle" style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                Live Investigation Activity Log:
              </span>
              <div
                style={{
                  maxHeight: "180px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.35rem",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.82rem",
                }}
              >
                {streamEvents.map((ev, i) => {
                  const item = formatTimelineEvent(ev);
                  return (
                    <div
                      key={ev.seq !== undefined ? `ev-seq-${ev.seq}` : `ev-idx-${i}`}
                      style={{
                        color: "var(--text-secondary)",
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "baseline",
                        lineHeight: 1.4,
                      }}
                    >
                      <span style={{ color: item.color, flexShrink: 0 }}>{item.icon}</span>
                      <span>{item.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PHASE 3A: Report Generating State */}
      {activeTab === "report" && reportState === "generating" && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem", textAlign: "center", padding: "2.5rem 1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.75rem" }}>
            <span className="status-pulse" />
            <h2 style={{ fontSize: "1.35rem", fontWeight: 700 }}>
              {status === "scoring" || (status === "report_ready" && reportLoading)
                ? "Synthesizing Final Risk Report..."
                : "Multi-Agent Investigation in Progress..."}
            </h2>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", maxWidth: "600px", margin: "0 auto", lineHeight: 1.6 }}>
            {status === "scoring" || (status === "report_ready" && reportLoading)
              ? "Consolidating evidence-backed flags from specialist agents, applying scoring safeguards, and assembling your action checklist."
              : "Specialist agents are querying official registries, inspecting payment channels, and analyzing risk patterns. Live results will appear here once ready."}
          </p>

          {streamEvents.length > 0 && (
            <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
              <span>Progress: <strong>{streamEvents.length}</strong> activity events recorded</span>
            </div>
          )}

          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveTab("process")}
              style={{ fontSize: "0.88rem", padding: "0.5rem 1.25rem" }}
            >
              🔍 View Live Multi-Agent Investigation Process →
            </button>
          </div>
        </div>
      )}

      {/* PHASE 3B: Report Failed State */}
      {activeTab === "report" && reportState === "failed" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* If score or risk level exists on check, show it so user never gets a completely blank assessment */}
          {(check?.riskLevel || check?.score != null) && (
            <div
              className="card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                borderLeft: `5px solid ${
                  displayRiskLevel === "high"
                    ? "var(--risk-high)"
                    : displayRiskLevel === "medium"
                    ? "var(--risk-medium)"
                    : displayRiskLevel === "low"
                    ? "var(--risk-low)"
                    : "var(--risk-cannot_verify)"
                }`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                    Assessed Risk Level (Scoring Engine)
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span
                      className={`badge ${
                        displayRiskLevel === "high"
                          ? "badge-high"
                          : displayRiskLevel === "medium"
                          ? "badge-medium"
                          : displayRiskLevel === "low"
                          ? "badge-low"
                          : "badge-cannot_verify"
                      }`}
                      style={{ fontSize: "1.05rem", padding: "0.4rem 1rem" }}
                    >
                      {displayRiskLevel.toUpperCase()} RISK
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "1.5rem" }}>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "block" }}>Risk Score</span>
                    <span style={{ fontSize: "1.35rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                      {displayScore != null ? `${displayScore}/100` : "--"}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "block" }}>Confidence</span>
                    <span style={{ fontSize: "1.35rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                      {displayConfidence}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Failure Card with plain reason & Retry Button */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "2rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span style={{ fontSize: "1.4rem" }}>⚠️</span>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Report Generation Notice</h2>
            </div>

            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6 }}>
              The narrative report could not be automatically synthesized:{" "}
              <strong style={{ color: "var(--text-primary)" }}>
                {reportError || check?.failureReason || "An unexpected error occurred during report synthesis."}
              </strong>
            </p>

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleRetryReport}
                disabled={isRetryingReport}
                style={{ padding: "0.6rem 1.4rem", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
              >
                {isRetryingReport ? "🔄 Regenerating Report..." : "🔄 Retry Report Generation"}
              </button>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => setActiveTab("process")}
                style={{ padding: "0.6rem 1.25rem" }}
              >
                🔍 Inspect Agent Findings & Activity Logs →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PHASE 3C: Final Risk Report Ready State */}
      {activeTab === "report" && reportState === "ready" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
          {/* Risk Level Banner */}
          <div
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1rem",
              borderLeft: `5px solid ${
                displayRiskLevel === "high"
                  ? "var(--risk-high)"
                  : displayRiskLevel === "medium"
                  ? "var(--risk-medium)"
                  : displayRiskLevel === "low"
                  ? "var(--risk-low)"
                  : "var(--risk-cannot_verify)"
              }`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
                  Assessed Risk Level
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span
                    className={`badge ${
                      displayRiskLevel === "high"
                        ? "badge-high"
                        : displayRiskLevel === "medium"
                        ? "badge-medium"
                        : displayRiskLevel === "low"
                        ? "badge-low"
                        : "badge-cannot_verify"
                    }`}
                    style={{ fontSize: "1.05rem", padding: "0.4rem 1rem" }}
                  >
                    {displayRiskLevel.toUpperCase()} RISK
                  </span>
                  {isAutomaticSummary && (
                    <span
                      className="badge badge-medium"
                      style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}
                      title="Deterministic summary generated from scoring rules and verified indicators"
                    >
                      🤖 Automatic summary
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: "1.5rem" }}>
                <div>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "block" }}>Risk Score</span>
                  <span style={{ fontSize: "1.35rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                    {displayScore != null ? `${displayScore}/100` : "--"}
                  </span>
                </div>
                <div>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", display: "block" }}>Confidence</span>
                  <span style={{ fontSize: "1.35rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                    {displayConfidence}
                  </span>
                </div>
              </div>
            </div>

            <p style={{ color: "var(--text-primary)", fontSize: "1.02rem", lineHeight: 1.6, marginTop: "0.5rem" }}>
              {report?.summary || (displayScore != null ? `Preliminary verification completed with score ${displayScore}/100. Review evidence flags and action checklist below.` : "Investigation completed. Review the evidence-backed findings and checklist below.")}
            </p>
          </div>

          {/* Evidence Coverage & Verification Scope Card */}
          <div
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.2rem",
              borderLeft: "4px solid var(--accent-primary, #3b82f6)",
              backgroundColor: "var(--bg-card)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-primary)" }}>
                  <span>🛡️</span> Evidence Coverage & Scope
                </h2>
                <span className="badge badge-low" style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}>
                  {(report?.coverage?.checked?.length || 0)}/5 Signal Categories Checked
                </span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginTop: "0.3rem" }}>
                A reliable risk evaluation requires independent verification across multiple evidence sources.
              </p>
            </div>

            {/* Grid of What we looked at vs What we could not look at */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
              {/* What we looked at */}
              <div
                style={{
                  padding: "0.9rem 1rem",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "rgba(16, 185, 129, 0.04)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--risk-low, #10b981)", fontWeight: 700, fontSize: "0.9rem" }}>
                  <span>✓</span>
                  <span>What we looked at</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.2rem" }}>
                  {(report?.coverage?.checked && report.coverage.checked.length > 0 ? report.coverage.checked : ["message"]).map((item, idx) => (
                    <span
                      key={idx}
                      className="badge badge-low"
                      style={{ fontSize: "0.78rem", padding: "0.2rem 0.6rem", textTransform: "capitalize" }}
                    >
                      ✓ {item}
                    </span>
                  ))}
                </div>
              </div>

              {/* What we could not look at */}
              <div
                style={{
                  padding: "0.9rem 1rem",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "rgba(245, 158, 11, 0.04)",
                  border: "1px solid rgba(245, 158, 11, 0.2)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--warning-primary, #f59e0b)", fontWeight: 700, fontSize: "0.9rem" }}>
                  <span>⚠️</span>
                  <span>What we could not look at</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.2rem" }}>
                  {(report?.coverage?.notChecked && report.coverage.notChecked.length > 0) ? (
                    report.coverage.notChecked.map((item, idx) => (
                      <span
                        key={idx}
                        className="badge badge-medium"
                        style={{ fontSize: "0.78rem", padding: "0.2rem 0.6rem", textTransform: "capitalize" }}
                      >
                        ✕ {item}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                      All core signal categories were successfully evaluated.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Add this to get a stronger result */}
            {Boolean(report?.improveCheck && report.improveCheck.length > 0) && (
              <div
                style={{
                  padding: "0.9rem 1.1rem",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-card-subtle)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, fontSize: "0.92rem", color: "var(--text-primary)" }}>
                  <span>💡</span>
                  <span>Add this to get a stronger result</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {report.improveCheck.map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Safe / Nothing found notice */}
            <div
              style={{
                fontSize: "0.82rem",
                color: "var(--text-muted)",
                backgroundColor: "var(--bg-card-subtle)",
                padding: "0.6rem 0.85rem",
                borderRadius: "var(--radius-sm)",
                borderLeft: "3px solid var(--text-muted)",
                lineHeight: 1.45,
              }}
            >
              <strong style={{ color: "var(--text-primary)" }}>Notice: </strong>
              {report?.disclaimer || "Nothing found is not the same as safe. Missing evidence means an opportunity cannot be verified. Always verify independently through trusted university channels."}
            </div>
          </div>

          {/* Where the checks disagreed section */}
          {Boolean((report?.whereDisagreed?.length || 0) > 0) && (
            <div
              className="card"
              style={{
                borderLeft: "4px solid var(--accent-amber, #d97706)",
                backgroundColor: "rgba(217, 119, 6, 0.04)",
                display: "flex",
                flexDirection: "column",
                gap: "0.8rem",
              }}
            >
              <div>
                <h2 style={{ fontSize: "1.15rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-primary)" }}>
                  <span>⚖️</span> Where the checks disagreed
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginTop: "0.2rem" }}>
                  Different analysis methods produced differing signals; deterministic evidence-backed findings supersede statistical heuristics.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {report.whereDisagreed.map((item, dIdx) => (
                  <div
                    key={dIdx}
                    style={{
                      padding: "0.65rem 0.85rem",
                      backgroundColor: "var(--bg-card)",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.92rem",
                      lineHeight: 1.5,
                      color: "var(--text-primary)",
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score Breakdown Section */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  Risk Score Breakdown & Rule Engine
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginTop: "0.2rem" }}>
                  Every contributing flag with agent origin and point weight, classifier score, and active scoring rules.
                </p>
              </div>
              <span className="badge badge-low" style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}>
                Score: {displayScore != null ? `${displayScore}/100` : "--"} • Level: {displayRiskLevel.toUpperCase()}
              </span>
            </div>

            {/* Flags Point Breakdown Table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", textAlign: "left", color: "var(--text-muted)" }}>
                    <th style={{ padding: "0.5rem 0.6rem" }}>Flag Indicator</th>
                    <th style={{ padding: "0.5rem 0.6rem" }}>Evaluating Agent</th>
                    <th style={{ padding: "0.5rem 0.6rem" }}>Weight</th>
                    <th style={{ padding: "0.5rem 0.6rem" }}>Points Awarded</th>
                    <th style={{ padding: "0.5rem 0.6rem" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scoreBreakdown?.flags && scoreBreakdown.flags.length > 0 ? (
                    scoreBreakdown.flags.map((fp, fIdx) => (
                      <tr key={fIdx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "0.6rem", fontWeight: 600 }}>{fp.id}</td>
                        <td style={{ padding: "0.6rem", color: "var(--text-secondary)" }}>{fp.agent || "Specialist Agent"}</td>
                        <td style={{ padding: "0.6rem", fontFamily: "var(--font-mono)" }}>{fp.weight ?? fp.points}</td>
                        <td style={{ padding: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: fp.points > 0 ? "var(--risk-high)" : "var(--text-muted)" }}>
                          +{fp.points}
                        </td>
                        <td style={{ padding: "0.6rem" }}>
                          <span className={`badge ${fp.status === "counted" ? "badge-high" : "badge-cannot_verify"}`} style={{ fontSize: "0.7rem" }}>
                            {fp.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    (report?.flags || []).map((fl, fIdx) => (
                      <tr key={fIdx} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <td style={{ padding: "0.6rem", fontWeight: 600 }}>{fl.id}</td>
                        <td style={{ padding: "0.6rem", color: "var(--text-secondary)" }}>Specialist Agent</td>
                        <td style={{ padding: "0.6rem", fontFamily: "var(--font-mono)" }}>--</td>
                        <td style={{ padding: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--risk-high)" }}>
                          Active
                        </td>
                        <td style={{ padding: "0.6rem" }}>
                          <span className="badge badge-high" style={{ fontSize: "0.7rem" }}>counted</span>
                        </td>
                      </tr>
                    ))
                  )}

                  {/* ML Classifier row */}
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-card-subtle)" }}>
                    <td style={{ padding: "0.6rem", fontWeight: 600 }}>ML Scam Classifier</td>
                    <td style={{ padding: "0.6rem", color: "var(--text-secondary)" }}>ML Scam Classifier</td>
                    <td style={{ padding: "0.6rem", fontFamily: "var(--font-mono)" }}>Max 25</td>
                    <td style={{ padding: "0.6rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: (scoreBreakdown?.classifierPoints || 0) > 0 ? "var(--risk-high)" : "var(--text-muted)" }}>
                      +{scoreBreakdown?.classifierPoints ?? 0}
                    </td>
                    <td style={{ padding: "0.6rem" }}>
                      <span className="badge badge-low" style={{ fontSize: "0.7rem" }}>applied</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Hard Rules & Coverage Summary Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginTop: "0.5rem" }}>
              <div style={{ padding: "0.75rem", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-card-subtle)", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                  Hard Rules Fired
                </span>
                <div style={{ marginTop: "0.3rem", fontSize: "0.88rem" }}>
                  {scoreBreakdown?.rulesFired && scoreBreakdown.rulesFired.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {scoreBreakdown.rulesFired.map((rf, rIdx) => (
                        <span key={rIdx} className="badge badge-high" style={{ fontSize: "0.72rem" }}>
                          {rf}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>None (Standard scoring applied)</span>
                  )}
                </div>
              </div>

              <div style={{ padding: "0.75rem", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-card-subtle)", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                  Verification Coverage
                </span>
                <div style={{ marginTop: "0.3rem", fontSize: "0.95rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {scoreBreakdown?.coverage
                    ? `${scoreBreakdown.coverage.completedCount}/${scoreBreakdown.coverage.eligibleCount} agents completed (${Math.round((scoreBreakdown.coverage.ratio || 0) * 100)}%)`
                    : "6/6 agents completed (100%)"}
                </div>
              </div>

              <div style={{ padding: "0.75rem", borderRadius: "var(--radius-sm)", backgroundColor: "var(--bg-card-subtle)", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                  Final Assessed Level
                </span>
                <div style={{ marginTop: "0.3rem" }}>
                  <span className={`badge ${report?.riskLevel === "high" || displayRiskLevel === "high" ? "badge-high" : (report?.riskLevel === "medium" || displayRiskLevel === "medium") ? "badge-medium" : (report?.riskLevel === "low" || displayRiskLevel === "low") ? "badge-low" : "badge-cannot_verify"}`} style={{ fontSize: "0.85rem", padding: "0.2rem 0.65rem" }}>
                    {(scoreBreakdown?.finalLevel || report?.riskLevel || displayRiskLevel || "").toUpperCase()} RISK ({report?.score ?? displayScore ?? "--"}/100)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Evidence Flags */}
          {Boolean((report?.flags?.length || 0) > 0 || (scoreBreakdown?.flagPoints?.length || 0) > 0) && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div>
                <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>
                  Evidence-Backed Risk Indicators ({(report?.flags || []).length || (scoreBreakdown?.flagPoints || []).length})
                </h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.2rem" }}>
                  Each indicator is directly anchored in verifiable signals from your input or public registries.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {(report?.flags || []).map((flag, idx) => (
                  <div
                    key={`${flag.id || "flag"}-${idx}`}
                    style={{
                      padding: "1rem 1.15rem",
                      backgroundColor: "var(--bg-card-subtle)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: "0.98rem" }}>{flag.title}</span>
                      <span
                        className={`badge ${
                          flag.severity === "high"
                            ? "badge-high"
                            : flag.severity === "medium"
                            ? "badge-medium"
                            : "badge-cannot_verify"
                        }`}
                        style={{ fontSize: "0.72rem" }}
                      >
                        {flag.severity}
                      </span>
                    </div>

                    <p style={{ color: "var(--text-secondary)", fontSize: "0.92rem", lineHeight: 1.5 }}>
                      {flag.explanation}
                    </p>

                    {flag.evidence && flag.evidence.length > 0 && (
                      <div
                        style={{
                          marginTop: "0.25rem",
                          padding: "0.6rem 0.85rem",
                          backgroundColor: "var(--bg-card)",
                          borderLeft: "3px solid var(--accent-primary)",
                          borderRadius: "var(--radius-sm)",
                          fontSize: "0.85rem",
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-muted)",
                        }}
                      >
                        <strong style={{ color: "var(--text-primary)" }}>Verbatim Evidence: </strong>
                        {flag.evidence.map((ev, eIdx) => (
                          <span key={eIdx}>
                            {formatEvidenceItem(ev)}
                            {eIdx < flag.evidence.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Verified Items */}
          {Boolean((report?.verified?.length || 0) > 0) && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                Checks that passed ({report?.verified?.length || 0})
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {(report?.verified || []).map((v, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem" }}>
                    <span style={{ color: "var(--risk-low)", fontWeight: 700 }}>✓</span>
                    <span>{typeof v === "string" ? v : v.description || JSON.stringify(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Specialist Multi-Agent Verification Audit Cards */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                  Specialist Multi-Agent Verification Cards
                </h2>
                <span className="badge badge-low" style={{ fontSize: "0.72rem", padding: "0.15rem 0.55rem" }}>
                  6 Agents Checked
                </span>
              </div>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.88rem", marginTop: "0.25rem" }}>
                Click any agent card to inspect its verbatim inputs, activity timeline, identified flags, verified records, and manual verification steps.
              </p>
            </div>

            <AgentCards
              agents={agentsCards}
              onSelectAgent={(ag) => setSelectedAgent(ag)}
              selectedAgentKey={selectedAgent?.agent}
            />
          </div>

          {/* PHASE 3B: Specialist Multi-Agent Detailed Responses & Findings */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>
                    Specialist Multi-Agent Audit & Detailed Responses
                  </h2>
                  <span className="badge badge-low" style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}>
                    {agentResults.length || Object.keys(AGENT_LABELS).length} Agents Active
                  </span>
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
                  Inspect verbatim findings, OSINT tool queries, and specific signals evaluated by each specialized analysis agent.
                </p>
              </div>

              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={toggleAllAgents}
                style={{ fontSize: "0.82rem", padding: "0.35rem 0.85rem" }}
              >
                {allExpanded ? "▲ Collapse All Agents" : "▼ Expand All Agents"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              {Object.entries(AGENT_LABELS).map(([agentKey, meta]) => {
                const res = agentResults.find((r) => r.agent === agentKey);
                const isExpanded = Boolean(expandedAgents[agentKey]);
                const statusStr = res?.status || agentStatuses[agentKey] || "ok";
                const flagsCount = res?.flags?.length || 0;
                const verifiedCount = res?.verified?.length || 0;
                const traceCount = res?.trace?.length || 0;

                // Identify tool errors in trace items and live SSE stream events
                const traceItems = Array.isArray(res?.trace) ? res.trace : [];
                const toolErrors = traceItems.filter((tr) => {
                  return (
                    tr.status === "error" ||
                    tr.status === "failed" ||
                    tr.ok === false ||
                    (tr.code && tr.code !== "OK" && tr.code !== 200 && !tr.ok && tr.status !== "ok")
                  );
                });
                const sseToolErrors = streamEvents.filter(
                  (ev) =>
                    ev.agent === agentKey &&
                    ev.type === "tool_end" &&
                    (ev.status === "error" || ev.status === "failed")
                );
                const totalToolErrors =
                  toolErrors.length + (toolErrors.length === 0 ? sseToolErrors.length : 0);
                const reasonInfo = explainAgentReason(res?.reason, statusStr);

                return (
                  <div
                    key={agentKey}
                    style={{
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-card-subtle)",
                      overflow: "hidden",
                    }}
                  >
                    {/* Header Bar */}
                    <div
                      onClick={() => toggleAgent(agentKey)}
                      style={{
                        padding: "0.85rem 1.15rem",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                        userSelect: "none",
                        backgroundColor: isExpanded ? "var(--bg-card)" : "transparent",
                        borderBottom: isExpanded ? "1px solid var(--border-subtle)" : "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "1.25rem" }}>{meta.icon}</span>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontWeight: 700, fontSize: "0.98rem" }}>{meta.name}</span>
                            <span
                              className={`badge ${
                                statusStr === "ok"
                                  ? "badge-low"
                                  : statusStr === "skipped"
                                  ? "badge-cannot_verify"
                                  : "badge-medium"
                              }`}
                              style={{ fontSize: "0.72rem", padding: "0.1rem 0.45rem", textTransform: "uppercase" }}
                            >
                              {statusStr}
                            </span>
                            {res?.round != null && (
                              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                [R{res.round}]
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{meta.desc}</span>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
                        {res?.durationMs != null && (
                          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                            {res.durationMs}ms
                          </span>
                        )}
                        {totalToolErrors > 0 && (
                          <span className="badge badge-high" style={{ fontSize: "0.72rem" }}>
                            ⚠️ {totalToolErrors} tool {totalToolErrors === 1 ? "error" : "errors"}
                          </span>
                        )}
                        {flagsCount > 0 && (
                          <span className="badge badge-high" style={{ fontSize: "0.72rem" }}>
                            {flagsCount} {flagsCount === 1 ? "flag" : "flags"}
                          </span>
                        )}
                        {verifiedCount > 0 && (
                          <span className="badge badge-low" style={{ fontSize: "0.72rem" }}>
                            {verifiedCount} verified
                          </span>
                        )}
                        <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>
                    </div>

                    {/* Collapsed Preview Summary */}
                    {!isExpanded && res?.notes && (
                      <div style={{ padding: "0.45rem 1.15rem 0.75rem", fontSize: "0.86rem", color: "var(--text-secondary)" }}>
                        {res.notes}
                      </div>
                    )}

                    {/* Expanded Detailed Body */}
                    {isExpanded && (
                      <div style={{ padding: "1.15rem", display: "flex", flexDirection: "column", gap: "1rem", backgroundColor: "var(--bg-card)" }}>
                        {/* Executive Agent Notes */}
                        {res?.notes ? (
                          <div
                            style={{
                              padding: "0.75rem 1rem",
                              backgroundColor: "var(--bg-card-subtle)",
                              borderRadius: "var(--radius-sm)",
                              borderLeft: "3px solid var(--accent-primary)",
                              fontSize: "0.9rem",
                              lineHeight: 1.5,
                            }}
                          >
                            <strong style={{ color: "var(--text-primary)", display: "block", marginBottom: "0.2rem" }}>
                              Agent Summary & Conclusion:
                            </strong>
                            <span style={{ color: "var(--text-secondary)" }}>{res.notes}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: "0.88rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                            Specialist completed without additional commentary.
                          </div>
                        )}

                        {/* Status Diagnostics & Why Agent Could Not Check / Was Skipped */}
                        {reasonInfo && (
                          <div
                            style={{
                              padding: "0.85rem 1rem",
                              backgroundColor: statusStr === "could_not_check" ? "rgba(239, 68, 68, 0.08)" : "var(--risk-cannot_verify-bg)",
                              border: `1px solid ${statusStr === "could_not_check" ? "rgba(239, 68, 68, 0.3)" : "var(--risk-cannot_verify-border)"}`,
                              borderRadius: "var(--radius-sm)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.35rem",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <span style={{ fontWeight: 700, fontSize: "0.92rem", color: statusStr === "could_not_check" ? "var(--risk-high)" : "var(--text-primary)" }}>
                                  {statusStr === "could_not_check" ? "⚠️ Check Could Not Complete" : "ℹ️ Check Status Note"}
                                </span>
                                {res?.reason && (
                                  <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", backgroundColor: "var(--bg-card)", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>
                                    {res.reason}
                                  </code>
                                )}
                              </div>
                            </div>

                            <div style={{ fontSize: "0.86rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                              <strong style={{ color: "var(--text-primary)" }}>Why this occurred: </strong>
                              {reasonInfo.explanation}
                            </div>

                            {reasonInfo.remediation && (
                              <div style={{ fontSize: "0.82rem", color: "var(--accent-primary)", marginTop: "0.1rem" }}>
                                💡 <strong>Action: </strong>{reasonInfo.remediation}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ML Classifier Specific Output */}
                        {res?.classifierResult && (
                          <div
                            style={{
                              padding: "1rem",
                              backgroundColor: "var(--bg-card-subtle)",
                              border: "1px solid var(--border-subtle)",
                              borderRadius: "var(--radius-sm)",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.75rem",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <strong style={{ fontSize: "0.95rem" }}>scikit-learn Classifier Output:</strong>
                              <span
                                className={`badge ${
                                  res.classifierResult.label === "suspicious" ? "badge-high" : "badge-low"
                                }`}
                                style={{ fontSize: "0.75rem" }}
                              >
                                {res.classifierResult.label?.toUpperCase()}
                              </span>
                            </div>

                            {/* Probability Bar */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem" }}>
                                <span style={{ color: "var(--text-muted)" }}>Scam Probability:</span>
                                <span style={{ fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                                  {(res.classifierResult.probability * 100).toFixed(1)}%
                                </span>
                              </div>
                              <div
                                style={{
                                  width: "100%",
                                  height: "8px",
                                  backgroundColor: "var(--border-subtle)",
                                  borderRadius: "4px",
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    width: `${Math.min(100, Math.max(0, res.classifierResult.probability * 100))}%`,
                                    height: "100%",
                                    backgroundColor:
                                      res.classifierResult.probability > 0.8
                                        ? "var(--risk-high)"
                                        : res.classifierResult.probability > 0.4
                                        ? "var(--risk-medium)"
                                        : "var(--risk-low)",
                                    transition: "width 0.4s ease",
                                  }}
                                />
                              </div>
                            </div>

                            {/* Inferred Category */}
                            {res.classifierResult.scamType && (
                              <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                                <strong>Inferred Opportunity Category: </strong>
                                <span className="badge badge-medium" style={{ fontSize: "0.72rem" }}>
                                  {res.classifierResult.scamType}
                                </span>
                              </div>
                            )}

                            {/* Top Predictive N-Gram Features */}
                            {Array.isArray(res.classifierResult.topTerms) && res.classifierResult.topTerms.length > 0 && (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 600 }}>
                                  Top Predictive Tokens:
                                </span>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                                  {res.classifierResult.topTerms.map((term, tIdx) => (
                                    <span
                                      key={tIdx}
                                      style={{
                                        padding: "0.2rem 0.5rem",
                                        backgroundColor: "var(--bg-card)",
                                        border: "1px solid var(--border-subtle)",
                                        borderRadius: "var(--radius-sm)",
                                        fontFamily: "var(--font-mono)",
                                        fontSize: "0.78rem",
                                        color: "var(--text-primary)",
                                      }}
                                    >
                                      &ldquo;{term}&rdquo;
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Flags Found By This Agent */}
                        {flagsCount > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                            <strong style={{ fontSize: "0.88rem", color: "var(--text-primary)" }}>
                              Flags Identified by this Specialist ({flagsCount}):
                            </strong>
                            {res.flags.map((f, fIdx) => (
                              <div
                                key={fIdx}
                                style={{
                                  padding: "0.75rem 0.95rem",
                                  backgroundColor: "var(--bg-card-subtle)",
                                  border: "1px solid var(--border-subtle)",
                                  borderRadius: "var(--radius-sm)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.35rem",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>{f.title || f.id}</span>
                                  <span
                                    className={`badge ${
                                      f.severity === "high"
                                        ? "badge-high"
                                        : f.severity === "medium"
                                        ? "badge-medium"
                                        : "badge-cannot_verify"
                                    }`}
                                    style={{ fontSize: "0.7rem" }}
                                  >
                                    {f.severity}
                                  </span>
                                </div>
                                <p style={{ fontSize: "0.86rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                                  {f.explanation}
                                </p>
                                {Array.isArray(f.evidence) && f.evidence.length > 0 && (
                                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
                                    <strong>Evidence Anchor: </strong>
                                    {f.evidence.map((ev, evIdx) => (
                                      <span key={evIdx}>
                                        {ev.quote ? `"${ev.quote}"` : ev.url ? (
                                          <a href={ev.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-primary)" }}>
                                            {ev.url}
                                          </a>
                                        ) : JSON.stringify(ev)}
                                        {evIdx < f.evidence.length - 1 ? ", " : ""}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Verified Signals By This Agent */}
                        {verifiedCount > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                            <strong style={{ fontSize: "0.88rem", color: "var(--text-primary)" }}>
                              Checks that passed ({verifiedCount}):
                            </strong>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                              {res.verified.map((v, vIdx) => (
                                <div key={vIdx} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.86rem" }}>
                                  <span style={{ color: "var(--risk-low)", fontWeight: 700 }}>✓</span>
                                  <span style={{ color: "var(--text-secondary)" }}>
                                    {typeof v === "string" ? v : v.description || JSON.stringify(v)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Tool & OSINT Trace History */}
                        {(traceCount > 0 || sseToolErrors.length > 0) && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            <details
                              open={totalToolErrors > 0}
                              style={{
                                fontSize: "0.84rem",
                                border: totalToolErrors > 0 ? "1px solid rgba(239, 68, 68, 0.35)" : "1px solid var(--border-subtle)",
                                borderRadius: "var(--radius-sm)",
                                padding: "0.6rem 0.85rem",
                                backgroundColor: totalToolErrors > 0 ? "rgba(239, 68, 68, 0.03)" : "var(--bg-card-subtle)",
                              }}
                            >
                              <summary
                                style={{
                                  cursor: "pointer",
                                  color: totalToolErrors > 0 ? "var(--risk-high)" : "var(--accent-primary)",
                                  fontWeight: 600,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  userSelect: "none",
                                }}
                              >
                                <span>
                                  {totalToolErrors > 0
                                    ? `⚠️ ${traceCount || sseToolErrors.length} Tool & OSINT Trace Call(s) — (${totalToolErrors} error${totalToolErrors === 1 ? "" : "s"})`
                                    : `View ${traceCount} Tool & OSINT Trace Call(s)`}
                                </span>
                                {totalToolErrors > 0 && (
                                  <span className="badge badge-high" style={{ fontSize: "0.68rem" }}>
                                    Inspect error causes
                                  </span>
                                )}
                              </summary>

                              <div
                                style={{
                                  marginTop: "0.75rem",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "0.6rem",
                                  maxHeight: "360px",
                                  overflowY: "auto",
                                }}
                              >
                                {/* Render trace items from agent results */}
                                {traceItems.map((tr, trIdx) => {
                                  const isErr =
                                    tr.status === "error" ||
                                    tr.status === "failed" ||
                                    tr.ok === false ||
                                    (tr.code && tr.code !== "OK" && tr.code !== 200 && !tr.ok && tr.status !== "ok");
                                  const errorInfo = isErr ? explainToolError(tr) : null;

                                  if (isErr && errorInfo) {
                                    return (
                                      <div
                                        key={trIdx}
                                        style={{
                                          padding: "0.65rem 0.85rem",
                                          backgroundColor: "rgba(239, 68, 68, 0.06)",
                                          border: "1px solid rgba(239, 68, 68, 0.25)",
                                          borderRadius: "var(--radius-sm)",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "0.3rem",
                                          fontSize: "0.82rem",
                                        }}
                                      >
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                            <span style={{ color: "var(--risk-high)", fontWeight: 700, fontSize: "0.85rem" }}>✕ FAILED QUERY</span>
                                            <strong style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>{errorInfo.toolName}</strong>
                                            {errorInfo.target && (
                                              <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}>
                                                ({errorInfo.target})
                                              </span>
                                            )}
                                          </div>
                                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                            <span className="badge badge-high" style={{ fontSize: "0.68rem", textTransform: "none" }}>
                                              {errorInfo.errorCode}
                                            </span>
                                            {tr.durationMs != null && (
                                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                                [{tr.durationMs}ms]
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        <div style={{ fontSize: "0.82rem", lineHeight: 1.45, color: "var(--text-primary)" }}>
                                          <strong style={{ color: "var(--risk-high)" }}>Why error occurred: </strong>
                                          <span>{errorInfo.explanation}</span>
                                        </div>

                                        {errorInfo.remediation && (
                                          <div style={{ fontSize: "0.78rem", color: "var(--accent-primary)" }}>
                                            💡 <strong>Remediation: </strong>
                                            {errorInfo.remediation}
                                          </div>
                                        )}

                                        {errorInfo.rawMsg && (
                                          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                            Detail: {errorInfo.rawMsg}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  }

                                  return (
                                    <div
                                      key={trIdx}
                                      style={{
                                        display: "flex",
                                        gap: "0.5rem",
                                        alignItems: "baseline",
                                        color: "var(--text-muted)",
                                        fontFamily: "var(--font-mono)",
                                        fontSize: "0.78rem",
                                        padding: "0.15rem 0",
                                      }}
                                    >
                                      <span style={{ color: "var(--risk-low)" }}>●</span>
                                      <strong style={{ color: "var(--text-primary)" }}>{tr.tool || tr.check || tr.item || tr.type || "check"}:</strong>
                                      <span>{tr.status || (tr.ok ? "ok" : "completed")}</span>
                                      {tr.detail && <span>({typeof tr.detail === "string" ? tr.detail : JSON.stringify(tr.detail)})</span>}
                                      {tr.durationMs != null && <span>[{tr.durationMs}ms]</span>}
                                    </div>
                                  );
                                })}

                                {/* Fallback: if agent has no trace items but SSE recorded tool errors */}
                                {traceItems.length === 0 &&
                                  sseToolErrors.map((ev, sIdx) => {
                                    const errorInfo = explainToolError(ev);
                                    return (
                                      <div
                                        key={`sse-err-${sIdx}`}
                                        style={{
                                          padding: "0.65rem 0.85rem",
                                          backgroundColor: "rgba(239, 68, 68, 0.06)",
                                          border: "1px solid rgba(239, 68, 68, 0.25)",
                                          borderRadius: "var(--radius-sm)",
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "0.3rem",
                                          fontSize: "0.82rem",
                                        }}
                                      >
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
                                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                            <span style={{ color: "var(--risk-high)", fontWeight: 700, fontSize: "0.85rem" }}>✕ FAILED QUERY</span>
                                            <strong style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>{ev.tool}</strong>
                                            {ev.label && (
                                              <span style={{ color: "var(--text-muted)", fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}>
                                                ({ev.label})
                                              </span>
                                            )}
                                          </div>
                                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                            <span className="badge badge-high" style={{ fontSize: "0.68rem" }}>
                                              TOOL_ERROR
                                            </span>
                                            {ev.durationMs != null && (
                                              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                                [{ev.durationMs}ms]
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        <div style={{ fontSize: "0.82rem", lineHeight: 1.45, color: "var(--text-primary)" }}>
                                          <strong style={{ color: "var(--risk-high)" }}>Why error occurred: </strong>
                                          <span>{errorInfo.explanation}</span>
                                        </div>

                                        {ev.summary && (
                                          <div style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                            Detail: {ev.summary}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                            </details>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Student Action Checklist */}
          {Boolean((report?.checklist?.length || 0) > 0) && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>
                      What to Verify Next (Action Checklist)
                    </h2>
                    <span className="badge badge-low" style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}>
                      {Object.values(checkedChecklist).filter(Boolean).length} / {report?.checklist?.length || 0} Completed
                    </span>
                  </div>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
                    Follow these concrete checkpoints before making decisions, sharing documents, or sending funds.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={handleCopyChecklist}
                  style={{ fontSize: "0.82rem", padding: "0.35rem 0.85rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
                >
                  <span>{copiedChecklist ? "✓ Copied Checklist!" : "📋 Copy Verification Checklist"}</span>
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {(report?.checklist || []).map((item, idx) => {
                  const parsed = normalizeChecklistItem(item);
                  const isChecked = Boolean(checkedChecklist[idx]);

                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "0.85rem 1rem",
                        backgroundColor: isChecked ? "rgba(16, 185, 129, 0.05)" : "var(--bg-card-subtle)",
                        border: `1px solid ${isChecked ? "rgba(16, 185, 129, 0.3)" : "var(--border-subtle)"}`,
                        borderRadius: "var(--radius-sm)",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.85rem",
                        transition: "all 0.2s ease",
                      }}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        id={`chk-${idx}`}
                        checked={isChecked}
                        onChange={() => toggleChecklistItem(idx)}
                        style={{
                          marginTop: "0.3rem",
                          cursor: "pointer",
                          width: "18px",
                          height: "18px",
                          accentColor: "var(--accent-primary)",
                        }}
                      />

                      {/* Checkpoint Details */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontSize: "0.78rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                              CHECKPOINT #{idx + 1}
                            </span>
                            <span className={`badge ${parsed.tagClass}`} style={{ fontSize: "0.7rem", padding: "0.1rem 0.45rem" }}>
                              {parsed.tag}
                            </span>
                          </div>

                          {parsed.url && (
                            <a
                              href={parsed.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-secondary btn-sm"
                              style={{
                                fontSize: "0.78rem",
                                padding: "0.2rem 0.6rem",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.35rem",
                                color: "var(--accent-primary)",
                              }}
                            >
                              <span>Official Portal ({parsed.portalName || "Link"}) ↗</span>
                            </a>
                          )}
                        </div>

                        <label
                          htmlFor={`chk-${idx}`}
                          style={{
                            fontSize: "0.92rem",
                            color: isChecked ? "var(--text-muted)" : "var(--text-primary)",
                            textDecoration: isChecked ? "line-through" : "none",
                            lineHeight: 1.5,
                            cursor: "pointer",
                          }}
                        >
                          {parsed.text}
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Entities and what was checked Table */}
          {(() => {
            const allEntityChecks = (agentsCards || []).flatMap((ag) =>
              (ag.entityStatus || []).map((es) => ({
                entity: `${es.entityKind}: ${es.entityValue}`,
                agent: ag.name || ag.agent,
                status: es.status,
                reason: es.reason || "—",
              }))
            );
            if (allEntityChecks.length === 0) return null;

            return (
              <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <div>
                  <h2 style={{ fontSize: "1.3rem", fontWeight: 700 }}>
                    Entities and What Was Checked
                  </h2>
                  <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.25rem" }}>
                    Multi-agent cross-verification record across all extracted identifiers and opportunity claims.
                  </p>
                </div>

                <div style={{ overflowX: "auto", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                    <thead>
                      <tr style={{ backgroundColor: "var(--bg-card-subtle)", borderBottom: "1px solid var(--border-subtle)" }}>
                        <th style={{ padding: "0.6rem 0.85rem", fontWeight: 600 }}>Entity</th>
                        <th style={{ padding: "0.6rem 0.85rem", fontWeight: 600 }}>Agent</th>
                        <th style={{ padding: "0.6rem 0.85rem", fontWeight: 600 }}>Status</th>
                        <th style={{ padding: "0.6rem 0.85rem", fontWeight: 600 }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allEntityChecks.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: idx < allEntityChecks.length - 1 ? "1px solid var(--border-subtle)" : "none" }}>
                          <td style={{ padding: "0.6rem 0.85rem", fontWeight: 500, fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}>
                            {item.entity}
                          </td>
                          <td style={{ padding: "0.6rem 0.85rem", color: "var(--text-secondary)" }}>
                            {item.agent}
                          </td>
                          <td style={{ padding: "0.6rem 0.85rem" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "0.15rem 0.5rem",
                                borderRadius: "var(--radius-sm)",
                                fontSize: "0.72rem",
                                fontWeight: 600,
                                textTransform: "uppercase",
                                backgroundColor:
                                  item.status === "verified" || item.status === "checked_no_issue"
                                    ? "rgba(22, 163, 74, 0.12)"
                                    : item.status === "contradicted"
                                    ? "rgba(220, 38, 38, 0.12)"
                                    : item.status === "could_not_check"
                                    ? "rgba(217, 119, 6, 0.12)"
                                    : "var(--bg-card-subtle)",
                                color:
                                  item.status === "verified" || item.status === "checked_no_issue"
                                    ? "#16a34a"
                                    : item.status === "contradicted"
                                    ? "#dc2626"
                                    : item.status === "could_not_check"
                                    ? "#d97706"
                                    : "var(--text-secondary)",
                              }}
                            >
                              {item.status}
                            </span>
                          </td>
                          <td style={{ padding: "0.6rem 0.85rem", color: "var(--text-secondary)" }}>
                            {item.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Action Tools & Help */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Next Actions & Student Assistance</h2>

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={handleGenerateCollegeEmail}
                disabled={emailLoading}
              >
                {emailLoading ? "Generating..." : "✉ Generate College / Placement Cell Email"}
              </button>

              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowPaidHelp(!showPaidHelp)}
              >
                🚨 I Already Paid Money (Immediate Help)
              </button>

              {(report?.riskLevel === "high" || displayRiskLevel === "high") && !graphSaved && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={handleSaveToGraph}
                >
                  🛡 Save Identifiers to Scam Graph
                </button>
              )}
            </div>

            {/* Generated Email Box */}
            {collegeEmail && (
              <div
                style={{
                  padding: "1rem",
                  backgroundColor: "var(--bg-card-subtle)",
                  borderRadius: "var(--radius-sm)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ fontSize: "0.9rem" }}>Draft Email to Placement Cell / College Authorities:</strong>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      const textToCopy = `Subject: ${collegeEmail.subject}\n\n${collegeEmail.body}`;
                      navigator.clipboard.writeText(textToCopy);
                      setCopiedEmail(true);
                      setTimeout(() => setCopiedEmail(false), 2000);
                    }}
                  >
                    {copiedEmail ? "✓ Copied!" : "Copy to Clipboard"}
                  </button>
                </div>
                <div style={{ fontSize: "0.88rem", fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap" }}>
                  <strong>Subject:</strong> {collegeEmail.subject}
                  <br /><br />
                  {collegeEmail.body}
                </div>
              </div>
            )}

            {/* I Already Paid Guide */}
            {showPaidHelp && (
              <div
                style={{
                  padding: "1rem",
                  backgroundColor: "var(--risk-high-bg)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--risk-high-border)",
                  borderRadius: "var(--radius-sm)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  fontSize: "0.9rem",
                }}
              >
                <strong style={{ color: "var(--risk-high)", fontSize: "1rem" }}>
                  Emergency Action Steps (Golden Hour):
                </strong>
                <ol style={{ paddingLeft: "1.2rem", lineHeight: 1.6 }}>
                  <li><strong>Call 1930 immediately:</strong> National Cyber Crime Helpline (Ministry of Home Affairs, India). Quick reporting within 2–4 hours increases chances of bank account freezing.</li>
                  <li><strong>Lodge a complaint on <a href="https://cybercrime.gov.in" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>cybercrime.gov.in</a>:</strong> Save the acknowledgement number (CFMS).</li>
                  <li><strong>Contact your Bank immediately:</strong> Report the UPI transaction UTR number or debit card unauthorized transfer. Request an immediate fraud chargeback/recall.</li>
                  <li><strong>Do not send more money:</strong> Scammers often demand &quot;unfreeze fees&quot; or &quot;cancellation charges&quot;. Any further payment will also be lost.</li>
                </ol>
              </div>
            )}

            {graphSaved && (
              <div style={{ fontSize: "0.85rem", color: "var(--risk-low)" }}>
                ✓ Identifiers anonymously recorded in shared scam database to alert other students.
              </div>
            )}

            {/* Feedback row */}
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.85rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
                Was this risk assessment helpful and accurate?
              </span>
              {feedbackSent ? (
                <span style={{ fontSize: "0.85rem", color: "var(--risk-low)" }}>✓ Thank you for your feedback!</span>
              ) : (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => handleSendFeedback(true)}>
                    👍 Yes
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={() => handleSendFeedback(false)}>
                    👎 No
                  </button>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Link href="/check" className="btn-secondary">
              ← Check Another Opportunity
            </Link>
            <Link href="/guides" className="btn-secondary">
              Explore Scam Archetype Guides →
            </Link>
          </div>
        </div>
      )}

      {/* Interactive Agent Activity Drawer */}
      {selectedAgent && (
        <AgentActivityDrawer
          agent={activeAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
