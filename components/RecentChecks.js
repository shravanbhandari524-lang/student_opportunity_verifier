"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function RecentChecks() {
  const [recentChecks, setRecentChecks] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ov_recent_checks");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentChecks(parsed.slice(0, 5));
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  function clearHistory() {
    localStorage.removeItem("ov_recent_checks");
    setRecentChecks([]);
  }

  if (recentChecks.length === 0) return null;

  return (
    <div className="panel" style={{ marginTop: "1.5rem" }}>
      <div className="panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            Recent Checks on This Device
          </span>
          <span className="badge-version">Local Only</span>
        </div>
        <button
          type="button"
          onClick={clearHistory}
          className="btn btn-ghost btn-sm"
          style={{ fontSize: "11px", color: "var(--text-muted)" }}
        >
          Clear
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {recentChecks.map((item) => (
          <Link
            key={item.id}
            href={`/check/${item.id}`}
            className="feed-row"
            style={{
              textDecoration: "none",
              color: "inherit",
              borderRadius: "var(--radius-sm)",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span className={`status-dot ${item.riskLevel === "high" ? "crimson" : item.riskLevel === "medium" ? "amber" : item.riskLevel === "low" ? "emerald" : "neutral"}`} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-primary)" }}>
                {item.id.slice(0, 8)}...
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.summary || "Investigation details"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>→</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
