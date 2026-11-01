"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getReportFraudErrorMessage } from "./errors.js";

// Helpline & portal official source: https://cybercrime.gov.in (National Cyber Crime Helpline: 1930)

const PAYMENT_METHODS = [
  { value: "", label: "Select payment method (optional)" },
  { value: "upi", label: "UPI (Google Pay, PhonePe, Paytm, BHIM)" },
  { value: "netbanking", label: "Net Banking (IMPS / NEFT / RTGS)" },
  { value: "card", label: "Debit / Credit Card" },
  { value: "wallet", label: "Digital Wallet" },
  { value: "cash", label: "Cash / Direct Deposit" },
  { value: "other", label: "Other / Cryptocurrency / Gift Card" },
];

function ReportFraudContent() {
  const searchParams = useSearchParams();
  const initialCheckId = searchParams.get("check") || "";

  const [checkId, setCheckId] = useState(initialCheckId);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [language, setLanguage] = useState("en");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);

  // Sync initial query param if it arrives
  useEffect(() => {
    if (initialCheckId) {
      setCheckId(initialCheckId);
    }
  }, [initialCheckId]);

  // Compute maximum allowed date (today) and minimum allowed date (365 days ago)
  const todayStr = new Date().toISOString().slice(0, 10);
  const minDateStr = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setResult(null);

    const payload = {};
    if (amount && !isNaN(Number(amount)) && Number(amount) > 0) {
      payload.amount = Math.floor(Number(amount));
    }
    if (date) {
      payload.date = date;
    }
    if (paymentMethod) {
      payload.paymentMethod = paymentMethod;
    }
    payload.language = language;

    const endpoint = checkId
      ? `/api/checks/${encodeURIComponent(checkId)}/fraud-summary`
      : `/api/fraud-summary`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorCode(data.code || "REQUEST_FAILED");
        setError(getReportFraudErrorMessage({ status: res.status, code: data.code, message: data.message }));
        return;
      }

      setResult(data);
    } catch {
      setError("Network error connecting to verification service. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.narrative) return;
    try {
      await navigator.clipboard.writeText(result.narrative);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const switchToStandalone = () => {
    setCheckId("");
    setError(null);
    setErrorCode(null);
  };

  return (
    <div style={{ maxWidth: "880px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* Header */}
      <div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "1.75rem" }}>🚨</span>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
            Fraud Assistance & Complaint Generator
          </h1>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.05rem", lineHeight: 1.5 }}>
          If you have transferred money, shared OTPs, or sent personal bank documents to a suspicious offer, take immediate action below.
        </p>
      </div>

      {/* Golden Hour Emergency Action Banner */}
      <div
        className="card"
        style={{
          borderLeft: "4px solid var(--danger-primary, #ef4444)",
          backgroundColor: "var(--bg-card, #ffffff)",
          padding: "1.25rem 1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontWeight: 800, color: "var(--danger-primary, #ef4444)", fontSize: "1rem" }}>
            ⚡ CRITICAL FIRST STEP (GOLDEN HOUR)
          </span>
        </div>
        <p style={{ fontSize: "0.95rem", lineHeight: 1.6, margin: 0 }}>
          Call the <strong>National Cyber Crime Helpline: 1930</strong> immediately. Reporting within the first 2 hours (&quot;Golden Hour&quot;) significantly increases the chances of freezing fraudulent transactions before money is withdrawn by fraudsters.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.25rem" }}>
          <a
            href="tel:1930"
            className="button"
            style={{
              backgroundColor: "var(--danger-primary, #ef4444)",
              color: "#ffffff",
              textDecoration: "none",
              fontWeight: 700,
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            📞 Dial 1930
          </a>
          <a
            href="https://cybercrime.gov.in"
            target="_blank"
            rel="noopener noreferrer"
            className="button button-secondary"
            style={{
              textDecoration: "none",
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            🌐 cybercrime.gov.in ↗
          </a>
        </div>
      </div>

      {/* Mode Notification */}
      {checkId ? (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            backgroundColor: "var(--bg-card-subtle, #f3f4f6)",
            fontSize: "0.9rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Linked to Check ID: <code>{checkId.slice(0, 8)}...</code> (Evidence and quotes from your report will be incorporated)
          </span>
          <button
            type="button"
            onClick={switchToStandalone}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent-primary, #2563eb)",
              cursor: "pointer",
              fontSize: "0.85rem",
              textDecoration: "underline",
            }}
          >
            Switch to standalone mode
          </button>
        </div>
      ) : (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            backgroundColor: "var(--bg-card-subtle, #f3f4f6)",
            fontSize: "0.9rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>
            Standalone Mode: Generating general complaint draft without linked check evidence.
          </span>
          <Link
            href="/check"
            style={{
              color: "var(--accent-primary, #2563eb)",
              fontSize: "0.85rem",
              textDecoration: "underline",
            }}
          >
            Run an offer check first
          </Link>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          className="card"
          style={{
            borderColor: "var(--danger-primary, #ef4444)",
            backgroundColor: "rgba(239, 68, 68, 0.08)",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <strong style={{ color: "var(--danger-primary, #ef4444)" }}>Error:</strong>
          <span style={{ fontSize: "0.95rem" }}>{error}</span>
          {(errorCode === "CHECK_EXPIRED" || errorCode === "NOT_FOUND" || errorCode === "STATE_CONFLICT") && checkId && (
            <button
              type="button"
              onClick={() => {
                switchToStandalone();
                handleSubmit();
              }}
              className="button button-secondary"
              style={{ alignSelf: "flex-start", marginTop: "0.25rem", fontSize: "0.85rem" }}
            >
              Generate Standalone Summary Now
            </button>
          )}
        </div>
      )}

      {/* Incident Input Form */}
      <form onSubmit={handleSubmit} className="card" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>Incident Details (Optional)</h2>
        <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", margin: 0 }}>
          Providing these details formats the complaint narrative ready for submission to your bank and the cybercrime portal.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.9rem", fontWeight: 600 }}>
            <span>Amount Disputed (INR)</span>
            <input
              type="number"
              min="1"
              max="10000000"
              placeholder="e.g. 2500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input"
              style={{ padding: "0.6rem", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.9rem", fontWeight: 600 }}>
            <span>Incident Date</span>
            <input
              type="date"
              max={todayStr}
              min={minDateStr}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
              style={{ padding: "0.6rem", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.9rem", fontWeight: 600 }}>
            <span>Payment Method</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="input"
              style={{ padding: "0.6rem", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.9rem", fontWeight: 600 }}>
            <span>Report Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="input"
              style={{ padding: "0.6rem", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}
            >
              <option value="en">English</option>
              <option value="hi">हिंदी (Hindi)</option>
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="button button-primary"
          style={{
            alignSelf: "flex-start",
            padding: "0.65rem 1.25rem",
            fontWeight: 700,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Generating Draft..." : "Generate Formal Complaint Draft"}
        </button>
      </form>

      {/* Complaint Narrative Output */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>{result.title}</h2>
              <button
                type="button"
                onClick={handleCopy}
                className="button button-secondary"
                style={{
                  padding: "0.4rem 0.8rem",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {copied ? "✓ Copied to Clipboard" : "📋 Copy Complaint Text"}
              </button>
            </div>

            <pre
              style={{
                backgroundColor: "var(--bg-card-subtle, #f9fafb)",
                padding: "1rem",
                borderRadius: "6px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                lineHeight: 1.5,
                border: "1px solid var(--border-subtle)",
                maxHeight: "450px",
                overflowY: "auto",
              }}
            >
              {result.narrative}
            </pre>
          </div>

          {/* Actionable Victim Steps */}
          {result.victimSteps && result.victimSteps.length > 0 && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>Recommended Steps to Protect Yourself</h3>
              <ul style={{ margin: 0, paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {result.victimSteps.map((step, idx) => (
                  <li key={idx} style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Reporting Channels */}
          {result.reportingChannels && result.reportingChannels.length > 0 && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0 }}>Official Reporting Channels</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {result.reportingChannels.map((ch, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "0.75rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border-subtle)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.25rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: "0.95rem" }}>{ch.name}</strong>
                      {ch.verified ? (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            backgroundColor: "rgba(16, 185, 129, 0.15)",
                            color: "var(--success-primary, #10b981)",
                            fontWeight: 700,
                          }}
                        >
                          Official Portal
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: "0.72rem",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            backgroundColor: "rgba(245, 158, 11, 0.15)",
                            color: "var(--warning-primary, #f59e0b)",
                            fontWeight: 600,
                          }}
                        >
                          Advisory (Verify independently)
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{ch.text}</span>
                    {ch.url && (
                      <a
                        href={ch.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--accent-primary, #2563eb)",
                          textDecoration: "underline",
                          marginTop: "0.2rem",
                        }}
                      >
                        {ch.url} ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportFraudPage() {
  return (
    <Suspense fallback={<div className="card">Loading fraud reporting assistant...</div>}>
      <ReportFraudContent />
    </Suspense>
  );
}
