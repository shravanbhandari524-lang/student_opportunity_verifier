"use client";

import { AGENT_ORDER, AGENT_DISPLAY_NAMES } from "../lib/config/agents.js";

const AGENT_ICONS = {
  message_analyst: "📝",
  classifier_client: "🧠",
  website_forensics: "🌐",
  payment_entity: "💳",
  official_verifier: "🏛️",
  reputation_osint: "🔍",
};

export const CHIP_CONFIG = {
  waiting: {
    label: "Waiting",
    className: "badge-cannot_verify",
    bg: "rgba(100, 116, 139, 0.12)",
    color: "var(--text-muted)",
    border: "rgba(100, 116, 139, 0.3)",
    icon: "⏳",
  },
  running: {
    label: "Running",
    className: "badge-medium",
    bg: "rgba(2, 132, 199, 0.15)",
    color: "#0284c7",
    border: "rgba(2, 132, 199, 0.4)",
    icon: "⚡",
  },
  done: {
    label: "Done",
    className: "badge-low",
    bg: "rgba(22, 163, 74, 0.12)",
    color: "#16a34a",
    border: "rgba(22, 163, 74, 0.35)",
    icon: "✓",
  },
  found_issues: {
    label: "Found issues",
    className: "badge-high",
    bg: "rgba(220, 38, 38, 0.12)",
    color: "#dc2626",
    border: "rgba(220, 38, 38, 0.4)",
    icon: "⚠️",
  },
  not_applicable: {
    label: "Not applicable",
    className: "badge-cannot_verify",
    bg: "rgba(148, 163, 184, 0.12)",
    color: "var(--text-muted)",
    border: "rgba(148, 163, 184, 0.25)",
    icon: "⊘",
  },
  could_not_check: {
    label: "Could not check",
    className: "badge-medium",
    bg: "rgba(217, 119, 6, 0.12)",
    color: "#d97706",
    border: "rgba(217, 119, 6, 0.35)",
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
        padding: "0.2rem 0.55rem",
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
          animation: isRunning ? "spin 1.5s linear infinite" : "none",
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

        const icon = AGENT_ICONS[agentKey] || "🔍";
        const isSelected = selectedAgentKey === agentKey;
        const durationText = item.durationMs > 0 ? `${item.durationMs}ms` : null;

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
            className="card card-interactive"
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: "1.1rem",
              borderRadius: "var(--radius-md)",
              backgroundColor: isSelected ? "var(--bg-card-hover)" : "var(--bg-card)",
              border: isSelected
                ? "2px solid var(--accent-primary)"
                : "1px solid var(--border-subtle)",
              boxShadow: isSelected ? "var(--shadow-md)" : "var(--shadow-sm)",
              cursor: "pointer",
              transition: "transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease",
              outline: "none",
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
                  marginBottom: "0.6rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>{icon}</span>
                  <h3
                    style={{
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      margin: 0,
                      lineHeight: 1.3,
                    }}
                  >
                    {item.name}
                  </h3>
                </div>
                <AgentStatusChip status={item.status} />
              </div>

              {/* Summary line */}
              <p
                style={{
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.45,
                  margin: "0.35rem 0 0.75rem 0",
                  wordBreak: "break-word",
                }}
              >
                {item.summary || "No summary recorded yet."}
              </p>
            </div>

            {/* Footer: Duration + Action prompt */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: "0.55rem",
                borderTop: "1px solid var(--border-subtle)",
                fontSize: "0.78rem",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-muted)",
                }}
              >
                {durationText || "—"}
              </span>
              <span
                style={{
                  color: "var(--accent-primary)",
                  fontWeight: 500,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.2rem",
                }}
              >
                Inspect log →
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
