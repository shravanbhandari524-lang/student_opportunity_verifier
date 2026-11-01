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
    },
    medium: {
      badge: "badge-medium",
      color: "var(--status-amber)",
      dot: "amber",
      label: "MEDIUM SEVERITY",
    },
    low: {
      badge: "badge-cannot_verify",
      color: "var(--status-neutral)",
      dot: "neutral",
      label: "LOW SEVERITY",
    },
  };

  const cfg = SEV_CONFIG[severity] || SEV_CONFIG.medium;
  const evidenceList = Array.isArray(flag.evidence) ? flag.evidence : [];

  return (
    <article
      className="panel"
      style={{
        borderLeft: `3px solid ${cfg.color}`,
        marginBottom: "0.75rem",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          cursor: "pointer",
          gap: "0.75rem",
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
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className={`badge ${cfg.badge}`}>{cfg.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
              ID: {flag.id}
            </span>
          </div>
          <h3 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}>
            {flag.title}
          </h3>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={expanded ? "Collapse flag details" : "Expand flag details"}
          style={{ fontFamily: "var(--font-mono)", fontSize: "12px", padding: "2px 6px" }}
        >
          {expanded ? "− Hide" : "+ Show"}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-divider)" }}>
          {/* Explanation */}
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
            {flag.explanation}
          </p>

          {/* Evidence Quotes & Sources */}
          {evidenceList.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <span
                style={{
                  display: "block",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  letterSpacing: "0.04em",
                  marginBottom: "4px",
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
                        padding: "6px 10px",
                        backgroundColor: "var(--bg-subtle)",
                        border: "1px solid var(--border-primary)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "3px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "10px",
                            padding: "1px 5px",
                            backgroundColor: "var(--bg-muted)",
                            borderRadius: "var(--radius-xs)",
                            color: "var(--text-secondary)",
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
                              color: "var(--text-primary)",
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
                            borderLeft: "2px solid var(--border-primary)",
                            paddingLeft: "8px",
                            wordBreak: "break-word",
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
