"use client";

import { AGENT_ORDER, AGENT_DISPLAY_NAMES } from "../lib/config/agents.js";

function getAgentIcon(agentKey) {
  switch (agentKey) {
    case "message_analyst":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case "classifier_client":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      );
    case "website_forensics":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case "payment_entity":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
      );
    case "official_verifier":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      );
    case "reputation_osint":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}

export const CHIP_CONFIG = {
  waiting: {
    label: "Waiting",
    className: "badge-cannot_verify",
    bg: "rgba(100, 116, 139, 0.08)",
    color: "var(--text-muted)",
    border: "rgba(100, 116, 139, 0.2)",
    icon: "⏳",
  },
  running: {
    label: "Running",
    className: "badge-medium",
    bg: "rgba(2, 132, 199, 0.12)",
    color: "var(--accent-primary)",
    border: "rgba(2, 132, 199, 0.35)",
    icon: "⚡",
  },
  done: {
    label: "Done",
    className: "badge-low",
    bg: "var(--status-emerald-bg)",
    color: "var(--status-emerald)",
    border: "var(--status-emerald-border)",
    icon: "✓",
  },
  found_issues: {
    label: "Found issues",
    className: "badge-high",
    bg: "var(--status-crimson-bg)",
    color: "var(--status-crimson)",
    border: "var(--status-crimson-border)",
    icon: "⚠️",
  },
  not_applicable: {
    label: "Not applicable",
    className: "badge-cannot_verify",
    bg: "rgba(148, 163, 184, 0.08)",
    color: "var(--text-muted)",
    border: "rgba(148, 163, 184, 0.2)",
    icon: "⊘",
  },
  could_not_check: {
    label: "Could not check",
    className: "badge-medium",
    bg: "var(--status-amber-bg)",
    color: "var(--status-amber)",
    border: "var(--status-amber-border)",
    icon: "✕",
  },
};

/**
 * Status Chip component rendering one of the six canonical status states.
 */
export function AgentStatusChip({ status }) {
  const config = CHIP_CONFIG[status] || CHIP_CONFIG.waiting;
  const isRunning = status === "running";

  return (
    <span
      className="badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.22rem 0.65rem",
        fontSize: "0.72rem",
        fontWeight: 600,
        borderRadius: "var(--radius-full)",
        backgroundColor: config.bg,
        color: config.color,
        border: `1px solid ${config.border}`,
        letterSpacing: "0.02em",
        textTransform: "none",
      }}
    >
      <span
        style={{
          display: "inline-block",
          fontSize: "0.75rem",
          animation: isRunning ? "spin 1.2s linear infinite" : "none",
        }}
      >
        {config.icon}
      </span>
      {config.label}
    </span>
  );
}

/**
 * Grid of six interactive Agent Cards displayed in canonical fixed order.
 * Clicking a card invokes onSelectAgent with the agent object.
 */
export default function AgentCards({ agents = [], onSelectAgent, selectedAgentKey }) {
  // Index agents by agent key for quick lookup
  const agentsMap = new Map();
  for (const ag of agents) {
    if (ag && ag.agent) {
      agentsMap.set(ag.agent, ag);
    }
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "1rem",
        width: "100%",
      }}
    >
      {AGENT_ORDER.map((agentKey) => {
        const item = agentsMap.get(agentKey) || {
          agent: agentKey,
          name: AGENT_DISPLAY_NAMES[agentKey] || agentKey,
          status: "waiting",
          summary: "Waiting to begin verification.",
          durationMs: 0,
          activity: [],
          flags: [],
          verified: [],
          unchecked: [],
          manualChecks: [],
        };

        const isSelected = selectedAgentKey === agentKey;
        const durationText = item.durationMs > 0 ? `${item.durationMs}ms` : null;
        const isRunning = item.status === "running";

        return (
          <div
            key={agentKey}
            role="button"
            tabIndex={0}
            onClick={() => onSelectAgent && onSelectAgent(item)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectAgent && onSelectAgent(item);
              }
            }}
            aria-label={`Open activity log for ${item.name}. Status: ${item.status}`}
            className="panel card-interactive"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "1.2rem",
              borderRadius: "var(--radius-lg)",
              backgroundColor: isSelected ? "var(--bg-card-hover)" : "var(--bg-card)",
              border: isSelected
                ? "2px solid var(--accent-primary)"
                : isRunning
                ? "1px solid var(--accent-primary)"
                : "1px solid var(--border-primary)",
              boxShadow: isSelected ? "var(--shadow-md)" : isRunning ? "0 0 0 1px var(--accent-primary)" : "var(--shadow-sm)",
              cursor: "pointer",
              outline: "none",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div>
              {/* Header: Icon + Name + Status Chip */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <div
                    style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-subtle)",
                      border: "1px solid var(--border-primary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--text-primary)",
                      flexShrink: 0,
                    }}
                  >
                    {getAgentIcon(agentKey)}
                  </div>
                  <h3
                    style={{
                      fontSize: "14.5px",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      margin: 0,
                      lineHeight: 1.3,
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {item.name}
                  </h3>
                </div>
                <AgentStatusChip status={item.status} />
              </div>

              {/* Summary / Reasoning Preview */}
              <p
                style={{
                  fontSize: "12.5px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.5,
                  margin: "0.25rem 0 0.85rem 0",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.summary || "No findings recorded yet."}
              </p>
            </div>

            {/* Bottom Telemetry Bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: "0.65rem",
                borderTop: "1px solid var(--border-divider)",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
              }}
            >
              <span>
                {item.activity && item.activity.length > 0
                  ? `${item.activity.length} steps`
                  : "0 telemetry"}
              </span>

              {durationText && (
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {durationText}
                </span>
              )}

              <span
                style={{
                  color: "var(--accent-primary)",
                  fontWeight: 600,
                  fontSize: "11px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                Inspect →
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
