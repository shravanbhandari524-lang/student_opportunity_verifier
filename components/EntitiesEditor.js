"use client";

import { useState } from "react";
import { ENTITY_KINDS, HANDLE_PLATFORMS } from "../lib/contracts/enums.js";

const KIND_LABELS = {
  domain: "Website Domain",
  url: "Web Link",
  upi: "UPI ID / VPA",
  email: "Email Address",
  phone: "Phone Number",
  company: "Company / Org Name",
  handle: "Social Handle",
  amount: "Payment Amount",
  scheme: "Government Scheme",
  youtube_url: "YouTube Link",
};

export default function EntitiesEditor({ initialEntities = [], onConfirm, confirming = false, disabled = false, error = null }) {
  const [entities, setEntities] = useState(initialEntities);
  const [newKind, setNewKind] = useState("company");
  const [newValue, setNewValue] = useState("");
  const [newPlatform, setNewPlatform] = useState("telegram");
  const [showAddForm, setShowAddForm] = useState(false);
  const [localSubmitting, setLocalSubmitting] = useState(false);

  const isBusy = confirming || disabled || localSubmitting;

  function handleRemove(index) {
    if (isBusy) return;
    setEntities((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAdd(e) {
    e.preventDefault();
    if (isBusy || !newValue.trim()) return;

    const newEntity = {
      kind: newKind,
      value: newValue.trim(),
      source: "user",
      confirmed: true,
      platform: newKind === "handle" ? newPlatform : undefined,
    };

    setEntities((prev) => [...prev, newEntity]);
    setNewValue("");
    setShowAddForm(false);
  }

  function handleStartInvestigation() {
    if (isBusy) return;
    setLocalSubmitting(true);
    onConfirm(entities);
  }

  return (
    <div className="panel" aria-labelledby="confirm-entities-title">
      <div className="panel-header">
        <div>
          <h2 id="confirm-entities-title" style={{ fontSize: "16.5px", fontWeight: 600, color: "var(--text-primary)", letterSpacing: "-0.015em" }}>
            Confirm Extracted Identifiers
          </h2>
          <p style={{ fontSize: "12.5px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Review what was read from your text and screenshots. Remove inaccurate items or add missing links before running specialist checks.
          </p>
        </div>
        <span className="badge badge-low" style={{ fontVariantNumeric: "tabular-nums" }}>
          {entities.length} Detected
        </span>
      </div>

      {/* Entity Chips List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "1.25rem" }}>
        {entities.length === 0 ? (
          <div style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "13px", backgroundColor: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px dashed var(--border-primary)" }}>
            No specific entities were extracted. You can add a company, domain, or payment handle below.
          </div>
        ) : (
          entities.map((ent, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                backgroundColor: "var(--bg-subtle)",
                border: "1px solid var(--border-primary)",
                borderRadius: "var(--radius-sm)",
                gap: "8px",
                transition: "background-color var(--dur-fast) var(--ease-out)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 7px",
                    backgroundColor: "var(--bg-muted)",
                    borderRadius: "var(--radius-xs)",
                    color: "var(--text-secondary)",
                    textTransform: "uppercase",
                  }}
                >
                  {KIND_LABELS[ent.kind] || ent.kind}
                </span>

                <span
                  style={{
                    fontFamily: ent.kind === "domain" || ent.kind === "upi" || ent.kind === "phone" ? "var(--font-mono)" : "inherit",
                    fontSize: "13.5px",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    wordBreak: "break-all",
                  }}
                >
                  {ent.value}
                </span>

                {ent.platform && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "10.5px",
                      color: "var(--text-muted)",
                      padding: "1px 5px",
                      backgroundColor: "var(--bg-muted)",
                      borderRadius: "var(--radius-xs)",
                    }}
                  >
                    ({ent.platform})
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${ent.kind} ${ent.value}`}
                style={{ color: "var(--text-muted)", padding: "3px 6px" }}
                title="Remove entity"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add Entity Toggle / Form */}
      {showAddForm ? (
        <form
          onSubmit={handleAdd}
          style={{
            padding: "12px 14px",
            backgroundColor: "var(--bg-muted)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-md)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginBottom: "1.25rem",
          }}
        >
          <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-primary)" }}>
            Add Identifier Manually
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <select
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
              className="input-field"
              style={{ width: "auto", minWidth: "150px" }}
            >
              {ENTITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k] || k}
                </option>
              ))}
            </select>

            {newKind === "handle" && (
              <select
                value={newPlatform}
                onChange={(e) => setNewPlatform(e.target.value)}
                className="input-field"
                style={{ width: "auto" }}
              >
                {HANDLE_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}

            <input
              type="text"
              placeholder={newKind === "domain" ? "e.g. example.com" : newKind === "upi" ? "e.g. name@okhdfc" : "Enter value..."}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="input-field"
              style={{ flex: 1, minWidth: "180px" }}
              autoFocus
            />

            <button type="submit" className="btn btn-primary btn-sm">
              Add
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="btn btn-secondary btn-sm"
          style={{ marginBottom: "1.25rem" }}
        >
          + Add another entity
        </button>
      )}

      {error && (
        <div style={{ padding: "9px 13px", backgroundColor: "var(--status-crimson-bg)", border: "1px solid var(--status-crimson-border)", color: "var(--status-crimson-text)", borderRadius: "var(--radius-sm)", fontSize: "13px", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Confirm & Start Button */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", borderTop: "1px solid var(--border-divider)", paddingTop: "1.25rem" }}>
        <button
          type="button"
          onClick={handleStartInvestigation}
          disabled={isBusy}
          className="btn btn-primary"
          style={{ padding: "9px 22px", fontSize: "14px", fontWeight: 600 }}
        >
          {isBusy ? (
            <>
              <span className="spinner" />
              <span>Starting Investigation...</span>
            </>
          ) : (
            <>
              <span>Confirm &amp; Start Multi-Agent Check</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
