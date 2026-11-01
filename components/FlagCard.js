"use client";

import { useState } from "react";
import { classifySource } from "../lib/evidence/source-classifier.js";

export default function FlagCard({ flag }) {
  const [expanded, setExpanded] = useState(true);

  if (!flag) return null;

  const severity = (flag.severity || "medium").toLowerCase();

  const SEV_CONFIG = {
    high: {
      badge: "badge-high",
      color: "var(--status-crimson)",
      dot: "crimson",
      label: "HIGH SEVERITY",
      borderGlow: "rgba(225, 29, 72, 0.12)",
    },
    medium: {
      badge: "badge-medium",
      color: "var(--status-amber)",
      dot: "amber",
      label: "MEDIUM SEVERITY",
      borderGlow: "rgba(245, 158, 11, 0.12)",
    },
    low: {
      badge: "badge-cannot_verify",
      color: "var(--status-neutral)",
      dot: "neutral",
      label: "LOW SEVERITY",
      borderGlow: "rgba(113, 113, 122, 0.12)",
    },
  };

  const cfg = SEV_CONFIG[severity] || SEV_CONFIG.medium;
  const evidenceList = Array.isArray(flag.evidence) ? flag.evidence : [];

  return (
    <article
      className="panel card-interactive"
      style={{
        borderLeft: `4px solid ${cfg.color}`,
        marginBottom: "0.85rem",
        backgroundColor: "var(--bg-surface)",
        padding: "1.15rem 1.25rem",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          cursor: "pointer",
          gap: "0.75rem",
          userSelect: "none",
        }}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`Toggle flag details for ${flag.title}`}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
              ID: {flag.id}
            </span>
          </div>
          <h3 style={{ fontSize: "15.5px", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.015em" }}>
            {flag.title}
          </h3>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={expanded ? "Collapse flag details" : "Expand flag details"}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            padding: "3px 8px",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            color: "var(--text-muted)",
          }}
        >
          <span>{expanded ? "Hide" : "Show"}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform var(--dur-fast) var(--ease-out)",
            }}
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid var(--border-divider)" }}>
          {/* Explanation */}
          <p style={{ fontSize: "13.5px", color: "var(--text-secondary)", lineHeight: 1.6 }}>
            {flag.explanation}
          </p>

          {/* Grounded Evidence Quotes & Source Links */}
          {evidenceList.length > 0 && (
            <div style={{ marginTop: "0.85rem" }}>
              <span
                style={{
                  display: "block",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  letterSpacing: "0.05em",
                  marginBottom: "6px",
                }}
              >
                Grounded Evidence:
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {evidenceList.map((item, idx) => {
                  const evidenceText = typeof item === "string" ? item : (item?.value || item?.url || JSON.stringify(item));
                  const isUrl = typeof evidenceText === "string" && (evidenceText.startsWith("http://") || evidenceText.startsWith("https://"));
                  const classification = isUrl ? classifySource(evidenceText) : { label: "Direct Text Quote", type: "quote" };

                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "8px 12px",
                        backgroundColor: "var(--bg-subtle)",
                        border: "1px solid var(--border-primary)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "12.5px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "10px",
                            padding: "1px 6px",
                            backgroundColor: "var(--bg-muted)",
                            borderRadius: "var(--radius-xs)",
                            color: "var(--text-secondary)",
                            fontWeight: 600,
                          }}
                        >
                          {classification.label || "Evidence"}
                        </span>
                        {isUrl ? (
                          <a
                            href={evidenceText}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: "var(--accent-primary)",
                              textDecoration: "underline",
                              wordBreak: "break-all",
                              fontFamily: "var(--font-mono)",
                              fontSize: "11px",
                            }}
                          >
                            {evidenceText} ↗
                          </a>
                        ) : null}
                      </div>

                      {!isUrl && (
                        <blockquote
                          style={{
                            margin: 0,
                            fontStyle: "italic",
                            color: "var(--text-primary)",
                            borderLeft: "2px solid var(--accent-primary)",
                            paddingLeft: "8px",
                            wordBreak: "break-word",
                            lineHeight: 1.5,
                          }}
                        >
                          &ldquo;{evidenceText}&rdquo;
                        </blockquote>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
