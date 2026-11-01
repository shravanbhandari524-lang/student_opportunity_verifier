"use client";

import { useState } from "react";
import Link from "next/link";
import { GUIDES_CONTENT } from "../../lib/guides/content.js";

export default function GuidesPage() {
  const [selectedType, setSelectedType] = useState(GUIDES_CONTENT[0]?.type || "scholarship_scam");

  const currentGuide = GUIDES_CONTENT.find((g) => g.type === selectedType) || GUIDES_CONTENT[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2.5rem" }}>
      <div>
        <h1 style={{ fontSize: "2.2rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          Student Scam Awareness & Guides
        </h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem", fontSize: "1.05rem", maxWidth: "65ch" }}>
          Authoritative, evidence-backed breakdowns of the 6 primary scam patterns targeting Indian students and job seekers.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.5rem" }}>
        {/* Guides Selector Sidebar / Tab Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Select Pattern
          </span>
          {GUIDES_CONTENT.map((g) => {
            const isSelected = g.type === selectedType;
            return (
              <div
                key={g.type}
                className="card"
                style={{
                  textAlign: "left",
                  padding: "1rem",
                  backgroundColor: isSelected ? "var(--bg-card-subtle)" : "var(--bg-card)",
                  borderColor: isSelected ? "var(--accent-primary)" : "var(--border-subtle)",
                  borderWidth: isSelected ? "2px" : "1px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                }}
              >
                <button
                  type="button"
                  onClick={() => setSelectedType(g.type)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <strong style={{ fontSize: "0.98rem", color: isSelected ? "var(--accent-primary)" : "var(--text-primary)" }}>
                    {g.title}
                  </strong>
                  <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    {g.summary}
                  </span>
                </button>
                <Link
                  href={`/guides/${g.type}`}
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--accent-primary, #2563eb)",
                    textDecoration: "underline",
                    alignSelf: "flex-start",
                    marginTop: "0.25rem",
                  }}
                >
                  Open full guide page →
                </Link>
              </div>
            );
          })}
        </div>

        {/* Selected Guide Detail View */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div>
            <div style={{ display: "inline-block", fontSize: "0.8rem", color: "var(--accent-primary)", fontWeight: 600, marginBottom: "0.3rem" }}>
              GUIDE ARCHETYPE: {currentGuide.type.toUpperCase().replace(/_/g, " ")}
            </div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700 }}>{currentGuide.title}</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", marginTop: "0.35rem", lineHeight: 1.5 }}>
              {currentGuide.summary}
            </p>
          </div>

          {/* How It Operates */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>How this scam operates:</h3>
            <ul style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {currentGuide.howItWorks.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ul>
          </div>

          {/* Key Red Flags */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--risk-high)" }}>
              Key Red Flags to Watch For:
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
              {currentGuide.redFlags.map((flag, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.6rem",
                    padding: "0.65rem 0.85rem",
                    backgroundColor: "var(--bg-card-subtle)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.9rem",
                    lineHeight: 1.45,
                  }}
                >
                  <span style={{ color: "var(--risk-high)", fontWeight: 700 }}>✕</span>
                  <span>{flag}</span>
                </div>
              ))}
            </div>
          </div>

          {/* What to Verify */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent-primary)" }}>
              What to Verify Before Doing Anything:
            </h3>
            <ul style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {currentGuide.whatToVerify.map((verify, idx) => (
                <li key={idx}>{verify}</li>
              ))}
            </ul>
          </div>

          {/* What to Do */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Immediate Safety Rules:</h3>
            <ul style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.92rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {currentGuide.whatToDo.map((todo, idx) => (
                <li key={idx}><strong>Rule:</strong> {todo}</li>
              ))}
            </ul>
          </div>

          {/* If already paid */}
          <div
            style={{
              padding: "1rem 1.15rem",
              backgroundColor: "var(--risk-high-bg)",
              border: "1px solid var(--risk-high-border)",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <strong style={{ color: "var(--risk-high)", fontSize: "0.98rem" }}>
              Already Paid? Take Immediate Action:
            </strong>
            <ul style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.88rem", lineHeight: 1.5 }}>
              {currentGuide.alreadyPaid.map((step, idx) => (
                <li key={idx}>{step}</li>
              ))}
            </ul>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Link href="/check" className="btn-primary" style={{ padding: "0.65rem 1.4rem" }}>
              Check a Suspicious Offer Now →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
