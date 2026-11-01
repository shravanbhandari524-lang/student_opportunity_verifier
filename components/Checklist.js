"use client";

import { useState } from "react";

export default function Checklist({ checklist = [], moreChecks = [] }) {
  const [completed, setCompleted] = useState({});
  const [copied, setCopied] = useState(false);

  const allItems = [
    ...(Array.isArray(checklist) ? checklist : []),
    ...(Array.isArray(moreChecks) ? moreChecks : []),
  ];

  if (allItems.length === 0) return null;

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
          <h2 id="checklist-heading" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
            What to Verify Next
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Actionable verification steps to protect yourself before sending funds or details.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="btn btn-secondary btn-sm"
          aria-label="Copy checklist to clipboard"
        >
          {copied ? "✓ Copied" : "📋 Copy checklist"}
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
                padding: "8px 10px",
                backgroundColor: isDone ? "var(--bg-muted)" : "var(--bg-subtle)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-sm)",
                transition: "all 120ms ease",
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
                  width: "14px",
                  height: "14px",
                  accentColor: "var(--accent-primary)",
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
                <label
                  htmlFor={`check-item-${idx}`}
                  style={{
                    fontSize: "13px",
                    color: isDone ? "var(--text-muted)" : "var(--text-primary)",
                    textDecoration: isDone ? "line-through" : "none",
                    cursor: "pointer",
                    lineHeight: 1.45,
                  }}
                >
                  {item.text}
                </label>

                {item.url && (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                      textDecoration: "underline",
                      wordBreak: "break-all",
                    }}
                  >
                    {item.url} ↗
                  </a>
                )}
              </div>

              {item.provenance && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    padding: "2px 5px",
                    backgroundColor: "var(--bg-muted)",
                    borderRadius: "var(--radius-xs)",
                    alignSelf: "flex-start",
                    flexShrink: 0,
                  }}
                >
                  {item.provenance.replace("_", " ")}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
