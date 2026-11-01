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

export default function EntitiesEditor({ initialEntities = [], onConfirm, confirming = false, error = null }) {
  const [entities, setEntities] = useState(initialEntities);
  const [newKind, setNewKind] = useState("company");
  const [newValue, setNewValue] = useState("");
  const [newPlatform, setNewPlatform] = useState("telegram");
  const [showAddForm, setShowAddForm] = useState(false);

  function handleRemove(index) {
    setEntities((prev) => prev.filter((_, i) => i !== index));
  }

  function handleAdd(e) {
    e.preventDefault();
    if (!newValue.trim()) return;

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
    onConfirm(entities);
  }

  return (
    <div className="panel" aria-labelledby="confirm-entities-title">
      <div className="panel-header">
        <div>
          <h2 id="confirm-entities-title" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
            Confirm Extracted Identifiers
          </h2>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Review what was read from your text and screenshots. Remove inaccurate items or add missing links before running specialist checks.
          </p>
        </div>
        <span className="badge badge-low">
          {entities.length} Detected
        </span>
      </div>

      {/* Entity Chips List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "1rem" }}>
        {entities.length === 0 ? (
          <div style={{ padding: "1rem", textAlign: "center", color: "var(--text-muted)", fontSize: "13px" }}>
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
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 6px",
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
                    fontSize: "13px",
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
                      fontSize: "10px",
                      color: "var(--text-muted)",
                      padding: "1px 4px",
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
                style={{ color: "var(--text-muted)" }}
                title="Remove entity"
              >
                ✕
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
            padding: "10px 12px",
            backgroundColor: "var(--bg-muted)",
            border: "1px solid var(--border-primary)",
            borderRadius: "var(--radius-sm)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginBottom: "1.25rem",
          }}
        >
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
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
        <div style={{ padding: "8px 12px", backgroundColor: "var(--status-crimson-bg)", border: "1px solid var(--status-crimson-border)", color: "var(--status-crimson-text)", borderRadius: "var(--radius-sm)", fontSize: "13px", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Confirm & Start Button */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", borderTop: "1px solid var(--border-divider)", paddingTop: "1rem" }}>
        <button
          type="button"
          onClick={handleStartInvestigation}
          disabled={confirming}
          className="btn btn-primary"
          style={{ padding: "8px 20px", fontSize: "14px", fontWeight: 600 }}
        >
          {confirming ? (
            <>
              <span className="spinner" />
              <span>Starting Investigation...</span>
            </>
          ) : (
            <>
              <span>Confirm &amp; Start Multi-Agent Check</span>
              <span aria-hidden="true">→</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
