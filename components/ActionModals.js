"use client";

import { useState } from "react";

export function CollegeEmailModal({ checkId, isOpen, onClose }) {
  const [recipient, setRecipient] = useState("college");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  async function generateDraft(selectedRecipient = recipient) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/checks/${checkId}/college-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientType: selectedRecipient }),
      });
      if (!res.ok) throw new Error("Failed to generate college email draft");
      const data = await res.json();
      setDraft(data);
    } catch (err) {
      setError(err.message || "Failed to generate draft");
    } finally {
      setLoading(false);
    }
  }

  function handleRecipientChange(type) {
    setRecipient(type);
    generateDraft(type);
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="college-modal-title">
      <div className="modal-content">
        <div className="panel-header" style={{ padding: "1rem 1.25rem", margin: 0 }}>
          <h2 id="college-modal-title" style={{ fontSize: "16px", fontWeight: 600 }}>
            Draft Inquiry Email to College
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close modal">
            ✕
          </button>
        </div>

        <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-secondary)", textTransform: "uppercase" }}>
              Select Recipient:
            </label>
            <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
              {[
                { id: "college", label: "College Administration" },
                { id: "placement", label: "Placement Cell / TPO" },
                { id: "teacher", label: "Faculty / Teacher" },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => handleRecipientChange(r.id)}
                  className={`btn btn-sm ${recipient === r.id ? "btn-primary" : "btn-secondary"}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {!draft && !loading && (
            <div style={{ textAlign: "center", padding: "1.5rem" }}>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                Generate an official, professional email inquiry to ask your college or placement cell to verify this circular.
              </p>
              <button
                type="button"
                onClick={() => generateDraft(recipient)}
                className="btn btn-primary"
              >
                Generate Email Draft
              </button>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem", gap: "8px" }}>
              <span className="spinner" />
              <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Drafting inquiry email...</span>
            </div>
          )}

          {error && (
            <div style={{ padding: "8px 12px", backgroundColor: "var(--status-crimson-bg)", border: "1px solid var(--status-crimson-border)", color: "var(--status-crimson-text)", borderRadius: "var(--radius-sm)", fontSize: "13px" }}>
              {error}
            </div>
          )}

          {draft && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Subject Line:
                </label>
                <input
                  type="text"
                  readOnly
                  value={draft.subject || ""}
                  className="input-field"
                  style={{ marginTop: "2px" }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase" }}>
                  Email Body:
                </label>
                <textarea
                  readOnly
                  rows={8}
                  value={draft.body || ""}
                  className="input-field font-mono"
                  style={{ marginTop: "2px", fontSize: "12px", whiteSpace: "pre-wrap" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
                <span style={{ fontSize: "12px", color: "var(--status-emerald)", opacity: copied ? 1 : 0, transition: "opacity 200ms" }}>
                  ✓ Copied to clipboard
                </span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" onClick={copyDraft} className="btn btn-primary">
                    {copied ? "✓ Copied" : "📋 Copy Subject & Body"}
                  </button>
                  <button type="button" onClick={onClose} className="btn btn-secondary">
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FeedbackModal({ checkId, isOpen, onClose }) {
  const [verdict, setVerdict] = useState("right");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/checks/${checkId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict, comment: comment.trim() || undefined }),
      });
      if (!res.ok) throw new Error("Failed to submit feedback");
      setSubmitted(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError(err.message || "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title">
      <div className="modal-content">
        <div className="panel-header" style={{ padding: "1rem 1.25rem", margin: 0 }}>
          <h2 id="feedback-modal-title" style={{ fontSize: "16px", fontWeight: 600 }}>
            Was this assessment accurate?
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close modal">
            ✕
          </button>
        </div>

        <div style={{ padding: "1.25rem" }}>
          {submitted ? (
            <div style={{ textAlign: "center", padding: "1.5rem" }}>
              <span style={{ fontSize: "24px" }}>✓</span>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--status-emerald)", marginTop: "0.5rem" }}>
                Thank you! Your anonymous feedback helps calibrate verification weights.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 500, display: "block", marginBottom: "6px" }}>
                  Assessment Accuracy:
                </label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setVerdict("right")}
                    className={`btn ${verdict === "right" ? "btn-primary" : "btn-secondary"}`}
                    style={{ flex: 1 }}
                  >
                    ✓ Accurate / Helpful
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerdict("wrong")}
                    className={`btn ${verdict === "wrong" ? "btn-primary" : "btn-secondary"}`}
                    style={{ flex: 1 }}
                  >
                    ✕ Inaccurate / Missed signal
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="feedback-comment" style={{ fontSize: "13px", fontWeight: 500, display: "block", marginBottom: "4px" }}>
                  Optional details or context:
                </label>
                <textarea
                  id="feedback-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Tell us what was right or wrong (e.g. 'This is an official state government scheme hosted on an unlinked portal')"
                  maxLength={500}
                  className="input-field"
                  rows={3}
                />
              </div>

              {error && (
                <div style={{ padding: "8px", backgroundColor: "var(--status-crimson-bg)", color: "var(--status-crimson-text)", fontSize: "12px", borderRadius: "var(--radius-sm)" }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <button type="button" onClick={onClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary">
                  {submitting ? "Submitting..." : "Submit Feedback"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
