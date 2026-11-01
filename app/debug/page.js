"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getClientLogs, clearClientLogs } from "../../lib/client-logger.js";

const AGENT_COLORS = {
  message_analyst: "var(--accent-primary, #0284c7)",
  classifier_client: "#8b5cf6",
  website_forensics: "#06b6d4",
  payment_entity: "#f59e0b",
  official_verifier: "#10b981",
  reputation_osint: "#ec4899",
  coordinator: "#64748b",
  user: "#3b82f6",
  client: "#64748b",
};

export default function DebugLogsPage() {
  const [logs, setLogs] = useState([]);
  const [selectedCheckId, setSelectedCheckId] = useState("all");
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRows, setExpandedRows] = useState({});
  const [copied, setCopied] = useState(false);

  // Load logs on mount and listen to real-time update events
  useEffect(() => {
    function refreshLogs() {
      setLogs(getClientLogs());
    }

    refreshLogs();
    window.addEventListener("debug_logs_updated", refreshLogs);
    const interval = setInterval(refreshLogs, 1500);

    return () => {
      window.removeEventListener("debug_logs_updated", refreshLogs);
      clearInterval(interval);
    };
  }, []);

  // Compute unique check IDs for dropdown
  const uniqueCheckIds = useMemo(() => {
    const set = new Set();
    for (const l of logs) {
      if (l.checkId) set.add(l.checkId);
    }
    return Array.from(set);
  }, [logs]);

  // Compute unique agents for dropdown
  const uniqueAgents = useMemo(() => {
    const set = new Set();
    for (const l of logs) {
      if (l.agent) set.add(l.agent);
    }
    return Array.from(set);
  }, [logs]);

  // Compute unique event types for dropdown
  const uniqueTypes = useMemo(() => {
    const set = new Set();
    for (const l of logs) {
      if (l.type) set.add(l.type);
    }
    return Array.from(set);
  }, [logs]);

  // Filtered log entries
  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (selectedCheckId !== "all" && l.checkId !== selectedCheckId) return false;
      if (selectedAgent !== "all" && l.agent !== selectedAgent) return false;
      if (selectedType !== "all" && l.type !== selectedType) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const str = `${l.agent || ""} ${l.type || ""} ${l.summary || ""} ${l.tool || ""} ${l.checkId || ""}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });
  }, [logs, selectedCheckId, selectedAgent, selectedType, searchQuery]);

  function handleClear() {
    if (window.confirm("Are you sure you want to clear all investigation logs from localStorage?")) {
      clearClientLogs();
      setLogs([]);
    }
  }

  function handleCopyJson() {
    const jsonStr = JSON.stringify(filteredLogs, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleRow(id) {
    setExpandedRows((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      {/* Page Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.6rem" }}>🔍</span>
            <h1 style={{ fontSize: "1.85rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
              Investigation Process & Debug Logs
            </h1>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.35rem", fontSize: "0.95rem" }}>
            Live client-side activity inspector. Events, tool calls, and agent verdicts are automatically recorded in localStorage so you do not need terminal access to debug.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.6rem" }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleCopyJson}
            disabled={filteredLogs.length === 0}
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
          >
            <span>{copied ? "✓ Copied JSON!" : "📋 Copy Filtered Logs"}</span>
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleClear}
            disabled={logs.length === 0}
            style={{ color: "var(--risk-high)", borderColor: "var(--risk-high-border)" }}
          >
            🗑 Clear Logs
          </button>
          {selectedCheckId !== "all" ? (
            <Link
              href={`/check/${selectedCheckId}`}
              className="btn-primary btn-sm"
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <span>📄 View Final Report →</span>
            </Link>
          ) : uniqueCheckIds.length > 0 ? (
            <Link
              href={`/check/${uniqueCheckIds[0]}`}
              className="btn-primary btn-sm"
              style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}
            >
              <span>📄 View Latest Report →</span>
            </Link>
          ) : (
            <Link href="/check" className="btn-primary btn-sm">
              + Run a Check
            </Link>
          )}
        </div>
      </div>

      {/* Metrics Strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
        }}
      >
        <div className="card-subtle" style={{ padding: "0.85rem 1rem" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Total Events Stored
          </span>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
            {logs.length}
          </div>
        </div>

        <div className="card-subtle" style={{ padding: "0.85rem 1rem" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Unique Checks Logged
          </span>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
            {uniqueCheckIds.length}
          </div>
        </div>

        <div className="card-subtle" style={{ padding: "0.85rem 1rem" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Tool Calls (Starts/Ends)
          </span>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
            {logs.filter((l) => l.type === "tool_start" || l.type === "tool_end").length}
          </div>
        </div>

        <div className="card-subtle" style={{ padding: "0.85rem 1rem" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
            Flags Identified
          </span>
          <div style={{ fontSize: "1.5rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--risk-high)", marginTop: "0.2rem" }}>
            {logs.filter((l) => l.type === "flag").length}
          </div>
        </div>
      </div>

      {/* Filters & Search Control Bar */}
      <div
        className="card"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.85rem",
          alignItems: "center",
          padding: "1rem",
        }}
      >
        {/* Search Input */}
        <div style={{ flex: "1 1 240px" }}>
          <input
            type="text"
            className="input-text"
            placeholder="Search by keyword, tool, agent, quote..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ fontSize: "0.88rem" }}
          />
        </div>

        {/* Check ID Filter */}
        <div style={{ minWidth: "160px" }}>
          <select
            className="input-select"
            value={selectedCheckId}
            onChange={(e) => setSelectedCheckId(e.target.value)}
            style={{ fontSize: "0.85rem" }}
          >
            <option value="all">All Checks ({uniqueCheckIds.length})</option>
            {uniqueCheckIds.map((cid) => (
              <option key={cid} value={cid}>
                Check: {cid.slice(0, 8)}...
              </option>
            ))}
          </select>
        </div>

        {/* Agent Filter */}
        <div style={{ minWidth: "150px" }}>
          <select
            className="input-select"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            style={{ fontSize: "0.85rem" }}
          >
            <option value="all">All Agents ({uniqueAgents.length})</option>
            {uniqueAgents.map((ag) => (
              <option key={ag} value={ag}>
                {ag}
              </option>
            ))}
          </select>
        </div>

        {/* Event Type Filter */}
        <div style={{ minWidth: "150px" }}>
          <select
            className="input-select"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            style={{ fontSize: "0.85rem" }}
          >
            <option value="all">All Event Types ({uniqueTypes.length})</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Reset Filter Button */}
        {(selectedCheckId !== "all" || selectedAgent !== "all" || selectedType !== "all" || searchQuery) && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setSelectedCheckId("all");
              setSelectedAgent("all");
              setSelectedType("all");
              setSearchQuery("");
            }}
            style={{ fontSize: "0.8rem" }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Log Feed Table / List */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.6rem" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            Showing {filteredLogs.length} of {logs.length} Log Entries
          </span>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            Stored in browser localStorage (capped at 600 entries)
          </span>
        </div>

        {filteredLogs.length === 0 ? (
          <div
            style={{
              padding: "3.5rem 1.5rem",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.75rem",
            }}
          >
            <span style={{ fontSize: "2.2rem" }}>📭</span>
            <strong style={{ fontSize: "1.1rem" }}>No investigation logs found</strong>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", maxWidth: "480px" }}>
              {logs.length === 0
                ? "No investigation runs have been recorded yet. Start an opportunity verification to watch agent and tool calls stream live."
                : "No log entries match the selected filters above."}
            </p>
            {logs.length === 0 && (
              <Link href="/check" className="btn-primary btn-sm" style={{ marginTop: "0.5rem" }}>
                Verify a Sample Opportunity →
              </Link>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {filteredLogs.map((log) => {
              const isExpanded = Boolean(expandedRows[log.id]);
              const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "--";
              const agentColor = AGENT_COLORS[log.agent] || "var(--text-muted)";

              return (
                <div
                  key={log.id}
                  style={{
                    backgroundColor: isExpanded ? "var(--bg-card-hover)" : "var(--bg-card-subtle)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0.6rem 0.85rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem",
                    transition: "background 0.1s ease",
                  }}
                >
                  {/* Summary Row */}
                  <div
                    onClick={() => toggleRow(log.id)}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "0.75rem",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap", flex: 1 }}>
                      {/* Timestamp */}
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.76rem", color: "var(--text-muted)" }}>
                        {timeStr}
                      </span>

                      {/* Sequence Number */}
                      {log.seq != null && (
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.72rem",
                            backgroundColor: "var(--border-subtle)",
                            padding: "0.05rem 0.35rem",
                            borderRadius: "3px",
                            color: "var(--text-secondary)",
                          }}
                        >
                          #{log.seq}
                        </span>
                      )}

                      {/* Agent Badge */}
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.78rem",
                          color: agentColor,
                          padding: "0.1rem 0.4rem",
                          backgroundColor: "var(--bg-page)",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        {log.agent || "system"}
                      </span>

                      {/* Event Type Badge */}
                      <span
                        className={`badge ${
                          log.type === "flag"
                            ? "badge-high"
                            : log.type === "verdict"
                            ? "badge-medium"
                            : log.type === "tool_start" || log.type === "tool_end"
                            ? "badge-low"
                            : "badge-cannot_verify"
                        }`}
                        style={{ fontSize: "0.68rem", padding: "0.05rem 0.4rem", textTransform: "uppercase" }}
                      >
                        {log.type}
                      </span>

                      {/* Tool tag */}
                      {log.tool && (
                        <code
                          style={{
                            fontSize: "0.76rem",
                            color: "var(--accent-primary)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {log.tool}
                        </code>
                      )}

                      {/* Summary Text */}
                      <span style={{ color: "var(--text-primary)", fontWeight: 500, lineHeight: 1.4 }}>
                        {log.summary || "(No summary text)"}
                      </span>
                    </div>

                    {/* Right Meta (Duration & Check Link) */}
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexShrink: 0 }}>
                      {log.durationMs != null && (
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          {log.durationMs}ms
                        </span>
                      )}
                      {log.checkId && (
                        <Link
                          href={`/check/${log.checkId}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: "0.74rem",
                            color: "var(--accent-primary)",
                            fontFamily: "var(--font-mono)",
                            textDecoration: "underline",
                          }}
                        >
                          {log.checkId.slice(0, 6)}...
                        </Link>
                      )}
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Payload Inspector */}
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: "0.35rem",
                        padding: "0.75rem",
                        backgroundColor: "var(--bg-page)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "0.8rem",
                        fontFamily: "var(--font-mono)",
                        overflowX: "auto",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
                        <span style={{ fontWeight: 600, color: "var(--text-muted)" }}>Raw Event Data:</span>
                        {log.checkId && (
                          <Link href={`/check/${log.checkId}`} style={{ color: "var(--accent-primary)", fontSize: "0.78rem" }}>
                            Go to Check Page →
                          </Link>
                        )}
                      </div>
                      <pre style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.45 }}>
                        {JSON.stringify(log.payload || log, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
