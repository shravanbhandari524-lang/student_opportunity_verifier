"use client";

import { useEffect, useRef } from "react";
import { AgentStatusChip } from "./AgentCards.js";
import { classifySource } from "../lib/evidence/source-classifier.js";

const ACTIVITY_TYPE_ICONS = {
  input: "📥",
  step: "⚙️",
  finding: "🚩",
  verified: "✓",
  limit: "⚠️",
  manual: "📋",
};

const ACTIVITY_STATUS_BADGES = {
  ok: { label: "✓ OK", bg: "rgba(22, 163, 74, 0.12)", color: "#16a34a" },
  warn: { label: "⚠️ Warn", bg: "rgba(217, 119, 6, 0.12)", color: "#d97706" },
  failed: { label: "✕ Failed", bg: "rgba(220, 38, 38, 0.12)", color: "#dc2626" },
  skipped: { label: "⊘ Skipped", bg: "rgba(100, 116, 139, 0.12)", color: "var(--text-muted)" },
  info: { label: "ℹ Info", bg: "rgba(2, 132, 199, 0.12)", color: "#0284c7" },
};

/**
 * Slide-over drawer on desktop / Bottom sheet on mobile
 * displaying the detailed step-by-step activity log of a selected agent.
 */
export default function AgentActivityDrawer({ agent, onClose }) {
  const drawerRef = useRef(null);

  // Close on Escape key press
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!agent) return null;

  const activityList = Array.isArray(agent.activity) ? agent.activity : [];
  const inputs = activityList.filter((a) => a.type === "input");
  const flags = Array.isArray(agent.flags) ? agent.flags : [];
  const verifiedItems = Array.isArray(agent.verified) ? agent.verified : [];
  const uncheckedItems = Array.isArray(agent.unchecked) ? agent.unchecked : [];
  const activityManuals = activityList
    .filter((a) => a.type === "manual")
    .map((a) => ({ label: a.title, detail: a.detail, url: a.sources?.[0]?.url }));
  const manualChecks = [
    ...(Array.isArray(agent.manualChecks) ? agent.manualChecks : []),
    ...activityManuals,
  ];
  const limits = activityList.filter((a) => a.type === "limit");
  const evidenceTransfers = Array.isArray(agent.evidenceTransfers) ? agent.evidenceTransfers : [];

  return (
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(12px) saturate(180%)",
          WebkitBackdropFilter: "blur(12px) saturate(180%)",
          zIndex: 100,
          animation: "fadeIn var(--dur-fast) var(--ease-out)",
        }}
      />

      {/* Drawer Container (Responsive: Bottom Sheet on Mobile, Slide-over on Desktop) */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${agent.name} Activity Log`}
        className="agent-drawer"
        style={{
          position: "fixed",
          right: 0,
          bottom: 0,
          top: 0,
          width: "100%",
          maxWidth: "580px",
          backgroundColor: "var(--bg-card)",
          borderLeft: "1px solid var(--border-primary)",
          boxShadow: "var(--shadow-float)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Drawer Header */}
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-card-subtle)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.35rem" }}>
              <h2
                style={{
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  margin: 0,
                }}
              >
                {agent.name}
              </h2>
              <AgentStatusChip status={agent.status} />
              {agent.durationMs > 0 && (
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-muted)",
                    padding: "0.15rem 0.45rem",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  {agent.durationMs}ms
                </span>
              )}
            </div>
            <p
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {agent.summary || "No summary recorded."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close activity log"
            className="btn btn-ghost btn-sm"
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--text-secondary)",
              flexShrink: 0,
              padding: 0,
              borderRadius: "var(--radius-sm)",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1.25rem 1.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "1.5rem",
          }}
        >
          {/* Section 1: What it received */}
          <section>
            <h3
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 0.6rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>📥</span> What it received
            </h3>
            {inputs.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {inputs.map((inp, idx) => (
                  <div
                    key={inp.seq ?? idx}
                    style={{
                      padding: "0.65rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-card-subtle)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{inp.title}</div>
                    {inp.detail && (
                      <div style={{ color: "var(--text-secondary)", marginTop: "0.2rem", fontSize: "0.82rem" }}>
                        {inp.detail}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  fontSize: "0.83rem",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                  padding: "0.5rem 0",
                }}
              >
                No dedicated input items were passed directly to this agent.
              </div>
            )}
          </section>

          {/* Section 2: What it did (Activity Timeline) */}
          <section>
            <h3
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 0.6rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>⚙️</span> What it did (Timeline)
            </h3>
            {activityList.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.6rem",
                  borderLeft: "2px solid var(--border-subtle)",
                  marginLeft: "0.5rem",
                  paddingLeft: "0.85rem",
                }}
              >
                {activityList.map((entry, idx) => {
                  const statusStyle = ACTIVITY_STATUS_BADGES[entry.status] || ACTIVITY_STATUS_BADGES.info;
                  const typeIcon = ACTIVITY_TYPE_ICONS[entry.type] || "•";

                  return (
                    <div
                      key={entry.seq ?? idx}
                      style={{
                        padding: "0.6rem 0.8rem",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--bg-card-subtle)",
                        border: "1px solid var(--border-subtle)",
                        fontSize: "0.83rem",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "0.5rem",
                          marginBottom: "0.25rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontSize: "0.9rem" }}>{typeIcon}</span>
                          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{entry.title}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                          {entry.tool && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                fontFamily: "var(--font-mono)",
                                padding: "0.1rem 0.4rem",
                                borderRadius: "var(--radius-sm)",
                                backgroundColor: "var(--bg-card)",
                                border: "1px solid var(--border-subtle)",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {entry.tool}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: "0.7rem",
                              fontWeight: 600,
                              padding: "0.1rem 0.45rem",
                              borderRadius: "var(--radius-full)",
                              backgroundColor: statusStyle.bg,
                              color: statusStyle.color,
                            }}
                          >
                            {statusStyle.label}
                          </span>
                          {entry.atMs != null && entry.atMs > 0 && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                fontFamily: "var(--font-mono)",
                                color: "var(--text-muted)",
                              }}
                            >
                              +{entry.atMs}ms
                            </span>
                          )}
                        </div>
                      </div>

                      {entry.detail && (
                        <div
                          style={{
                            color: "var(--text-secondary)",
                            lineHeight: 1.45,
                            marginTop: "0.25rem",
                            wordBreak: "break-word",
                          }}
                        >
                          {entry.detail}
                        </div>
                      )}

                      {Array.isArray(entry.sources) && entry.sources.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "0.4rem",
                            marginTop: "0.4rem",
                          }}
                        >
                          {entry.sources.map((src, sIdx) => {
                            const sourceInfo = classifySource(src.url);
                            return (
                              <div
                                key={sIdx}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "0.35rem",
                                  fontSize: "0.72rem",
                                }}
                              >
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: "var(--accent-primary)",
                                    textDecoration: "underline",
                                    wordBreak: "break-all",
                                  }}
                                >
                                  🔗 {src.label || src.url}
                                </a>
                                <span
                                  style={{
                                    fontSize: "0.68rem",
                                    padding: "0.05rem 0.35rem",
                                    borderRadius: "4px",
                                    backgroundColor: sourceInfo.isAuthoritative
                                      ? "rgba(16, 185, 129, 0.12)"
                                      : "rgba(107, 114, 128, 0.12)",
                                    color: sourceInfo.isAuthoritative
                                      ? "var(--risk-low, #059669)"
                                      : "var(--text-muted, #6b7280)",
                                    fontWeight: 500,
                                    border: "1px solid currentColor",
                                  }}
                                >
                                  {sourceInfo.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  fontSize: "0.83rem",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                  padding: "0.5rem 0",
                }}
              >
                No execution steps logged yet.
              </div>
            )}
          </section>

          {/* Section 3: What it found (Flags) */}
          <section>
            <h3
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 0.6rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>🚩</span> What it found (Red Flags)
            </h3>
            {flags.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {flags.map((flag, idx) => {
                  const isHigh = flag.severity === "high";
                  return (
                    <div
                      key={flag.id ?? idx}
                      style={{
                        padding: "0.85rem",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: isHigh ? "var(--risk-high-bg)" : "var(--risk-medium-bg)",
                        border: `1px solid ${isHigh ? "var(--risk-high-border)" : "var(--risk-medium-border)"}`,
                        color: "var(--text-primary)",
                        fontSize: "0.85rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "0.3rem",
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{flag.title || flag.id}</span>
                        <span
                          className={`badge ${isHigh ? "badge-high" : "badge-medium"}`}
                          style={{ fontSize: "0.7rem", padding: "0.15rem 0.5rem" }}
                        >
                          {flag.severity} risk
                        </span>
                      </div>
                      <p style={{ margin: "0.25rem 0 0.5rem 0", lineHeight: 1.45, color: "var(--text-primary)" }}>
                        {flag.explanation}
                      </p>

                      {/* Evidence block */}
                      {Array.isArray(flag.evidence) && flag.evidence.length > 0 && (
                        <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                          {flag.evidence.map((ev, evIdx) => {
                            const isUrl = ev.type === "url" || (typeof ev.value === "string" && (ev.value.startsWith("http://") || ev.value.startsWith("https://")));
                            const sourceInfo = isUrl ? classifySource(ev.value) : null;
                            return (
                              <div
                                key={evIdx}
                                style={{
                                  padding: "0.45rem 0.65rem",
                                  borderRadius: "var(--radius-sm)",
                                  backgroundColor: "rgba(255, 255, 255, 0.75)",
                                  border: "1px dashed var(--border-subtle)",
                                  fontSize: "0.8rem",
                                  color: "var(--text-primary)",
                                  fontFamily: "var(--font-mono)",
                                }}
                              >
                                <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>
                                  {isUrl ? "Source: " : "Quote: "}
                                </span>
                                {isUrl ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                                    <a
                                      href={ev.value}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: "var(--accent-primary)", textDecoration: "underline" }}
                                    >
                                      {ev.value}
                                    </a>
                                    <span
                                      style={{
                                        fontSize: "0.68rem",
                                        padding: "0.05rem 0.35rem",
                                        borderRadius: "4px",
                                        backgroundColor: sourceInfo?.isAuthoritative
                                          ? "rgba(16, 185, 129, 0.12)"
                                          : "rgba(107, 114, 128, 0.12)",
                                        color: sourceInfo?.isAuthoritative
                                          ? "var(--risk-low, #059669)"
                                          : "var(--text-muted, #6b7280)",
                                        fontWeight: 500,
                                        border: "1px solid currentColor",
                                      }}
                                    >
                                      {sourceInfo?.label}
                                    </span>
                                  </span>
                                ) : (
                                  <>&ldquo;{ev.value}&rdquo;</>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-card-subtle)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "0.84rem",
                }}
              >
                <div style={{ color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                  No red flags identified by this agent.
                </div>
                <div style={{ fontWeight: 600, color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  Nothing found is not the same as safe.
                </div>
              </div>
            )}
          </section>

          {/* Section 4: What checked out */}
          <section>
            <h3
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 0.6rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>✓</span> What checked out
            </h3>
            {verifiedItems.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {verifiedItems.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.55rem 0.75rem",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-card-subtle)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.84rem",
                      color: "var(--text-primary)",
                    }}
                  >
                    <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>
                    <span>{item}</span>
                  </div>
                ))}
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                    marginTop: "0.25rem",
                  }}
                >
                  Nothing found is not the same as safe.
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-card-subtle)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "0.84rem",
                }}
              >
                <div style={{ color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                  No deterministic positive checks confirmed for this agent.
                </div>
                <div style={{ fontWeight: 600, color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  Nothing found is not the same as safe.
                </div>
              </div>
            )}
          </section>

          {/* Section 5: What it could not check and why */}
          <section>
            <h3
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 0.6rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>⚠️</span> What it could not check and why
            </h3>
            {uncheckedItems.length > 0 || limits.length > 0 || agent.status === "not_applicable" || agent.status === "could_not_check" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {/* Skipped guidance or plain failure reason */}
                {agent.status === "not_applicable" && (
                  <div
                    style={{
                      padding: "0.65rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-card-subtle)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.84rem",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>Check Skipped</div>
                    <div style={{ color: "var(--text-secondary)", marginTop: "0.2rem" }}>
                      {limits[0]?.detail || agent.summary || "No applicable input was provided for this check."}
                    </div>
                  </div>
                )}

                {agent.status === "could_not_check" && (
                  <div
                    style={{
                      padding: "0.65rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--risk-medium-bg)",
                      border: "1px solid var(--risk-medium-border)",
                      fontSize: "0.84rem",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--risk-medium)" }}>Could Not Complete Check</div>
                    <div style={{ color: "var(--text-primary)", marginTop: "0.2rem" }}>
                      {limits[0]?.detail || agent.summary || "Check could not complete under budget or network constraints."}
                    </div>
                  </div>
                )}

                {/* Specific unchecked items */}
                {uncheckedItems.map((u, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.55rem 0.75rem",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-card-subtle)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.84rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <span>⚠️</span>
                    <span>Left unchecked: {u}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  fontSize: "0.83rem",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                  padding: "0.5rem 0",
                }}
              >
                All eligible verification targets for this agent were checked.
              </div>
            )}
          </section>

          {/* Section 6: What you should check yourself */}
          <section>
            <h3
              style={{
                fontSize: "0.88rem",
                fontWeight: 700,
                color: "var(--text-primary)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                margin: "0 0 0.6rem 0",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>📋</span> What you should check yourself
            </h3>
            {manualChecks.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {manualChecks.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "0.65rem 0.85rem",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--bg-card-subtle)",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.84rem",
                    }}
                  >
                    <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>{m.label}</div>
                    {m.url && (
                      <div style={{ marginTop: "0.25rem" }}>
                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "var(--accent-primary)",
                            fontSize: "0.8rem",
                            textDecoration: "underline",
                            wordBreak: "break-all",
                          }}
                        >
                          Verify directly at {m.url} ↗
                        </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  fontSize: "0.83rem",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                  padding: "0.5rem 0",
                }}
              >
                No specific manual portal checks designated for this agent.
              </div>
            )}
          </section>

          {/* Section 6b: Entities and what was checked */}
          {Array.isArray(agent.entityStatus) && agent.entityStatus.length > 0 && (
            <section>
              <h3
                style={{
                  fontSize: "0.88rem",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  margin: "0 0 0.6rem 0",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                }}
              >
                <span>🏷️</span> Entities and what was checked
              </h3>
              <div
                style={{
                  overflowX: "auto",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.82rem",
                    textAlign: "left",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        backgroundColor: "var(--bg-card-subtle)",
                        borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Entity</th>
                      <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Agent</th>
                      <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Status</th>
                      <th style={{ padding: "0.5rem 0.75rem", fontWeight: 600 }}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.entityStatus.map((item, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom:
                            idx < agent.entityStatus.length - 1
                              ? "1px solid var(--border-subtle)"
                              : "none",
                        }}
                      >
                        <td style={{ padding: "0.5rem 0.75rem", fontWeight: 500 }}>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--text-muted)",
                              marginRight: "0.3rem",
                            }}
                          >
                            {item.entityKind}:
                          </span>
                          {item.entityValue}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem", color: "var(--text-secondary)" }}>
                          {agent.name || agent.agent}
                        </td>
                        <td style={{ padding: "0.5rem 0.75rem" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "0.15rem 0.45rem",
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
                        <td
                          style={{
                            padding: "0.5rem 0.75rem",
                            color: "var(--text-secondary)",
                          }}
                        >
                          {item.reason || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Section 6c: Evidence shared */}
          {evidenceTransfers.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.1rem" }}>🔄</span>
                <h3 style={{ fontSize: "0.98rem", fontWeight: 700 }}>
                  Evidence Shared ({evidenceTransfers.length})
                </h3>
              </div>
              <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "-0.2rem" }}>
                Verified artifacts and entity discoveries handed over across investigation rounds and report stages.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {evidenceTransfers.map((et, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "0.65rem 0.85rem",
                      backgroundColor: "var(--bg-card-subtle)",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.2rem" }}>
                      <span style={{ fontWeight: 600, color: "var(--accent-primary)" }}>
                        {et.transferType === "round_entities" ? "Discovered Entities Transferred" : "Evidence Ledger Handover"}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        Round {et.round}
                      </span>
                    </div>
                    <div style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}>
                      {et.outcome}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                      From: {et.fromAgent || "Coordinator"} → To: {et.toAgent}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Section 7: Technical Details (Raw Trace JSON Toggle) */}
          <section style={{ paddingTop: "0.5rem", borderTop: "1px solid var(--border-subtle)" }}>
            <details style={{ cursor: "pointer" }}>
              <summary
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  outline: "none",
                }}
              >
                Technical details (raw trace JSON)
              </summary>
              <pre
                style={{
                  marginTop: "0.6rem",
                  padding: "0.85rem",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--bg-page)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)",
                  overflowX: "auto",
                  maxHeight: "260px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {JSON.stringify(
                  {
                    agent: agent.agent,
                    status: agent.status,
                    rawStatus: agent.rawStatus,
                    durationMs: agent.durationMs,
                    summary: agent.summary,
                    activity: agent.activity,
                    flags: agent.flags,
                    verified: agent.verified,
                    unchecked: agent.unchecked,
                    manualChecks: agent.manualChecks,
                    trace: agent.trace,
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          </section>
        </div>
      </div>
    </>
  );
}
