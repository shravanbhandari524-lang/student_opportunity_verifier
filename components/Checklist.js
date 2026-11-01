"use client";

import { useState } from "react";

export default function Checklist({ checklist = [], moreChecks = [] }) {
  const [completed, setCompleted] = useState({});
  const [copied, setCopied] = useState(false);

  const allItems = [
    ...(Array.isArray(checklist) ? checklist : []),
    ...(Array.isArray(moreChecks) ? moreChecks : []),
  ];

  if (allItems.length === 0) {
    return (
      <div className="panel" style={{ padding: "1rem", fontSize: "13px", color: "var(--text-secondary)" }}>
        No pending verification checklist items. Always exercise caution and verify official channels directly.
      </div>
    );
  }

  function toggleItem(index) {
    setCompleted((prev) => ({
      ...prev,
      [index]: !prev[index],
    }));
  }

  async function handleCopy() {
    const textToCopy = allItems
      .map((item, idx) => {
        const mark = completed[idx] ? "[x]" : "[ ]";
        const urlStr = item.url ? ` (${item.url})` : "";
        return `${mark} ${item.text}${urlStr}`;
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }

  return (
    <section className="panel" aria-labelledby="checklist-heading">
      <div className="panel-header">
        <div>
          <h2 id="checklist-heading" style={{ fontSize: "16.5px", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.015em" }}>
            What to Verify Next
          </h2>
          <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Actionable verification steps to protect yourself before sending funds or details.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="btn btn-secondary btn-sm"
          aria-label="Copy checklist to clipboard"
          style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}
        >
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Copied</span>
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy checklist</span>
            </>
          )}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {allItems.map((item, idx) => {
          const isDone = Boolean(completed[idx]);

          return (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "9px 12px",
                backgroundColor: isDone ? "var(--bg-muted)" : "var(--bg-subtle)",
                border: `1px solid ${isDone ? "var(--border-divider)" : "var(--border-primary)"}`,
                borderRadius: "var(--radius-sm)",
                transition: "background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)",
              }}
            >
              <input
                type="checkbox"
                id={`check-item-${idx}`}
                checked={isDone}
                onChange={() => toggleItem(idx)}
                style={{
                  marginTop: "3px",
                  cursor: "pointer",
                  width: "15px",
                  height: "15px",
                  accentColor: "var(--accent-primary)",
                  borderRadius: "var(--radius-xs)",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
                <label
                  htmlFor={`check-item-${idx}`}
                  style={{
                    fontSize: "13.5px",
                    color: isDone ? "var(--text-muted)" : "var(--text-primary)",
                    textDecoration: isDone ? "line-through" : "none",
                    fontWeight: isDone ? 400 : 500,
                    cursor: "pointer",
                    lineHeight: 1.45,
                  }}
                >
                  {item.text}
                </label>
                {item.reason && (
                  <span style={{ fontSize: "12px", color: isDone ? "var(--text-tertiary)" : "var(--text-secondary)", lineHeight: 1.4 }}>
                    {item.reason}
                  </span>
                )}
                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "11.5px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--accent-primary)",
                      textDecoration: "underline",
                      marginTop: "2px",
                      width: "fit-content",
                    }}
                  >
                    Official Portal Link ↗
                  </a>
                )}
              </div>
              {item.provenance && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    padding: "2px 6px",
                    backgroundColor: "var(--bg-muted)",
                    borderRadius: "var(--radius-xs)",
                    color: "var(--text-muted)",
                    alignSelf: "flex-start",
                  }}
                >
                  {item.provenance}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
