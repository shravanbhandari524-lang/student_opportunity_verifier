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
        <div className="panel-header" style={{ padding: "1.25rem 1.5rem", margin: 0, borderBottom: "1px solid var(--border-divider)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-secondary)" }}>
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            <h2 id="college-modal-title" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
              Draft Inquiry Email to College
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            aria-label="Close modal"
            style={{ width: "28px", height: "28px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "6px" }}>
              Select Institutional Recipient:
            </label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
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
                  style={{ fontSize: "12px" }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {!draft && !loading && (
            <div style={{ textAlign: "center", padding: "1.5rem 1rem", backgroundColor: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-divider)" }}>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "0.85rem", lineHeight: 1.5 }}>
                Generate an official, professional email inquiry asking your college administration or placement cell to verify this notice or circular before you commit funds or sign documents.
              </p>
              <button
                type="button"
                onClick={() => generateDraft(recipient)}
                className="btn btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m5 12 7-7 7 7" />
                  <path d="M12 19V5" />
                </svg>
                <span>Generate Email Draft</span>
              </button>
            </div>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5rem 1rem", gap: "10px" }}>
              <span className="spinner" style={{ width: "18px", height: "18px" }} />
              <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 500 }}>
                Drafting inquiry email with verified identifiers...
              </span>
            </div>
          )}

          {error && (
            <div style={{ padding: "10px 12px", backgroundColor: "var(--status-crimson-bg)", border: "1px solid var(--status-crimson-border)", color: "var(--status-crimson-text)", borderRadius: "var(--radius-sm)", fontSize: "13px" }}>
              {error}
            </div>
          )}

          {draft && !loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div>
                <label style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "4px" }}>
                  Subject Line:
                </label>
                <input
                  type="text"
                  readOnly
                  value={draft.subject || ""}
                  className="input-field"
                  style={{ fontSize: "13px", fontWeight: 500 }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "4px" }}>
                  Email Body:
                </label>
                <textarea
                  readOnly
                  rows={8}
                  value={draft.body || ""}
                  className="input-field font-mono"
                  style={{ fontSize: "12px", whiteSpace: "pre-wrap", lineHeight: 1.55 }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
                <span style={{ fontSize: "12px", color: "var(--status-emerald)", opacity: copied ? 1 : 0, transition: "opacity 150ms var(--ease-out)", fontWeight: 500 }}>
                  ✓ Copied to clipboard
                </span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={copyDraft}
                    className="btn btn-primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    {copied ? (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                        </svg>
                        <span>Copy Subject &amp; Body</span>
                      </>
                    )}
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
        <div className="panel-header" style={{ padding: "1.25rem 1.5rem", margin: 0, borderBottom: "1px solid var(--border-divider)" }}>
          <h2 id="feedback-modal-title" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)" }}>
            Was this assessment accurate?
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            aria-label="Close modal"
            style={{ width: "28px", height: "28px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div style={{ padding: "1.25rem 1.5rem" }}>
          {submitted ? (
            <div style={{ textAlign: "center", padding: "1.5rem 1rem" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  backgroundColor: "var(--status-emerald-bg)",
                  border: "1px solid var(--status-emerald-border)",
                  color: "var(--status-emerald-text)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 0.75rem auto",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--status-emerald-text)" }}>
                Thank you! Your anonymous feedback helps calibrate verification weights.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ fontSize: "13px", fontWeight: 500, display: "block", marginBottom: "8px", color: "var(--text-primary)" }}>
                  Assessment Accuracy:
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setVerdict("right")}
                    className={`btn ${verdict === "right" ? "btn-primary" : "btn-secondary"}`}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>Accurate / Helpful</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerdict("wrong")}
                    className={`btn ${verdict === "wrong" ? "btn-primary" : "btn-secondary"}`}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                    <span>Inaccurate / Missed signal</span>
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="feedback-comment" style={{ fontSize: "12px", fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: "4px" }}>
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
                  style={{ fontSize: "13px" }}
                />
              </div>

              {error && (
                <div style={{ padding: "8px 12px", backgroundColor: "var(--status-crimson-bg)", color: "var(--status-crimson-text)", fontSize: "12px", borderRadius: "var(--radius-sm)", border: "1px solid var(--status-crimson-border)" }}>
                  {error}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border-divider)", paddingTop: "0.75rem" }}>
                <button type="button" onClick={onClose} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  {submitting ? (
                    <>
                      <span className="spinner" style={{ width: "14px", height: "14px" }} />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Submit Feedback</span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
