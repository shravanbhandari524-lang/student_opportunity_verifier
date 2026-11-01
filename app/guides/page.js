"use client";

import { useState } from "react";
import Link from "next/link";
import { GUIDES_CONTENT } from "../../lib/guides/content.js";

export default function GuidesPage() {
  const [selectedType, setSelectedType] = useState(GUIDES_CONTENT[0]?.type || "scholarship_scam");
  const [search, setSearch] = useState("");

  const filteredGuides = GUIDES_CONTENT.filter((g) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return g.title.toLowerCase().includes(q) || g.summary.toLowerCase().includes(q);
  });

  const activeGuide = GUIDES_CONTENT.find((g) => g.type === selectedType) || GUIDES_CONTENT[0];

  return (
    <div className="container-wide" style={{ padding: "2rem 1rem 4rem 1rem" }}>
      {/* Title & Search Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
          <span className="status-dot emerald" aria-hidden="true" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", textTransform: "uppercase", color: "var(--text-secondary)", letterSpacing: "0.05em" }}>
            Student Security Intelligence · 6 Archetypes
          </span>
        </div>
        <h1 style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
          Scam Awareness &amp; Verification Guides
        </h1>
        <p style={{ fontSize: "14px", color: "var(--text-secondary)", marginTop: "4px", maxWidth: "70ch" }}>
          Evidence-backed breakdowns of fraudulent opportunities targeting college students and job seekers across India.
        </p>

        {/* Search Bar */}
        <div style={{ marginTop: "1rem", maxWidth: "480px" }}>
          <input
            type="search"
            placeholder="Search scam types, red flags, or keywords..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field"
            aria-label="Search guides"
          />
        </div>
      </div>

      {/* 2-Column Desktop Layout (Selector left, active guide right) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.5rem", alignItems: "start" }}>
        {/* Left Column: Archetypes List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.04em" }}>
            Select Pattern ({filteredGuides.length}):
          </span>

          {filteredGuides.map((g) => {
            const isSelected = g.type === selectedType;

            return (
              <div
                key={g.type}
                className="panel"
                style={{
                  padding: "1rem",
                  cursor: "pointer",
                  backgroundColor: isSelected ? "var(--bg-subtle)" : "var(--bg-surface)",
                  borderLeft: isSelected ? "3px solid var(--accent-primary)" : "1px solid var(--border-primary)",
                  transition: "all 120ms ease",
                }}
                onClick={() => setSelectedType(g.type)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedType(g.type);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                    {g.title}
                  </h3>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
                    #{g.type.slice(0, 4)}
                  </span>
                </div>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  {g.summary}
                </p>
                <div style={{ marginTop: "8px", display: "flex", justifyContent: "flex-end" }}>
                  <Link
                    href={`/guides/${g.type}`}
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: "11px", padding: "2px 6px" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Dedicated page →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Detailed Guide View */}
        {activeGuide && (
          <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div className="panel-header" style={{ margin: 0, paddingBottom: "1rem" }}>
              <div>
                <span className="badge badge-medium" style={{ marginBottom: "6px" }}>
                  {activeGuide.type.replace("_", " ")}
                </span>
                <h2 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-primary)" }}>
                  {activeGuide.title}
                </h2>
              </div>
              <Link href={`/guides/${activeGuide.type}`} className="btn btn-secondary btn-sm">
                Full View ↗
              </Link>
            </div>

            {/* How it Works */}
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
                How the Scam Operates:
              </h3>
              <ol style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                {activeGuide.howItWorks.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </div>

            {/* Red Flags */}
            <div style={{ padding: "1rem", backgroundColor: "var(--status-crimson-bg)", border: "1px solid var(--status-crimson-border)", borderRadius: "var(--radius-sm)" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--status-crimson-text)", marginBottom: "8px" }}>
                🚩 High-Risk Red Flags:
              </h3>
              <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.5 }}>
                {activeGuide.redFlags.map((flag, idx) => (
                  <li key={idx}>{flag}</li>
                ))}
              </ul>
            </div>

            {/* What to Verify Next */}
            <div>
              <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
                What to Verify Before Acting:
              </h3>
              <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "6px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                {activeGuide.whatToVerify.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>

            {/* Already Paid Emergency Steps */}
            <div style={{ padding: "1rem", backgroundColor: "var(--bg-subtle)", borderLeft: "3px solid var(--status-amber)", borderRadius: "var(--radius-sm)" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px" }}>
                Already Transferred Money or Shared Bank Details?
              </h3>
              <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: "8px" }}>
                Immediately contact your bank to freeze transactions and call the <strong>National Cyber Crime Helpline at 1930</strong> (within 2 hours for maximum recovery chance).
              </p>
              <Link href="/report-fraud" className="btn btn-secondary btn-sm">
                Open Emergency Action Guide →
              </Link>
            </div>

            {/* Check CTA */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-divider)", paddingTop: "1rem" }}>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                Received an offer matching this pattern?
              </span>
              <Link href="/check" className="btn btn-primary">
                Verify this offer now →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
